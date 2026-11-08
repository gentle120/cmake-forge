/**
 * Locates the OpenOCD executable the generated Cortex-Debug configuration will
 * start.
 *
 * F5 has no way to report a missing server process: cortex-debug fails to spawn
 * it and the debug session closes within a second. Checking at generation time
 * lets the generator explain the problem while the user is still looking at the
 * sidebar.
 */

import { statSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';

function isFile(candidate: string): boolean {
  try {
    return statSync(candidate).isFile();
  } catch {
    return false;
  }
}

const executableExtensions = process.platform === 'win32'
  ? ['', '.exe', '.cmd', '.bat']
  : [''];

/**
 * Resolves the OpenOCD command from an absolute path or the process `PATH`.
 *
 * Returns `undefined` when nothing matches; callers must not treat a bare
 * command name as "found" just because it is configured.
 */
export function resolveOpenOcdExecutable(
  configured: string,
  environment: NodeJS.ProcessEnv = process.env
): string | undefined {
  const value = configured.trim();
  if (!value) {
    return undefined;
  }
  if (isAbsolute(value) || /^[A-Za-z]:[\\/]/.test(value)) {
    return isFile(value) ? value : undefined;
  }
  const directories = (environment.PATH ?? environment.Path ?? '')
    .split(delimiter)
    .filter((directory) => directory.length > 0);
  for (const directory of directories) {
    for (const extension of executableExtensions) {
      const candidate = join(directory, `${value}${extension}`);
      if (isFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

/** Copy for a generation that will not be able to start OpenOCD on F5. */
export function missingOpenOcdNotice(configured: string): string {
  const name = configured.trim() || 'openocd';
  return `没有找到 OpenOCD（${name}）：按 F5 会立即退出。请在设置 cmakeForge.openocdPath 里填写 openocd.exe 的完整路径，或把 OpenOCD 的 bin 目录加入 PATH 后重试。`;
}
