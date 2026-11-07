import * as vscode from 'vscode';
import type { CommandResult } from '../shared/commandResult';
import { randomBytes } from 'node:crypto';
import {
  getDeviceProfileForPack,
  isRuntimeDeviceProfile,
  listDeviceProfilesForPack
} from '../devices/deviceProfiles';
import type { DevicePackOption } from '../devices/deviceSelection';
import {
  comparePackVersions,
  listDeviceProfilesForSeries,
  listDeviceSeries
} from '../devices/deviceSelection';
import { getVendorMetadata, hasVendor } from '../devices/vendorRegistry';
import { findCatalogSeries } from '../devices/seriesCatalog';
import { getFlashProbeProfile } from '../flash/probeProfiles';
import { getFlashTargetProfile } from '../flash/targets/targetProfiles';
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
  type ProjectWorkflowHost,
  type WorkflowResult
} from '../generation/workflow';
import { discoverLinuxToolchains } from '../linux/discovery';
import { createLinuxToolchain } from '../linux/toolchainGenerator';
import { describeNativeProject } from '../native/projectStructure';
import { scanProject, ScanCancelledError } from '../scanner/projectScanner';
import {
  discoverWorkspaceProjects,
  reconcileProjectRoot,
  WorkspaceProjectsCancelledError,
  type WorkspaceProject,
  type WorkspaceProjectScanOptions
} from '../scanner/workspaceProjects';
import { renderSidebarHtml } from './html';
import { parseIncomingMessage, type SidebarIncomingMessage } from './messages';
import {
  buildSidebarState,
  nextMcuSelection,
  sanitizeSidebarSelection,
  type SidebarOption,
  type SidebarSelection
} from './state';

const selectionKey = 'cmakeEmbedded.sidebarSelection.v1';

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
  static readonly viewType = 'cmakeEmbedded.sidebar';

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
  private packCatalogRequest = 0;
  private lastBusyHintAt = 0;
  private readonly viewDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly dependencies: SidebarProviderDependencies
  ) {
    this.selectionValue = sanitizeSidebarSelection(
      context.workspaceState.get(selectionKey)
    );
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
    return sanitizeSidebarSelection(this.selectionValue, this.selectionValue, this.packOptions);
  }

  refresh(): void {
    this.postState();
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
    if (!this.disposed && this.view) {
      void this.view.webview.postMessage(message);
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
      this.packCatalogNotice
    );
  }

  private postState(): void {
    this.post({ type: 'state', state: this.state() });
  }

  private async saveSelection(value: unknown): Promise<void> {
    const previous = this.selectionValue;
    const requested = sanitizeSidebarSelection(value, previous, this.packOptions);
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
          this.packOptions
        )
      : requested;
    const vendorChanged = this.selectionValue.mcu.vendor !== previous.mcu.vendor;
    const seriesChanged = this.selectionValue.mcu.series !== previous.mcu.series;
    await this.context.workspaceState.update(selectionKey, this.selectionValue);
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
    const prefix = catalog?.partPrefix.toUpperCase();
    for (const option of this.packOptions) {
      if (option.origin === 'imported' && option.packFile) {
        const profiles = listDeviceProfilesForPack(option.packFile);
        if (profiles.some((profile) =>
          profile.series === series
          || (prefix !== undefined && profile.part.toUpperCase().startsWith(prefix))
        )) {
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
      this.packOptions = catalogResult.options;
      this.packCatalogNotice = catalogResult.notice || vendorResult?.notice || '';
      if (this.packOptions.length === 0 && this.packCatalogNotice === '') {
        const catalog = findCatalogSeries(this.selectionValue.mcu.vendor, this.selectionValue.mcu.series);
        this.packCatalogNotice = catalog?.packName
          ? `「${catalog.label}」系列需要 ${catalog.packName}：请点上方「在线安装 Pack」打开官方下载页，或用 Keil Pack Installer 安装后重选系列，也可点「导入 Pack 包」导入已下载的 .pack。`
          : '未找到该厂商的 Pack：请点上方「在线安装 Pack」或「导入 Pack 包」获取器件包，也可以先用 Keil Pack Installer 安装。';
      }

      const selected = this.packOptions.find((option) =>
        option.packId === this.selectionValue.mcu.packId
        && option.version === this.selectionValue.mcu.version
      );
      const fallback = this.packOptions[0];
      if (!selected && fallback) {
        this.pendingPackId = fallback.packId;
        // An explicit vendor change activates the newest already-available
        // Pack version so series and parts work without a manual import.
        // Downloadable entries wait for an explicit selection; startup
        // refreshes never activate on their own.
        const autoCandidate = autoActivate && this.dependencies.activatePack
          ? [...this.packOptions]
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
        notice: this.packCatalogNotice
      });
      this.postState();
    } catch (error) {
      if (request !== this.packCatalogRequest || vendor !== this.selectionValue.mcu.vendor) {
        return;
      }
      this.packCatalogNotice = error instanceof Error ? error.message : String(error);
      this.packOptions = this.packOptions.filter((option) =>
        option.vendorId === vendor && option.origin !== 'downloadable'
      );
      const options = this.optionsForCatalog();
      this.post({
        type: 'packCatalogState',
        vendor,
        packs: options.packs,
        versions: options.versions,
        notice: this.packCatalogNotice
      });
      this.postState();
    }
  }

  private optionsForCatalog(): { packs: SidebarOption[]; versions: SidebarOption[] } {
    const packs = new Map<string, DevicePackOption>();
    for (const option of this.packOptions) {
      if (!packs.has(option.packId)) {
        packs.set(option.packId, option);
      }
    }
    return {
      packs: [...packs.values()].map((option) => ({
        value: option.packId,
        label: option.name,
        description: option.origin
      })),
      versions: this.packOptions
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
      // pack serves it (by series id or catalog part prefix).
      const chosenSeries = this.selectionValue.mcu.series;
      const catalog = findCatalogSeries(vendor, chosenSeries);
      const prefix = catalog?.partPrefix.toUpperCase();
      const pool = prefix !== undefined
        ? profiles.filter((profile) => profile.part.toUpperCase().startsWith(prefix))
        : profiles.filter((profile) => profile.series === chosenSeries);
      const candidates = pool.length > 0 ? pool : profiles;
      const series = [...new Set(candidates.map((profile) => profile.series))]
        .sort((left, right) => left.localeCompare(right))[0];
      const profile = candidates
        .filter((candidate) => candidate.series === series)
        .sort((left, right) => left.part.localeCompare(right.part))[0];
      if (!profile) {
        throw new Error('此 Pack 版本没有可用于生成的芯片。');
      }
      this.selectionValue = sanitizeSidebarSelection(
        nextMcuSelection(this.selectionValue, {
          vendor: activatedVendor,
          packId: activated.packId,
          version: activated.version,
          sourcePack,
          series,
          part: profile.part
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
        notice: this.packCatalogNotice
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

  private executablePaths(): FlashExecutablePaths {
    const configuration = vscode.workspace.getConfiguration('cmakeEmbedded');
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
      openocdPath: selection.openocdPath,
      backend,
      device,
      executables: this.executablePaths()
    };
  }

  private selectedDeviceProfile() {
    const { part, sourcePack } = this.selectionValue.mcu;
    if (!part || !sourcePack) {
      throw new Error('请先选择芯片支持包与型号。');
    }
    return getDeviceProfileForPack(part, sourcePack);
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
      void this.discoverProjects().catch((error) => {
        const text = error instanceof Error ? error.message : String(error);
        this.post({ type: 'notification', level: 'error', message: text });
        this.discoveringProjects = false;
        this.postState();
      });
      void this.refreshPackCatalog(this.selectionValue.mcu.vendor);
      this.postState();
      if (this.selectionValue.debugEnabled) {
        this.post({
          type: 'notification',
          level: 'info',
          message: '下次生成工程时会同时更新 Cortex-Debug 配置。'
        });
      }
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
      if (this.packOptions.some((option) => option.packId === message.packId)) {
        this.pendingPackId = message.packId;
        const options = this.optionsForCatalog();
        this.post({
          type: 'packCatalogState',
          vendor: this.selectionValue.mcu.vendor,
          packs: options.packs,
          versions: options.versions,
          notice: this.packCatalogNotice
        });
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
        const commandResult = await vscode.commands.executeCommand<CommandResult>('cmakeEmbedded.importPack');
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
    if (message.type === 'installPackOnline') {
      const result = await this.runGeneration('正在在线安装 Pack', async () => {
        const commandResult = await vscode.commands.executeCommand<CommandResult>('cmakeEmbedded.installPackOnline');
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
        '@ext:gentle120.cmake-embedded'
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
          const structure = describeNativeProject(
            project,
            root.replace(/\\/g, '/').split('/').pop()?.replace(/[^A-Za-z0-9_-]/g, '_') || 'app',
            {
              targetType: this.selectionValue.native.targetType,
              cStandard: this.selectionValue.native.cStandard,
              cxxStandard: this.selectionValue.native.cxxStandard
            }
          );
          return generateNativeWorkflow(this.workflowHost(), structure);
        }
        if (this.selectionValue.mode === 'linux') {
          return generateLinuxWorkflow(this.workflowHost(), this.toolchainForSelection());
        }
        const profile = this.selectedDeviceProfile();
        const flash = this.selectionValue.flash.enabled
          ? this.flashGenerationOptions()
          : undefined;
        const project = await generateMcuWorkflow(this.workflowHost(), profile, { flash });
        if (!project.ok || !this.selectionValue.debugEnabled || !flash) {
          return project;
        }
        const debug = await generateDebugWorkflow(
          this.workflowHost(),
          flash.target,
          flash.probe,
          flash.openocdPath,
          flash.backend,
          flash.device
        );
        return {
          ...project,
          ok: debug.ok,
          files: [...new Set([...project.files, ...debug.files])],
          message: `${project.message} ${debug.message}`
        };
      });
      return;
    }
    if (message.type === 'generateFlashScript') {
      await this.runGeneration('正在生成 flash.py', () => {
        const flash = this.flashGenerationOptions();
        return generateFlashWorkflow(
          this.workflowHost(),
          flash.target,
          flash.probe,
          flash.openocdPath,
          flash.backend,
          flash.device,
          flash.executables
        );
      });
      return;
    }
    if (message.type === 'generateDebugConfiguration') {
      await this.runGeneration('正在生成调试配置', async () => {
        const flash = this.flashGenerationOptions();
        const debug = await generateDebugWorkflow(
          this.workflowHost(),
          flash.target,
          flash.probe,
          flash.openocdPath,
          flash.backend,
          flash.device
        );
        return {
          ...debug,
          files: [...new Set(debug.files)]
        };
      });
    }
  }

  private async scan(): Promise<void> {
    const root = this.projectRoot();
    if (!root) {
      this.post({
        type: 'notification',
        level: 'info',
        message: this.discoveringProjects
          ? '正在发现工程，请稍候。'
          : '请先选择目标工程。'
      });
      return;
    }
    if (this.busy) {
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
