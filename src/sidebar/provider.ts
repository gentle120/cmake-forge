import * as vscode from 'vscode';
import type { BuildRunResult } from '../generation/buildRunner';
import { armGccExecutablePath, inspectArmToolchainPath, normalizeArmToolchainPath } from '../env/armToolchain';
import type { CommandResult } from '../shared/commandResult';
import { randomBytes } from 'node:crypto';
import {
  getDeviceProfile,
  isRuntimeDeviceProfile,
  listDeviceProfiles
} from '../devices/deviceProfiles';
import { listDeviceProfilesForSeries, listDeviceSeries } from '../devices/deviceSelection';
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
import { scanProject } from '../scanner/projectScanner';
import {
  discoverWorkspaceProjects,
  reconcileProjectRoot,
  type WorkspaceProject
} from '../scanner/workspaceProjects';
import { renderSidebarHtml } from './html';
import { parseIncomingMessage, type SidebarIncomingMessage } from './messages';
import {
  buildSidebarState,
  sanitizeSidebarSelection,
  type SidebarSelection
} from './state';

const selectionKey = 'cmakeEmbedded.sidebarSelection.v1';

export interface SidebarProviderDependencies {
  workflow: ProjectWorkflowHost;
  confirmOverwrite(files: string[]): Promise<boolean>;
  discoverToolchains(): ReturnType<typeof discoverLinuxToolchains>;
  discoverProjects(roots: string[]): Promise<WorkspaceProject[]>;
  /** Resolves the stored CMSIS pack path for an imported part, when available. */
  packFileForPart?(part: string): string | undefined;
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
  private readonly viewDisposables: vscode.Disposable[] = [];

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly dependencies: SidebarProviderDependencies
  ) {
    this.selectionValue = sanitizeSidebarSelection(
      context.workspaceState.get(selectionKey)
    );
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
    return sanitizeSidebarSelection(this.selectionValue);
  }

  refresh(): void {
    this.postState();
  }

  dispose(): void {
    this.disposed = true;
    this.viewDisposables.splice(0).forEach((disposable) => disposable.dispose());
    this.view = undefined;
  }

  private post(message: unknown): void {
    if (!this.disposed && this.view) {
      void this.view.webview.postMessage(message);
    }
  }

  private state() {
    return buildSidebarState(
      workspaceName(),
      this.selectionValue,
      this.dependencies.discoverToolchains(),
      inspectArmToolchainPath(this.armToolchainPath()),
      this.discoveredProjects.map((project) => ({
        value: project.root,
        label: project.label,
        description: project.relativePath || '.',
        detail: project.markers.join(', ')
      })),
      this.selectionValue.projectRoot,
      this.discoveringProjects
    );
  }

  private postState(): void {
    this.post({ type: 'state', state: this.state() });
  }

  private async saveSelection(value: unknown): Promise<void> {
    const previous = this.selectionValue;
    this.selectionValue = sanitizeSidebarSelection(value, previous);
    const vendorChanged = this.selectionValue.mcu.vendor !== previous.mcu.vendor;
    const seriesChanged = this.selectionValue.mcu.series !== previous.mcu.series;
    if (vendorChanged || seriesChanged) {
      const profiles = listDeviceProfiles();
      const nextSeries = vendorChanged
        ? listDeviceSeries(profiles, this.selectionValue.mcu.vendor)[0]
        : this.selectionValue.mcu.series;
      const nextPart = listDeviceProfilesForSeries(
        profiles,
        this.selectionValue.mcu.vendor,
        nextSeries
      )[0]?.part;
      this.selectionValue = sanitizeSidebarSelection({
        ...this.selectionValue,
        mcu: {
          vendor: this.selectionValue.mcu.vendor,
          series: nextSeries,
          part: nextPart
        }
      }, previous);
    }
    await this.context.workspaceState.update(selectionKey, this.selectionValue);
    this.postState();
  }

  private async discoverProjects(): Promise<void> {
    const roots = (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath);
    this.discoveringProjects = true;
    this.postState();
    try {
      this.discoveredProjects = roots.length > 0
        ? await this.dependencies.discoverProjects(roots)
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
    } finally {
      this.discoveringProjects = false;
      this.postState();
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

  private async runGeneration(operation: string, run: () => Promise<WorkflowResult>): Promise<void> {
    if (this.busy) {
      return;
    }
    this.busy = true;
    this.post({ type: 'operationStarted', operation });
    try {
      const result = await run();
      this.post({
        type: 'operationFinished',
        result: normalizeResult(result)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.post({
        type: 'operationFinished',
        result: { ok: false, message, files: [] }
      });
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

  private armToolchainPath(): string {
    return normalizeArmToolchainPath(vscode.workspace
      .getConfiguration('cmakeEmbedded', vscode.workspace.workspaceFolders?.[0]?.uri)
      .get<string>('armToolchainPath', ''));
  }

  private flashGenerationOptions() {
    const selection = this.selectionValue.flash;
    const profile = getDeviceProfile(this.selectionValue.mcu.part);
    const probe = getFlashProbeProfile(selection.probeId);
    const requested = selection.backend as FlashBackendId;
    const backend: FlashBackendId = backendSupportsProbe(requested, probe.id)
      ? requested
      : defaultBackendFor(profile, probe.id);
    const device: FlashDeviceContext = {
      part: profile.part,
      core: profile.core,
      packFile: isRuntimeDeviceProfile(profile.part)
        ? this.dependencies.packFileForPart?.(profile.part)
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

  private async handleMessage(message: SidebarIncomingMessage): Promise<void> {
    if (this.busy && message.type !== 'ready' && message.type !== 'openSettings') {
      return;
    }
    if (message.type === 'ready') {
      void this.discoverProjects();
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
    if (message.type === 'scanEnvironment') {
      await this.runGeneration('正在扫描本机工具链', async () => {
        const result = await vscode.commands.executeCommand<CommandResult>('cmakeEmbedded.scanEnvironment');
        return { kind: 'mcu', ...result, files: [] };
      });
      this.postState();
      return;
    }
    if (message.type === 'importPack') {
      await this.runGeneration('正在导入 Pack', async () => {
        const result = await vscode.commands.executeCommand<CommandResult>('cmakeEmbedded.importPack');
        return { kind: 'mcu', ...result, files: [] };
      });
      this.postState();
      return;
    }
    if (message.type === 'setArmToolchainPath' || message.type === 'browseArmToolchain') {
      await this.runGeneration('正在设置 ARM GNU 工具链', async () => {
        const result = await vscode.commands.executeCommand<CommandResult>('cmakeEmbedded.selectArmToolchain',
          message.type === 'setArmToolchainPath' ? message.path : undefined);
        return { kind: 'mcu', ...result, files: [] };
      });
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
    if (message.type === 'buildProject') {
      await this.runGeneration('正在配置并编译', async () => {
        const result = await vscode.commands.executeCommand<BuildRunResult | undefined>('cmakeEmbedded.buildProject');
        return {
          kind: 'mcu',
          ok: result?.ok ?? false,
          cancelled: result?.cancelled ?? !result,
          message: result?.message ?? '构建未执行，详情见通知或输出面板。',
          files: []
        };
      });
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
        const profile = getDeviceProfile(this.selectionValue.mcu.part);
        const flash = this.selectionValue.flash.enabled
          ? this.flashGenerationOptions()
          : undefined;
        const project = await generateMcuWorkflow(this.workflowHost(), profile, {
          flash, compilerPath: armGccExecutablePath(this.armToolchainPath())
        });
        if (!project.ok || !this.selectionValue.debugEnabled || !flash) {
          return project;
        }
        const debug = await generateDebugWorkflow(
          this.workflowHost(),
          flash.target,
          flash.probe,
          flash.openocdPath,
          this.armToolchainPath() || undefined,
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
          this.armToolchainPath() || undefined,
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
    this.busy = true;
    this.post({ type: 'operationStarted', operation: '正在扫描工作区' });
    try {
      const project = await scanProject(root);
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
      const message = error instanceof Error ? error.message : String(error);
      this.post({
        type: 'operationFinished',
        result: { ok: false, message, files: [] }
      });
    } finally {
      this.busy = false;
    }
  }
}
