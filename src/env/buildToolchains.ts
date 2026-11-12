/**
 * Compiler toolchain discovery for the MCU and desktop directions.
 *
 * The MCU direction always offers three families: Arm GNU Toolchain (arm-none-eabi
 * GCC), Arm Compiler 6 (armclang) and LLVM clang. They are looked up on `PATH`
 * and in the usual installation roots (Keil MDK, STM32CubeCLT, Arm GNU
 * Toolchain/LLVM under Program Files); the scan only marks which family is
 * installed, because a project may be generated here and built elsewhere.
 *
 * Desktop discovery lists the host compilers on `PATH` (gcc, clang, MinGW
 * prefixes), which is what a desktop CMake project can use.
 *
 * No external process runs: candidates are recognised by executable names.
 */

import { readdirSync } from 'node:fs';

export type BuildToolchainDirection = 'mcu';
export type McuToolchainFamily = 'gcc' | 'armclang' | 'clang';

export interface BuildToolchain {
  /** Stable selection id: `mcu:gcc`, `mcu:armclang`, `mcu:clang`. */
  id: string;
  direction: BuildToolchainDirection;
  /** MCU compiler family. */
  family?: McuToolchainFamily;
  /** GCC prefix (`arm-none-eabi`); empty for armclang and host compilers. */
  prefix: string;
  /** C compiler command name when it is on PATH, otherwise its absolute path. */
  cCompiler: string;
  /** C++ compiler command name/path, when the installation ships one. */
  cxxCompiler?: string;
  /** Absolute compiler path (always set; used when the toolchain is off PATH). */
  cCompilerPath: string;
  /** Absolute `fromelf` path for armclang (hex/bin conversion). */
  fromelf?: string;
  /** True when a real installation was found; the options stay selectable when false. */
  detected?: boolean;
  /** Absolute objcopy/size paths when the GCC toolchain is not on PATH. */
  objcopy?: string;
  size?: string;
  /** True when `binDir` is a `PATH` entry, so command names are portable. */
  onPath: boolean;
  binDir: string;
  label: string;
  detail: string;
}

export interface BuildToolchainFileSystem {
  readDir(path: string): string[];
}

const defaultFileSystem: BuildToolchainFileSystem = {
  readDir: (path) => readdirSync(path)
};

const executableExtensions = ['.exe', ''];

function normalizedDirectory(directory: string): string {
  return directory.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
}

function environmentPathEntries(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string[] {
  const value = environment.PATH ?? environment.Path ?? '';
  return value
    .split(platform === 'win32' ? ';' : ':')
    .map((entry) => entry.trim().replace(/\\/g, '/').replace(/\/+$/, ''))
    .filter((entry) => entry.length > 0);
}

interface DirectoryListing {
  /** Executable base names without the `.exe` suffix. */
  names: Set<string>;
  /** Lower-cased base name → file name as it exists on disk (keeps `.exe`). */
  files: Map<string, string>;
}

function listDirectory(fileSystem: BuildToolchainFileSystem, directory: string): DirectoryListing {
  let entries: string[] = [];
  try {
    entries = fileSystem.readDir(directory.replace(/\\/g, '/'));
  } catch {
    return { names: new Set(), files: new Map() };
  }
  const names = new Set<string>();
  const files = new Map<string, string>();
  for (const entry of entries) {
    const lowered = entry.toLowerCase();
    const extension = executableExtensions.find((candidate) => lowered.endsWith(candidate));
    if (extension === undefined) {
      continue;
    }
    const base = extension === '' ? entry : entry.slice(0, -extension.length);
    names.add(base);
    files.set(base.toLowerCase(), entry);
  }
  return { names, files };
}

function joinPath(base: string, name: string): string {
  return `${base.replace(/\\/g, '/').replace(/\/+$/, '')}/${name.replace(/\\/g, '/')}`;
}

function probeCompiler(
  fileSystem: BuildToolchainFileSystem,
  directory: string,
  basename: string
): string | undefined {
  const listing = listDirectory(fileSystem, directory);
  const file = listing.files.get(basename.toLowerCase());
  return file === undefined ? undefined : joinPath(directory, file);
}

/** Absolute directories worth probing in addition to `PATH`. */
interface CompilerSearchRoots {
  /** Candidate Keil MDK `ARM/ARMCLANG/bin` directories. */
  armclangDirs: string[];
  /** Candidate directories containing arm-none-eabi-gcc. */
  gccDirs: string[];
  /** Candidate directories containing LLVM clang. */
  clangDirs: string[];
}

function pushDirectory(list: string[], directory: string | undefined): void {
  if (directory && !list.includes(directory)) {
    list.push(directory);
  }
}

function readChildren(fileSystem: BuildToolchainFileSystem, directory: string): string[] {
  try {
    return fileSystem.readDir(directory.replace(/\\/g, '/'));
  } catch {
    return [];
  }
}

/**
 * Common installation roots for the two MCU families.
 *
 * Keil installs armclang under `<Keil>/ARM/ARMCLANG/bin`; GNU toolchains are
 * unpacked either directly (`Arm GNU Toolchain arm-none-eabi/<version>/bin`) or
 * as part of STM32CubeCLT (`ST/STM32CubeCLT_<version>/GNU-tools-for-STM32/bin`).
 */
function defaultSearchRoots(
  environment: NodeJS.ProcessEnv,
  fileSystem: BuildToolchainFileSystem,
  platform: NodeJS.Platform
): CompilerSearchRoots {
  const armclangDirs: string[] = [];
  const gccDirs: string[] = [];
  const clangDirs: string[] = [];
  const hints = environmentHintDirectories(environment, platform);
  gccDirs.push(...hints);
  armclangDirs.push(...hints);
  clangDirs.push(...hints);

  if (platform !== 'win32') {
    // POSIX installs are usually on PATH, but standalone Arm Compiler and
    // toolchains unpacked under /opt are common enough to probe.
    for (const root of ['/opt/arm', '/opt/Arm', '/opt/arm-none-eabi', '/usr/local/Arm', '/usr/local/arm']) {
      pushDirectory(gccDirs, root);
      pushDirectory(gccDirs, `${root}/bin`);
      pushDirectory(armclangDirs, root);
      pushDirectory(armclangDirs, `${root}/bin`);
      for (const child of readChildren(fileSystem, root)) {
        pushDirectory(armclangDirs, `${root}/${child}/bin`);
        pushDirectory(gccDirs, `${root}/${child}/bin`);
      }
    }
    for (const root of ['/opt/llvm', '/opt/LLVM', '/usr/local/llvm', '/usr/local/LLVM', '/usr/lib/llvm']) {
      pushDirectory(clangDirs, `${root}/bin`);
      for (const child of readChildren(fileSystem, root)) {
        pushDirectory(clangDirs, `${root}/${child}/bin`);
      }
    }
    return { armclangDirs, gccDirs, clangDirs };
  }

  const systemDrive = environment.SystemDrive?.replace(/^([A-Za-z]):.*$/, '$1:') ?? 'C:';
  const drives = [systemDrive];
  for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
    const drive = `${letter}:`;
    if (!drives.includes(drive) && readChildren(fileSystem, `${drive}/`).length > 0) {
      drives.push(drive);
    }
  }

  for (const drive of drives) {
    pushDirectory(armclangDirs, `${drive}/Keil_v5/ARM/ARMCLANG/bin`);
    pushDirectory(armclangDirs, `${drive}/Keil/ARM/ARMCLANG/bin`);
    pushDirectory(clangDirs, `${drive}/LLVM/bin`);
    pushDirectory(clangDirs, `${drive}/llvm/bin`);
    // Keil installed into a custom folder on the drive (e.g. D:/tools/Keil_v5).
    for (const child of readChildren(fileSystem, `${drive}/`)) {
      if (/keil|mdk/i.test(child)) {
        pushDirectory(armclangDirs, `${drive}/${child}/ARM/ARMCLANG/bin`);
      }
    }
  }
  for (const cltRoot of drives.flatMap((drive) => [`${drive}/ST`])) {
    for (const child of readChildren(fileSystem, cltRoot)) {
      if (/^STM32CubeCLT_/i.test(child)) {
        pushDirectory(gccDirs, `${cltRoot}/${child}/GNU-tools-for-STM32/bin`);
      }
    }
  }

  const programRoots = [
    environment.ProgramFiles,
    environment['ProgramFiles(x86)'],
    environment.LOCALAPPDATA ? joinPath(environment.LOCALAPPDATA, 'Programs') : undefined
  ].filter((value): value is string => Boolean(value));
  for (const root of programRoots) {
    for (const child of readChildren(fileSystem, root)) {
      if (/Arm GNU Toolchain|GNU Arm Embedded|arm-none-eabi/i.test(child)) {
        pushDirectory(gccDirs, joinPath(root, `${child}/bin`));
        for (const version of readChildren(fileSystem, joinPath(root, child))) {
          pushDirectory(gccDirs, joinPath(root, `${child}/${version}/bin`));
        }
      }
      if (/Arm Compiler|ARM Compiler|armclang/i.test(child)) {
        for (const directory of binDirectoriesBelow(fileSystem, joinPath(root, child), 2)) {
          pushDirectory(armclangDirs, directory);
        }
      }
      if (/^LLVM$/i.test(child) || /llvm/i.test(child)) {
        pushDirectory(clangDirs, joinPath(root, `${child}/bin`));
        for (const version of readChildren(fileSystem, joinPath(root, child))) {
          pushDirectory(clangDirs, joinPath(root, `${child}/${version}/bin`));
        }
      }
      if (/^Arm$/i.test(child)) {
        for (const grandchild of readChildren(fileSystem, joinPath(root, child))) {
          if (/Compiler|armclang/i.test(grandchild)) {
            for (const directory of binDirectoriesBelow(
              fileSystem,
              joinPath(root, `${child}/${grandchild}`),
              2
            )) {
              pushDirectory(armclangDirs, directory);
            }
          }
        }
      }
    }
  }

  for (const home of homeDirectories(environment)) {
    // PlatformIO unpacked ARM GCC toolchains.
    const platformioPackages = joinPath(home, '.platformio/packages');
    for (const child of readChildren(fileSystem, platformioPackages)) {
      if (/toolchain|gcc|arm/i.test(child)) {
        pushDirectory(gccDirs, joinPath(platformioPackages, `${child}/bin`));
      }
    }
    // xPack-dev-tools keeps the binaries under .content/bin in each version.
    const xpack = joinPath(home, '.xpack');
    for (const directory of binDirectoriesBelow(fileSystem, xpack, 4)) {
      pushDirectory(gccDirs, directory);
      pushDirectory(clangDirs, directory);
    }
  }
  return { armclangDirs, gccDirs, clangDirs };
}


/** Home directories from the environment (Windows and POSIX). */
function homeDirectories(environment: NodeJS.ProcessEnv): string[] {
  return [...new Set(
    [environment.USERPROFILE, environment.HOME, environment.HOMEDRIVE && environment.HOMEPATH
      ? `${environment.HOMEDRIVE}${environment.HOMEPATH}`
      : undefined]
      .filter((value): value is string => Boolean(value && value.trim()))
      .map((value) => value.replace(/\\/g, '/').replace(/\/+$/, ''))
  )];
}

/**
 * Directories referenced by every absolute path in the environment.
 *
 * The scan is deliberately not limited to variables whose names look toolchain
 * related: a user may keep an install path in an arbitrary variable (or only in
 * `PATH`). Each value is split on the platform path separator and its directory
 * plus `bin` child are probed, which covers roots like `ARMCLANG_PATH=D:/ac6`.
 */
function environmentHintDirectories(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string[] {
  const directories: string[] = [];
  const delimiter = platform === 'win32' ? ';' : ':';
  for (const value of Object.values(environment)) {
    if (!value || value.length > 8192) {
      continue;
    }
    for (const raw of value.split(delimiter)) {
      const entry = raw.trim().replace(/^"|"$/g, '').replace(/\\/g, '/');
      if (!/^[A-Za-z]:\//.test(entry) && !entry.startsWith('/')) {
        continue;
      }
      const directory = /\.exe$/i.test(entry) ? entry.slice(0, entry.lastIndexOf('/')) : entry;
      const root = directory.replace(/\/+$/, '');
      pushDirectory(directories, root);
      pushDirectory(directories, `${root}/bin`);
    }
  }
  return directories;
}

/** Every `bin` directory below a small toolchain root (xPack/PlatformIO layout). */
function binDirectoriesBelow(
  fileSystem: BuildToolchainFileSystem,
  root: string,
  maxDepth: number
): string[] {
  const found: string[] = [];
  const walk = (directory: string, depth: number): void => {
    const children = readChildren(fileSystem, directory);
    if (children.includes('bin') || children.includes('Bin')) {
      pushDirectory(found, `${directory}/bin`);
    }
    if (depth >= maxDepth) {
      return;
    }
    for (const child of children) {
      // Only descend through plausible container directories; walking the whole
      // home tree would be slow on a developer machine.
      if (/^(toolchain|@xpack|packages|gcc|arm|bin|content|\.content|versions?|\d)/i.test(child)) {
        walk(`${directory}/${child}`, depth + 1);
      }
    }
  };
  walk(root, 0);
  return found;
}

function pathDirectories(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string[] {
  return environmentPathEntries(environment, platform);
}

/** A directory that is not on PATH needs its absolute compiler path. */
function directoryOnPath(directory: string, pathDirectoriesList: string[]): boolean {
  const wanted = normalizedDirectory(directory);
  return pathDirectoriesList.some((entry) => normalizedDirectory(entry) === wanted);
}

function mcuGccToolchain(
  directory: string,
  onPath: boolean,
  compilerPath: string,
  cxxPath: string | undefined,
  objcopyPath: string | undefined,
  sizePath: string | undefined
): BuildToolchain | undefined {
  return {
    id: 'mcu:gcc',
    direction: 'mcu',
    family: 'gcc',
    prefix: 'arm-none-eabi',
    cCompiler: onPath ? 'arm-none-eabi-gcc' : compilerPath,
    ...(cxxPath === undefined
      ? {}
      : { cxxCompiler: onPath ? 'arm-none-eabi-g++' : cxxPath }),
    cCompilerPath: compilerPath,
    ...(onPath || objcopyPath === undefined ? {} : { objcopy: objcopyPath }),
    ...(onPath || sizePath === undefined ? {} : { size: sizePath }),
    detected: true,
    onPath,
    binDir: directory,
    label: 'Arm GNU Toolchain (armgcc)',
    detail: directory
  };
}

function mcuArmclangToolchain(
  directory: string,
  onPath: boolean,
  compilerPath: string,
  fromelf: string | undefined
): BuildToolchain {
  const executable = onPath ? 'armclang' : compilerPath;
  return {
    id: 'mcu:armclang',
    direction: 'mcu',
    family: 'armclang',
    prefix: '',
    cCompiler: executable,
    cxxCompiler: executable,
    cCompilerPath: compilerPath,
    ...(fromelf === undefined ? {} : { fromelf }),
    detected: true,
    onPath,
    binDir: directory,
    label: 'Arm Compiler 6 (armclang)',
    detail: directory
  };
}

function mcuClangToolchain(
  directory: string,
  onPath: boolean,
  compilerPath: string,
  cxxPath: string | undefined,
  objcopyPath: string | undefined,
  sizePath: string | undefined
): BuildToolchain {
  return {
    id: 'mcu:clang',
    direction: 'mcu',
    family: 'clang',
    prefix: '',
    cCompiler: onPath ? 'clang' : compilerPath,
    ...(cxxPath === undefined
      ? {}
      : { cxxCompiler: onPath ? 'clang++' : cxxPath }),
    cCompilerPath: compilerPath,
    ...(objcopyPath === undefined ? {} : { objcopy: onPath ? 'llvm-objcopy' : objcopyPath }),
    ...(sizePath === undefined ? {} : { size: onPath ? 'llvm-size' : sizePath }),
    detected: true,
    onPath,
    binDir: directory,
    label: 'LLVM clang (arm-none-eabi)',
    detail: directory
  };
}

/** Placeholder entries keep all three families selectable before installation. */
function missingMcuToolchain(
  family: McuToolchainFamily,
  id: string,
  label: string,
  cCompiler: string,
  cxxCompiler: string
): BuildToolchain {
  return {
    id,
    direction: 'mcu',
    family,
    prefix: family === 'gcc' ? 'arm-none-eabi' : '',
    cCompiler,
    cxxCompiler,
    cCompilerPath: '',
    detected: false,
    onPath: false,
    binDir: '',
    label,
    detail: '未检测到：生成后请把编译器加入 PATH，或安装对应工具链'
  };
}

/**
 * Finds the MCU compiler families installed on this machine.
 *
 * The result contains at most one entry per family, in the order GCC then
 * armclang; a family that cannot be found is omitted so the sidebar does not
 * offer an unusable selection.
 */
export function discoverMcuBuildToolchains(
  environment: NodeJS.ProcessEnv = process.env,
  fileSystem: BuildToolchainFileSystem = defaultFileSystem,
  platform: NodeJS.Platform = process.platform
): BuildToolchain[] {
  const pathDirs = pathDirectories(environment, platform);
  const roots = defaultSearchRoots(environment, fileSystem, platform);
  const gccCandidates = [...pathDirs, ...roots.gccDirs];
  const armclangCandidates = [...pathDirs, ...roots.armclangDirs];

  let gcc: BuildToolchain | undefined;
  for (const directory of gccCandidates) {
    const compilerPath = probeCompiler(fileSystem, directory, 'arm-none-eabi-gcc');
    if (compilerPath === undefined) {
      continue;
    }
    const cxxPath = probeCompiler(fileSystem, directory, 'arm-none-eabi-g++');
    const objcopyPath = probeCompiler(fileSystem, directory, 'arm-none-eabi-objcopy');
    const sizePath = probeCompiler(fileSystem, directory, 'arm-none-eabi-size');
    gcc = mcuGccToolchain(
      directory,
      directoryOnPath(directory, pathDirs),
      compilerPath,
      cxxPath,
      objcopyPath,
      sizePath
    );
    break;
  }

  let armclang: BuildToolchain | undefined;
  for (const directory of armclangCandidates) {
    const compilerPath = probeCompiler(fileSystem, directory, 'armclang');
    if (compilerPath === undefined) {
      continue;
    }
    const fromelf = probeCompiler(fileSystem, directory, 'fromelf');
    armclang = mcuArmclangToolchain(
      directory,
      directoryOnPath(directory, pathDirs),
      compilerPath,
      fromelf
    );
    break;
  }

  let clang: BuildToolchain | undefined;
  for (const directory of [...pathDirs, ...roots.clangDirs]) {
    const compilerPath = probeCompiler(fileSystem, directory, 'clang');
    if (compilerPath === undefined) {
      continue;
    }
    const cxxPath = probeCompiler(fileSystem, directory, 'clang++');
    const objcopyPath = probeCompiler(fileSystem, directory, 'llvm-objcopy');
    const sizePath = probeCompiler(fileSystem, directory, 'llvm-size');
    clang = mcuClangToolchain(
      directory,
      directoryOnPath(directory, pathDirs),
      compilerPath,
      cxxPath,
      objcopyPath,
      sizePath
    );
    break;
  }

  return [
    gcc ?? missingMcuToolchain('gcc', 'mcu:gcc', 'Arm GNU Toolchain (armgcc)', 'arm-none-eabi-gcc', 'arm-none-eabi-g++'),
    armclang ?? missingMcuToolchain('armclang', 'mcu:armclang', 'Arm Compiler 6 (armclang)', 'armclang', 'armclang'),
    clang ?? missingMcuToolchain('clang', 'mcu:clang', 'LLVM clang (arm-none-eabi)', 'clang', 'clang++')
  ];
}

/** Looks a toolchain id up in the discovered MCU compiler families. */
export function findBuildToolchain(
  toolchains: BuildToolchain[],
  id: string
): BuildToolchain | undefined {
  if (id === '') {
    return undefined;
  }
  return toolchains.find((toolchain) => toolchain.id === id);
}
