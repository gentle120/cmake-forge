import * as vscode from 'vscode';
import {
  getDeviceProfile,
  getDeviceProfileForPack,
  isRuntimeDeviceProfile,
  listDeviceProfiles,
  type DeviceSeries,
  type DeviceVendor
} from './devices/deviceProfiles';
import {
  buildDevicePackOptions,
  listDeviceProfilesForSeries,
  listDeviceSeries,
  listDeviceVendors
} from './devices/deviceSelection';
import {
  getVendorMetadata,
  hasVendor,
  importedVendorBaseOrder,
  registerVendor
} from './devices/vendorRegistry';
import { getFlashProbeProfile, listFlashProbeProfiles, type FlashProbeProfile } from './flash/probeProfiles';
import {
  importPack,
  importPackDirectory,
  listImportedPacks,
  loadImportedProfiles,
  removePack,
  type ImportPackResult
} from './devices/importedProfiles';
import { defaultScanRoots, listKeilPacks } from './env/toolchainScanner';
import {
  findInstalledPackEntry,
  findPackPdsc,
  listInstalledPackIdentities,
  resolveInstalledPackIdentity,
  type InstalledPackIdentity
} from './packs/installedPacks';
import { buildPackVendorOptions } from './packs/vendorOptions';
import {
  downloadPack,
  searchPacks,
  type FetchLike,
  type PackSearchCacheEntry
} from './packs/packIndex';
import { curatedVendors } from './devices/curatedVendors';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as os from 'node:os';
import {
  defaultBackendFor,
  listFlashBackendProfiles,
  type FlashBackendId
} from './flash/backendProfiles';
import type { FlashDeviceContext, FlashExecutablePaths } from './generator/flashScriptGenerator';
import {
  getFlashTargetProfile,
  getFlashTargetProfileForDevice,
  listFlashTargetProfiles,
  listFlashTargetSeries,
  listFlashTargetVendors,
  listFlashTargetsForSeries,
  type FlashTargetProfile
} from './flash/targets/targetProfiles';
import {
  generateDebugWorkflow,
  generateFlashWorkflow,
  generateLinuxWorkflow,
  generateMcuWorkflow,
  generateNativeWorkflow,
  projectNameFromRoot,
  type ProjectWorkflowHost,
  type WorkflowResult
} from './generation/workflow';
import { readLinuxProjectConfig } from './linux/projectConfig';
import { discoverLinuxToolchains } from './linux/discovery';
import { selectLinuxToolchain } from './linux/selection';
import { linuxConfigFileName } from './linux/types';
import { describeNativeProject } from './native/projectStructure';
import { scanProject, ScanCancelledError, type ProjectDescription } from './scanner/projectScanner';
import { discoverWorkspaceProjects } from './scanner/workspaceProjects';
import { SidebarProvider } from './sidebar/provider';
import type { CommandResult } from './shared/commandResult';

async function scanWorkspace(root: string): Promise<ProjectDescription | undefined> {
  try {
    return await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '正在扫描工作区源文件...',
        cancellable: true
      },
      async (_progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        return scanProject(root, { signal: controller.signal });
      }
    );
  } catch (error) {
    if (error instanceof ScanCancelledError) {
      vscode.window.showInformationMessage('已取消工作区扫描。');
      return undefined;
    }
    throw error;
  }
}

async function updateWorkspaceSettings(settings: Record<string, string | boolean>): Promise<void> {
  for (const [key, value] of Object.entries(settings)) {
    const separator = key.indexOf('.');
    const section = key.slice(0, separator);
    const setting = key.slice(separator + 1);
    await vscode.workspace.getConfiguration(section).update(
      setting,
      value,
      vscode.ConfigurationTarget.Workspace
    );
  }
}

function createWorkflowHost(fixedRoot?: string): ProjectWorkflowHost {
  return {
    workspaceRoot: () => fixedRoot ?? activeSidebar?.selection().projectRoot ?? undefined,
    scanWorkspace,
    confirmOverwrite: async (files) => {
      const action = await vscode.window.showWarningMessage(
        `已有 ${files.length} 个生成文件存在，是否覆盖？`,
        '覆盖',
        '取消'
      );
      return action === '覆盖';
    },
    updateSettings: async (settings) => {
      try {
        await updateWorkspaceSettings(settings);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showWarningMessage(`CMake Tools / IntelliSense 设置未更新：${message}`);
      }
    }
  };
}

function reportWorkflowResult(result: WorkflowResult): void {
  if (result.cancelled) {
    return;
  }
  if (result.ok) {
    vscode.window.showInformationMessage(result.message);
  } else {
    vscode.window.showErrorMessage(result.message);
  }
}

async function selectDeviceProfile(): Promise<ReturnType<typeof getDeviceProfile> | undefined> {
  const profiles = listDeviceProfiles();
  if (profiles.length === 0) {
    void vscode.window.showInformationMessage('没有可用芯片：请先在侧栏选择或在 Keil 安装目录导入 CMSIS Pack。');
    return undefined;
  }
  const vendorSelection = await vscode.window.showQuickPick(
    listDeviceVendors(profiles).map((vendor) => ({
      label: getVendorMetadata(vendor).label,
      description: `${profiles.filter((profile) => profile.vendor === vendor).length} 个支持的型号`,
      vendor
    })),
    { placeHolder: '选择 MCU 厂商' }
  );
  if (!vendorSelection) {
    return undefined;
  }

  const vendor = vendorSelection.vendor as DeviceVendor;
  const seriesSelection = await vscode.window.showQuickPick(
    listDeviceSeries(profiles, vendor).map((series) => {
      const seriesProfiles = listDeviceProfilesForSeries(profiles, vendor, series);
      return {
        label: seriesProfiles[0]?.family ?? series,
        description: `${seriesProfiles.length} 个支持的型号`,
        detail: `${seriesProfiles[0]?.core ?? 'ARM'} MCU 系列`,
        series
      };
    }),
    { placeHolder: `选择 MCU 系列（${vendorSelection.label}）` }
  );
  if (!seriesSelection) {
    return undefined;
  }

  const series = seriesSelection.series as DeviceSeries;
  const deviceSelection = await vscode.window.showQuickPick(
    listDeviceProfilesForSeries(profiles, vendor, series).map((profile) => ({
      label: profile.part,
      description: `${profile.family} / ${profile.core}`,
      detail: `${profile.flash.length / 1024} KB Flash，${profile.ram.length / 1024} KB RAM`
    })),
    { placeHolder: `选择 MCU 型号（${seriesSelection.label}）` }
  );
  return deviceSelection ? getDeviceProfile(deviceSelection.label) : undefined;
}

async function selectWorkspaceProject(): Promise<string | undefined> {
  const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
  if (roots.length === 0) {
    return undefined;
  }
  const selected = activeSidebar?.selection().projectRoot;
  const projects = await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: '正在发现工作区工程…' },
    () => discoverWorkspaceProjects(roots)
  );
  if (projects.length === 0) {
    vscode.window.showWarningMessage('工作区中没有发现可生成的工程。');
    return undefined;
  }
  if (selected && projects.some((project) => project.root === selected)) {
    return selected;
  }
  if (projects.length === 1) {
    return projects[0].root;
  }
  const picked = await vscode.window.showQuickPick(
    projects.map((project) => ({
      label: project.label,
      description: project.relativePath || '.',
      detail: project.markers.join(', '),
      root: project.root
    })),
    { placeHolder: '选择要生成 CMake 工程的目标工程' }
  );
  return picked?.root;
}

async function selectFlashProbe(): Promise<FlashProbeProfile | undefined> {
  const selection = await vscode.window.showQuickPick(
    listFlashProbeProfiles().map((profile) => ({
      label: profile.label,
      description: profile.interfaceConfig,
      id: profile.id
    })),
    { placeHolder: '选择 OpenOCD 调试器' }
  );
  return selection ? getFlashProbeProfile(selection.id) : undefined;
}

async function selectFlashTarget(): Promise<FlashTargetProfile | undefined> {
  const targets = listFlashTargetProfiles();
  const vendorSelection = await vscode.window.showQuickPick(
    listFlashTargetVendors().map((vendor) => ({
      label: vendor,
      description: `${targets.filter((target) => target.vendor === vendor).length} 个 OpenOCD target`,
      vendor
    })),
    { placeHolder: '选择 OpenOCD target 厂商' }
  );
  if (!vendorSelection) {
    return undefined;
  }

  const seriesSelection = await vscode.window.showQuickPick(
    listFlashTargetSeries(vendorSelection.vendor).map((series) => {
      const seriesTargets = listFlashTargetsForSeries(vendorSelection.vendor, series);
      return {
        label: seriesTargets[0]?.label ?? series,
        description: `${seriesTargets.length} 个 OpenOCD target`,
        series
      };
    }),
    { placeHolder: `选择 OpenOCD target 系列（${vendorSelection.label}）` }
  );
  if (!seriesSelection) {
    return undefined;
  }

  const targetSelection = await vscode.window.showQuickPick(
    listFlashTargetsForSeries(vendorSelection.vendor, seriesSelection.series).map((target) => ({
      label: target.label,
      description: `${target.vendor} / ${target.series}`,
      detail: `${target.targetConfig} / ${target.transport}`,
      id: target.id
    })),
    { placeHolder: `选择 OpenOCD target（${seriesSelection.label}）` }
  );
  return targetSelection ? getFlashTargetProfile(targetSelection.id) : undefined;
}

async function shouldGenerateFlashScript(): Promise<boolean | undefined> {
  const selection = await vscode.window.showQuickPick(
    [
      { label: '同时生成 flash.py', value: true },
      { label: '暂不生成 flash.py', value: false }
    ],
    { placeHolder: '是否生成 OpenOCD 烧录脚本？' }
  );
  return selection?.value;
}

function getOpenOcdPath(): string {
  return vscode.workspace.getConfiguration('cmakeEmbedded')
    .get<string>('openocdPath', 'openocd')?.trim() || 'openocd';
}

let packStorageRoot = '';
let activeSidebar: SidebarProvider | undefined;
const packFileByPart = new Map<string, string>();
const packArchiveBySource = new Map<string, string>();
const packSearchCache = new Map<string, PackSearchCacheEntry>();

function ensureCatalogVendor(id: string, label: string): void {
  if (hasVendor(id)) {
    return;
  }
  registerVendor({
    id,
    label: label || id,
    definePrefixes: [id.replace(/[^A-Za-z0-9_]/g, '') || id],
    order: importedVendorBaseOrder + listDeviceProfiles().length
  });
}

async function installedPackIdentities(): Promise<InstalledPackIdentity[]> {
  return listInstalledPackIdentities(listKeilPacks(scanRoots().packRoots, scanFileSystem));
}

/**
 * Vendor options for the sidebar: locally usable vendors (imported profiles
 * and installed Packs with importable devices) first, then the curated
 * mainstream chip vendors so the dropdown always reads like a product menu.
 * The keil.com pack index is deliberately not a vendor source — it only lists
 * Keil-hosted packs and would bury real chip vendors under publisher noise.
 */
async function discoverPackVendorOptions(): Promise<{
  vendors: Array<{ value: string; label: string; description?: string }>;
  notice?: string;
}> {
  const vendors = buildPackVendorOptions({
    registered: listDeviceVendors(listDeviceProfiles()).map((vendor) => ({
      id: vendor,
      label: getVendorMetadata(vendor).label
    })),
    imported: (await listImportedPacks(packStorageRoot)).map((pack) => ({
      vendorId: pack.vendorId,
      vendorName: pack.vendorName,
      hasDevices: pack.parts.length > 0
    })),
    installed: (await installedPackIdentities()).map((pack) => ({
      vendorId: pack.vendorId,
      vendorName: pack.vendorName,
      hasDevices: pack.hasDevices
    })),
    curated: curatedVendors
  });
  for (const vendor of vendors) {
    ensureCatalogVendor(vendor.value, vendor.label);
  }
  return { vendors };
}

async function loadDevicePackCatalog(vendorId: string): Promise<{
  options: ReturnType<typeof buildDevicePackOptions>;
  notice?: string;
}> {
  const imported = await listImportedPacks(packStorageRoot);
  const importedInVendor = imported.filter((pack) =>
    pack.vendorId === vendorId && pack.parts.length > 0
  );
  const installed = (await installedPackIdentities())
    .filter((pack) => pack.vendorId === vendorId && pack.hasDevices)
    .filter((pack) => !importedInVendor.some((record) =>
      record.packId === `${pack.vendorId}:${pack.name}` && record.version === pack.version
    ))
    .map((pack) => ({
      vendorId: pack.vendorId,
      name: pack.name,
      version: pack.version,
      packFile: pack.packFile,
      source: pack.source,
      hasDevices: pack.hasDevices
    }));
  return {
    options: buildDevicePackOptions({
      vendorId,
      imported: importedInVendor,
      installed,
      online: []
    })
  };
}

async function activateDevicePack(
  vendorId: string,
  packId: string,
  version: string
): Promise<{ vendorId: string; packId: string; version: string; sourcePack: string; message: string }> {
  let record = (await listImportedPacks(packStorageRoot))
    .find((pack) => pack.packId === packId && pack.version === version);
  let importedResult: ImportPackResult | undefined;
  if (!record) {
    const catalog = await loadDevicePackCatalog(vendorId);
    const option = catalog.options.find((candidate) =>
      candidate.packId === packId && candidate.version === version
    );
    if (!option) {
      throw new Error('找不到所选 Pack 版本，请刷新目录后重试。');
    }
    if (option.origin === 'installed' && option.packFile) {
      const entry = await findInstalledPackEntry(
        listKeilPacks(scanRoots().packRoots, scanFileSystem),
        option.packFile
      );
      const installed = entry ? await resolveInstalledPackIdentity(entry) : undefined;
      if (!entry || !installed) {
        throw new Error('已安装 Pack 已不可用，请刷新目录后重试。');
      }
      const metadata = { name: installed.name, version: installed.version };
      if (entry.source === 'directory') {
        const pdscPath = await findPackPdsc(entry.packFile);
        if (!pdscPath) {
          throw new Error('已安装 Pack 目录中没有 PDSC 文件。');
        }
        importedResult = await importPackDirectory(
          entry.packFile,
          `${entry.packFile}/${pdscPath}`,
          packStorageRoot,
          metadata
        );
      } else {
        importedResult = await importPack(
          await readFile(entry.packFile),
          entry.packFile.split(/[/\\]/).pop() ?? 'installed.pack',
          packStorageRoot,
          metadata
        );
      }
    } else if (option.origin === 'downloadable' && option.packUrl) {
      const buffer = await downloadPack(fetchWithTimeout, option.packUrl);
      const fileName = option.packUrl.split('/').pop() ?? `${option.name}.${option.version}.pack`;
      importedResult = await importPack(buffer, fileName, packStorageRoot, {
        name: option.name,
        version: option.version
      });
    } else {
      throw new Error('此 Pack 版本当前不可导入。');
    }
    await syncPackFileIndex();
    // Only the record the importer just produced may be selected; a fallback
    // match on name/version/part could pick another vendor's same-named Pack.
    record = importedResult?.pack
      ? (await listImportedPacks(packStorageRoot)).find((pack) =>
          pack.packId === importedResult!.pack!.packId
          && pack.version === importedResult!.pack!.version
          && pack.packFile === importedResult!.pack!.packFile
        )
      : undefined;
    if (!record || record.parts.length === 0) {
      const skipped = importedResult?.skipped.length ?? 0;
      throw new Error(skipped > 0
        ? `Pack 中没有可用型号，已跳过 ${skipped} 个不受支持或信息不完整的设备。`
        : 'Pack 中没有可用于生成的芯片。');
    }
  }

  if (record.parts.length === 0) {
    throw new Error('Pack 中没有可用于生成的芯片。');
  }
  return {
    vendorId: record.vendorId,
    packId: record.packId,
    version: record.version,
    sourcePack: record.packFile,
    message: `已载入 ${record.vendorName} ${record.name} ${record.version}（${record.parts.length} 个型号）。`
  };
}

async function syncPackFileIndex(): Promise<void> {
  packFileByPart.clear();
  packArchiveBySource.clear();
  for (const record of await listImportedPacks(packStorageRoot)) {
    if (!record.archiveFile) {
      continue;
    }
    packArchiveBySource.set(record.packFile, record.archiveFile);
    for (const part of record.parts) {
      packFileByPart.set(part, record.archiveFile);
    }
  }
}

function executablePaths(): FlashExecutablePaths {
  const configuration = vscode.workspace.getConfiguration('cmakeEmbedded');
  return {
    jlink: configuration.get<string>('jlinkPath', 'JLink')?.trim() || 'JLink',
    pyocd: configuration.get<string>('pyocdPath', 'pyocd')?.trim() || 'pyocd'
  };
}

function flashDeviceFor(profile: ReturnType<typeof getDeviceProfile>): FlashDeviceContext {
  return {
    part: profile.part,
    core: profile.core,
    packFile: isRuntimeDeviceProfile(profile.part)
      ? packFileByPart.get(profile.part)
      : undefined
  };
}

const scanFileSystem = { exists: existsSync, readDir: readdirSync };

function scanRoots() {
  const drives = process.platform === 'win32'
    ? Array.from({ length: 24 }, (_, index) => `${String.fromCharCode(67 + index)}:/`).filter(existsSync)
    : [];
  const roots = defaultScanRoots(process.platform, process.env, os.homedir(), drives);
  return roots;
}

const fetchWithTimeout: FetchLike = (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
};

async function pickLocalPack(): Promise<{ buffer: Buffer; fileName: string } | undefined> {
  const picked = await vscode.window.showOpenDialog({
    filters: { 'CMSIS Pack': ['pack'] }
  });
  if (!picked || picked.length === 0) {
    return undefined;
  }
  const fileName = picked[0].path.split('/').pop() ?? 'imported.pack';
  return { buffer: await readFile(picked[0].fsPath), fileName };
}

async function pickKeilPack(): Promise<{ kind: 'buffer'; buffer: Buffer; fileName: string } | { kind: 'directory'; root: string; pdscPath: string } | undefined> {
  // Component/board packs (CMSIS, middleware, BSPs) contain no chips and can
  // never yield a usable import; only device-bearing packs are selectable.
  const installed = (await installedPackIdentities()).filter((pack) => pack.hasDevices);
  if (installed.length === 0) {
    vscode.window.showWarningMessage(
      'Keil 安装目录中没有含可生成芯片的器件包（CMSIS 组件包、中间件包、板级包不算）。' +
      '请先获取芯片厂商的 DFP 器件包（Keil Pack Installer 或厂商官网），再用「本地 .pack 文件」导入。'
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    installed.map((pack) => ({
      label: `${pack.vendorName} ${pack.name}`,
      description: pack.version,
      detail: pack.packFile,
      identity: pack
    })),
    { placeHolder: `发现 ${installed.length} 个含器件的已安装 Pack，选择要导入的` }
  );
  if (!picked) {
    return undefined;
  }
  if (picked.identity.source === 'directory') {
    const pdsc = await findPackPdsc(picked.identity.packFile);
    if (!pdsc) {
      vscode.window.showWarningMessage('所选已安装 Pack 目录中没有 PDSC 文件。');
      return undefined;
    }
    return { kind: 'directory', root: picked.identity.packFile, pdscPath: pdsc };
  }
  const fileName = picked.identity.packFile.split(/[/\\]/).pop() ?? 'imported.pack';
  return { kind: 'buffer', buffer: await readFile(picked.identity.packFile), fileName };
}

async function pickOnlinePack(): Promise<{ buffer: Buffer; fileName: string } | undefined> {
  const keyword = await vscode.window.showInputBox({
    placeHolder: '输入厂商或芯片关键字，例如 MS32'
  });
  if (keyword === undefined || keyword.trim() === '') {
    return undefined;
  }
  const results = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `正在搜索 keil.com Pack 索引「${keyword.trim()}」…`,
      cancellable: true
    },
    (_progress, token) => {
      const controller = new AbortController();
      const cancellation = token.onCancellationRequested(() => controller.abort());
      return searchPacks(fetchWithTimeout, keyword, {
        cache: packSearchCache,
        signal: controller.signal
      }).finally(() => cancellation.dispose());
    }
  );
  if (results.length === 0) {
    vscode.window.showInformationMessage(`keil.com 在线索引中没有匹配「${keyword}」的 Pack。`);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    results.map((pack) => ({
      label: pack.name,
      description: pack.version,
      detail: pack.description,
      packUrl: pack.packUrl
    })),
    { placeHolder: `匹配 ${results.length} 个 Pack，选择要下载导入的包` }
  );
  if (!picked) {
    return undefined;
  }
  const buffer = await downloadPack(fetchWithTimeout, picked.packUrl);
  const fileName = picked.packUrl.split('/').pop() ?? 'imported.pack';
  return { buffer, fileName };
}

async function importPackOnly(): Promise<CommandResult> {
  const cancelled: CommandResult = { ok: false, cancelled: true, message: '未执行 Pack 导入。' };
  const source = await vscode.window.showQuickPick(
    [
      { label: '本地 .pack 文件', value: 'local' as const },
      { label: 'Keil 已安装 Pack', value: 'keil' as const },
      { label: 'keil.com 在线索引', value: 'online' as const }
    ],
    { placeHolder: '选择 CMSIS Pack 来源' }
  );
  if (!source) {
    return cancelled;
  }
  try {
    let result: ImportPackResult;
    if (source.value === 'local') {
      const picked = await pickLocalPack();
      if (!picked) {
        return cancelled;
      }
      result = await importPack(picked.buffer, picked.fileName, packStorageRoot);
    } else if (source.value === 'keil') {
      const picked = await pickKeilPack();
      if (!picked) {
        return cancelled;
      }
      if (picked.kind === 'directory') {
        result = await importPackDirectory(picked.root, picked.pdscPath, packStorageRoot);
      } else {
        result = await importPack(picked.buffer, picked.fileName, packStorageRoot);
      }
    } else {
      const picked = await pickOnlinePack();
      if (!picked) {
        return cancelled;
      }
      result = await importPack(picked.buffer, picked.fileName, packStorageRoot);
    }
    await syncPackFileIndex();
    activeSidebar?.refresh();
    const skipped = result.skipped.length > 0
      ? `\n跳过 ${result.skipped.length} 个型号：${result.skipped
          .map((item) => `${item.part}（${item.reason}）`)
          .join('、')}`
      : '';
    const message = `Pack 导入完成：${result.imported.length} 个新型号已注册。${skipped}`;
    void vscode.window.showInformationMessage(message);
    return { ok: true, message };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // Component/board packs (CMSIS, middleware, BSPs) fail deep inside the
    // parser; translate those PDSC errors into product guidance.
    const message = /no devices section|No \.pdsc file found|no family vendor/.test(raw)
      ? 'Pack 导入失败：这个包的 PDSC 没有任何芯片定义（CMSIS 组件包、中间件包或板级包不含可生成的芯片）。请改用芯片厂商的 DFP 器件包。'
      : `Pack 导入失败：${raw}`;
    void vscode.window.showErrorMessage(message);
    return { ok: false, message };
  }
}

async function removePackOnly(): Promise<CommandResult> {
  const packs = await listImportedPacks(packStorageRoot);
  if (packs.length === 0) {
    const message = '没有可删除的已导入 Pack。';
    void vscode.window.showInformationMessage(message);
    return { ok: false, message };
  }
  const picked = await vscode.window.showQuickPick(
    packs.map((pack) => ({
      label: pack.vendorName,
      description: pack.packFile,
      detail: `${pack.parts.length} 个型号 · ${pack.source}`,
      pack
    })),
    { placeHolder: '选择要删除的已导入 Pack' }
  );
  if (!picked) {
    return { ok: false, cancelled: true, message: '未删除 Pack。' };
  }
  await removePack(packStorageRoot, picked.pack.packFile);
  await syncPackFileIndex();
  activeSidebar?.refresh();
  const message = `已删除 ${picked.pack.vendorName}（${picked.pack.parts.length} 个型号）。`;
  void vscode.window.showInformationMessage(message);
  return { ok: true, message };
}

async function selectFlashBackend(
  probe: FlashProbeProfile,
  profile?: { debugTarget?: string }
): Promise<FlashBackendId | undefined> {
  const compatible = listFlashBackendProfiles()
    .filter((backend) => backend.probes.includes(probe.id));
  const fallback = defaultBackendFor(profile ?? {}, probe.id);
  const selection = await vscode.window.showQuickPick(
    compatible.map((backend) => ({
      label: backend.label,
      description: backend.id === 'openocd'
        ? 'target cfg 驱动'
        : backend.id === 'jlink' ? 'SEGGER J-Link Commander' : 'pyOCD（CMSIS Pack 设备）',
      id: backend.id,
      picked: backend.id === fallback
    })),
    { placeHolder: '选择烧录/调试后端' }
  );
  return selection?.id as FlashBackendId | undefined;
}

async function ensureCortexDebugInstalled(): Promise<boolean> {
  if (vscode.extensions.getExtension('marus25.cortex-debug')) {
    return true;
  }
  const action = await vscode.window.showWarningMessage(
    '生成调试配置需要 Cortex-Debug。',
    '安装',
    '继续'
  );
  if (action === '安装') {
    await vscode.commands.executeCommand(
      'workbench.extensions.installExtension',
      'marus25.cortex-debug'
    );
    return false;
  }
  return action === '继续';
}

async function generateDebugConfigurationOnly(): Promise<void> {
  const root = await selectWorkspaceProject();
  if (!root) {
    vscode.window.showErrorMessage('请先打开一个 MCU 工程目录。');
    return;
  }
  if (!(await ensureCortexDebugInstalled())) {
    return;
  }
  const target = await selectFlashTarget();
  if (!target) {
    return;
  }
  const probe = await selectFlashProbe();
  if (!probe) {
    return;
  }
  const backend = await selectFlashBackend(probe);
  if (!backend) {
    return;
  }
  reportWorkflowResult(await generateDebugWorkflow(
    createWorkflowHost(root),
    target,
    probe,
    getOpenOcdPath(),
    backend
  ));
}

async function generateFlashScriptOnly(): Promise<void> {
  const root = await selectWorkspaceProject();
  if (!root) {
    vscode.window.showErrorMessage('请先打开一个 MCU 工程目录。');
    return;
  }
  const target = await selectFlashTarget();
  if (!target) {
    return;
  }
  const probe = await selectFlashProbe();
  if (!probe) {
    return;
  }
  const backend = await selectFlashBackend(probe);
  if (!backend) {
    return;
  }
  reportWorkflowResult(await generateFlashWorkflow(
    createWorkflowHost(root),
    target,
    probe,
    getOpenOcdPath(),
    backend,
    undefined,
    executablePaths()
  ));
}

async function generateProject(): Promise<void> {
  const root = await selectWorkspaceProject();
  if (!root) {
    return;
  }
  const profile = await selectDeviceProfile();
  if (!profile) {
    return;
  }
  const generateFlash = await shouldGenerateFlashScript();
  if (generateFlash === undefined) {
    return;
  }
  let flash: Parameters<typeof generateMcuWorkflow>[2]['flash'];
  if (generateFlash) {
    const probe = await selectFlashProbe();
    if (!probe) {
      return;
    }
    let backend: FlashBackendId = 'openocd';
    const device = flashDeviceFor(profile);
    let target: FlashTargetProfile;
    if (profile.debugTarget) {
      target = getFlashTargetProfileForDevice(profile);
    } else {
      const picked = await selectFlashBackend(probe, profile);
      if (!picked) {
        return;
      }
      backend = picked;
      // jlink/pyocd scripts never read the OpenOCD target; any entry satisfies the type.
      target = getFlashTargetProfile('stm32f1xx');
    }
    flash = {
      target,
      probe,
      openocdPath: getOpenOcdPath(),
      backend,
      device,
      executables: executablePaths()
    };
  }
  reportWorkflowResult(await generateMcuWorkflow(
    createWorkflowHost(root),
    profile,
    { flash }
  ));
}

async function generateLinuxProject(): Promise<void> {
  const root = await selectWorkspaceProject();
  if (!root) {
    vscode.window.showErrorMessage('请先打开一个工程目录。');
    return;
  }
  const saved = await readLinuxProjectConfig(`${root}/${linuxConfigFileName}`);
  const toolchain = await selectLinuxToolchain(saved?.toolchainFamily);
  if (!toolchain) {
    return;
  }
  reportWorkflowResult(await generateLinuxWorkflow(createWorkflowHost(root), toolchain));
}

async function generateNativeProject(): Promise<void> {
  const root = await selectWorkspaceProject();
  if (!root) {
    vscode.window.showErrorMessage('请先打开一个 C/C++ 工程目录。');
    return;
  }
  const project = await scanWorkspace(root);
  if (!project) {
    return;
  }
  if (project.sources.length === 0) {
    vscode.window.showErrorMessage('工作区中没有找到 C/C++ 或汇编源文件。');
    return;
  }
  const selection = await vscode.window.showQuickPick(
    [
      { label: '可执行文件', value: 'executable' as const },
      { label: '静态库', value: 'static' as const },
      { label: '动态库', value: 'shared' as const }
    ],
    { placeHolder: '选择普通 C/C++ 目标类型' }
  );
  if (!selection) {
    return;
  }
  const standardSelection = await vscode.window.showQuickPick(
    [
      { label: 'C11 / C++17（推荐）', cStandard: 11 as const, cxxStandard: 17 as const },
      { label: 'C17 / C++20', cStandard: 17 as const, cxxStandard: 20 as const },
      { label: 'C23 / C++23', cStandard: 23 as const, cxxStandard: 23 as const }
    ],
    { placeHolder: '选择 C / C++ 语言标准' }
  );
  if (!standardSelection) {
    return;
  }
  const structure = describeNativeProject(
    project,
    projectNameFromRoot(root),
    {
      targetType: selection.value,
      cStandard: standardSelection.cStandard,
      cxxStandard: standardSelection.cxxStandard
    }
  );
  reportWorkflowResult(await generateNativeWorkflow(createWorkflowHost(root), structure));
}

export function activate(context: vscode.ExtensionContext): void {
  const host = createWorkflowHost();
  packStorageRoot = context.globalStorageUri.fsPath;
  const sidebarProvider = new SidebarProvider(context, {
    workflow: host,
    confirmOverwrite: async (files) => {
      const action = await vscode.window.showWarningMessage(
        `已有 ${files.length} 个生成文件存在，是否覆盖？`,
        '覆盖',
        '取消'
      );
      return action === '覆盖';
    },
    discoverToolchains: () => discoverLinuxToolchains(),
    scanProject: (root, options) => scanProject(root, options),
    discoverProjects: (roots, options) => discoverWorkspaceProjects(roots, options),
    packFileForPart: (part, sourcePack) => (
      sourcePack ? packArchiveBySource.get(sourcePack) : packFileByPart.get(part)
    ),
    discoverPackVendors: () => discoverPackVendorOptions(),
    loadPackCatalog: (vendor) => loadDevicePackCatalog(vendor),
    activatePack: (vendor, packId, version) => activateDevicePack(vendor, packId, version)
  });
  activeSidebar = sidebarProvider;
  void loadImportedProfiles(packStorageRoot).then(async (profiles) => {
    await syncPackFileIndex();
    if (profiles.length > 0) {
      sidebarProvider.refresh();
    }
  });
  context.subscriptions.push(
    vscode.commands.registerCommand('cmakeEmbedded.generateMcu', () => generateProject()),
    vscode.commands.registerCommand('cmakeEmbedded.generateLinux', () => generateLinuxProject()),
    vscode.commands.registerCommand('cmakeEmbedded.generateNative', () => generateNativeProject()),
    vscode.commands.registerCommand('cmakeEmbedded.generateFlashScript', () => generateFlashScriptOnly()),
    vscode.commands.registerCommand(
      'cmakeEmbedded.generateDebugConfiguration',
      () => generateDebugConfigurationOnly()
    ),
    vscode.commands.registerCommand('cmakeEmbedded.importPack', () => importPackOnly()),
    vscode.commands.registerCommand('cmakeEmbedded.removePack', () => removePackOnly()),
    vscode.window.registerWebviewViewProvider(SidebarProvider.viewType, sidebarProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    sidebarProvider,
    vscode.workspace.onDidChangeWorkspaceFolders(() => sidebarProvider.refresh()),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('cmakeEmbedded')) {
        sidebarProvider.refresh();
      }
    })
  );
}

export function deactivate(): void {
  // No extension-level resources need cleanup.
}
