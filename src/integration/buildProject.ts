import * as vscode from 'vscode';
import { createBuildProjectCommand } from '../generation/buildWorkflow';
import { getArmToolchainPath } from './toolchainSettings';

/** Registers the explicit CMake build command and owns its output/cancellation lifetime. */
export function registerBuildProject(context: vscode.ExtensionContext): void {
  const output = vscode.window.createOutputChannel('CMake-Embedded Build');
  let controller: AbortController | undefined;
  const command = createBuildProjectCommand({
    workspaceRoot: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath,
    isTrusted: () => vscode.workspace.isTrusted,
    choosePreset: async () => {
      const picked = await vscode.window.showQuickPick([
        { label: 'Debug', description: '调试构建 · build/debug', value: 'debug' as const },
        { label: 'Release', description: '优化构建 · build/release', value: 'release' as const }
      ], { placeHolder: '选择要配置并编译的 CMake preset' });
      return picked?.value;
    },
    cmakePath: () => vscode.workspace.getConfiguration('cmake').get<string>('cmakePath', 'cmake'),
    armToolchainPath: getArmToolchainPath,
    showOutput: () => output.show(true),
    appendLine: line => output.appendLine(line),
    showError: message => { void vscode.window.showErrorMessage(message); },
    showInformation: message => { void vscode.window.showInformationMessage(message); },
    withProgress: async run => vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification, title: 'CMake-Embedded：配置并编译', cancellable: true
    }, async (_progress, token) => {
      const active = new AbortController();
      controller = active;
      const cancellation = token.onCancellationRequested(() => active.abort());
      if (token.isCancellationRequested) {
        active.abort();
      }
      try {
        return await run(active.signal);
      } finally {
        cancellation.dispose();
        if (controller === active) {
          controller = undefined;
        }
      }
    })
  });
  context.subscriptions.push(
    output,
    vscode.commands.registerCommand('cmakeEmbedded.buildProject', command),
    { dispose: () => controller?.abort() }
  );
}
