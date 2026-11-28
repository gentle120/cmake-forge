import * as vscode from 'vscode';
import { existsSync, statSync } from 'node:fs';
import { delimiter, dirname, isAbsolute, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { CommandResult } from '../shared/commandResult';
import { randomBytes } from 'node:crypto';
import {
  getDeviceProfileForPack,
  isRuntimeDeviceProfile,
  listDeviceProfilesForPack,
  type DeviceProfile
} from '../devices/deviceProfiles';
import type { DevicePackOption } from '../devices/deviceSelection';
import { comparePackVersions } from '../shared/packVersion';
import { getVendorMetadata, hasVendor } from '../devices/vendorRegistry';
import { canonicalSeriesId, findCatalogSeries, seriesServesProfile } from '../devices/seriesCatalog';
import type { CorePackStatus } from '../packs/corePack';
import { getFlashProbeProfile, listFlashProbeProfiles, type FlashProbeId } from '../flash/probeProfiles';
import {
  getFlashTargetProfile,
  listFlashTargetVendors,
  type FlashTargetProfile
} from '../flash/targets/targetProfiles';
import {
  backendSupportsProbe,
  defaultBackendFor,
  jlinkDeviceName,
  pyocdTargetName,
  type FlashBackendId
} from '../flash/backendProfiles';
import type { FlashDeviceContext, FlashExecutablePaths } from '../generator/flashScriptGenerator';
import { missingOpenOcdNotice, resolveOpenOcdExecutable } from '../flash/openocd';
import { normalizeConfiguredPath } from '../shared/configuredPath';
import {
  buildOpenOcdFlashArgs,
  detectChip,
  describeIdentity,
  matchOpenOcdStage,
  type ChipIdentity
} from '../flash/openocdDirect';
import { suggestTargetForChip } from '../flash/chipTargets';
import {
  generateDebugWorkflow,
  generateFlashWorkflow,
  generateLinuxWorkflow,
  generateMcuWorkflow,
  generateNativeWorkflow,
  projectNameFromRoot,
  type ProjectWorkflowHost,
  type WorkflowResult
} from '../generation/workflow';
import { discoverLinuxToolchains } from '../linux/discovery';
import { createLinuxToolchain } from '../linux/toolchainGenerator';
import { describeNativeProject } from '../native/projectStructure';
import type { DeviceSupportFile } from '../packs/deviceSupport';
import { logLine, showLog } from '../integration/output';
import { scanProject, ScanCancelledError } from '../scanner/projectScanner';
import {
  reconcileProjectRoot,
  WorkspaceProjectsCancelledError,
  type WorkspaceProject,
  type WorkspaceProjectScanOptions
} from '../scanner/workspaceProjects';
import {
  discoverMcuBuildToolchains,
  findBuildToolchain,
  type BuildToolchain
} from '../env/buildToolchains';
import { PYPI_MIRROR, installArmGcc, installOpenOcd } from '../env/toolDownloads';
import { renderSidebarHtml } from './html';
import { parseIncomingMessage, type SidebarIncomingMessage } from './messages';
import {
  buildSidebarState,
  nextMcuSelection,
  packServesSeries,
  sanitizeSidebarSelection,
  type SidebarEnvironment,
  type SidebarEnvironmentChoice,
  type SidebarFlashDetection,
  type SidebarOption,
  type SidebarSelection,
  type SidebarToolId,
  type SidebarToolStatus
} from './state';
import { discoverFirmware, findWorkspaceFirmware } from '../flash/firmwareDiscovery';
import { runFlash, runTool, type FlashEvent, type FlashRunResult } from '../flash/flashRunner';
import { diagnoseFlashFailure } from '../flash/flashDiagnostics';

const selectionKey = 'cmakeForge.sidebarSelection.v1';

interface SidebarScanHost {
  scanProject(root: string, options?: { signal?: AbortSignal }): ReturnType<typeof scanProject>;
}

const scanHost: SidebarScanHost = {
  scanProject: (root, options) => scanProject(root, options)
};

export interface SidebarProviderDependencies {
  workflow: ProjectWorkflowHost;
  confirmOverwrite(files: string[], removedFiles?: string[]): Promise<boolean>;
  discoverToolchains(): ReturnType<typeof discoverLinuxToolchains>;
  /** Installed MCU compiler families; absent means "scan the real machine". */
  discoverMcuBuildToolchains?(): BuildToolchain[];
  discoverProjects(roots: string[], options?: WorkspaceProjectScanOptions): Promise<WorkspaceProject[]>;
  scanProject?(root: string, options?: { signal?: AbortSignal }): ReturnType<typeof scanProject>;
  /** Resolves the stored CMSIS pack path for an imported part, when available. */
  packFileForPart?(part: string, sourcePack?: string): string | undefined;
  discoverPackVendors?(): Promise<{ vendors: Array<{ value: string; label: string; description?: string }>; notice?: string }>;
  loadPackCatalog?(vendor: string): Promise<{ options: DevicePackOption[]; notice?: string }>;
  activatePack?(
    vendor: string,
    packId: string,
    version: string
  ): Promise<{ vendorId: string; packId: string; version: string; sourcePack: string; message: string }>;
  /** Installed ARM CMSIS core pack, for the sidebar copy and its dropdown. */
  describeCorePack?(): Promise<CorePackStatus>;
  /**
   * The core pack a generation must copy into the project. `includeCorePack` is
   * false when the user turned the switch off; `version` empty means newest.
   */
  corePackForGeneration?(
    includeCorePack: boolean,
    version: string
  ): Promise<{ includeDir: string; version: string } | undefined>;
  /**
   * Confirms the Cortex-Debug adapter is installed before a configuration that
   * cannot run is written. Injected so the provider stays testable outside the
   * VS Code host; absent means "assume installed".
   */
  ensureCortexDebugInstalled?(): Promise<boolean>;
  /**
   * Device header and `system_*` snapshot of the selected Pack, copied into the
   * generated project. Absent in tests that do not exercise the copy.
   */
  deviceSupportFilesForPart?(part: string, sourcePack?: string): Promise<DeviceSupportFile[]>;
  /**
   * Directory the extension may write downloads into (the global storage
   * root). Absent in tests, which never reach the download buttons.
   */
  toolStorageRoot?(): string;
}

function workspaceName(): string {
  const root = vscode.workspace.workspaceFolders?.[0];
  return root?.name ?? '未打开工作区';
}

function normalizeResult(result: WorkflowResult): {
  ok: boolean;
  cancelled?: boolean;
  message: string;
  files: string[];
} {
  return {
    ok: result.ok,
    cancelled: result.cancelled,
    message: result.message,
    files: result.files
  };
}

function sameDirectory(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/[\\/]+$/, '').toLowerCase();
  return normalize(left) === normalize(right);
}

function basenamePath(file: string): string {
  const parts = file.split(/[\\/]/);
  return parts[parts.length - 1] || file;
}

function formatBytes(size: number): string {
  if (!Number.isFinite(size) || size <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = size;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 || value >= 10 ? String(Math.round(value)) : value.toFixed(1);
  return `${text} ${units[unit]}`;
}


function toolExtensions(): string[] {
  const windows = typeof process !== 'undefined' && process.platform === 'win32';
  return windows ? ['', '.exe', '.cmd', '.bat'] : [''];
}

/**
 * Resolves a configured command (absolute path or bare name) to a real file.
 * Bare names are looked up on `PATH`; a configured name alone is not proof the
 * tool is installed.
 */
function resolveConfiguredExecutable(configured: string, fallback: string): string | undefined {
  if (typeof process === 'undefined') {
    return undefined;
  }
  const value = configured.trim() || fallback;
  if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    try {
      return statSync(value).isFile() ? value : undefined;
    } catch {
      return undefined;
    }
  }
  const path = process.env.PATH ?? process.env.Path ?? '';
  for (const directory of path.split(delimiter).filter((entry) => entry.length > 0)) {
    for (const extension of toolExtensions()) {
      const candidate = join(directory, `${value}${extension}`);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // Keep looking.
      }
    }
  }
  return undefined;
}

export class SidebarProvider implements vscode.WebviewViewProvider, vscode.Disposable {
  static readonly viewType = 'cmakeForge.sidebar';

  private view?: vscode.WebviewView;
  private disposed = false;
  private busy = false;
  private selectionValue: SidebarSelection;
  private discoveredProjects: WorkspaceProject[] = [];
  private discoveringProjects = true;
  private projectDiscoveryController?: AbortController;
  private workspaceScanController?: AbortController;
  private workspaceScanPromise?: Promise<void>;
  /** Latest firmware/target/probe detection; `undefined` until the first scan. */
  private flashDetection?: SidebarFlashDetection;
  private flashController?: AbortController;
  private chipDetectionRunning = false;
  /** Project root the cached chip label belongs to; a new root invalidates it. */
  private chipDetectionRoot?: string;
  /** Which tool download is running, if any. */
  private toolInstallRunning?: SidebarToolId;
  /** Download prompts already shown in this window; VS Code notifications are not persistent. */
  private promptedTools = new Set<SidebarToolId>();
  /** Progress of the tool download the user started, if any. */
  private toolProgress?: SidebarEnvironment['progress'];
  private packOptions: DevicePackOption[] = [];
  private vendorOptions?: Array<{ value: string; label: string; description?: string }>;
  private pendingPackId: string;
  private packCatalogNotice = '';
  private corePackNotice = '';
  private corePackVersions: SidebarOption[] = [];
  private packCatalogRequest = 0;
  private lastBusyHintAt = 0;
  private pendingPosts: unknown[] = [];
  private buildToolchainCache?: { at: number; value: BuildToolchain[] };
  /** True while the OpenOCD path is the setting default, not a per-workspace override. */
  private openOcdPathIsDefault = true;
  private readonly viewDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly dependencies: SidebarProviderDependencies
  ) {
    this.selectionValue = sanitizeSidebarSelection(
      context.workspaceState.get(selectionKey),
      undefined,
      [],
      true,
      this.buildToolchains()
    );
    // The sidebar default is the bare command `openocd`; when the user configured
    // an absolute OpenOCD path in the settings, that path is what the generated
    // launch.json must pass as `serverpath` (a bare name is only found on PATH).
    // The setting stays authoritative: only an explicit per-workspace override
    // is persisted; otherwise the displayed path follows the setting.
    this.openOcdPathIsDefault = this.selectionValue.flash.openocdPath === 'openocd';
    if (this.openOcdPathIsDefault) {
      this.selectionValue = {
        ...this.selectionValue,
        flash: {
          ...this.selectionValue.flash,
          openocdPath: this.configuredOpenOcdPath()
        }
      };
    }
    this.pendingPackId = this.selectionValue.mcu.packId;
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri]
    };
    const nonce = randomBytes(16).toString('base64');
    view.webview.html = renderSidebarHtml(view.webview, this.context.extensionUri, nonce);
    // Messages sent before the webview's message listener exists are dropped;
    // flush them once the webview has announced itself with `ready`.
    this.postState();

    const messageDisposable = view.webview.onDidReceiveMessage((value) => {
      const message = parseIncomingMessage(value);
      if (!message) {
        return;
      }
      void this.handleMessage(message).catch((error) => {
        const text = error instanceof Error ? error.message : String(error);
        this.post({ type: 'notification', level: 'error', message: text });
      });
    });
    const viewDisposable = view.onDidDispose(() => {
      messageDisposable.dispose();
      viewDisposable.dispose();
      this.viewDisposables.splice(0).forEach((disposable) => {
        if (disposable !== viewDisposable) {
          disposable.dispose();
        }
      });
      this.view = undefined;
    });
    this.viewDisposables.push(messageDisposable, viewDisposable);
  }

  selection(): SidebarSelection {
    return sanitizeSidebarSelection(
      this.selectionValue,
      this.selectionValue,
      this.packOptions,
      this.packOptions.length === 0,
      this.buildToolchains()
    );
  }

  /**
   * Compiler toolchains on `PATH`, cached briefly: the sidebar re-renders after
   * every selection change and each render would otherwise re-read the PATH
   * directories.
   */
  private buildToolchains(): BuildToolchain[] {
    const now = Date.now();
    if (this.buildToolchainCache && now - this.buildToolchainCache.at < 10_000) {
      return this.buildToolchainCache.value;
    }
    // Only GNU Arm GCC is offered: it is the one toolchain the extension can
    // install by itself and the one the flash/debug flow is verified against.
    const discovered = (this.dependencies.discoverMcuBuildToolchains?.()
      ?? discoverMcuBuildToolchains()).filter((toolchain) => toolchain.family === 'gcc');
    const configured = this.configuredArmGccToolchain();
    const value = configured
      ? [
          configured,
          ...discovered.filter((toolchain) => !sameDirectory(toolchain.binDir, configured.binDir))
        ]
      : discovered;
    this.buildToolchainCache = { at: now, value };
    return value;
  }

  /** `cmakeForge.armGccPath`: a bin directory or the compiler executable itself. */
  private configuredArmGccToolchain(): BuildToolchain | undefined {
    const configured = normalizeConfiguredPath(
      vscode.workspace.getConfiguration('cmakeForge').get<string>('armGccPath', '')
    );
    if (!configured) {
      return undefined;
    }
    const binDir = /arm-none-eabi-gcc(\.exe)?$/i.test(configured)
      ? dirname(configured)
      : configured;
    const suffix = process.platform === 'win32' ? '.exe' : '';
    const compiler = join(binDir, `arm-none-eabi-gcc${suffix}`);
    if (!existsSync(compiler)) {
      return undefined;
    }
    const maybe = (name: string): string | undefined => {
      const candidate = join(binDir, `${name}${suffix}`);
      return existsSync(candidate) ? candidate : undefined;
    };
    return {
      id: 'mcu:gcc',
      direction: 'mcu',
      family: 'gcc',
      prefix: 'arm-none-eabi',
      cCompiler: compiler,
      cxxCompiler: maybe('arm-none-eabi-g++.exe'),
      cCompilerPath: compiler,
      objcopy: maybe('arm-none-eabi-objcopy.exe'),
      size: maybe('arm-none-eabi-size.exe'),
      detected: true,
      onPath: false,
      binDir,
      label: 'ARM GNU Toolchain',
      detail: binDir
    };
  }

  private selectedMcuToolchain(): BuildToolchain | undefined {
    const toolchains = this.buildToolchains();
    return findBuildToolchain(toolchains, this.selectionValue.mcu.buildToolchain)
      ?? toolchains.find((toolchain) => toolchain.detected)
      ?? toolchains[0];
  }

  /**
   * Mirrors a long-running operation's progress into the sidebar badge, so the
   * download is visible where the user started it and not only in the corner
   * notification.
   */
  private async refreshCorePackNotice(): Promise<void> {
    if (!this.dependencies.describeCorePack) {
      return;
    }
    try {
      const status = await this.dependencies.describeCorePack();
      this.corePackNotice = status.notice;
      this.corePackVersions = status.versions.map((version) => ({
        value: version,
        label: version
      }));
    } catch (error) {
      this.corePackNotice = error instanceof Error ? error.message : String(error);
      this.corePackVersions = [];
    }
  }

  reportProgress(message: string): void {
    this.post({ type: 'operationProgress', message });
  }

  refresh(): void {
    if (this.openOcdPathIsDefault) {
      const configured = this.configuredOpenOcdPath();
      if (this.selectionValue.flash.openocdPath !== configured) {
        this.selectionValue = {
          ...this.selectionValue,
          flash: { ...this.selectionValue.flash, openocdPath: configured }
        };
      }
    }
    // One state post after the refresh, not one before and several after: the
    // webview re-renders the whole panel per message, so duplicate posts are
    // visible as flicker.
    // A sidebar operation refreshes the catalog once it has finished; reloading
    // it here would repeat the installed-Pack scan while that operation runs.
    if (this.busy) {
      this.postState();
      return;
    }
    // Workspace folders can be added or removed while the view stays open; the
    // project list must follow without waiting for a window reload.
    const discovery = this.discoveringProjects
      ? Promise.resolve()
      : this.discoverProjects().catch((error) => {
          const text = error instanceof Error ? error.message : String(error);
          this.post({ type: 'notification', level: 'error', message: text });
          this.discoveringProjects = false;
        });
    // The core-pack state changes only on install, but it is cached, so a stale
    // copy would survive a manual storage cleanup.
    const corePack = this.refreshCorePackNotice();
    void Promise.all([discovery, corePack])
      .then(() => this.postState())
      .catch(() => this.postState());
    void this.refreshPackCatalog(this.selectionValue.mcu.vendor);
  }

  dispose(): void {
    this.disposed = true;
    this.projectDiscoveryController?.abort();
    this.workspaceScanController?.abort();
    this.viewDisposables.splice(0).forEach((disposable) => disposable.dispose());
    this.view = undefined;
  }

  private post(message: unknown): void {
    if (this.disposed) {
      return;
    }
    if (!this.view) {
      // The view resolves after activation; early progress and notifications
      // are queued instead of being dropped. The window is small and bounded.
      this.pendingPosts.push(message);
      if (this.pendingPosts.length > 20) {
        this.pendingPosts.shift();
      }
      return;
    }
    void this.view.webview.postMessage(message);
  }

  private flushPendingPosts(): void {
    const queued = this.pendingPosts.splice(0);
    for (const message of queued) {
      this.post(message);
    }
  }

  private state() {
    // The sidebar loader contract is optional for old host fixtures.
    const state = buildSidebarState(
      workspaceName(),
      this.selectionValue,
      this.dependencies.discoverToolchains(),
      this.discoveredProjects.map((project) => ({
        value: project.root,
        label: project.label,
        description: project.relativePath || '.',
        detail: project.markers.join(', ')
      })),
      this.selectionValue.projectRoot,
      this.discoveringProjects,
      this.packOptions,
      this.pendingPackId,
      this.vendorOptions,
      this.packCatalogNotice,
      this.corePackNotice,
      this.corePackVersions,
      this.buildToolchains()
    );
    // Detection is host-side IO and can lag the selection by one refresh; the
    // webview shows "尚未检测" until the first result lands.
    return {
      ...state,
      ...(this.flashDetection ? { flashDetection: this.flashDetection } : {}),
      environment: this.environment()
    };
  }

  private postState(): void {
    this.post({ type: 'state', state: this.state() });
  }

  private async saveSelection(value: unknown): Promise<void> {
    const previous = this.selectionValue;
    let requested = sanitizeSidebarSelection(
      value,
      previous,
      this.packOptions,
      this.packOptions.length === 0,
      this.buildToolchains()
    );
    const mcu = requested.mcu;
    const mcuChanged =
      mcu.vendor !== previous.mcu.vendor
      || mcu.packId !== previous.mcu.packId
      || mcu.version !== previous.mcu.version
      || mcu.sourcePack !== previous.mcu.sourcePack
      || mcu.series !== previous.mcu.series
      || mcu.part !== previous.mcu.part;
    // Only an actual MCU-field change runs the MCU recomputation; a mode-only
    // change must survive as sent, and nextMcuSelection never rewrites the mode.
    this.selectionValue = mcuChanged && mcu.vendor === previous.mcu.vendor
      ? sanitizeSidebarSelection(
          nextMcuSelection({ ...previous, mode: requested.mode }, {
            vendor: mcu.vendor,
            packId: mcu.packId,
            version: mcu.version,
            sourcePack: mcu.sourcePack,
            series: mcu.series,
            part: mcu.part
          }, this.packOptions),
          previous,
          this.packOptions,
          this.packOptions.length === 0,
          this.buildToolchains()
        )
      : requested;
    // Keep the setting as the default instead of persisting its current value:
    // otherwise a later settings change or window reload keeps the stale path.
    const configuredOpenOcd = this.configuredOpenOcdPath();
    this.openOcdPathIsDefault = requested.flash.openocdPath === 'openocd'
      || requested.flash.openocdPath === configuredOpenOcd;
    if (this.openOcdPathIsDefault) {
      requested = {
        ...requested,
        flash: { ...requested.flash, openocdPath: 'openocd' }
      };
      this.selectionValue = {
        ...this.selectionValue,
        flash: { ...this.selectionValue.flash, openocdPath: configuredOpenOcd }
      };
    } else {
      this.selectionValue = requested;
    }
    const vendorChanged = this.selectionValue.mcu.vendor !== previous.mcu.vendor;
    const seriesChanged = this.selectionValue.mcu.series !== previous.mcu.series;
    await this.context.workspaceState.update(selectionKey, requested);
    if (vendorChanged) {
      this.pendingPackId = this.selectionValue.mcu.packId;
      this.packOptions = [];
      this.packCatalogNotice = '';
    }
    this.postState();
    // The firmware, target and probe labels in the flash card follow the
    // selection, so every persisted change re-runs the detection.
    void this.refreshFlashDetection().then(() => this.postState());
    if (vendorChanged) {
      // Series-first: switching vendors only refreshes the catalog; the series
      // (defaulted to the catalog's first entry) then determines the Pack.
      await this.refreshPackCatalog(this.selectionValue.mcu.vendor);
    }
    if (seriesChanged || vendorChanged) {
      const resolved = this.resolvePackForSeries(
        this.selectionValue.mcu.vendor,
        this.selectionValue.mcu.series
      );
      if (resolved) {
        this.pendingPackId = resolved.packId;
        await this.activatePack(resolved.packId, resolved.version);
        return;
      }
    }
  }

  /** Finds a locally known Pack serving the selected series. */
  private resolvePackForSeries(
    vendor: string,
    series: string
  ): { packId: string; version: string } | undefined {
    const catalog = findCatalogSeries(vendor, series);
    for (const option of this.packOptions) {
      if (option.origin === 'imported' && option.packFile) {
        const profiles = listDeviceProfilesForPack(option.packFile);
        if (profiles.some((profile) => seriesServesProfile(vendor, series, profile))) {
          return { packId: option.packId, version: option.version };
        }
      } else if (option.origin === 'installed' && catalog && option.name === catalog.packName) {
        return { packId: option.packId, version: option.version };
      }
    }
    return undefined;
  }

  private async refreshPackCatalog(vendor: string, autoActivate = false): Promise<void> {
    const request = ++this.packCatalogRequest;
    // Keep the last good catalog for this vendor: a transient index/network
    // failure must not replace a usable list with an empty one.
    const previousOptions = this.packOptions;
    this.packOptions = [];
    this.post({
      type: 'packCatalogLoading',
      vendor,
      packs: [],
      versions: [],
      notice: ''
    });
    try {
      const [vendorResult, catalogResult] = await Promise.all([
        this.vendorOptions || !this.dependencies.discoverPackVendors
          ? Promise.resolve(undefined)
          : this.dependencies.discoverPackVendors(),
        this.dependencies.loadPackCatalog
          ? this.dependencies.loadPackCatalog(vendor)
          : Promise.resolve({
              options: [] as DevicePackOption[],
              notice: undefined as string | undefined
            })
      ]);
      if (request !== this.packCatalogRequest || vendor !== this.selectionValue.mcu.vendor) {
        return;
      }
      if (vendorResult) {
        this.vendorOptions = vendorResult.vendors;
      }
      // First open without a usable persisted vendor: adopt the first offered
      // vendor so the series dropdown is operable instead of staying empty.
      if (this.selectionValue.mcu.vendor === '' && this.vendorOptions?.length) {
        const adopted = this.vendorOptions[0].value;
        this.selectionValue = sanitizeSidebarSelection({
          ...this.selectionValue,
          mcu: { ...this.selectionValue.mcu, vendor: adopted, series: '' }
        }, this.selectionValue);
        await this.context.workspaceState.update(selectionKey, this.selectionValue);
        await this.refreshPackCatalog(adopted);
        return;
      }
      this.packOptions = catalogResult.options;
      // The persisted selection was kept unvalidated until the catalog arrived;
      // now drop whatever it no longer offers (a removed builtin Pack, an old
      // version) and pick the version the catalog actually has.
      this.selectionValue = sanitizeSidebarSelection(
        this.selectionValue,
        this.selectionValue,
        this.packOptions
      );
      this.packCatalogNotice = catalogResult.notice || vendorResult?.notice || '';
      // Only Packs that serve the selected series are offered: with a series
      // chosen first, an unrelated DFP is not a valid choice — selecting one
      // would leave the part list empty with no way forward.
      const serving = this.servingPackOptions();
      if (serving.length === 0 && this.packCatalogNotice === '') {
        const catalog = findCatalogSeries(this.selectionValue.mcu.vendor, this.selectionValue.mcu.series);
        this.packCatalogNotice = catalog?.packName
          ? `「${catalog.label}」系列需要 ${catalog.packName}：点上方「在线安装 Pack」可直接下载导入，或用 Keil Pack Installer 安装后重选系列，也可点「导入 Pack 包」导入已下载的 .pack。`
          : '未找到该厂商的 Pack：请点上方「在线安装 Pack」或「导入 Pack 包」获取器件包，也可以先用 Keil Pack Installer 安装。';
      }

      const selected = serving.find((option) =>
        option.packId === this.selectionValue.mcu.packId
        && option.version === this.selectionValue.mcu.version
      );
      const fallback = serving[0];
      if (!selected && fallback) {
        this.pendingPackId = fallback.packId;
        // An explicit vendor change activates the newest already-available
        // Pack version so series and parts work without a manual import.
        // Downloadable entries wait for an explicit selection; startup
        // refreshes never activate on their own. The series wins over version
        // order: after an online install of another series' DFP, the Pack that
        // serves the selected series is the only correct activation.
        const seriesPack = autoActivate
          ? this.resolvePackForSeries(this.selectionValue.mcu.vendor, this.selectionValue.mcu.series)
          : undefined;
        const seriesCandidate = seriesPack && serving.find((option) =>
          option.packId === seriesPack.packId
          && option.version === seriesPack.version
          && (option.origin === 'imported' || option.origin === 'installed')
        );
        const autoCandidate = autoActivate && this.dependencies.activatePack
          ? seriesCandidate ?? [...serving]
            .filter((option) => option.origin === 'imported' || option.origin === 'installed')
            .sort((left, right) =>
              comparePackVersions(right.version, left.version)
              || (left.origin === 'imported' ? -1 : right.origin === 'imported' ? 1 : 0)
            )[0]
          : undefined;
        if (autoCandidate) {
          this.pendingPackId = autoCandidate.packId;
          await this.activatePack(autoCandidate.packId, autoCandidate.version);
          return;
        }
      } else {
        this.pendingPackId = selected?.packId ?? this.selectionValue.mcu.packId;
      }
      const options = this.optionsForCatalog();
      this.post({
        type: 'packCatalogState',
        vendor,
        packs: options.packs,
        versions: options.versions,
        notice: this.packCatalogNotice,
        pendingPackId: this.pendingPackId
      });
      this.postState();
    } catch (error) {
      if (request !== this.packCatalogRequest || vendor !== this.selectionValue.mcu.vendor) {
        return;
      }
      this.packCatalogNotice = error instanceof Error ? error.message : String(error);
      this.packOptions = previousOptions.filter((option) =>
        option.vendorId === vendor && option.origin !== 'downloadable'
      );
      const options = this.optionsForCatalog();
      this.post({
        type: 'packCatalogState',
        vendor,
        packs: options.packs,
        versions: options.versions,
        notice: this.packCatalogNotice,
        pendingPackId: this.pendingPackId
      });
      this.postState();
    }
  }

  /** Catalog entries this selection's series can actually use. */
  private servingPackOptions(): DevicePackOption[] {
    return this.packOptions.filter((option) =>
      packServesSeries(
        this.selectionValue.mcu.vendor,
        this.selectionValue.mcu.series,
        option
      )
    );
  }

  private optionsForCatalog(): { packs: SidebarOption[]; versions: SidebarOption[] } {
    const packs = new Map<string, DevicePackOption>();
    for (const option of this.packOptions) {
      if (!packs.has(option.packId)) {
        packs.set(option.packId, option);
      }
    }
    const serving = this.servingPackOptions();
    return {
      packs: [...packs.values()]
        .filter((option) => serving.some((candidate) =>
          candidate.packId === option.packId && candidate.version === option.version
        ))
        .map((option) => ({
          value: option.packId,
          label: option.name,
          description: option.origin
        })),
      versions: serving
        .filter((option) => option.packId === this.pendingPackId)
        .map((option) => ({
          value: option.version,
          label: option.version,
          description: option.origin
        }))
    };
  }

  private async activatePack(packId: string, version: string): Promise<void> {
    if (this.busy) {
      return;
    }
    const vendor = this.selectionValue.mcu.vendor;
    const option = this.packOptions.find((candidate) =>
      candidate.packId === packId && candidate.version === version
    );
    if (!option || !this.dependencies.activatePack) {
      this.post({
        type: 'notification',
        level: 'error',
        message: '所选 Pack 版本当前不可用，请刷新目录后重试。'
      });
      return;
    }

    this.busy = true;
    this.post({ type: 'operationStarted', operation: '正在准备芯片支持包' });
    try {
      const activated = await this.dependencies.activatePack(vendor, packId, version);
      const activatedVendor = activated.vendorId;
      if (activatedVendor !== vendor && !this.vendorOptions?.some((item) => item.value === activatedVendor)) {
        this.vendorOptions = [
          ...(this.vendorOptions ?? []),
          {
            value: activatedVendor,
            label: hasVendor(activatedVendor)
              ? getVendorMetadata(activatedVendor).label
              : activatedVendor
          }
        ];
      }
      let sourcePack = activated.sourcePack;
      if (this.dependencies.loadPackCatalog) {
        const catalog = await this.dependencies.loadPackCatalog(activatedVendor);
        this.packOptions = catalog.options;
        this.packCatalogNotice = catalog.notice ?? '';
        // The catalog key is the storage key of an already imported version;
        // an installed option's packFile is only its Keil installation path.
        const catalogKey = this.packOptions.find((candidate) =>
          candidate.packId === activated.packId
          && candidate.version === activated.version
          && candidate.origin !== 'installed'
        )?.packFile;
        sourcePack = catalogKey ?? sourcePack;
      }
      const profiles = listDeviceProfilesForPack(sourcePack);
      if (profiles.length === 0) {
        throw new Error('此 Pack 版本没有可用于生成的芯片。');
      }
      // The series-first flow keeps the user's chosen series when the activated
      // pack serves it. The persisted id is the curated one (`F1x`), while a
      // vendor pack names the same series differently (`STM32F1 Series`), so the
      // match is by series or catalog part prefix — never by exact string alone,
      // or the selection would snap to the pack's text and stop responding.
      const chosenSeries = this.selectionValue.mcu.series;
      // Match against the vendor the Pack actually belongs to: activating the
      // first Pack of a vendor happens before the selection carries that vendor.
      const pool = profiles.filter((profile) =>
        seriesServesProfile(activatedVendor, chosenSeries, profile)
      );
      // The chosen series is kept even when this Pack does not serve it: the
      // pack still activates (so its versions are selectable) and the empty part
      // list plus the catalog notice point at the DFP that does serve it.
      const series = chosenSeries !== ''
        ? chosenSeries
        : canonicalSeriesId(activatedVendor, profiles)
          ?? [...new Set(profiles.map((profile) => profile.series))]
            .sort((left, right) => left.localeCompare(right))[0];
      const profile = pool
        .sort((left, right) => left.part.localeCompare(right.part))[0];
      this.selectionValue = sanitizeSidebarSelection(
        nextMcuSelection(this.selectionValue, {
          vendor: activatedVendor,
          packId: activated.packId,
          version: activated.version,
          sourcePack,
          series,
          part: profile?.part ?? ''
        }, this.packOptions),
        this.selectionValue,
        this.packOptions
      );
      this.pendingPackId = activated.packId;
      await this.context.workspaceState.update(selectionKey, this.selectionValue);
      const options = this.optionsForCatalog();
      this.post({
        type: 'packCatalogState',
        vendor: activatedVendor,
        packs: options.packs,
        versions: options.versions,
        notice: this.packCatalogNotice,
        pendingPackId: this.pendingPackId
      });
      this.postState();
      this.post({
        type: 'operationFinished',
        result: { ok: true, message: activated.message, files: [] }
      });
    } catch (error) {
      this.post({
        type: 'operationFinished',
        result: {
          ok: false,
          message: error instanceof Error ? error.message : String(error),
          files: []
        }
      });
    } finally {
      this.busy = false;
      this.postState();
    }
  }

  private async discoverProjects(): Promise<void> {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    const controller = new AbortController();
    this.projectDiscoveryController?.abort();
    this.projectDiscoveryController = controller;
    this.discoveringProjects = true;
    this.postState();
    try {
      this.discoveredProjects = roots.length > 0
        ? await this.dependencies.discoverProjects(roots, { signal: controller.signal })
        : [];
      const projectRoot = reconcileProjectRoot(
        this.discoveredProjects,
        this.selectionValue.projectRoot
      );
      if (projectRoot !== this.selectionValue.projectRoot) {
        this.selectionValue = sanitizeSidebarSelection({
          ...this.selectionValue,
          projectRoot
        });
        await this.context.workspaceState.update(selectionKey, this.selectionValue);
      }
    } catch (error) {
      if (!(error instanceof WorkspaceProjectsCancelledError)) {
        throw error;
      }
      if (this.projectDiscoveryController === controller) {
        this.post({
          type: 'notification',
          level: 'info',
          message: '已取消发现工作区工程。'
        });
      }
    } finally {
      if (this.projectDiscoveryController === controller) {
        this.projectDiscoveryController = undefined;
        this.discoveringProjects = false;
        this.postState();
      }
    }
  }

  private projectRoot(): string | undefined {
    return this.selectionValue.projectRoot || undefined;
  }

  /**
   * The chip label only counts while it belongs to the open project: carrying
   * it across a folder switch would let an old target survive a new chip.
   */
  private detectedChipLabel(): string {
    const root = this.projectRoot();
    // Reading a chip does not depend on a workspace, so a session without a
    // project keeps the identity it just read; with a project the result must
    // belong to that project to avoid claiming another board's silicon.
    return root === undefined || this.chipDetectionRoot === root
      ? this.flashDetection?.chipLabel ?? ''
      : '';
  }

  /** OpenOCD flashes with the algorithm named by the target config. */
  private requiresDetectedTarget(backend: string): boolean {
    return backend === 'openocd' && this.detectedChipLabel() === '';
  }

  private async confirmOverwrite(files: string[], removedFiles?: string[]): Promise<boolean> {
    return this.dependencies.confirmOverwrite(files, removedFiles);
  }

  private workflowHost(): ProjectWorkflowHost {
    return {
      ...this.dependencies.workflow,
      workspaceRoot: () => this.projectRoot(),
      confirmOverwrite: (files, removedFiles) => this.confirmOverwrite(files, removedFiles)
    };
  }

  private async runGeneration(
    operation: string,
    run: () => Promise<WorkflowResult>
  ): Promise<ReturnType<typeof normalizeResult> | undefined> {
    if (this.busy) {
      return undefined;
    }
    this.busy = true;
    this.post({ type: 'operationStarted', operation });
    try {
      const result = await run();
      const normalized = normalizeResult(result);
      this.post({
        type: 'operationFinished',
        result: normalized
      });
      for (const warning of result.warnings ?? []) {
        this.post({ type: 'notification', level: 'warning', message: warning });
      }
      return normalized;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({
        type: 'operationFinished',
        result: { ok: false, message, files: [] }
      });
      return { ok: false, message, files: [] };
    } finally {
      this.busy = false;
    }
  }

  private toolchainForSelection() {
    const family = this.selectionValue.linux.toolchainFamily;
    const hit = this.dependencies.discoverToolchains().find((candidate) => candidate.family === family);
    return hit ?? createLinuxToolchain(family);
  }

  private async deviceSupportFiles(): Promise<DeviceSupportFile[]> {
    const { part, sourcePack } = this.selectionValue.mcu;
    if (!part || !this.dependencies.deviceSupportFilesForPart) {
      return [];
    }
    try {
      return await this.dependencies.deviceSupportFilesForPart(part, sourcePack);
    } catch (error) {
      // Device files are an enhancement: a Pack without a declared header must
      // not fail the generation, the startup's weak SystemInit still links.
      logLine(`[device] ${part}: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  /** Absolute OpenOCD path from the extension settings, when configured. */
  private configuredOpenOcdPath(): string {
    const configured = vscode.workspace
      .getConfiguration('cmakeForge')
      .get<string>('openocdPath', 'openocd');
    return normalizeConfiguredPath(configured) || 'openocd';
  }

  private executablePaths(): FlashExecutablePaths {
    const configuration = vscode.workspace.getConfiguration('cmakeForge');
    return {
      jlink: normalizeConfiguredPath(configuration.get<string>('jlinkPath', 'JLink')) || 'JLink',
      pyocd: normalizeConfiguredPath(configuration.get<string>('pyocdPath', 'pyocd')) || 'pyocd'
    };
  }

  private flashGenerationOptions() {
    const selection = this.selectionValue.flash;
    const profile = this.selectedDeviceProfile();
    const probe = getFlashProbeProfile(selection.probeId);
    const requested = selection.backend as FlashBackendId;
    const backend: FlashBackendId = backendSupportsProbe(requested, probe.id)
      ? requested
      : defaultBackendFor(profile, probe.id);
    const device: FlashDeviceContext = {
      part: profile.part,
      core: profile.core,
      packFile: isRuntimeDeviceProfile(profile.part)
        ? this.dependencies.packFileForPart?.(
            profile.part,
            this.selectionValue.mcu.sourcePack
          )
        : undefined
    };
    return {
      target: getFlashTargetProfile(selection.targetId),
      probe,
      openocdPath: selection.openocdPath === 'openocd'
        ? this.configuredOpenOcdPath()
        : selection.openocdPath,
      backend,
      device,
      executables: this.executablePaths()
    };
  }

  /**
   * Warns when the selected vendor has no curated OpenOCD target mapping.
   *
   * The flash/debug generators always produce *some* configuration; without a
   * mapping it would silently be an STM32/GD32 target for a chip from another
   * vendor. The generated files stay usable, but the user has to fix the
   * `configFiles` / `target` entry for the real part.
   */
  private flashTargetVendorWarning(target: FlashTargetProfile): string | undefined {
    const { part, sourcePack } = this.selectionValue.mcu;
    if (!part || !sourcePack) {
      return undefined;
    }
    let profile: DeviceProfile;
    try {
      profile = getDeviceProfileForPack(part, sourcePack);
    } catch {
      return undefined;
    }
    const metadata = getVendorMetadata(profile.vendor);
    const keys = [metadata.label, metadata.id, ...metadata.definePrefixes]
      .map((value) => value.toUpperCase());
    if (listFlashTargetVendors().some((vendor) => keys.includes(vendor.toUpperCase()))) {
      return undefined;
    }
    return `「${metadata.label}」暂无内置 OpenOCD target 映射：已按 ${target.label} 生成，请按实际芯片修改 launch.json 的 configFiles / flash.py 的 target。`;
  }

  /** 把持久化的手选路径变成绝对路径（相对路径按工程根解析）。 */
  private absoluteFirmwarePath(root: string, candidate: string): string {
    return isAbsolute(candidate) || /^[A-Za-z]:[\\/]/.test(candidate)
      ? candidate
      : join(root, candidate);
  }

  /**
   * Finds the firmware the flash card shows and why flashing is (un)available.
   *
   * Never throws: a missing `build/` directory is the normal state right after
   * cloning a project, and the sidebar must still render. The chip label is
   * carried over from the last probe detection — reading it needs hardware.
   */
  private async refreshFlashDetection(): Promise<void> {
    const root = this.projectRoot();
    if (!root) {
      // Detection is workspace-independent: keep the chip the probe read and
      // only mark flashing as unavailable until a project supplies a firmware.
      const selection = this.selectionValue.flash;
      const probe = getFlashProbeProfile(selection.probeId);
      const chipLabel = this.detectedChipLabel();
      let targetLabel = '自动（点「检测探针」确定）';
      if (chipLabel !== '') {
        targetLabel = selection.targetId;
        try {
          targetLabel = getFlashTargetProfile(selection.targetId).label;
        } catch {
          // A stale target id is repaired by sanitize; keep the raw value.
        }
      }
      this.flashDetection = {
        firmwarePath: '',
        firmwareLabel: '',
        firmwareDetail: '',
        targetLabel,
        probeLabel: probe.label,
        chipLabel,
        available: false,
        blockedReason: '打开工程后才能选择或构建固件并烧录；检测探针不需要工程。'
      };
      return;
    }
    const selection = this.selectionValue.flash;
    const probe = getFlashProbeProfile(selection.probeId);
    // A target only means something once the probe has read the chip it belongs
    // to: a leftover id from another project would otherwise claim a match with
    // silicon it never saw, and the user has no control left to correct it.
    const chipLabel = this.detectedChipLabel();
    let targetLabel = '自动（点「检测探针」确定）';
    if (chipLabel !== '') {
      targetLabel = selection.targetId;
      try {
        targetLabel = getFlashTargetProfile(selection.targetId).label;
      } catch {
        // An unknown persisted target id is repaired by sanitize; keep the raw id
        // instead of failing the whole state for a label.
      }
    }
    let firmwarePath = '';
    let firmwareLabel = '';
    let firmwareDetail = '';
    let blockedReason = '';
    if (selection.firmwarePath) {
      // A user-picked ELF wins over detection: it is the file they asked to
      // flash, even when a newer build sits next to it.
      const picked = this.absoluteFirmwarePath(root, selection.firmwarePath);
      let size = -1;
      try {
        const stats = statSync(picked);
        if (stats.isFile()) {
          size = stats.size;
        }
      } catch {
        size = -1;
      }
      if (size < 0) {
        blockedReason = `找不到手动选择的固件：${selection.firmwarePath}`;
      } else {
        firmwarePath = picked;
        firmwareLabel = basenamePath(picked);
        firmwareDetail = `手动选择 · ${formatBytes(size)}`;
      }
    } else {
      let discovered: Awaited<ReturnType<typeof discoverFirmware>>;
      try {
        discovered = await discoverFirmware(root);
      } catch (error) {
        logLine(`[flash] ${root}: ${error instanceof Error ? error.message : String(error)}`);
        discovered = { candidates: [], reason: '无法读取 build 目录。' };
      }
      let firmware = discovered.selected;
      let fromWorkspace = false;
      if (!firmware) {
        // Projects built by Keil or a hand-written Makefile keep the ELF outside
        // build/; fall back to the newest image anywhere in the workspace.
        try {
          const workspace = await findWorkspaceFirmware(root);
          firmware = workspace[0];
          fromWorkspace = firmware !== undefined;
        } catch (error) {
          logLine(`[flash] workspace scan: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      if (firmware) {
        firmwarePath = firmware.path;
        firmwareLabel = basenamePath(firmware.path);
        firmwareDetail = fromWorkspace
          ? `工作区 · ${formatBytes(firmware.size)} · ${new Date(firmware.mtimeMs).toLocaleString()}`
          : `${firmware.preset} · ${formatBytes(firmware.size)} · ${new Date(firmware.mtimeMs).toLocaleString()}`;
      } else {
        blockedReason = discovered.reason || '没有找到可烧录的 ELF：先构建工程，或用「选择…」指定固件。';
      }
    }
    // OpenOCD picks its flash algorithm from the target config, so flashing
    // without a chip-derived target is how the wrong bank gets erased. J-Link
    // and pyOCD take a part name instead and stay usable before detection.
    const needsTarget = selection.backend === 'openocd';
    const needsChip = needsTarget && chipLabel === '';
    this.flashDetection = {
      firmwarePath,
      firmwareLabel,
      firmwareDetail,
      targetLabel,
      probeLabel: probe.label,
      chipLabel,
      available: firmwarePath !== '' && !needsChip,
      blockedReason: blockedReason
        || (firmwarePath !== '' && needsChip
          ? '先点「检测探针」读取芯片型号：OpenOCD 的烧录目标由它决定。'
          : '')
    };
  }

  /**
   * 检测是芯片型号的唯一权威：写芯片行、把应答的接口改成当前探针，并按
   * DBGMCU DEV_ID 推导烧录 target——用户不必再手选一个可能和硅片矛盾的目标。
   */
  private async applyChipIdentity(
    identity: ChipIdentity,
    probeId: FlashProbeId | undefined
  ): Promise<string[]> {
    const label = describeIdentity(identity);
    if (this.flashDetection) {
      this.flashDetection = { ...this.flashDetection, chipLabel: label };
    }
    const lines = [`芯片  ${label}`];
    const suggested = suggestTargetForChip(identity);
    const currentTarget = this.selectionValue.flash.targetId;
    if (suggested && suggested.id !== currentTarget) {
      this.selectionValue = {
        ...this.selectionValue,
        flash: { ...this.selectionValue.flash, targetId: suggested.id }
      };
      lines.push(`目标  ${suggested.label} · ${suggested.targetConfig}（已按检测结果切换）`);
    } else if (suggested) {
      lines.push(`目标  ${suggested.label} · ${suggested.targetConfig}`);
    } else {
      let currentLabel = currentTarget;
      try {
        currentLabel = getFlashTargetProfile(currentTarget).label;
      } catch {
        // An unset target id is reported as-is instead of failing detection.
      }
      lines.push(`目标  ${currentLabel}（DEV_ID 未收录，保留当前目标）`);
    }
    if (probeId && probeId !== this.selectionValue.flash.probeId) {
      this.selectionValue = {
        ...this.selectionValue,
        flash: { ...this.selectionValue.flash, probeId }
      };
    }
    const probe = getFlashProbeProfile(this.selectionValue.flash.probeId);
    lines.push(`探针  ${probe.label} · ${probe.interfaceConfig}`);
    this.chipDetectionRoot = this.projectRoot();
    await this.context.workspaceState.update(selectionKey, this.selectionValue);
    return lines;
  }

  /**
   * 让探针读一次芯片标识（CPUID + DBGMCU DEV_ID）。
   *
   * 依次尝试支持 OpenOCD 的探针接口，探测成功的接口会写成当前探针——用户不必
   * 先选对探针再点检测。读内存失败不算错误：换下一个接口继续试。
   */
  private async detectProbeChip(): Promise<void> {
    if (this.busy) {
      return;
    }
    let options: ReturnType<SidebarProvider['detectionOptions']>;
    try {
      options = this.detectionOptions();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({ type: 'notification', level: 'warning', message });
      return;
    }
    const openocdPath = resolveOpenOcdExecutable(options.openocdPath);
    if (!openocdPath) {
      this.post({ type: 'notification', level: 'warning', message: missingOpenOcdNotice(options.openocdPath) });
      return;
    }
    const probes = options.probes;
    this.busy = true;
    this.post({ type: 'operationStarted', operation: '正在检测探针' });
    try {
      this.post({ type: 'flashProgress', stage: 'init', message: '连接探针，读取芯片标识…', percent: 10 });
      const result = await detectChip({
        openocdPath,
        probes,
        targetConfig: options.target.targetConfig,
        transport: options.target.transport,
        generic: options.target.transport === 'swd',
        speedKHz: 4000,
        cwd: options.cwd,
        timeoutMs: 10000
      });
      if (!result.ok || !result.identity) {
        if (result.outputTail.length > 0) {
          this.post({ type: 'flashOutput', lines: result.outputTail });
        }
        this.post({ type: 'flashProgress', stage: 'failed', message: '没有读到芯片信息。' });
        this.post({
          type: 'operationFinished',
          result: {
            ok: false,
            message: '没有从探针读到芯片信息：检查探针连接、目标供电与 OpenOCD 配置后重试。',
            files: []
          }
        });
        return;
      }
      const lines = await this.applyChipIdentity(
        result.identity,
        result.probeId as FlashProbeId | undefined
      );
      this.post({ type: 'flashOutput', lines });
      this.post({
        type: 'flashProgress',
        stage: 'done',
        message: `检测到 ${describeIdentity(result.identity)}`,
        percent: 100
      });
      this.post({
        type: 'operationFinished',
        result: { ok: true, message: `${lines[0].replace(/^芯片\s+/, '检测到 ')}；${lines[1]}`, files: [] }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logLine(`[flash] detect: ${message}`);
      this.post({ type: 'flashProgress', stage: 'failed', message: '探针检测失败。' });
      this.post({ type: 'operationFinished', result: { ok: false, message: `探针检测失败：${message}`, files: [] } });
    } finally {
      this.busy = false;
      await this.refreshFlashDetection();
      this.postState();
    }
  }

  /** 当前探针优先、其余支持 OpenOCD 的接口随后：探测成功即可自动改选。 */
  private chipProbes(
    selectedProbe: FlashProbeId
  ): Array<{ id: FlashProbeId; interfaceConfig: string }> {
    return listFlashProbeProfiles()
      .filter((candidate) => backendSupportsProbe('openocd', candidate.id))
      .sort((left, right) => (left.id === selectedProbe ? 0 : 1) - (right.id === selectedProbe ? 0 : 1))
      .map((candidate) => ({ id: candidate.id, interfaceConfig: candidate.interfaceConfig }));
  }

  /**
   * Everything detecting a chip needs. Reading the identity only requires the
   * probe, so this deliberately skips the device profile: detection must work
   * before a project (or a Pack) is selected.
   */
  private detectionOptions() {
    const selection = this.selectionValue.flash;
    const probe = getFlashProbeProfile(selection.probeId);
    return {
      target: getFlashTargetProfile(selection.targetId),
      probe,
      openocdPath: selection.openocdPath === 'openocd'
        ? this.configuredOpenOcdPath()
        : selection.openocdPath,
      probes: this.chipProbes(probe.id),
      cwd: this.projectRoot() ?? this.dependencies.toolStorageRoot?.() ?? tmpdir()
    };
  }

  /**
   * 后台静默读一次芯片标识：打开工程时如果已经接了探针，芯片行不必等用户点
   * 「检测探针」。没接探针是常态，失败就不吭声。
   */
  private autoDetectChip(): void {
    if (this.chipDetectionRunning || this.busy || this.flashDetection?.chipLabel) {
      return;
    }
    const root = this.projectRoot();
    if (!root) {
      return;
    }
    let flash: ReturnType<SidebarProvider['flashGenerationOptions']>;
    try {
      flash = this.flashGenerationOptions();
    } catch {
      return;
    }
    const openocdPath = resolveOpenOcdExecutable(flash.openocdPath);
    if (!openocdPath) {
      return;
    }
    this.chipDetectionRunning = true;
    void (async () => {
      try {
        const result = await detectChip({
          openocdPath,
          probes: this.chipProbes(flash.probe.id),
          targetConfig: flash.target.targetConfig,
          transport: flash.target.transport,
          generic: flash.target.transport === 'swd',
          speedKHz: 2000,
          cwd: root,
          timeoutMs: 5000
        });
        if (!result.ok || !result.identity || this.busy) {
          return;
        }
        const lines = await this.applyChipIdentity(
          result.identity,
          result.probeId as FlashProbeId | undefined
        );
        this.postState();
        const label = lines[0].replace(/^芯片\s+/, '');
        this.post({ type: 'notification', level: 'info', message: `探针检测到 ${label}。` });
      } catch (error) {
        logLine(`[flash] auto detect: ${error instanceof Error ? error.message : String(error)}`);
      } finally {
        this.chipDetectionRunning = false;
      }
    })();
  }

  /** 文件对话框从当前固件所在目录开始；没有固件时退回 build/ 或工作区根。 */
  private firmwareBrowseDirectory(root: string): string {
    const current = this.flashDetection?.firmwarePath;
    if (current && existsSync(current)) {
      return dirname(current);
    }
    const build = join(root, 'build');
    return existsSync(build) ? build : root;
  }

  /** 打开文件对话框手选一个 ELF；选中后写入选择并立即刷新检测结果。 */
  private async pickFirmwareFile(): Promise<void> {
    const root = this.projectRoot();
    if (!root) {
      this.post({ type: 'notification', level: 'warning', message: '先选择一个工程，再选择固件。' });
      return;
    }
    const picked = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: '选择要烧录的固件',
      defaultUri: vscode.Uri.file(this.firmwareBrowseDirectory(root)),
      filters: { 'ELF 固件': ['elf'], '所有文件': ['*'] }
    });
    if (!picked || picked.length === 0) {
      return;
    }
    const firmwarePath = picked[0].fsPath;
    this.selectionValue = {
      ...this.selectionValue,
      flash: { ...this.selectionValue.flash, firmwarePath }
    };
    await this.refreshFlashDetection();
    this.postState();
    this.post({ type: 'notification', level: 'info', message: `已选择固件：${basenamePath(firmwarePath)}` });
  }

  /**
   * `pip install --user` puts `pyocd.exe` in the user's Scripts directory,
   * which is usually not on `PATH`. Ask Python where that is and remember the
   * absolute path so the environment card flips to installed without a reload.
   */
  private async pyocdScriptPath(
    python: string,
    storageRoot: string
  ): Promise<string | undefined> {
    try {
      const result = await runTool({
        executable: python,
        args: [
          '-c',
          'import sysconfig; print(sysconfig.get_path("scripts", "nt_user") or "")'
        ],
        cwd: storageRoot,
        tailLines: 5
      });
      if (!result.ok) {
        return undefined;
      }
      const directory = result.outputTail
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .at(-1);
      if (!directory) {
        return undefined;
      }
      const suffix = process.platform === 'win32' ? '.exe' : '';
      const candidate = join(directory, `pyocd${suffix}`);
      return existsSync(candidate) ? candidate : undefined;
    } catch {
      return undefined;
    }
  }

  /** Python executable: the setting wins, then the platform launcher. */
  private pythonPath(): string {
    const configured = vscode.workspace
      .getConfiguration('cmakeForge')
      .get<string>('pythonPath', '');
    const normalized = normalizeConfiguredPath(configured);
    if (normalized) {
      return normalized;
    }
    return process.platform === 'win32' ? 'python' : 'python3';
  }

  private flashArguments(
    flash: ReturnType<SidebarProvider['flashGenerationOptions']>,
    firmwarePath: string,
    verify: boolean,
    reset: boolean
  ): string[] {
    // OpenOCD no longer goes through flash.py; these arguments serve the two
    // vendors' own CLIs, which have no equivalent "program … verify reset exit".
    const args = ['--firmware', firmwarePath];
    if (flash.backend === 'jlink') {
      args.push(
        '--jlink', flash.executables.jlink ?? 'JLink',
        '--device', jlinkDeviceName(flash.device.part ?? '', flash.device.core ?? ''),
        '--speed', '4000'
      );
      if (!reset) {
        args.push('--no-reset');
      }
      return args;
    }
    args.push(
      '--probe', flash.probe.id,
      '--pyocd', flash.executables.pyocd ?? 'pyocd',
      '--target', pyocdTargetName(flash.device.part ?? ''),
      '--speed', '4000'
    );
    if (flash.device.packFile) {
      args.push('--pack', flash.device.packFile);
    }
    return args;
  }

  private postFlashEvent(event: FlashEvent): void {
    this.post({
      type: 'flashProgress',
      stage: event.stage,
      message: event.message,
      ...(event.percent === undefined ? {} : { percent: event.percent })
    });
  }

  /**
   * Flash the firmware through OpenOCD directly (or `flash.py` for J-Link and
   * pyOCD, which own their own tool invocations).
   *
   * The OpenOCD argument list is built in `openocdDirect.ts` and echoed into the
   * output pane before it runs, so a failure can be replayed verbatim in a
   * terminal — and no Python is needed for the common ST-Link/DAPLink path.
   */
  private async flashFirmware(
    request: { firmwarePath?: string; verify?: boolean; reset?: boolean }
  ): Promise<void> {
    if (this.busy) {
      return;
    }
    const root = this.projectRoot();
    const firmwarePath = request.firmwarePath || this.flashDetection?.firmwarePath;
    if (!root || !firmwarePath) {
      this.post({
        type: 'operationFinished',
        result: { ok: false, message: '没有找到可烧录的固件：先构建工程。', files: [] }
      });
      return;
    }
    if (!existsSync(firmwarePath)) {
      this.post({
        type: 'operationFinished',
        result: { ok: false, message: `找不到要烧录的固件：${firmwarePath}`, files: [] }
      });
      return;
    }
    let flash: ReturnType<SidebarProvider['flashGenerationOptions']>;
    try {
      flash = this.flashGenerationOptions();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({ type: 'operationFinished', result: { ok: false, message, files: [] } });
      return;
    }
    if (this.requiresDetectedTarget(flash.backend)) {
      this.post({
        type: 'operationFinished',
        result: {
          ok: false,
          message: '先点「检测探针」读取芯片型号：OpenOCD 的烧录目标由它决定。',
          files: []
        }
      });
      return;
    }
    const verify = request.verify ?? this.selectionValue.flash.verify !== false;
    const reset = request.reset ?? this.selectionValue.flash.resetAfterFlash !== false;
    const controller = new AbortController();
    this.flashController = controller;
    this.busy = true;
    this.post({ type: 'operationStarted', operation: '正在烧录' });
    this.post({ type: 'flashProgress', stage: 'init', message: '准备烧录…', percent: 5 });
    try {
      let result: FlashRunResult;
      if (flash.backend === 'openocd') {
        const openocdPath = resolveOpenOcdExecutable(flash.openocdPath);
        if (!openocdPath) {
          this.post({ type: 'flashProgress', stage: 'failed', message: '找不到 OpenOCD。' });
          this.post({
            type: 'operationFinished',
            result: { ok: false, message: missingOpenOcdNotice(flash.openocdPath), files: [] }
          });
          return;
        }
        const args = buildOpenOcdFlashArgs({
          target: {
            interfaceConfig: flash.probe.interfaceConfig,
            targetConfig: flash.target.targetConfig,
            transport: flash.target.transport,
            speedKHz: 4000
          },
          firmwarePath,
          verify,
          reset
        });
        // 原样回显命令行：用户可以在终端复现同一条命令，失败截图也自带上下文。
        this.post({ type: 'flashOutput', lines: [`> ${openocdPath} ${args.join(' ')}`] });
        result = await runTool({
          executable: openocdPath,
          args,
          cwd: root,
          signal: controller.signal,
          onEvent: (event) => this.postFlashEvent(event),
          matchLine: matchOpenOcdStage,
          tailLines: 40
        });
      } else {
        const scriptPath = join(root, 'flash.py');
        if (!existsSync(scriptPath)) {
          this.post({
            type: 'operationFinished',
            result: {
              ok: false,
              message: '工程里还没有 flash.py：J-Link / pyOCD 后端仍由它执行，先点「只生成 flash.py」。',
              files: []
            }
          });
          return;
        }
        result = await runFlash({
          pythonPath: this.pythonPath(),
          scriptPath,
          args: this.flashArguments(flash, firmwarePath, verify, reset),
          cwd: root,
          signal: controller.signal,
          onEvent: (event) => this.postFlashEvent(event)
        });
      }
      if (result.outputTail.length > 0) {
        this.post({ type: 'flashOutput', lines: result.outputTail });
      }
      if (result.cancelled) {
        this.post({ type: 'flashProgress', stage: 'failed', message: '已取消烧录。' });
        this.post({
          type: 'operationFinished',
          result: { ok: false, cancelled: true, message: '已取消烧录。', files: [] }
        });
        return;
      }
      if (!result.ok) {
        const diagnosis = diagnoseFlashFailure({
          output: result.outputTail,
          exitCode: result.exitCode,
          spawnError: result.spawnError,
          backend: flash.backend
        });
        this.post({ type: 'flashProgress', stage: 'failed', message: diagnosis.title });
        this.post({
          type: 'operationFinished',
          result: {
            ok: false,
            message: `${diagnosis.title}：${diagnosis.detail}`,
            files: []
          }
        });
        return;
      }
      this.post({ type: 'flashProgress', stage: 'done', message: '烧录完成。', percent: 100 });
      this.post({
        type: 'operationFinished',
        result: { ok: true, message: `烧录完成：${basenamePath(firmwarePath)}`, files: [firmwarePath] }
      });
    } finally {
      this.flashController = undefined;
      this.busy = false;
      void this.refreshFlashDetection().then(() => this.postState());
    }
  }

  /**
   * Build task F5 runs before the session. CMake Tools owns the label; the
   * setting exists so a workspace with a renamed task can still use it.
   */
  private debugPreLaunchTask(): string | undefined {
    const configured = vscode.workspace
      .getConfiguration('cmakeForge')
      .get<string>('debugPreLaunchTask', 'CMake: build');
    const trimmed = configured?.trim();
    return trimmed ? trimmed : undefined;
  }

  private cancelFlash(): void {
    this.flashController?.abort();
  }


  /**
   * Tool readiness shown in the sidebar's environment card. Everything is
   * computed on demand so a download or a settings edit is reflected on the
   * next render without a restart.
   */
  private environment(): SidebarEnvironment {
    const configured = this.configuredArmGccToolchain();
    const detected = this.buildToolchains().find((toolchain) => toolchain.detected);
    const binDir = configured?.binDir ?? detected?.binDir;
    const armGcc: SidebarToolStatus = binDir
      ? { ready: true, detail: binDir }
      : {
          ready: false,
          detail: process.platform === 'win32'
            ? '未找到 arm-none-eabi-gcc'
            : '未找到 arm-none-eabi-gcc（自动下载仅 Windows）'
        };
    const openocdExecutable = resolveOpenOcdExecutable(this.configuredOpenOcdPath());
    const toolchainChoices: SidebarEnvironmentChoice[] = this.buildToolchains().map((toolchain) => ({
      value: toolchain.id,
      label: toolchain.label,
      ready: toolchain.detected !== false,
      detail: toolchain.binDir
    }));
    const executables = this.executablePaths();
    const jlink = resolveConfiguredExecutable(executables.jlink ?? '', 'JLink.exe');
    const pyocd = resolveConfiguredExecutable(executables.pyocd ?? '', 'pyocd');
    const environment: SidebarEnvironment = {
      armGcc,
      openocd: openocdExecutable
        ? { ready: true, detail: openocdExecutable }
        : { ready: false, detail: '未找到 openocd.exe' },
      toolchains: toolchainChoices,
      backends: [
        {
          value: 'openocd',
          label: 'OpenOCD',
          ready: Boolean(openocdExecutable),
          detail: openocdExecutable ?? '未找到 openocd.exe'
        },
        {
          value: 'jlink',
          label: 'J-Link',
          ready: Boolean(jlink),
          detail: jlink ?? '未找到 JLink.exe'
        },
        {
          value: 'pyocd',
          label: 'pyOCD',
          ready: Boolean(pyocd),
          detail: pyocd ?? '未找到 pyocd'
        }
      ]
    };
    if (this.toolInstallRunning) {
      environment.installing = this.toolInstallRunning;
    }
    if (this.toolProgress) {
      environment.progress = this.toolProgress;
    }
    return environment;
  }

  /** Installs (or opens the download page for) whichever tool the user picked. */
  private async installTool(tool: SidebarToolId): Promise<void> {
    if (tool === 'jlink') {
      await this.openJlinkDownload();
      return;
    }
    if (tool === 'pyocd') {
      if (this.busy) {
        return;
      }
      await this.installPyocd();
      return;
    }
    if (this.busy) {
      // An install already owns the busy flag; a second one would race it.
      return;
    }
    if (process.platform !== 'win32') {
      this.post({
        type: 'notification',
        level: 'warning',
        message: '自动下载目前只支持 Windows：请用系统包管理器安装 ARM GNU 工具链与 OpenOCD，并在设置里填写路径。'
      });
      return;
    }
    const storageRoot = this.dependencies.toolStorageRoot?.();
    if (!storageRoot) {
      this.post({
        type: 'notification',
        level: 'error',
        message: '无法确定下载目录：请在扩展的全局存储目录可写后重试。'
      });
      return;
    }
    const label = tool === 'armgcc' ? 'ARM GNU 工具链' : 'OpenOCD';
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: `正在安装 ${label}`,
        cancellable: true
      },
      async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        this.busy = true;
        this.toolInstallRunning = tool;
        this.toolProgress = { tool, stage: 'download', message: `正在准备 ${label}…`, percent: 0 };
        this.post({ type: 'operationStarted', operation: `正在下载 ${label}` });
        this.postState();
        let reported = 0;
        try {
          const options = {
            storageRoot,
            signal: controller.signal,
            onProgress: (update: {
              stage: 'download' | 'extract' | 'verify' | 'done';
              message: string;
              percent?: number;
            }) => {
              this.toolProgress = { tool, ...update };
              this.post({ type: 'toolProgress', tool, ...update });
              const percent = update.percent;
              if (typeof percent === 'number' && percent > reported) {
                progress.report({ message: update.message, increment: percent - reported });
                reported = percent;
              } else {
                progress.report({ message: update.message });
              }
            }
          };
          if (tool === 'armgcc') {
            const installed = await installArmGcc(options);
            await vscode.workspace.getConfiguration('cmakeForge')
              .update('armGccPath', installed.binDir, vscode.ConfigurationTarget.Global);
            this.buildToolchainCache = undefined;
            // The environment card must flip to "已安装" before the (possibly
            // slow) workspace scan below starts, otherwise the sidebar keeps
            // claiming the tool is missing while the toast says it is done.
            this.toolInstallRunning = undefined;
            this.toolProgress = undefined;
            this.busy = false;
            this.postState();
            this.post({
              type: 'operationFinished',
              result: {
                ok: true,
                message: `ARM GNU 工具链 ${installed.version} 已安装：${installed.binDir}`,
                files: []
              }
            });
          } else {
            const installed = await installOpenOcd(options);
            await vscode.workspace.getConfiguration('cmakeForge')
              .update('openocdPath', installed.executable, vscode.ConfigurationTarget.Global);
            // Same as above: a tool that just finished installing must not be
            // reported as missing while firmware detection catches up.
            this.toolInstallRunning = undefined;
            this.toolProgress = undefined;
            this.busy = false;
            this.postState();
            this.post({
              type: 'operationFinished',
              result: {
                ok: true,
                message: `OpenOCD ${installed.version} 已安装：${installed.executable}`,
                files: []
              }
            });
          }
          logLine(`[tools] installed ${label}`);
          await this.refreshFlashDetection();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          const cancelled = controller.signal.aborted || message.includes('已取消');
          if (!cancelled) {
            logLine(`[tools] ${label} 安装失败：${message}`);
          }
          this.post({
            type: 'operationFinished',
            result: {
              ok: false,
              message: cancelled ? `已取消安装 ${label}。` : `${label} 安装失败：${message}`,
              files: []
            }
          });
        } finally {
          this.busy = false;
          this.toolInstallRunning = undefined;
          this.toolProgress = undefined;
          this.postState();
        }
      }
    );
  }

  /** One notification per missing tool, so the card keeps showing plain states. */
  private async promptMissingTools(): Promise<void> {
    // Unit tests run the provider without a VS Code UI to answer the prompt.
    if (typeof vscode.window?.showInformationMessage !== 'function') {
      return;
    }
    const environment = this.environment();
    const backendReady = new Map(environment.backends.map((choice) => [choice.value, choice.ready]));
    const missing: { tool: SidebarToolId; label: string }[] = [];
    if (!environment.armGcc.ready) {
      missing.push({ tool: 'armgcc', label: 'ARM GNU 工具链' });
    }
    const backend = this.selectionValue.flash.backend;
    // OpenOCD only matters when it is the selected backend; offering to install
    // it while the user flashes through J-Link or pyOCD is just noise.
    if (!environment.openocd.ready && backend === 'openocd') {
      missing.push({ tool: 'openocd', label: 'OpenOCD' });
    }
    if (backend === 'jlink' && backendReady.get('jlink') !== true) {
      missing.push({ tool: 'jlink', label: 'J-Link' });
    }
    if (backend === 'pyocd' && backendReady.get('pyocd') !== true) {
      missing.push({ tool: 'pyocd', label: 'pyOCD' });
    }
    for (const item of missing) {
      if (this.promptedTools.has(item.tool)) {
        continue;
      }
      this.promptedTools.add(item.tool);
      const answer = await vscode.window.showInformationMessage(
        `没有找到 ${item.label}，编译或烧录需要它。`,
        '下载',
        '稍后'
      );
      if (answer === '下载') {
        await this.installTool(item.tool);
        // Cancelled or failed installs stay out of the way, but the next
        // refresh should be allowed to ask again instead of never offering.
        const ready = this.environment();
        const stillMissing = item.tool === 'armgcc'
          ? !ready.armGcc.ready
          : item.tool === 'openocd'
            ? !ready.openocd.ready
            : ready.backends.find((choice) => choice.value === item.tool)?.ready !== true;
        if (stillMissing) {
          this.promptedTools.delete(item.tool);
        }
      }
    }
  }

  /** J-Link ships as a GUI installer, so the honest "download" is its page. */
  private async openJlinkDownload(): Promise<void> {
    const url = 'https://www.segger.com/downloads/jlink/';
    try {
      await vscode.env.openExternal(vscode.Uri.parse(url));
    } catch {
      // Headless hosts have no browser; the notice below still carries the URL.
    }
    this.post({
      type: 'notification',
      level: 'info',
      message: `已打开 J-Link 下载页：${url}。安装后重开 VS Code；装在非默认目录时请填写 cmakeForge.jlinkPath。`
    });
  }

  /** pyOCD is a pip package, so it can be installed in place. */
  private async installPyocd(): Promise<void> {
    const storageRoot = this.dependencies.toolStorageRoot?.();
    if (!storageRoot) {
      this.post({
        type: 'notification',
        level: 'error',
        message: '无法确定安装目录：请在扩展的全局存储目录可写后重试。'
      });
      return;
    }
    const python = this.pythonPath();
    const executable = resolveConfiguredExecutable(python, python);
    if (!executable) {
      this.post({
        type: 'operationFinished',
        result: {
          ok: false,
          message:
            '没有找到 Python，无法自动安装 pyOCD：请先安装 Python（勾选 Add to PATH），或到 https://pyocd.io/docs/installing 按说明安装。',
          files: []
        }
      });
      return;
    }
    await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Notification,
        title: '正在安装 pyOCD',
        cancellable: true
      },
      async (progress, token) => {
        const controller = new AbortController();
        token.onCancellationRequested(() => controller.abort());
        this.busy = true;
        this.toolInstallRunning = 'pyocd';
        this.toolProgress = { tool: 'pyocd', stage: 'download', message: '正在安装 pyOCD…' };
        this.post({ type: 'operationStarted', operation: '正在安装 pyOCD' });
        progress.report({ message: '正在运行 pip install pyocd…' });
        this.postState();
        try {
          const result = await runTool({
            executable,
            args: ['-m', 'pip', 'install', '--user', '--upgrade', '-i', PYPI_MIRROR, 'pyocd'],
            cwd: storageRoot,
            tailLines: 20,
            signal: controller.signal
          });
          if (controller.signal.aborted || result.cancelled) {
            this.post({
              type: 'operationFinished',
              result: { ok: false, message: '已取消安装 pyOCD。', files: [] }
            });
          } else if (result.ok) {
            const installed = await this.pyocdScriptPath(executable, storageRoot);
            if (installed) {
              await vscode.workspace
                .getConfiguration('cmakeForge')
                .update('pyocdPath', installed, vscode.ConfigurationTarget.Global);
              this.post({
                type: 'operationFinished',
                result: {
                  ok: true,
                  message: `pyOCD 已安装并可用：${installed}`,
                  files: []
                }
              });
            } else {
              this.post({
                type: 'operationFinished',
                result: {
                  ok: true,
                  message:
                    'pyOCD 已安装，但没找到 pyocd.exe：pip 的 Scripts 目录可能不在 PATH，请在 cmakeForge.pyocdPath 里填写它的完整路径。',
                  files: []
                }
              });
            }
            this.postState();
          } else {
            const reason = result.spawnError ?? result.outputTail.filter(Boolean).at(-1) ?? '未知错误';
            this.post({
              type: 'operationFinished',
              result: { ok: false, message: `pyOCD 安装失败：${reason}`, files: [] }
            });
          }
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          this.post({
            type: 'operationFinished',
            result: { ok: false, message: `pyOCD 安装失败：${reason}`, files: [] }
          });
        } finally {
          this.busy = false;
          this.toolInstallRunning = undefined;
          this.toolProgress = undefined;
          this.postState();
        }
      }
    );
  }

  private selectedDeviceProfile() {
    const { part, sourcePack } = this.selectionValue.mcu;
    if (!part || !sourcePack) {
      throw new Error(this.mcuBlockedMessage());
    }
    try {
      return getDeviceProfileForPack(part, sourcePack);
    } catch {
      throw new Error(this.mcuBlockedMessage());
    }
  }

  /**
   * Copy for a blocked MCU generation, naming the DFP the selected series needs.
   * The sidebar shows the same sentence, so a command that slips through (the
   * command palette, a stale webview) explains itself identically.
   */
  private mcuBlockedMessage(): string {
    const { vendor, series } = this.selectionValue.mcu;
    const catalog = findCatalogSeries(vendor, series);
    if (catalog?.packName) {
      return `「${catalog.label}」系列需要 ${catalog.packName}：点「在线安装 Pack…」可直接下载导入，或用 Keil Pack Installer 安装后重选系列，也可点「导入 Pack 包」导入已下载的 .pack。`;
    }
    return '请先选择可用的芯片支持包与型号，再生成工程。';
  }

  private async handleMessage(message: SidebarIncomingMessage): Promise<void> {
    if (message.type === 'cancelWorkspaceScan') {
      this.cancelWorkspaceScan();
      return;
    }
    if (message.type === 'cancelFlash') {
      // Cancellation must work while the flash operation holds `busy`.
      this.cancelFlash();
      return;
    }
    if (
      this.busy
      && message.type !== 'ready'
      && message.type !== 'openSettings'
      // Choosing a firmware file only opens a dialog; the running build/flash
      // does not conflict with it.
      && message.type !== 'pickFirmware'
    ) {
      // Clicks during a running operation must never feel dead: answer with a
      // throttled wait hint instead of silently dropping the message.
      const now = Date.now();
      if (now - this.lastBusyHintAt > 1500) {
        this.lastBusyHintAt = now;
        this.post({ type: 'notification', level: 'info', message: '正在处理上一个操作，请稍候。' });
      }
      return;
    }
    if (message.type === 'detectFlash') {
      await this.detectProbeChip();
      return;
    }
    if (message.type === 'pickFirmware') {
      await this.pickFirmwareFile();
      return;
    }
    if (message.type === 'flash') {
      await this.flashFirmware(message);
      return;
    }
    if (message.type === 'installTool') {
      await this.installTool(message.tool);
      return;
    }
    if (message.type === 'ready') {
      this.flushPendingPosts();
      // The core-pack status drives the version dropdown, so it must be loaded
      // with the first state instead of waiting for an unrelated refresh.
      void this.refreshCorePackNotice().then(() => this.postState());
      void this.discoverProjects().catch((error) => {
        const text = error instanceof Error ? error.message : String(error);
        this.post({ type: 'notification', level: 'error', message: text });
        this.discoveringProjects = false;
        this.postState();
      });
      void this.refreshPackCatalog(this.selectionValue.mcu.vendor);
      void this.refreshFlashDetection().then(() => {
        this.postState();
        this.autoDetectChip();
      });
      this.postState();
      void this.promptMissingTools();
      return;
    }
    if (message.type === 'saveSelection') {
      try {
        const previousBackend = this.selectionValue.flash.backend;
        await this.saveSelection(message.selection);
        if (this.selectionValue.flash.backend !== previousBackend) {
          void this.promptMissingTools();
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        this.post({
          type: 'notification',
          level: 'warning',
          message: `无法保存侧栏选择：${text}`
        });
      }
      return;
    }
    if (message.type === 'selectPack') {
      if (this.servingPackOptions().some((option) => option.packId === message.packId)) {
        this.pendingPackId = message.packId;
        const options = this.optionsForCatalog();
        this.post({
          type: 'packCatalogState',
          vendor: this.selectionValue.mcu.vendor,
          packs: options.packs,
          versions: options.versions,
          notice: this.packCatalogNotice
        });
        // Choosing a Pack must make its devices available instead of leaving
        // the version select showing an option the selection does not own:
        // an imported or installed version is activated (imported if needed)
        // right away. Downloadable versions still wait for an explicit pick.
        const candidate = this.packOptions
          .filter((option) => option.packId === message.packId
            && (option.origin === 'imported' || option.origin === 'installed'))
          .sort((left, right) =>
            comparePackVersions(right.version, left.version)
            || (left.origin === 'imported' ? -1 : right.origin === 'imported' ? 1 : 0)
          )[0];
        if (candidate) {
          await this.activatePack(candidate.packId, candidate.version);
        }
      }
      return;
    }
    if (message.type === 'activatePack') {
      await this.activatePack(message.packId, message.version);
      return;
    }
    if (message.type === 'setProjectRoot') {
      if (!this.discoveredProjects.some((project) => project.root === message.root)) {
        return;
      }
      // A manually chosen firmware belongs to the project it was picked from;
      // carrying it into another project would flash the wrong ELF.
      const rootChanged = this.selectionValue.projectRoot !== message.root;
      const nextSelection = rootChanged
        ? {
            ...this.selectionValue,
            projectRoot: message.root,
            flash: { ...this.selectionValue.flash, firmwarePath: '' }
          }
        : { ...this.selectionValue, projectRoot: message.root };
      this.selectionValue = sanitizeSidebarSelection(
        nextSelection,
        this.selectionValue,
        this.packOptions,
        // Switching projects must not drop the Pack/part while the catalog for
        // the new project has not loaded yet: an empty catalog is not a reason
        // to forget what the user imported.
        this.packOptions.length === 0,
        this.buildToolchains()
      );
      await this.context.workspaceState.update(selectionKey, this.selectionValue);
      this.postState();
      void this.refreshFlashDetection().then(() => {
        this.postState();
        this.autoDetectChip();
      });
      return;
    }
    if (message.type === 'scanWorkspace') {
      await this.scan();
      return;
    }
    if (message.type === 'importPack') {
      const result = await this.runGeneration('正在导入 Pack', async () => {
        const commandResult = await vscode.commands.executeCommand<CommandResult>('cmakeForge.importPack');
        return { kind: 'mcu' as const, ...commandResult, files: [] };
      });
      // A successful import must land in front of the user immediately: the
      // catalog refresh reuses the vendor-change auto-activation so the
      // imported pack's series and parts become selectable at once.
      if (result?.ok) {
        await this.refreshPackCatalog(this.selectionValue.mcu.vendor, true);
      }
      this.postState();
      return;
    }
    if (message.type === 'installCorePack') {
      await this.runGeneration('正在安装 ARM CMSIS 内核包', async () => {
        const commandResult = await vscode.commands.executeCommand<CommandResult>('cmakeForge.installCorePack');
        return { kind: 'mcu' as const, ...commandResult, files: [] };
      });
      // The include path the next generation writes depends on this result.
      await this.refreshCorePackNotice();
      this.postState();
      return;
    }
    if (message.type === 'installPackOnline') {
      const result = await this.runGeneration('正在在线安装 Pack', async () => {
        const commandResult = await vscode.commands.executeCommand<CommandResult>('cmakeForge.installPackOnline');
        return { kind: 'mcu' as const, ...commandResult, files: [] };
      });
      if (result?.ok) {
        await this.refreshPackCatalog(this.selectionValue.mcu.vendor, true);
      }
      this.postState();
      return;
    }
    if (message.type === 'openSettings') {
      await vscode.commands.executeCommand(
        'workbench.action.openSettings',
        '@ext:gentle120.cmake-forge'
      );
      return;
    }
    if (message.type === 'generateProject') {
      await this.runGeneration('正在生成工程', async () => {
        if (this.selectionValue.mode === 'native') {
          const root = this.dependencies.workflow.workspaceRoot();
          if (!root) {
            return {
              kind: 'native' as const,
              ok: false,
              files: [],
              message: '请先打开一个 C/C++ 工程目录。'
            };
          }
          const project = await this.dependencies.workflow.scanWorkspace(root);
          if (!project) {
            return {
              kind: 'native' as const,
              ok: false,
              cancelled: true,
              files: [],
              message: '工作区扫描已取消。'
            };
          }
          if (project.sources.length === 0) {
            return {
              kind: 'native' as const,
              ok: false,
              files: [],
              message: '工作区中没有找到 C/C++ 或汇编源文件。'
            };
          }
          // Desktop compilers are detected by CMake Tools / CMake itself; the
          // generated project intentionally does not pin one.
          const structure = describeNativeProject(
            project,
            projectNameFromRoot(root),
            {
              targetType: this.selectionValue.native.targetType,
              cStandard: this.selectionValue.native.cStandard,
              cxxStandard: this.selectionValue.native.cxxStandard
            }
          );
          return generateNativeWorkflow(this.workflowHost(), structure);
        }
        if (this.selectionValue.mode === 'linux') {
          return generateLinuxWorkflow(this.workflowHost(), this.toolchainForSelection(), {
            targetType: this.selectionValue.linux.targetType,
            sysroot: this.selectionValue.linux.sysroot
          });
        }
        const profile = this.selectedDeviceProfile();
        // flash.py and the Cortex-Debug configuration have their own buttons;
        // generating the project no longer writes them implicitly.
        const deviceSupport = await this.deviceSupportFiles();
        const mcuToolchain = this.selectedMcuToolchain();
        const result = await generateMcuWorkflow(this.workflowHost(), profile, {
          toolchain: mcuToolchain === undefined ? undefined : {
            family: mcuToolchain.family ?? 'gcc',
            ...(mcuToolchain.prefix ? { prefix: mcuToolchain.prefix } : {}),
            ...(mcuToolchain.cCompiler ? { cCompiler: mcuToolchain.cCompiler } : {}),
            ...(mcuToolchain.cxxCompiler ? { cxxCompiler: mcuToolchain.cxxCompiler } : {}),
            ...(mcuToolchain.cCompilerPath ? { cCompilerPath: mcuToolchain.cCompilerPath } : {}),
            ...(mcuToolchain.fromelf ? { fromelf: mcuToolchain.fromelf } : {}),
            ...(mcuToolchain.objcopy ? { objcopy: mcuToolchain.objcopy } : {}),
            ...(mcuToolchain.size ? { size: mcuToolchain.size } : {}),
            ...(mcuToolchain.variant ? { variant: mcuToolchain.variant } : {})
          },
          corePack: this.dependencies.corePackForGeneration
            ? await this.dependencies.corePackForGeneration(
                this.selectionValue.corePackInclude !== false,
                this.selectionValue.mcu.corePackVersion
              )
            : undefined,
          deviceSupport
        });
        const warnings = [...(result.warnings ?? [])];
        // A project generated with the device-profile default prefix when no
        // compiler was found would silently fail at configure time; say so.
        if (mcuToolchain !== undefined && mcuToolchain.detected === false) {
          warnings.push(
            `未检测到 ${mcuToolchain.label}：已按命令名生成，安装后把编译器加入 PATH 即可构建。`
          );
        }
        if (mcuToolchain?.family === 'armclang' && !mcuToolchain.fromelf) {
          warnings.push(
            '未找到 fromelf：工程可以构建出 .elf，但不会生成 .hex/.bin。'
          );
        }
        if (mcuToolchain?.variant === 'atfe' && !mcuToolchain.onPath) {
          warnings.push(
            `ATfE 工具链不在 PATH；生成时会通过 cmake.environment 前置 ${mcuToolchain.binDir}。若 CMake Tools 或其他终端仍未解析到它，请把该目录加入 PATH。`
          );
        }
        if (mcuToolchain?.family === 'clang') {
          const starm = mcuToolchain.variant === 'starm';
          if (!mcuToolchain.objcopy || !mcuToolchain.size) {
            warnings.push(
              starm
                ? '未找到 starm-objcopy/starm-size：工程可以构建出 .elf，但不会生成 .hex/.bin。'
                : '未找到 llvm-objcopy/llvm-size：工程可以构建出 .elf，但不会生成 .hex/.bin。'
            );
          }
          if (!starm && !mcuToolchain.linker) {
            warnings.push(
              '未找到 LLD（ld.lld/lld）：LLVM clang 工程需要 lld 才能链接。'
            );
          }
        }
        // An empty device-file set is legitimate for a Pack without a declared
        // device header, but it also silently produces a project without real
        // `SystemInit`; name it so the sidebar explains instead of leaving the
        // user to compare directories.
        if (deviceSupport.length === 0 && this.dependencies.deviceSupportFilesForPart) {
          showLog();
          warnings.push(
            '未复制器件头/system 文件：该 Pack 没有可用的器件头，或扩展尚未重新加载。打开「输出 → CMake Forge」可看到具体原因。'
          );
        }
        return warnings.length > 0 ? { ...result, warnings } : result;
      });
      return;
    }
    if (message.type === 'generateFlashScript') {
      await this.runGeneration('正在生成 flash.py', async () => {
        const flash = this.flashGenerationOptions();
        if (this.requiresDetectedTarget(flash.backend)) {
          throw new Error('先点「检测探针」读取芯片型号：烧录目标由它决定，生成前需要先确定目标。');
        }
        const result = await generateFlashWorkflow(
          this.workflowHost(),
          flash.target,
          flash.probe,
          flash.openocdPath,
          flash.backend,
          flash.device,
          flash.executables
        );
        const warning = flash.backend === 'openocd'
          ? this.flashTargetVendorWarning(flash.target)
          : undefined;
        return warning
          ? { ...result, warnings: [...(result.warnings ?? []), warning] }
          : result;
      });
      return;
    }
    if (message.type === 'generateDebugConfiguration') {
      await this.runGeneration('正在生成调试配置', async () => {
        const detected = this.flashGenerationOptions();
        if (this.requiresDetectedTarget(detected.backend)) {
          throw new Error('先点「检测探针」读取芯片型号：调试配置里的烧录目标由它决定。');
        }
        if (this.dependencies.ensureCortexDebugInstalled
          && !(await this.dependencies.ensureCortexDebugInstalled())) {
          return {
            kind: 'debug' as const,
            ok: false,
            files: [],
            message: '已取消：需要先安装 Cortex-Debug，否则按 F5 调试会话会立即退出。'
          };
        }
        const flash = this.flashGenerationOptions();
        const debug = await generateDebugWorkflow(
          this.workflowHost(),
          flash.target,
          flash.probe,
          flash.openocdPath,
          flash.backend,
          flash.device,
          {
            toolchainPrefix: this.selectedMcuToolchain()?.prefix,
            toolchainFamily: this.selectedMcuToolchain()?.family,
            preLaunchTask: this.debugPreLaunchTask(),
            includeAttach: true
          }
        );
        const warning = flash.backend === 'openocd'
          ? this.flashTargetVendorWarning(flash.target)
          : undefined;
        return {
          ...debug,
          files: [...new Set(debug.files)],
          ...(warning ? { warnings: [...(debug.warnings ?? []), warning] } : {})
        };
      });
      return;
    }
  }

  private async scan(): Promise<void> {
    const root = this.projectRoot();
    if (!root) {
      // The webview already marked the scan busy before sending the message;
      // returning without operationFinished leaves every control disabled.
      this.post({
        type: 'operationFinished',
        result: {
          ok: false,
          cancelled: this.discoveringProjects,
          message: this.discoveringProjects
            ? '正在发现工程，请稍候。'
            : '请先选择目标工程。',
          files: []
        }
      });
      return;
    }
    if (this.busy) {
      this.post({
        type: 'operationFinished',
        result: { ok: false, message: '正在处理上一个操作，请稍候。', files: [] }
      });
      return;
    }
    const controller = new AbortController();
    this.workspaceScanController = controller;
    this.busy = true;
    this.post({ type: 'operationStarted', operation: '正在扫描工作区' });
    const operation = this.runWorkspaceScan(root, controller);
    this.workspaceScanPromise = operation;
    try {
      await operation;
    } finally {
      if (this.workspaceScanController === controller) {
        this.workspaceScanController = undefined;
        this.workspaceScanPromise = undefined;
        this.busy = false;
        this.postStateAfterCancellation();
      }
    }
  }

  private cancelWorkspaceScan(): void {
    if (this.workspaceScanController) {
      const controller = this.workspaceScanController;
      const operation = this.workspaceScanPromise;
      controller.abort();
      this.workspaceScanController = undefined;
      this.workspaceScanPromise = undefined;
      this.busy = false;
      this.post({
        type: 'operationFinished',
        result: {
          ok: false,
          cancelled: true,
          message: '已取消扫描工作区。',
          files: []
        }
      });
      this.postStateAfterCancellation();
      void operation?.catch(() => undefined);
      return;
    }
    if (this.projectDiscoveryController) {
      this.projectDiscoveryController.abort();
    }
  }

  private postStateAfterCancellation(): void {
    queueMicrotask(() => this.postState());
  }

  private async runWorkspaceScan(root: string, controller: AbortController): Promise<void> {
    try {
      const project = await (this.dependencies.scanProject ?? scanHost.scanProject)(
        root,
        { signal: controller.signal }
      );
      if (controller.signal.aborted) {
        return;
      }
      if (project.sources.length === 0) {
        this.post({
          type: 'workspaceScan',
          sources: 0,
          includeDirs: 0,
          defines: 0
        });
        this.post({
          type: 'operationFinished',
          result: {
            ok: false,
            message: '工作区中没有找到 C/C++ 或汇编源文件。',
            files: []
          }
        });
        return;
      }
      this.post({
        type: 'workspaceScan',
        sources: project.sources.length,
        includeDirs: project.includeDirs.length,
        defines: project.defines.length
      });
      this.post({
        type: 'operationFinished',
        result: {
          ok: true,
          message: `扫描完成：${project.sources.length} 个源文件。`,
          files: []
        }
      });
    } catch (error) {
      if (error instanceof ScanCancelledError || controller.signal.aborted) {
        return;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.post({
        type: 'operationFinished',
        result: { ok: false, message, files: [] }
      });
    }
  }
}
