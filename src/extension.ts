import * as vscode from 'vscode';
import { join, resolve } from 'node:path';
import {
  devicePackSourceForPart,
  getDeviceProfile,
  listDeviceProfiles,
  type DeviceProfile,
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
  listPackIndexPacks,
  searchPacks,
  selectPacksForSelection,
  type PackSearchCacheEntry
} from './packs/packIndex';
import { describeDownloadProgress, downloadPack } from './packs/packDownloads';
import {
  describeCorePack,
  findInstalledCorePack,
  installCorePack
} from './packs/corePack';
import {
  createTimeoutFetcher,
  describeTimeout,
  isCancellationError,
  RequestTimeoutError
} from './packs/fetcher';
import { curatedVendors } from './devices/curatedVendors';
import { findCatalogSeries, seriesDownloadPage } from './devices/seriesCatalog';
import { existsSync, readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as os from 'node:os';
import {
  defaultBackendFor,
  listFlashBackendProfiles,
  type FlashBackendId
} from './flash/backendProfiles';
import type { FlashExecutablePaths } from './generator/flashScriptGenerator';
import {
  getFlashTargetProfile,
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
import { readNativeProjectConfig } from './native/projectConfig';
import { nativeConfigFileName } from './native/types';
import { ensureCortexDebugInstalled } from './integration/cortexDebug';
import { loadDeviceSupportFiles, type DeviceSupportFile } from './packs/deviceSupport';
import { logLine } from './integration/output';
import { scanProject, ScanCancelledError, type ProjectDescription } from './scanner/projectScanner';
import { discoverWorkspaceProjects } from './scanner/workspaceProjects';
import { SidebarProvider } from './sidebar/provider';
import { comparePackVersions } from './shared/packVersion';
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
      // Modal: a non-modal notification can be collapsed into the notification
      // centre, leaving the generation waiting for an answer the user cannot see.
      const action = await vscode.window.showWarningMessage(
        `已有 ${files.length} 个生成文件存在，是否覆盖？`,
        { modal: true },
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
  // A generation can succeed and still leave F5 broken (a missing OpenOCD, for
  // example); the warning explains the next step while the result is fresh.
  for (const warning of result.warnings ?? []) {
    void vscode.window.showWarningMessage(warning);
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

function getOpenOcdPath(): string {
  return vscode.workspace.getConfiguration('cmakeEmbedded')
    .get<string>('openocdPath', 'openocd')?.trim() || 'openocd';
}

/**
 * Optional Pack mirror root. Mainland networks reach the Keil CDN slowly enough
 * that a large DFP can take minutes, so a LAN or domestic mirror can be pointed at
 * a flat directory of `<vendor>.<name>.<version>.pack` archives instead.
 */
function getPackMirror(): string | undefined {
  const configured = vscode.workspace.getConfiguration('cmakeEmbedded')
    .get<string>('packMirror', '')?.trim();
  return configured ? configured : undefined;
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
  // Derived from the curated position so repeated refreshes do not reshuffle
  // the vendor list as the profile count grows.
  const curatedIndex = curatedVendors.findIndex((vendor) => vendor.id === id);
  registerVendor({
    id,
    label: label || id,
    definePrefixes: [id.replace(/[^A-Za-z0-9_]/g, '') || id],
    order: importedVendorBaseOrder + (curatedIndex >= 0 ? curatedIndex : 0)
  });
}

/**
 * Installed-Pack identities, memoized for one catalog refresh.
 *
 * Resolving identities reads and parses every installed PDSC, which measures at
 * roughly a second on a real Keil installation. A single vendor switch asks for
 * them twice (vendor list and pack catalog), so the scan is shared rather than
 * repeated. Any operation that changes the store drops the entry explicitly; the
 * short window only covers back-to-back refreshes.
 */
const installedIdentitiesTtlMs = 2000;
let installedIdentitiesCache:
  { at: number; value: Promise<InstalledPackIdentity[]> } | undefined;

function installedPackIdentities(): Promise<InstalledPackIdentity[]> {
  const now = Date.now();
  if (installedIdentitiesCache && now - installedIdentitiesCache.at < installedIdentitiesTtlMs) {
    return installedIdentitiesCache.value;
  }
  const value = listInstalledPackIdentities(listKeilPacks(scanRoots().packRoots, scanFileSystem));
  installedIdentitiesCache = { at: now, value };
  // A failed scan must not poison the next refresh.
  void value.catch(() => {
    if (installedIdentitiesCache?.value === value) {
      installedIdentitiesCache = undefined;
    }
  });
  return value;
}

function invalidateInstalledPackIdentities(): void {
  installedIdentitiesCache = undefined;
}

/**
 * Linux toolchain discovery, memoized briefly.
 *
 * Every sidebar state post asks for the toolchain list, and each probe walks the
 * whole PATH with a stat per entry — measured at ~34 ms on a 41-entry PATH, so a
 * vendor switch that posts state repeatedly would spend hundreds of milliseconds
 * on it. The list only changes when the user edits PATH, hence the short TTL.
 */
const toolchainCacheTtlMs = 5000;
let toolchainCache: { at: number; value: ReturnType<typeof discoverLinuxToolchains> } | undefined;

function cachedLinuxToolchains(): ReturnType<typeof discoverLinuxToolchains> {
  const now = Date.now();
  if (toolchainCache && now - toolchainCache.at < toolchainCacheTtlMs) {
    return toolchainCache.value;
  }
  const value = discoverLinuxToolchains();
  toolchainCache = { at: now, value };
  return value;
}

/**
 * Vendor options for the sidebar: locally usable vendors (imported profiles
 * and installed Packs with importable devices) first, then the curated
 * mainstream chip vendors so the dropdown always reads like a product menu.
 * The pack index is deliberately not a vendor source — it lists publisher and
 * component packs too and would bury real chip vendors under publisher noise.
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
      const buffer = await downloadPack(downloadFetcher, option.packUrl, {
        mirror: getPackMirror()
      });
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
  invalidateInstalledPackIdentities();
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

const scanFileSystem = { exists: existsSync, readDir: readdirSync };

/**
 * Pack roots and Keil roots, memoized briefly.
 *
 * Enumerating the drive letters (`existsSync` per letter) and rebuilding the
 * candidate layout happens on every catalog refresh and every Keil Pack lookup;
 * the paths cannot change without a window reload or an environment edit, so a
 * short TTL removes the repeated filesystem probing.
 */
const scanRootsTtlMs = 5000;
let scanRootsCache: { at: number; value: ReturnType<typeof defaultScanRoots> } | undefined;

function scanRoots() {
  const now = Date.now();
  if (scanRootsCache && now - scanRootsCache.at < scanRootsTtlMs) {
    return scanRootsCache.value;
  }
  const drives = process.platform === 'win32'
    ? Array.from({ length: 24 }, (_, index) => `${String.fromCharCode(67 + index)}:/`).filter(existsSync)
    : [];
  const roots = defaultScanRoots(process.platform, process.env, os.homedir(), drives);
  scanRootsCache = { at: now, value: roots };
  return roots;
}

// The public CMSIS index is ~240 KB and can answer slowly, while a real DFP runs
// to tens of megabytes; one shared timeout would either abort the index or cut a
// large pack download short.
const indexFetcher = createTimeoutFetcher(30000);
const downloadFetcher = createTimeoutFetcher(10 * 60 * 1000);

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

/**
 * Downloads one pack from the online index.
 *
 * The index entry is the authoritative identity: a vendor-hosted archive name is
 * not a reliable pack name/version pair, so the caller passes the entry's values
 * to the importer instead of re-parsing the file name.
 */
async function downloadIndexedPack(pack: {
  name: string;
  version: string;
  packUrl: string;
}): Promise<{ buffer: Buffer; fileName: string; identity: { name: string; version: string } }> {
  const buffer = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `正在下载 ${pack.name} ${pack.version}…`,
      cancellable: true
    },
    (progress, token) => {
      const controller = new AbortController();
      const cancellation = token.onCancellationRequested(() => controller.abort());
      // The notification bar advances by deltas, so the last reported percentage
      // is tracked here instead of sending the absolute fraction each time.
      let reportedPercent = 0;
      return downloadPack(downloadFetcher, pack.packUrl, {
        signal: controller.signal,
        mirror: getPackMirror(),
        onProgress: (state) => {
          const described = describeDownloadProgress(state);
          const percent = described.fraction === undefined
            ? undefined
            : Math.floor(described.fraction * 100);
          const increment = percent === undefined ? 0 : Math.max(0, percent - reportedPercent);
          if (percent !== undefined) {
            reportedPercent = percent;
          }
          progress.report(increment > 0
            ? { message: described.message, increment }
            : { message: described.message });
          activeSidebar?.reportProgress(
            `正在下载 ${pack.name} ${pack.version}：${described.message}`
          );
        }
      }).finally(() => cancellation.dispose());
    }
  );
  return {
    buffer,
    fileName: pack.packUrl.split('/').pop() ?? `${pack.name}.${pack.version}.pack`,
    identity: { name: pack.name, version: pack.version }
  };
}

async function pickOnlinePack(): Promise<{
  buffer: Buffer;
  fileName: string;
  identity: { name: string; version: string };
} | undefined> {
  const keyword = await vscode.window.showInputBox({
    placeHolder: '输入厂商或芯片关键字，例如 MS32'
  });
  if (keyword === undefined || keyword.trim() === '') {
    return undefined;
  }
  const results = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: `正在搜索 CMSIS 公开 Pack 索引「${keyword.trim()}」…`,
      cancellable: true
    },
    (_progress, token) => {
      const controller = new AbortController();
      const cancellation = token.onCancellationRequested(() => controller.abort());
      return searchPacks(indexFetcher, keyword, {
        cache: packSearchCache,
        signal: controller.signal
      }).finally(() => cancellation.dispose());
    }
  );
  if (results.length === 0) {
    vscode.window.showInformationMessage(`CMSIS 公开索引中没有匹配「${keyword}」的 Pack。`);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    results.map((pack) => ({
      label: pack.name,
      description: pack.version,
      detail: pack.packUrl,
      pack
    })),
    { placeHolder: `匹配 ${results.length} 个 Pack，选择要下载导入的包` }
  );
  return picked ? downloadIndexedPack(picked.pack) : undefined;
}

/**
 * External include directories a generated MCU project needs.
 *
 * The CMSIS core pack is the only one today: device headers include
 * \`core_cm*.h\`, which no vendor DFP ships. When it is not installed the
 * project is still generated — the missing headers would break the build either
 * way, and blocking generation would also block the user from fixing it.
 */
async function mcuCorePackForGeneration(
  includeCorePack: boolean,
  version: string
): Promise<{ includeDir: string; version: string } | undefined> {
  if (!includeCorePack) {
    return undefined;
  }
  const pack = await findInstalledCorePack(packStorageRoot, version);
  if (pack) {
    return { includeDir: pack.includeDir, version: pack.record.version };
  }
  void vscode.window.showWarningMessage(
    '未安装 ARM CMSIS 内核包：生成的工程缺少 core_cm*.h，编译会失败。请点侧栏「安装内核包…」或运行「CMake Embedded: Install ARM CMSIS Core Pack」。'
  );
  return undefined;
}

/**
 * Directory of an installed Pack that matches a stored import record.
 *
 * Records created before the device-file snapshot existed carry neither the
 * snapshot nor the source directory; the installed Pack is still on disk, so the
 * snapshot can be rebuilt from it.
 */
async function installedDirectoryFor(name: string, version: string): Promise<string | undefined> {
  const entries = listKeilPacks(scanRoots().packRoots, scanFileSystem);
  for (const entry of entries) {
    if (entry.source !== 'directory') {
      continue;
    }
    const identity = await resolveInstalledPackIdentity(entry);
    if (identity && identity.name === name && identity.version === version) {
      return entry.packFile;
    }
  }
  return undefined;
}

/**
 * Device header and `system_*.c`/`.h` of the selected Pack, read from the
 * snapshot taken at import time (rebuilt from the archive or the installed
 * directory for Packs imported before the snapshot existed).
 *
 * A Pack without a declared device header falls back to the single device header
 * in its snapshot; without any device files the startup's weak `SystemInit`
 * keeps the project linking.
 */
async function deviceSupportFor(profile: DeviceProfile, sourcePack?: string): Promise<DeviceSupportFile[]> {
  const packSource = sourcePack ?? devicePackSourceForPart(profile.part);
  if (!packSource) {
    logLine(`[device] ${profile.part}: 没有关联的 Pack 来源，跳过器件文件复制。`);
    return [];
  }
  try {
    const record = (await listImportedPacks(packStorageRoot))
      .find((pack) => pack.packFile === packSource);
    // Scanning the installed Pack roots is only the fallback when the stored
    // archive is gone; doing it for every archive-backed Pack would make each
    // generation walk the whole Keil installation.
    const archivePresent = existsSync(resolve(packStorageRoot, packSource));
    const sourceRoot = record?.sourceRoot
      ?? (record && !archivePresent
        ? await installedDirectoryFor(record.name, record.version)
        : undefined);
    logLine(
      `[device] ${profile.part}: pack=${packSource} record=${record ? 'yes' : 'no'} `
      + `header=${profile.deviceHeader ?? '(未记录)'} sourceRoot=${sourceRoot ?? '(无)'}`
    );
    const files = await loadDeviceSupportFiles(packStorageRoot, packSource, profile.deviceHeader, {
      sourceRoot,
      familyHints: [profile.family, profile.series, profile.part]
    });
    logLine(
      files.length > 0
        ? `[device] ${profile.part}: 复制 ${files.length} 个文件（${files.map((file) => file.relative).join(', ')}）`
        : `[device] ${profile.part}: 没有解析到器件头/system 文件（Pack 快照与归档都无法给出 header）。`
    );
    return files;
  } catch (error) {
    logLine(`[device] ${profile.part}: 解析失败：${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function importPackOnly(): Promise<CommandResult> {
  const cancelled: CommandResult = { ok: false, cancelled: true, message: '未执行 Pack 导入。' };
  const source = await vscode.window.showQuickPick(
    [
      { label: '本地 .pack 文件', value: 'local' as const },
      { label: 'Keil 已安装 Pack', value: 'keil' as const },
      { label: 'CMSIS 公开在线索引', value: 'online' as const }
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
      result = await importPack(picked.buffer, picked.fileName, packStorageRoot, picked.identity);
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
    if (isCancellationError(error)) {
      return { ok: false, cancelled: true, message: '已取消 Pack 导入。' };
    }
    const message = `Pack 导入失败：${describeImportFailure(error)}`;
    void vscode.window.showErrorMessage(message);
    return { ok: false, message };
  }
}

/**
 * Downloads or picks a CMSIS Core pack archive.
 *
 * The core pack is the one pack that cannot be installed through the device-pack
 * path: it parses as a package but declares no devices, so \`importPack\` rejects
 * it by design. It is fetched here and installed by \`installCorePack\`.
 */
async function pickCorePackArchive(): Promise<{ buffer: Buffer; fileName: string } | undefined> {
  const source = await vscode.window.showQuickPick(
    [
      { label: '在线下载 ARM CMSIS 内核包（推荐）', value: 'online' as const },
      { label: '本地 .pack 文件', value: 'local' as const }
    ],
    { placeHolder: '选择 ARM CMSIS 内核包来源' }
  );
  if (!source) {
    return undefined;
  }
  if (source.value === 'local') {
    return pickLocalPack();
  }
  const packs = await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: '正在读取 CMSIS 公开 Pack 索引…',
      cancellable: true
    },
    (_progress, token) => {
      const controller = new AbortController();
      const cancellation = token.onCancellationRequested(() => controller.abort());
      return listPackIndexPacks(indexFetcher, packSearchCache, controller.signal)
        .finally(() => cancellation.dispose());
    }
  );
  const corePacks = packs
    .filter((pack) => pack.name.trim().toLowerCase() === 'cmsis')
    .sort((left, right) => comparePackVersions(right.version, left.version));
  if (corePacks.length === 0) {
    const message = 'CMSIS 公开索引中没有 ARM CMSIS 内核包。请改用本地 .pack 文件导入。';
    void vscode.window.showErrorMessage(message);
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    corePacks.map((pack) => ({
      label: `ARM CMSIS ${pack.version}`,
      description: pack.version,
      detail: pack.packUrl,
      pack
    })),
    { placeHolder: '选择要安装的 ARM CMSIS 内核包版本' }
  );
  if (!picked) {
    return undefined;
  }
  const download = await downloadIndexedPack({
    name: 'ARM.CMSIS',
    version: picked.pack.version,
    packUrl: picked.pack.packUrl
  });
  return { buffer: download.buffer, fileName: download.fileName };
}

/** Installs the ARM CMSIS core pack: the \`core_cm*.h\` headers device packs omit. */
async function installCorePackOnly(): Promise<CommandResult> {
  try {
    const picked = await pickCorePackArchive();
    if (!picked) {
      return { ok: false, cancelled: true, message: '未安装内核包。' };
    }
    const installed = await installCorePack(picked.buffer, picked.fileName, packStorageRoot);
    const message = installed.replaced
      ? `已更新 ARM CMSIS 内核包到 ${installed.record.version}（${installed.record.files} 个头文件）。生成工程时会自动包含它。`
      : `已安装 ARM CMSIS 内核包 ${installed.record.version}（${installed.record.files} 个头文件）。生成工程时会自动包含它。`;
    void vscode.window.showInformationMessage(message);
    activeSidebar?.refresh();
    return { ok: true, message };
  } catch (error) {
    if (isCancellationError(error)) {
      return { ok: false, cancelled: true, message: '已取消内核包安装。' };
    }
    const message = `内核包安装失败：${describeImportFailure(error)}`;
    void vscode.window.showErrorMessage(message);
    return { ok: false, message };
  }
}

/** Component/board packs fail deep inside the parser; surface product guidance. */
function describeImportFailure(error: unknown): string {
  // A timeout aborts exactly like a cancellation; name it instead of surfacing
  // either the raw AbortError or the cancellation copy.
  if (error instanceof RequestTimeoutError) {
    return `${describeTimeout(error)}。请检查代理/VPN 或换个时间重试，也可用「导入 Pack 包」导入本地 .pack。`;
  }
  const raw = error instanceof Error ? error.message : String(error);
  if (/no devices section|No \.pdsc file found|no family vendor/.test(raw)) {
    return '这个包的 PDSC 没有任何芯片定义（CMSIS 组件包、中间件包或板级包不含可生成的芯片）。请改用芯片厂商的 DFP 器件包。';
  }
  // A response without a numeric status means the request never reached the
  // server intact (intercepted proxy, captive portal, blocked TLS). Name that
  // rather than echoing the bare `HTTP undefined`.
  if (/\bHTTP (undefined|NaN|0)\b/.test(raw)) {
    return '在线索引请求没有拿到 HTTP 状态码，通常是代理/VPN 或防火墙拦截了请求。请检查代理设置后重试，也可用「导入 Pack 包」导入本地 .pack。';
  }
  // "fetch failed" is undici's wrapper; the cause carries the actionable reason.
  if (/^fetch failed$/i.test(raw.trim())) {
    const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code;
    const reason = code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ETIMEDOUT'
      ? '连接在线索引或厂商下载站超时'
      : code === 'ENOTFOUND' || code === 'EAI_AGAIN'
        ? '无法解析在线索引或厂商下载站的域名'
        : '网络请求失败';
    return `${reason}（${code ?? '网络错误'}）。请检查代理/VPN 后重试，或改用「导入 Pack 包」导入本地 .pack。`;
  }
  return raw;
}

/** One-click online install: the selected vendor's DFP, downloaded and imported. */
async function installPackOnlineOnly(): Promise<CommandResult> {
  try {
    const packs = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '正在读取 CMSIS 公开 Pack 索引…',
        cancellable: true
      },
      (_progress, token) => {
        const controller = new AbortController();
        const cancellation = token.onCancellationRequested(() => controller.abort());
        return listPackIndexPacks(indexFetcher, packSearchCache, controller.signal)
          .finally(() => cancellation.dispose());
      }
    );
    if (packs.length === 0) {
      const message = '在线索引暂无可用 Pack。';
      void vscode.window.showInformationMessage(message);
      return { ok: false, message };
    }
    // The online install is vendor- and series-aware: the candidates are the
    // packs that can serve the chip family selected in the sidebar, newest
    // version first.
    const selectedVendor = activeSidebar?.selection().mcu.vendor ?? '';
    const selectedSeries = activeSidebar?.selection().mcu.series ?? '';
    const curatedLabel = curatedVendors.find((vendor) => vendor.id === selectedVendor)?.label
      ?? selectedVendor;
    const wantedPackName = findCatalogSeries(selectedVendor, selectedSeries)?.packName ?? '';
    let candidates = selectedVendor
      ? selectPacksForSelection(packs, selectedVendor, wantedPackName)
      : packs;
    if (selectedVendor && candidates.length === 0) {
      const downloadPage = seriesDownloadPage(selectedVendor, selectedSeries);
      if (downloadPage) {
        void vscode.env.openExternal(vscode.Uri.parse(downloadPage));
        void vscode.window.showInformationMessage(
          `CMSIS 公开索引没有「${curatedLabel}」的器件包：已在浏览器打开官方下载页，下载 DFP .pack 后点「导入 Pack 包」完成导入。`
        );
        return { ok: false, cancelled: true, message: '已在浏览器打开器件包下载页。' };
      }
      const fallback = await vscode.window.showQuickPick(
        [
          { label: '浏览在线索引全部厂商的包', value: 'all' as const },
          { label: '取消', value: 'cancel' as const }
        ],
        {
          placeHolder: `CMSIS 公开索引没有「${curatedLabel}」的器件包：请用 Keil Pack Installer 安装，或从厂商官网下载 .pack 后用「导入 Pack 包」安装`
        }
      );
      if (fallback?.value !== 'all') {
        return { ok: false, cancelled: true, message: '未执行在线安装。' };
      }
      candidates = packs;
    }
    const picked = await vscode.window.showQuickPick(
      candidates.map((pack) => ({
        label: `${pack.vendorName} ${pack.name}`,
        description: pack.version,
        detail: pack.packUrl,
        pack
      })),
      {
        placeHolder: selectedVendor
          ? `${curatedLabel} 可在线安装的 Pack（${candidates.length} 个），选择后自动下载导入`
          : `在线索引共 ${candidates.length} 个 Pack，输入关键字过滤，选择后自动下载导入`
      }
    );
    if (!picked) {
      return { ok: false, cancelled: true, message: '未执行在线安装。' };
    }
    const download = await downloadIndexedPack(picked.pack);
    const result = await importPack(
      download.buffer,
      download.fileName,
      packStorageRoot,
      download.identity
    );
    await syncPackFileIndex();
    activeSidebar?.refresh();
    const skipped = result.skipped.length > 0
      ? `\n跳过 ${result.skipped.length} 个型号：${result.skipped
          .map((item) => `${item.part}（${item.reason}）`)
          .join('、')}`
      : '';
    const message = `在线安装完成：${result.imported.length} 个新型号已注册。${skipped}`;
    void vscode.window.showInformationMessage(message);
    return { ok: true, message };
  } catch (error) {
    if (isCancellationError(error)) {
      return { ok: false, cancelled: true, message: '已取消在线安装。' };
    }
    const message = `在线安装失败：${describeImportFailure(error)}`;
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
  // flash.py and the Cortex-Debug configuration have their own commands; the
  // sidebar behaves the same way, so both entry points generate only the
  // project here.
  const selection = activeSidebar?.selection();
  const corePack = await mcuCorePackForGeneration(
    selection?.corePackInclude !== false,
    selection?.mcu.corePackVersion ?? ''
  );
  const selectedSource = selection?.mcu.part.toUpperCase() === profile.part.toUpperCase()
    ? selection.mcu.sourcePack
    : undefined;
  reportWorkflowResult(await generateMcuWorkflow(
    createWorkflowHost(root),
    profile,
    {
      corePack,
      deviceSupport: await deviceSupportFor(profile, selectedSource)
    }
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
  const sysroot = await vscode.window.showInputBox({
    title: '目标 sysroot（可选）',
    prompt: '填写目标系统的根目录，例如 /opt/loongarch64-sysroot；留空表示使用编译器的默认搜索路径。',
    value: saved?.sysroot ?? '',
    ignoreFocusOut: true
  });
  if (sysroot === undefined) {
    return;
  }
  reportWorkflowResult(await generateLinuxWorkflow(createWorkflowHost(root), toolchain, {
    sysroot: sysroot.trim() || undefined
  }));
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
  const saved = await readNativeProjectConfig(join(root, nativeConfigFileName));
  const typeItems = [
    { label: '可执行文件', value: 'executable' as const },
    { label: '静态库', value: 'static' as const },
    { label: '动态库', value: 'shared' as const }
  ];
  // The previous generation's choice is offered as the default item instead of
  // forcing the user to re-pick it on every regeneration.
  const orderedTypes = saved?.targetType
    ? [...typeItems].sort((left, right) =>
        left.value === saved.targetType ? -1 : right.value === saved.targetType ? 1 : 0)
    : typeItems;
  const selection = await vscode.window.showQuickPick(orderedTypes, {
    placeHolder: '选择普通 C/C++ 目标类型'
  });
  if (!selection) {
    return;
  }
  const standards = [
    { label: 'C11 / C++17（推荐）', cStandard: 11 as const, cxxStandard: 17 as const },
    { label: 'C17 / C++20', cStandard: 17 as const, cxxStandard: 20 as const },
    { label: 'C23 / C++23', cStandard: 23 as const, cxxStandard: 23 as const }
  ];
  const orderedStandards = saved?.cStandard && saved?.cxxStandard
    ? [...standards].sort((left, right) =>
        left.cStandard === saved.cStandard && left.cxxStandard === saved.cxxStandard
          ? -1
          : right.cStandard === saved.cStandard && right.cxxStandard === saved.cxxStandard ? 1 : 0)
    : standards;
  const standardSelection = await vscode.window.showQuickPick(orderedStandards, {
    placeHolder: '选择 C / C++ 语言标准'
  });
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
      // Modal: a non-modal notification can be collapsed into the notification
      // centre, leaving the generation waiting for an answer the user cannot see.
      const action = await vscode.window.showWarningMessage(
        `已有 ${files.length} 个生成文件存在，是否覆盖？`,
        { modal: true },
        '覆盖',
        '取消'
      );
      return action === '覆盖';
    },
    discoverToolchains: () => cachedLinuxToolchains(),
    scanProject: (root, options) => scanProject(root, options),
    discoverProjects: (roots, options) => discoverWorkspaceProjects(roots, options),
    packFileForPart: (part, sourcePack) => (
      sourcePack ? packArchiveBySource.get(sourcePack) : packFileByPart.get(part)
    ),
    discoverPackVendors: () => discoverPackVendorOptions(),
    describeCorePack: () => describeCorePack(packStorageRoot),
    ensureCortexDebugInstalled: () => ensureCortexDebugInstalled(),
    deviceSupportFilesForPart: async (part, sourcePack) => {
      const selected = getDeviceProfile(part);
      return deviceSupportFor(selected, sourcePack);
    },
    corePackForGeneration: (includeCorePack, version) =>
      mcuCorePackForGeneration(includeCorePack, version),
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
    vscode.commands.registerCommand('cmakeEmbedded.installPackOnline', () => installPackOnlineOnly()),
    vscode.commands.registerCommand('cmakeEmbedded.removePack', () => removePackOnly()),
    vscode.commands.registerCommand('cmakeEmbedded.installCorePack', () => installCorePackOnly()),
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
