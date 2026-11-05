import * as vscode from 'vscode';
import { inspectArmToolchainPath, normalizeArmToolchainPath } from '../env/armToolchain';
import type { CommandResult } from '../shared/commandResult';

function configuration(): vscode.WorkspaceConfiguration {
  return vscode.workspace.getConfiguration('cmakeEmbedded', vscode.workspace.workspaceFolders?.[0]?.uri);
}

export function getArmToolchainPath(): string | undefined {
  return normalizeArmToolchainPath(configuration().get<string>('armToolchainPath', '')) || undefined;
}

/** Updates the effective setting scope, so a workspace override cannot hide the selection. */
export async function saveArmToolchainPath(input: string): Promise<CommandResult> {
  const status = inspectArmToolchainPath(input);
  if (status.state === 'missing') {
    void vscode.window.showErrorMessage(status.message);
    return { ok: false, message: status.message };
  }
  const config = configuration();
  const current = config.inspect<string>('armToolchainPath');
  const target = current?.workspaceFolderValue !== undefined
    ? vscode.ConfigurationTarget.WorkspaceFolder
    : current?.workspaceValue !== undefined
      ? vscode.ConfigurationTarget.Workspace
      : vscode.ConfigurationTarget.Global;
  await config.update('armToolchainPath', status.binDir, target);
  return { ok: true, message: status.binDir ? 'ARM GNU 工具链目录已保存。' : '已清空工具链目录，构建将使用 PATH。' };
}

export function registerArmToolchainSettings(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.commands.registerCommand('cmakeEmbedded.selectArmToolchain', async (input?: string) => {
    if (input !== undefined && typeof input !== 'string') {
      return { ok: false, message: '工具链路径必须为字符串。' };
    }
    if (input === undefined) {
      const current = getArmToolchainPath();
      const picked = await vscode.window.showOpenDialog({
        title: '选择 ARM GNU GCC 工具链的 bin 目录',
        canSelectFiles: false, canSelectFolders: true, canSelectMany: false,
        defaultUri: current ? vscode.Uri.file(current) : undefined,
        openLabel: '选择工具链'
      });
      if (!picked?.[0]) {
        return { ok: false, cancelled: true, message: '已取消选择工具链。' };
      }
      input = picked[0].fsPath;
    }
    return saveArmToolchainPath(input);
  }));
}
