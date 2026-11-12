import * as vscode from 'vscode';
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
import { getFlashProbeProfile } from '../flash/probeProfiles';
import {
  getFlashTargetProfile,
  listFlashTargetVendors,
  type FlashTargetProfile
} from '../flash/targets/targetProfiles';
import {
  backendSupportsProbe,
  defaultBackendFor,
  type FlashBackendId
} from '../flash/backendProfiles';
import type { FlashDeviceContext, FlashExecutablePaths } from '../generator/flashScriptGenerator';
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
import { renderSidebarHtml } from './html';
import { parseIncomingMessage, type SidebarIncomingMessage } from './messages';
import {
  buildSidebarState,
  nextMcuSelection,
  packServesSeries,
  sanitizeSidebarSelection,
  type SidebarOption,
  type SidebarSelection
} from './state';

const selectionKey = 'cmakeForge.sidebarSelection.v1';

interface SidebarScanHost {
  scanProject(root: string, options?: { signal?: AbortSignal }): ReturnType<typeof scanProject>;
}

const scanHost: SidebarScanHost = {
  scanProject: (root, options) => scanProject(root, options)
};

export interface SidebarProviderDependencies {
  workflow: ProjectWorkflowHost;
  confirmOverwrite(files: string[]): Promise<boolean>;
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
    const value = this.dependencies.discoverMcuBuildToolchains?.()
      ?? discoverMcuBuildToolchains();
    this.buildToolchainCache = { at: now, value };
    return value;
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
    return buildSidebarState(
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
      false,
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
          false,
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

  private async confirmOverwrite(files: string[]): Promise<boolean> {
    return this.dependencies.confirmOverwrite(files);
  }

  private workflowHost(): ProjectWorkflowHost {
    return {
      ...this.dependencies.workflow,
      workspaceRoot: () => this.projectRoot(),
      confirmOverwrite: (files) => this.confirmOverwrite(files)
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
    return configured?.trim() || 'openocd';
  }

  private executablePaths(): FlashExecutablePaths {
    const configuration = vscode.workspace.getConfiguration('cmakeForge');
    return {
      jlink: configuration.get<string>('jlinkPath', 'JLink')?.trim() || 'JLink',
      pyocd: configuration.get<string>('pyocdPath', 'pyocd')?.trim() || 'pyocd'
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
    if (this.busy && message.type !== 'ready' && message.type !== 'openSettings') {
      // Clicks during a running operation must never feel dead: answer with a
      // throttled wait hint instead of silently dropping the message.
      const now = Date.now();
      if (now - this.lastBusyHintAt > 1500) {
        this.lastBusyHintAt = now;
        this.post({ type: 'notification', level: 'info', message: '正在处理上一个操作，请稍候。' });
      }
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
      this.postState();
      return;
    }
    if (message.type === 'saveSelection') {
      try {
        await this.saveSelection(message.selection);
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
      this.selectionValue = sanitizeSidebarSelection({
        ...this.selectionValue,
        projectRoot: message.root
      });
      await this.context.workspaceState.update(selectionKey, this.selectionValue);
      this.postState();
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
            ...(mcuToolchain.size ? { size: mcuToolchain.size } : {})
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
        if (mcuToolchain?.family === 'clang' && (!mcuToolchain.objcopy || !mcuToolchain.size)) {
          warnings.push(
            '未找到 llvm-objcopy/llvm-size：工程可以构建出 .elf，但不会生成 .hex/.bin。'
          );
        }
        if (mcuToolchain?.family === 'clang' && !mcuToolchain.linker) {
          warnings.push(
            '未找到 LLD（ld.lld/lld）：LLVM clang 工程需要 lld 才能链接。'
          );
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
            toolchainFamily: this.selectedMcuToolchain()?.family
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
