/**
 * A tiny output channel for generation diagnostics.
 *
 * Device-file copying depends on the Pack store (record, snapshot, archive or
 * installed directory), which is not visible from the generated project. When it
 * yields nothing the reason has to be readable somewhere instead of silently
 * producing a project without `SystemInit`.
 *
 * The VS Code API is loaded lazily: this module is also imported by host-side
 * code under the Node test harness, where `vscode` does not exist.
 */

import type * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

function api(): typeof vscode | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('vscode') as typeof vscode;
  } catch {
    return undefined;
  }
}

function outputChannel(): vscode.OutputChannel | undefined {
  const code = api();
  const factory = (code?.window as { createOutputChannel?: unknown } | undefined)?.createOutputChannel;
  if (!code || typeof factory !== 'function') {
    return undefined;
  }
  channel ??= code.window.createOutputChannel('CMake-Embedded');
  return channel;
}

/** Appends one diagnostic line; outside the VS Code host this is a no-op. */
export function logLine(message: string): void {
  try {
    outputChannel()?.appendLine(message);
  } catch {
    // Diagnostics must never break generation.
  }
}

/** Shows the channel so the user can read the last generation's explanation. */
export function showLog(): void {
  try {
    outputChannel()?.show(true);
  } catch {
    // Ignore.
  }
}
