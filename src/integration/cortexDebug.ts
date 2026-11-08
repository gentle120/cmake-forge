/**
 * Guards the Cortex-Debug dependency at the point where a debug configuration
 * is generated.
 *
 * The debug adapter is deliberately not an `extensionDependencies` entry: an
 * install prompt is only relevant to users who actually debug, not to everyone
 * who generates a project. The command palette and the sidebar therefore offer
 * the install at the same moment instead.
 */

import * as vscode from 'vscode';

export const cortexDebugExtensionId = 'marus25.cortex-debug';

const cmakeToolsExtensionId = 'ms-vscode.cmake-tools';

export function isCortexDebugInstalled(): boolean {
  return vscode.extensions.getExtension(cortexDebugExtensionId) !== undefined;
}

/**
 * True when this window clearly did not load the extensions a generated project
 * needs.
 *
 * The Extension Development Host is frequently started with `--disable-extensions`
 * for isolation; in that window Cortex-Debug and CMake Tools are disabled even
 * when they are installed, so debugging a generated project ends within a
 * second no matter what the project contains. Naming that situation saves the
 * user from chasing the generated files.
 */
export function areHostExtensionsDisabled(): boolean {
  return vscode.extensions.getExtension(cmakeToolsExtensionId) === undefined;
}

/**
 * Returns true when a debug configuration can actually be used.
 *
 * A missing adapter makes F5 close the session within a second, so the caller
 * must stop instead of writing a configuration that cannot run.
 */
export async function ensureCortexDebugInstalled(): Promise<boolean> {
  if (isCortexDebugInstalled()) {
    return true;
  }
  const action = await vscode.window.showWarningMessage(
    areHostExtensionsDisabled()
      ? '当前窗口没有加载 CMake Tools 与 Cortex-Debug（常见于扩展开发宿主以 --disable-extensions 启动）：在这种窗口里按 F5 调试固件会立刻退出。请换成普通窗口调试，或去掉启动参数里的 --disable-extensions。'
      : '生成调试配置需要 Cortex-Debug：未安装时按 F5 调试会话会立即退出。',
    '安装',
    '继续'
  );
  if (action === '安装') {
    await vscode.commands.executeCommand(
      'workbench.extensions.installExtension',
      cortexDebugExtensionId
    );
    return false;
  }
  return action === '继续';
}
