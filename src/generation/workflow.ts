import { access, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join } from 'node:path';
import type { DeviceProfile } from '../devices/deviceProfiles';
import type { FlashProbeProfile } from '../flash/probeProfiles';
import type { FlashTargetProfile } from '../flash/targets/targetProfiles';
import { generateCMakeLists } from '../generator/cmakeGenerator';
import { generateProjectConfig } from '../generator/configGenerator';
import { generateCortexDebugLaunchJson } from '../generator/debugConfigGenerator';
import { generateFlashScript } from '../generator/flashScriptGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateCMakePresets } from '../generator/presetsGenerator';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateSyscalls, generateSysmem, runtimeSourceNames } from '../generator/runtimeGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';
import {
  copyCoreHeaders,
  coreProjectIncludeDir,
  planCoreHeaderCopy,
  type CoreHeaderCopy
} from '../packs/corePack';
import {
  deviceIncludeDir,
  deviceSourceDir,
  type DeviceSupportFile
} from '../packs/deviceSupport';
import { configureCppProperties } from '../integration/cppProperties';
import { getWorkspaceSettings } from '../integration/workspaceSettings';
import { missingOpenOcdNotice, resolveOpenOcdExecutable } from '../flash/openocd';
import {
  configureNativeCppProperties,
  getNativeWorkspaceSettings
} from '../native/integration';
import { generateLinuxCMakeLists } from '../linux/cmakeGenerator';
import { generateLinuxProjectConfig } from '../linux/configGenerator';
import { configureLinuxCppProperties, getLinuxWorkspaceSettings } from '../linux/integration';
import { generateLinuxCMakePresets } from '../linux/presetsGenerator';
import { describeLinuxProject } from '../linux/projectStructure';
import { readLinuxProjectConfig } from '../linux/projectConfig';
import { generateLinuxToolchainFile } from '../linux/toolchainGenerator';
import {
  linuxConfigFileName,
  linuxToolchainFileName,
  type LinuxTargetType,
  type LinuxToolchain,
  type LinuxToolchainHit
} from '../linux/types';
import { generateNativeCMakeLists } from '../native/cmakeGenerator';
import { generateNativeCMakePresets } from '../native/presetsGenerator';
import { nativeConfigFileName, type NativeProjectStructure } from '../native/types';
import type { ProjectDescription } from '../scanner/projectScanner';
import {
  toWorkspacePath,
  writeGeneratedFiles,
  type GeneratedFile
} from '../shared/generatedFiles';
import type { FlashBackendId } from '../flash/backendProfiles';
import type { FlashDeviceContext, FlashExecutablePaths } from '../generator/flashScriptGenerator';

export interface ProjectWorkflowHost {
  workspaceRoot(): string | undefined;
  scanWorkspace(root: string): Promise<ProjectDescription | undefined>;
  confirmOverwrite(existingFiles: string[]): Promise<boolean>;
  updateSettings(settings: Record<string, string | boolean>): Promise<void>;
}

export interface WorkflowResult {
  kind: 'mcu' | 'linux' | 'native' | 'flash' | 'debug';
  ok: boolean;
  cancelled?: boolean;
  files: string[];
  message: string;
  /** Non-fatal problems the caller should surface next to the result. */
  warnings?: string[];
}

export interface McuWorkflowOptions {
  /**
   * Installed ARM CMSIS core pack to copy into the project. Its headers land in
   * `CMSIS/Core/Include` and become an ordinary project include directory, so
   * the generated project builds without pointing at extension storage.
   */
  corePack?: { includeDir: string; version: string };
  /**
   * Device header and `system_*.c`/`.h` snapshot taken from the selected Pack.
   * Without them a generated project has no `SystemInit` and no device header;
   * the startup's weak default keeps it linking, but the vendor clock setup and
   * register definitions only come from these files.
   */
  deviceSupport?: DeviceSupportFile[];
  /**
   * Compiler prefix selected in the sidebar (`arm-none-eabi`). Empty keeps the
   * device profile's default prefix.
   */
  toolchainPrefix?: string;
  flash?: {
    target: FlashTargetProfile;
    probe: FlashProbeProfile;
    openocdPath: string;
    backend?: FlashBackendId;
    device?: FlashDeviceContext;
    executables?: FlashExecutablePaths;
  };
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** True when the file already holds exactly the content about to be written. */
async function hasSameContent(filePath: string, content: string | Buffer): Promise<boolean> {
  try {
    const current = await readFile(filePath);
    return Buffer.isBuffer(content)
      ? current.equals(content)
      : current.toString('utf8') === content;
  } catch {
    // A missing or unreadable file always needs the write.
    return false;
  }
}

/**
 * Files of a generation whose on-disk content differs from the new output.
 *
 * Regenerating an unchanged project must not ask for confirmation, and a file
 * that is missing has nothing to confirm either: both are reported here as
 * "no overwrite needed" so the caller only prompts when something is lost.
 */
async function filesNeedingOverwrite(files: GeneratedFile[]): Promise<string[]> {
  const changed: string[] = [];
  for (const file of files) {
    if (await exists(file.path) && !(await hasSameContent(file.path, file.content))) {
      changed.push(file.path);
    }
  }
  return changed;
}

export function projectNameFromRoot(root: string): string {
  const name = basename(root).replace(/[^A-Za-z0-9_-]/g, '_');
  return name || 'firmware';
}

/**
 * Copies recorded by a previous generation that the current one no longer
 * writes (a core-pack version change drops headers, a pack switch drops the
 * previous device header and system source).
 *
 * Only directories the generator owns are cleaned: a stale `core_cm*.h` or
 * `system_*.c` left behind would still be compiled, and the two files must not
 * drift apart from the selected series.
 */
async function findObsoleteCopies(
  root: string,
  configPath: string,
  keepRelatives: string[],
  managedPrefixesLower: string[]
): Promise<string[]> {
  let recorded: string[] = [];
  try {
    const parsed = JSON.parse(await readFile(configPath, 'utf8')) as { generatedFiles?: unknown };
    recorded = Array.isArray(parsed.generatedFiles)
      ? parsed.generatedFiles.filter((value): value is string => typeof value === 'string')
      : [];
  } catch {
    return [];
  }
  const keep = new Set(keepRelatives.map((relative) => relative.replace(/\\/g, '/').toLowerCase()));
  const obsolete: string[] = [];
  for (const relative of recorded) {
    const normalized = relative.replace(/\\/g, '/').toLowerCase();
    if (keep.has(normalized)) {
      continue;
    }
    if (!managedPrefixesLower.some((prefix) => normalized.startsWith(prefix))) {
      continue;
    }
    const absolute = join(root, relative);
    if (await exists(absolute)) {
      obsolete.push(absolute);
    }
  }
  return obsolete;
}

/**
 * The scanned project without the copied core-header directory.
 *
 * After the first generation those headers exist in the project and the scanner
 * reports `CMSIS/Include` as a normal include directory. The generated
 * CMakeLists adds it explicitly as a project path, so keeping the scanned copy
 * would change the include block between the first and second generation and
 * ask the user to overwrite an otherwise identical file.
 */
function generatedProjectOf(
  project: ProjectDescription,
  corePlan: CoreHeaderCopy[],
  deviceSupport: DeviceSupportFile[]
): ProjectDescription {
  const strip = (value: string): string => {
    const normalized = value.split(String.fromCharCode(92)).join('/');
    return (normalized.endsWith('/') ? normalized.slice(0, -1) : normalized).toLowerCase();
  };
  // The copied CMSIS directories and the device system source are generated on
  // every run; a scan of the project sees them as ordinary sources and include
  // directories, which would change the CMakeLists between runs and ask to
  // overwrite identical output.
  const managedIncludes = new Set<string>();
  if (corePlan.length > 0) {
    managedIncludes.add(coreProjectIncludeDir.toLowerCase());
  }
  if (deviceSupport.some((file) => file.relative.startsWith(`${deviceIncludeDir}/`))) {
    managedIncludes.add(deviceIncludeDir.toLowerCase());
  }
  const managedSourcePrefix = `${deviceSourceDir.toLowerCase()}/`;
  // Sub-directories of a managed include root come from the same copy (the
  // scanner reports `CMSIS/Include/m-profile` separately) and must not leak into
  // the generated include list.
  const isManagedInclude = (directory: string): boolean => {
    const normalized = strip(directory);
    return [...managedIncludes].some((managed) => normalized === managed || normalized.startsWith(`${managed}/`));
  };
  return {
    ...project,
    includeDirs: project.includeDirs.filter((directory) => !isManagedInclude(directory)),
    sources: project.sources.filter((source) => !strip(source).startsWith(managedSourcePrefix))
  };
}

function createMcuFiles(
  root: string,
  projectName: string,
  profile: DeviceProfile,
  project: ProjectDescription,
  existingCMakeContent: string | undefined,
  options: McuWorkflowOptions,
  corePlan: CoreHeaderCopy[],
  deviceSupport: DeviceSupportFile[]
): GeneratedFile[] {
  const cmakeDir = join(root, 'cmake');
  const hasSource = (fileName: string): boolean => {
    const sourceBasename = basename(fileName).toLowerCase();
    return project.sources.some((source) => basename(source).toLowerCase() === sourceBasename);
  };
  // Copied headers are an ordinary project directory, so the include stays
  // relative and the project keeps building outside this machine.
  const files: GeneratedFile[] = [{
    path: join(root, 'CMakeLists.txt'),
    content: generateCMakeLists(projectName, generatedProjectOf(project, corePlan, deviceSupport), profile, existingCMakeContent, {
      projectPaths: [
        ...(corePlan.length > 0 ? [coreProjectIncludeDir] : []),
        ...(deviceSupport.some((file) => file.relative.startsWith(`${deviceIncludeDir}/`)) ? [deviceIncludeDir] : [])
      ],
      generatedSources: deviceSupport
        .filter((file) => file.relative.startsWith(`${deviceSourceDir}/`))
        .map((file) => file.relative)
    })
  }];

  if (!hasSource(runtimeSourceNames[0])) {
    files.push({
      path: join(root, runtimeSourceNames[0]),
      content: generateSyscalls()
    });
  }
  if (!hasSource(runtimeSourceNames[1])) {
    files.push({
      path: join(root, runtimeSourceNames[1]),
      content: generateSysmem()
    });
  }
  files.push(
    {
      path: join(root, profile.gnuStartupFileName),
      content: generateGnuStartup(profile)
    },
    {
      path: join(cmakeDir, profile.toolchainFileName),
      content: generateToolchainFile(profile)
    },
    {
      path: join(root, profile.linkerFileName),
      content: generateLinkerScript(profile)
    },
    {
      path: join(root, 'CMakePresets.json'),
      content: generateCMakePresets(profile.toolchainFileName)
    }
  );
  const flash = options.flash;
  if (flash) {
    files.push({
      path: join(root, 'flash.py'),
      content: generateFlashScript(
        projectName,
        flash.target,
        flash.probe,
        flash.openocdPath,
        flash.backend ?? 'openocd',
        flash.device,
        flash.executables
      )
    });
  }
  return files;
}

/**
 * Drops the Pack's device support files when the project already ships them.
 *
 * Projects migrated from a vendor firmware repository usually import their own
 * `CMSIS/GD/<series>/Include` and `Source/system_<stem>.c`. Copying the DFP copy
 * next to those compiles `SystemInit` twice, mixes register definitions from two
 * header versions, and the link fails — the debugger then has no executable.
 */
async function deviceSupportWithoutProjectCopies(
  root: string,
  project: ProjectDescription,
  files: DeviceSupportFile[]
): Promise<{ files: DeviceSupportFile[]; reused: string[] }> {
  if (files.length === 0) {
    return { files, reused: [] };
  }
  const sourceNames = new Set(project.sources.map((source) => basename(source).toLowerCase()));
  const includeEntries = project.includeDirs
    .map((directory) => {
      const normalized = directory.replace(/\\/g, '/');
      return normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
    })
    .filter((directory) => directory.length > 0 && !isAbsolute(directory));
  const headerProvided = async (relative: string): Promise<boolean> => {
    const name = basename(relative);
    for (const directory of includeEntries) {
      if (await exists(join(root, directory, name))) {
        return true;
      }
    }
    return false;
  };

  // Only the device header and the system source identify "the project already
  // has device support". Auxiliary headers (`RTE_Components.h`, the vendor
  // umbrella and the single RCU header) are commonly shipped by a driver
  // library the project already contains; seeing one must not suppress the
  // device header itself.
  const isPrimarySupportFile = (relative: string): boolean => {
    if (relative.startsWith(`${deviceSourceDir}/`)) {
      return true;
    }
    const name = basename(relative).toLowerCase();
    return !/^(rte_components|.*_libopt|.*_rcu|.*_rcc)\.h$/.test(name);
  };

  for (const file of files) {
    if (!isPrimarySupportFile(file.relative)) {
      continue;
    }
    const name = basename(file.relative).toLowerCase();
    const provided = file.relative.startsWith(`${deviceSourceDir}/`)
      ? sourceNames.has(name)
      : await headerProvided(file.relative);
    if (provided) {
      return { files: [], reused: files.map((entry) => entry.relative) };
    }
  }
  return { files, reused: [] };
}

/**
 * Warns when a copied vendor umbrella header (`*_conf.h`) pulls in a driver
 * library the project does not contain.
 *
 * Some vendor device headers force `USE_STDPERIPH_DRIVER` themselves and then
 * include a configuration header that lists peripheral driver headers. The
 * generator does not copy driver libraries, so the build only works after the
 * user adds that driver folder to the project (or their own configuration
 * header).
 */
async function missingUmbrellaIncludes(
  root: string,
  project: ProjectDescription,
  files: DeviceSupportFile[]
): Promise<string[]> {
  const umbrella = files.find((file) => /_conf\.h$/i.test(file.relative));
  if (!umbrella) {
    return [];
  }
  const known = new Set(files.map((file) => basename(file.relative).toLowerCase()));
  const includeEntries = project.includeDirs
    .map((directory) => directory.replace(/\\/g, '/'))
    .map((directory) => (directory.endsWith('/') ? directory.slice(0, -1) : directory))
    .filter((directory) => directory.length > 0 && !isAbsolute(directory));
  const available = new Set<string>();
  for (const directory of includeEntries) {
    let names: string[];
    try {
      names = await readdir(join(root, directory));
    } catch {
      continue;
    }
    for (const name of names) {
      available.add(name.toLowerCase());
    }
  }
  const missing: string[] = [];
  for (const match of umbrella.content.toString('utf8').matchAll(/#\s*include\s+"([^"]+)"/g)) {
    const name = (match[1].replace(/\\/g, '/').split('/').pop() ?? match[1]).toLowerCase();
    if (!known.has(name) && !available.has(name)) {
      missing.push(name);
    }
  }
  return [...new Set(missing)];
}

export async function generateMcuWorkflow(
  host: ProjectWorkflowHost,
  profile: DeviceProfile,
  options: McuWorkflowOptions
): Promise<WorkflowResult> {
  const root = host.workspaceRoot();
  if (!root) {
    return {
      kind: 'mcu',
      ok: false,
      files: [],
      message: '请先打开一个 MCU 工程目录。'
    };
  }
  const project = await host.scanWorkspace(root);
  if (!project) {
    return {
      kind: 'mcu',
      ok: false,
      cancelled: true,
      files: [],
      message: '工作区扫描已取消。'
    };
  }
  if (project.sources.length === 0) {
    return {
      kind: 'mcu',
      ok: false,
      files: [],
      message: '工作区中没有找到 C/C++ 或汇编源文件。'
    };
  }

  const projectName = projectNameFromRoot(root);
  // The toolchain selection overrides the device profile's default prefix; the
  // rest of the profile (memory map, startup, linker) is untouched.
  const requestedPrefix = options.toolchainPrefix?.trim().replace(/-+$/, '');
  const effectiveProfile = requestedPrefix
    ? { ...profile, toolchainPrefix: requestedPrefix }
    : profile;
  const cmakePath = join(root, 'CMakeLists.txt');
  const existingCMakeContent = await exists(cmakePath)
    ? await readFile(cmakePath, 'utf8')
    : undefined;
  // The headers are copied into the project like any other generated file, so
  // they take part in the overwrite check and the reported file list.
  const corePlan = options.corePack
    ? await planCoreHeaderCopy(options.corePack.includeDir, root, coreProjectIncludeDir, effectiveProfile.core)
    : [];
  // The guard must look at the project *without* the generator-owned CMSIS
  // directories: otherwise a previous generation's own copies look like
  // user-provided files and the next run stops refreshing them.
  const deviceSupportPlan = await deviceSupportWithoutProjectCopies(
    root,
    generatedProjectOf(project, corePlan, options.deviceSupport ?? []),
    options.deviceSupport ?? []
  );
  const deviceSupport = deviceSupportPlan.files;
  const missingUmbrella = await missingUmbrellaIncludes(root, project, deviceSupport);
  const generatedFiles = createMcuFiles(
    root,
    projectName,
    effectiveProfile,
    project,
    existingCMakeContent,
    options,
    corePlan,
    deviceSupport
  );
  const configPath = join(root, '.mcu-cmake.json');
  const settingsPath = join(root, '.vscode', 'settings.json');
  const cppPropertiesPath = join(root, '.vscode', 'c_cpp_properties.json');
  const cppPropertiesContent = await exists(cppPropertiesPath)
    ? await readFile(cppPropertiesPath, 'utf8')
    : undefined;
  const cppPropertiesFile: GeneratedFile = {
    path: cppPropertiesPath,
    content: configureCppProperties(
      cppPropertiesContent,
      `${effectiveProfile.toolchainPrefix}-gcc`
    )
  };

  // Regenerating an unchanged project must not ask for confirmation, so only
  // files whose content actually differs are offered for overwrite.
  const changedFiles = await filesNeedingOverwrite([...generatedFiles, cppPropertiesFile]);
  const changedCorePlan: CoreHeaderCopy[] = [];
  const copyCorePlan: CoreHeaderCopy[] = [];
  for (const entry of corePlan) {
    if (await exists(entry.target)) {
      const source = await readFile(entry.source);
      if (await hasSameContent(entry.target, source)) {
        // Identical copy: do not rewrite it and do not ask about it.
        continue;
      }
      changedCorePlan.push(entry);
    }
    copyCorePlan.push(entry);
  }
  const changedDeviceFiles: DeviceSupportFile[] = [];
  const copyDeviceFiles: DeviceSupportFile[] = [];
  for (const file of deviceSupport) {
    const target = join(root, file.relative);
    const current = await exists(target) ? await readFile(target) : undefined;
    if (current && current.equals(file.content)) {
      // Identical copy: leave it alone so editors and the C/C++ index are not
      // reloaded on every generation.
      continue;
    }
    if (current) {
      changedDeviceFiles.push(file);
    }
    copyDeviceFiles.push(file);
  }
  const managedPrefixes = [
    ...(corePlan.length > 0 ? [`${coreProjectIncludeDir.toLowerCase()}/`] : []),
    ...(deviceSupport.some((file) => file.relative.startsWith(`${deviceIncludeDir}/`))
      ? [`${deviceIncludeDir.toLowerCase()}/`]
      : []),
    ...(deviceSupport.some((file) => file.relative.startsWith(`${deviceSourceDir}/`))
      ? [`${deviceSourceDir.toLowerCase()}/`]
      : [])
  ];
  const obsoleteCopies = await findObsoleteCopies(
    root,
    configPath,
    [...corePlan.map((entry) => entry.relative), ...deviceSupport.map((file) => file.relative)],
    managedPrefixes
  );
  const overwrittenFiles = [
    ...changedFiles,
    ...changedCorePlan.map((entry) => entry.target),
    ...changedDeviceFiles.map((file) => join(root, file.relative)),
    ...obsoleteCopies
  ];
  if (overwrittenFiles.length > 0 && !(await host.confirmOverwrite(overwrittenFiles))) {
    return {
      kind: 'mcu',
      ok: false,
      cancelled: true,
      files: [],
      message: '已取消覆盖。'
    };
  }
  // Files the current Pack or core version no longer ships are removed after the
  // same confirmation: the copy directories are owned by the generator.
  for (const obsolete of obsoleteCopies) {
    await rm(obsolete, { force: true });
  }

  await mkdir(join(root, 'cmake'), { recursive: true });
  await mkdir(join(root, 'system'), { recursive: true });
  await mkdir(join(root, '.vscode'), { recursive: true });
  const configFile: GeneratedFile = {
    path: configPath,
    content: generateProjectConfig(
      projectName,
      effectiveProfile,
      [
        ...generatedFiles.map((file) => toWorkspacePath(root, file.path)),
        ...corePlan.map((entry) => toWorkspacePath(root, entry.target)),
        ...deviceSupport.map((file) => file.relative),
        toWorkspacePath(root, settingsPath),
        toWorkspacePath(root, cppPropertiesPath)
      ],
      overwrittenFiles.map((filePath) => toWorkspacePath(root, filePath)),
      options.flash
        ? {
            script: 'flash.py',
            probe: options.flash.probe.id,
            interfaceConfig: options.flash.probe.interfaceConfig,
            openocdPath: options.flash.openocdPath,
            target: options.flash.target.targetConfig,
            transport: options.flash.target.transport
          }
        : undefined
    )
  };
  await writeGeneratedFiles([...generatedFiles, configFile, cppPropertiesFile]);
  await copyCoreHeaders(copyCorePlan);
  for (const file of copyDeviceFiles) {
    const target = join(root, file.relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
  await host.updateSettings(getWorkspaceSettings());
  return {
    kind: 'mcu',
    ok: true,
    files: [
      ...generatedFiles,
      configFile,
      cppPropertiesFile,
      { path: settingsPath, content: '' },
      ...corePlan.map((entry) => ({ path: entry.target, content: '' })),
      ...deviceSupport.map((file) => ({ path: join(root, file.relative), content: '' }))
    ].map((file) => toWorkspacePath(root, file.path)),
    warnings: (() => {
      const warnings: string[] = [];
      if (deviceSupportPlan.reused.length > 0) {
        warnings.push(`工程里已有该系列的器件头/ system 文件（${deviceSupportPlan.reused.map((relative) => basename(relative)).join('、')}），本次未重复复制，避免 SystemInit 被编译两次。`);
      }
      if (missingUmbrella.length > 0) {
        warnings.push(`器件头通过厂商配置头引入了外设驱动库（${missingUmbrella.slice(0, 4).join('、')}${missingUmbrella.length > 4 ? '…' : ''}），本插件不复制驱动库：请把厂商驱动目录加入工程 include 路径后再编译。`);
      }
      return warnings.length > 0 ? warnings : undefined;
    })(),
    message: [
      `已为 ${effectiveProfile.part} 生成 CMake 工程，共扫描到 ${project.sources.length} 个源文件`,
      options.corePack ? `，写入 ${effectiveProfile.core} 内核头文件（${options.corePack.version}）` : '',
      deviceSupport.length > 0 ? `，并复制该系列的器件头文件与 system 启动文件` : '',
      '。'
    ].join('')
  };
}

export interface LinuxWorkflowOptions {
  /** Output kind; falls back to the previous generation, then an executable. */
  targetType?: LinuxTargetType;
  /** Preprocessor definitions; falls back to the previous generation. */
  defines?: string[];
  /** Target root; falls back to the previous generation. */
  sysroot?: string;
}

export async function generateLinuxWorkflow(
  host: ProjectWorkflowHost,
  toolchain: LinuxToolchain | LinuxToolchainHit,
  options: LinuxWorkflowOptions = {}
): Promise<WorkflowResult> {
  const root = host.workspaceRoot();
  if (!root) {
    return {
      kind: 'linux',
      ok: false,
      files: [],
      message: '请先打开一个工程目录。'
    };
  }
  const project = await host.scanWorkspace(root);
  if (!project) {
    return {
      kind: 'linux',
      ok: false,
      cancelled: true,
      files: [],
      message: '工作区扫描已取消。'
    };
  }
  if (project.sources.length === 0) {
    return {
      kind: 'linux',
      ok: false,
      files: [],
      message: '工作区中没有找到 C/C++ 或汇编源文件。'
    };
  }

  const configPath = join(root, linuxConfigFileName);
  const saved = await readLinuxProjectConfig(configPath);
  const sysroot = options.sysroot?.trim() || saved?.sysroot;
  const structure = describeLinuxProject(
    project,
    projectNameFromRoot(root),
    options.defines ?? saved?.defines ?? [],
    options.targetType ?? saved?.targetType ?? 'executable',
    sysroot
  );
  const cmakePath = join(root, 'CMakeLists.txt');
  const existingCMakeContent = await exists(cmakePath)
    ? await readFile(cmakePath, 'utf8')
    : undefined;
  const generatedFiles: GeneratedFile[] = [
    {
      path: cmakePath,
      content: generateLinuxCMakeLists(structure, existingCMakeContent)
    },
    {
      path: join(root, 'CMakePresets.json'),
      content: generateLinuxCMakePresets()
    },
    {
      path: join(root, 'cmake', linuxToolchainFileName),
      content: generateLinuxToolchainFile({ ...toolchain, sysroot })
    }
  ];
  const settingsPath = join(root, '.vscode', 'settings.json');
  const cppPropertiesPath = join(root, '.vscode', 'c_cpp_properties.json');
  const cppPropertiesFile: GeneratedFile = {
    path: cppPropertiesPath,
    content: configureLinuxCppProperties(
      await exists(cppPropertiesPath) ? await readFile(cppPropertiesPath, 'utf8') : undefined,
      toolchain
    )
  };
  // Same rule as the MCU direction: only content that actually changes is
  // offered for overwrite, so an unchanged regeneration runs silently.
  const existingFiles = await filesNeedingOverwrite([...generatedFiles, cppPropertiesFile]);
  if (existingFiles.length > 0 && !(await host.confirmOverwrite(existingFiles))) {
    return {
      kind: 'linux',
      ok: false,
      cancelled: true,
      files: [],
      message: '已取消覆盖。'
    };
  }

  const configFile: GeneratedFile = {
    path: configPath,
    content: generateLinuxProjectConfig(
      structure.targetName,
      toolchain,
      structure,
      [
        ...generatedFiles.map((file) => toWorkspacePath(root, file.path)),
        toWorkspacePath(root, settingsPath),
        toWorkspacePath(root, cppPropertiesPath)
      ],
      existingFiles.map((filePath) => toWorkspacePath(root, filePath))
    )
  };
  await mkdir(join(root, 'cmake'), { recursive: true });
  await mkdir(join(root, '.vscode'), { recursive: true });
  await writeGeneratedFiles([...generatedFiles, configFile, cppPropertiesFile]);
  await host.updateSettings(getLinuxWorkspaceSettings());
  return {
    kind: 'linux',
    ok: true,
    files: [
      ...generatedFiles,
      configFile,
      cppPropertiesFile,
      { path: settingsPath, content: '' }
    ].map((file) => toWorkspacePath(root, file.path)),
    message: `已生成 Linux 交叉编译工程，共扫描到 ${structure.sources.length} 个源文件。`
  };
}

export async function generateNativeWorkflow(
  host: ProjectWorkflowHost,
  structure: NativeProjectStructure
): Promise<WorkflowResult> {
  const root = host.workspaceRoot();
  if (!root) {
    return {
      kind: 'native',
      ok: false,
      files: [],
      message: '请先打开一个 C/C++ 工程目录。'
    };
  }
  const cmakePath = join(root, 'CMakeLists.txt');
  const existingCMakeContent = await exists(cmakePath)
    ? await readFile(cmakePath, 'utf8')
    : undefined;
  const generatedFiles: GeneratedFile[] = [
    {
      path: cmakePath,
      content: generateNativeCMakeLists(structure, existingCMakeContent)
    },
    {
      path: join(root, 'CMakePresets.json'),
      content: generateNativeCMakePresets()
    }
  ];
  const configPath = join(root, nativeConfigFileName);
  const settingsPath = join(root, '.vscode', 'settings.json');
  const cppPropertiesPath = join(root, '.vscode', 'c_cpp_properties.json');
  const cppPropertiesFile: GeneratedFile = {
    path: cppPropertiesPath,
    content: configureNativeCppProperties(
      await exists(cppPropertiesPath) ? await readFile(cppPropertiesPath, 'utf8') : undefined
    )
  };
  // Only content that actually changes needs a confirmation, as in the MCU and
  // Linux directions.
  const existingFiles = await filesNeedingOverwrite([...generatedFiles, cppPropertiesFile]);
  if (existingFiles.length > 0 && !(await host.confirmOverwrite(existingFiles))) {
    return {
      kind: 'native',
      ok: false,
      cancelled: true,
      files: [],
      message: '已取消覆盖。'
    };
  }

  const configFile: GeneratedFile = {
    path: configPath,
    content: `${JSON.stringify({
      projectName: structure.targetName,
      kind: 'native',
      targetType: structure.targetType,
      structure: {
        sourceCount: structure.sources.length,
        includeDirs: structure.includeDirs,
        defines: structure.defines,
        cStandard: structure.cStandard,
        cxxStandard: structure.cxxStandard,
        toolchain: structure.toolchain ?? null
      },
      defines: structure.defines,
      generatedFiles: [
        ...generatedFiles.map((file) => toWorkspacePath(root, file.path)),
        toWorkspacePath(root, settingsPath),
        toWorkspacePath(root, cppPropertiesPath)
      ],
      overwrittenFiles: existingFiles.map((filePath) => toWorkspacePath(root, filePath))
    }, null, 2)}\n`
  };
  await mkdir(join(root, '.vscode'), { recursive: true });
  await writeGeneratedFiles([...generatedFiles, configFile, cppPropertiesFile]);
  await host.updateSettings(getNativeWorkspaceSettings());
  return {
    kind: 'native',
    ok: true,
    files: [
      ...generatedFiles,
      configFile,
      cppPropertiesFile,
      { path: settingsPath, content: '' }
    ].map((file) => toWorkspacePath(root, file.path)),
    message: `已生成普通 C/C++ CMake 工程，共扫描到 ${structure.sources.length} 个源文件。`
  };
}

export async function generateFlashWorkflow(
  host: ProjectWorkflowHost,
  target: FlashTargetProfile,
  probe: FlashProbeProfile,
  openocdPath: string,
  backend: FlashBackendId = 'openocd',
  device?: FlashDeviceContext,
  executables: FlashExecutablePaths = {}
): Promise<WorkflowResult> {
  const root = host.workspaceRoot();
  if (!root) {
    return {
      kind: 'flash',
      ok: false,
      files: [],
      message: '请先打开一个 MCU 工程目录。'
    };
  }
  const flashPath = join(root, 'flash.py');
  const script = generateFlashScript(
    projectNameFromRoot(root),
    target,
    probe,
    openocdPath,
    backend,
    device,
    executables
  );
  const existingFiles = await filesNeedingOverwrite([{ path: flashPath, content: script }]);
  if (existingFiles.length > 0 && !(await host.confirmOverwrite(existingFiles))) {
    return {
      kind: 'flash',
      ok: false,
      cancelled: true,
      files: [],
      message: '已取消覆盖 flash.py。'
    };
  }
  // An unchanged script needs no write either: keep the file's timestamp so a
  // rerun does not look like it produced new output.
  if (existingFiles.length > 0 || !(await hasSameContent(flashPath, script))) {
    await writeFile(flashPath, script, 'utf8');
  }
  return {
    kind: 'flash',
    ok: true,
    files: ['flash.py'],
    message: backend === 'openocd'
      ? `已生成 ${target.label} 的 OpenOCD 烧录脚本。`
      : `已生成 ${device?.part ?? target.label} 的 ${backend} 烧录脚本。`
  };
}

/**
 * OpenOCD script roots for the generated Cortex-Debug configuration.
 *
 * Mirrors the order the generated flash.py uses, because both must resolve the
 * same interface/target files: `OPENOCD_SCRIPTS`, then the layouts around the
 * executable (Windows zip, Linux packages, macOS Homebrew).
 */
async function findOpenOcdSearchDirs(
  openocdPath: string,
  environment: NodeJS.ProcessEnv = process.env
): Promise<string[]> {
  const candidates: string[] = [];
  const environmentRoot = environment.OPENOCD_SCRIPTS?.trim();
  if (environmentRoot) {
    candidates.push(environmentRoot);
  }
  if (isAbsolute(openocdPath)) {
    const prefix = dirname(dirname(openocdPath));
    candidates.push(
      join(prefix, 'scripts'),
      join(prefix, 'share', 'openocd', 'scripts'),
      join(prefix, 'openocd', 'scripts'),
      join(dirname(openocdPath), 'scripts')
    );
  }
  for (const candidate of new Set(candidates)) {
    if (await exists(join(candidate, 'target'))) {
      return [candidate];
    }
  }
  return [];
}

/** True when one of the generated presets has produced a debug/release ELF. */
async function hasBuiltExecutable(root: string): Promise<boolean> {
  for (const preset of ['debug', 'release']) {
    try {
      const files = await readdir(join(root, 'build', preset));
      if (files.some((name) => name.toLowerCase().endsWith('.elf'))) {
        return true;
      }
    } catch {
      // The preset has not been configured yet.
    }
  }
  return false;
}

export async function generateDebugWorkflow(
  host: ProjectWorkflowHost,
  target: FlashTargetProfile,
  probe: FlashProbeProfile,
  openocdPath: string,
  backend: FlashBackendId = 'openocd',
  device?: FlashDeviceContext,
  options: { toolchainPrefix?: string } = {}
): Promise<WorkflowResult> {
  const root = host.workspaceRoot();
  if (!root) {
    return {
      kind: 'debug',
      ok: false,
      files: [],
      message: '请先打开一个 MCU 工程目录。'
    };
  }
  const launchPath = join(root, '.vscode', 'launch.json');
  const existingContent = await exists(launchPath)
    ? await readFile(launchPath, 'utf8')
    : undefined;
  const content = generateCortexDebugLaunchJson(existingContent, {
    openocdPath,
    target,
    probe,
    backend,
    device,
    // The presets always build into build/<preset>/, so the executable does not
    // depend on CMake Tools having a selected launch target.
    executable: `\${workspaceFolder}/build/debug/${projectNameFromRoot(root)}.elf`,
    searchDirs: backend === 'openocd' ? await findOpenOcdSearchDirs(openocdPath) : [],
    ...(options.toolchainPrefix ? { toolchainPrefix: options.toolchainPrefix } : {})
  });
  await mkdir(join(root, '.vscode'), { recursive: true });
  // launch.json is merged rather than replaced, so an identical merge result
  // needs no write and keeps the file's modification time intact.
  if (content !== existingContent) {
    await writeFile(launchPath, content, 'utf8');
  }
  const warnings: string[] = [];
  if (backend === 'openocd' && !resolveOpenOcdExecutable(openocdPath)) {
    warnings.push(missingOpenOcdNotice(openocdPath));
  }
  // `${command:cmake.launchTargetPath}` resolves to an empty path until a preset
  // has been built, which also closes the F5 session immediately.
  if (!(await hasBuiltExecutable(root))) {
    warnings.push('还没有构建产物：按 F5 前先构建（cmake --build --preset debug），否则调试会话会立即退出。');
  }
  return {
    kind: 'debug',
    ok: true,
    files: ['.vscode/launch.json'],
    message: backend === 'openocd'
      ? `已生成 ${target.label} 和 ${probe.label} 的 Cortex-Debug 配置。`
      : `已生成 ${device?.part ?? target.label} 的 Cortex-Debug（${backend}）配置。`,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}
