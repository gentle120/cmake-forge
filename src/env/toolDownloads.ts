/**
 * Downloads the two tools a generated STM32 project actually needs: the GNU
 * Arm toolchain that compiles it and OpenOCD that flashes it.
 *
 * Both are plain zip archives on purpose — asking a user without a compiler to
 * click through vendor installers (and possibly an admin prompt) is the step
 * where a first-run session dies. Extraction uses the `tar` shipped with
 * Windows 10+, so no extra dependency is bundled.
 */

import { spawn } from 'node:child_process';
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs';
import { join } from 'node:path';

/** Newest Arm release whose Windows zip is published for both architectures. */
export const ARM_GCC_VERSION = '15.2.rel1';
export const ARM_GCC_URL =
  `https://developer.arm.com/-/media/Files/downloads/gnu/${ARM_GCC_VERSION}/binrel/`
  + `arm-gnu-toolchain-${ARM_GCC_VERSION}-mingw-w64-x86_64-arm-none-eabi.zip`;

export const OPENOCD_VERSION = '0.12.0-7';
export const OPENOCD_URL =
  `https://github.com/xpack-dev-tools/openocd-xpack/releases/download/v${OPENOCD_VERSION}/`
  + `xpack-openocd-${OPENOCD_VERSION}-win32-x64.zip`;

/** Rough sizes, used for a percentage before the server reports a length. */
export const ARM_GCC_EXPECTED_BYTES = 296_000_000;
export const OPENOCD_EXPECTED_BYTES = 3_300_000;

export type ToolDownloadStage = 'download' | 'extract' | 'verify' | 'done';

export interface ToolProgress {
  stage: ToolDownloadStage;
  message: string;
  /** 0–100 while downloading; omitted for stages without a meaningful ratio. */
  percent?: number;
}

export interface InstallOptions {
  /** Extension-global storage root; tools land in `toolchains/` and `tools/`. */
  storageRoot: string;
  onProgress?: (progress: ToolProgress) => void;
  signal?: AbortSignal;
  /** Injected in tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Injected in tests; defaults to spawning `tar`. */
  extractImpl?: (archive: string, destination: string) => Promise<void>;
}

export interface InstalledArmGcc {
  version: string;
  /** Directory containing `arm-none-eabi-gcc.exe`. */
  binDir: string;
}

export interface InstalledOpenOcd {
  version: string;
  /** Full path to `openocd.exe`. */
  executable: string;
}

function report(
  options: InstallOptions,
  stage: ToolDownloadStage,
  message: string,
  percent?: number
): void {
  options.onProgress?.(percent === undefined ? { stage, message } : { stage, message, percent });
}

async function downloadArchive(
  options: InstallOptions,
  url: string,
  destination: string,
  expectedBytes: number,
  label: string
): Promise<void> {
  const fetcher = options.fetchImpl ?? fetch;
  mkdirSync(join(destination, '..'), { recursive: true });
  report(options, 'download', `正在下载 ${label}…`, 0);
  const response = await fetcher(url, { signal: options.signal, redirect: 'follow' });
  if (!response.ok || !response.body) {
    // The CDN answers 403/404 with a short body; surfacing the status is enough
    // to tell a blocked network from a moved release.
    throw new Error(`下载 ${label} 失败：HTTP ${response.status}`);
  }
  const declared = Number(response.headers.get('content-length') ?? '');
  const total = Number.isFinite(declared) && declared > 0 ? declared : expectedBytes;
  const partial = `${destination}.part`;
  const stream = createWriteStream(partial);
  const reader = response.body.getReader();
  let received = 0;
  let lastPercent = -1;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      if (options.signal?.aborted) {
        throw new Error('已取消下载。');
      }
      received += chunk.value.byteLength;
      const percent = Math.min(99, Math.floor((received / total) * 100));
      if (percent !== lastPercent) {
        lastPercent = percent;
        report(options, 'download', `正在下载 ${label}… ${percent}%`, percent);
      }
      if (!stream.write(chunk.value)) {
        await new Promise<void>((resolve) => stream.once('drain', resolve));
      }
    }
    await new Promise<void>((resolve, reject) => {
      stream.end((error?: Error | null) => (error ? reject(error) : resolve()));
    });
    renameSync(partial, destination);
  } finally {
    stream.destroy();
    if (existsSync(partial)) {
      rmSync(partial, { force: true });
    }
  }
}

function tarExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const bundled = join(systemRoot, 'System32', 'tar.exe');
  return existsSync(bundled) ? bundled : 'tar';
}

async function extractWithTar(archive: string, destination: string): Promise<void> {
  mkdirSync(destination, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(tarExecutable(), ['-xf', archive, '-C', destination], {
      windowsHide: true
    });
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`解压失败（tar 退出码 ${code}）${stderr.trim() ? `：${stderr.trim()}` : ''}`));
    });
  });
}

/**
 * Depth-first search for a relative path below `root`.
 *
 * The downloads unpack into a versioned directory, so the executable is never
 * at a path the code can hard-code.
 */
export function findBelow(root: string, relative: string, maxDepth = 3): string | undefined {
  if (!existsSync(root)) {
    return undefined;
  }
  const target = join(root, relative);
  if (existsSync(target)) {
    return target;
  }
  if (maxDepth <= 0) {
    return undefined;
  }
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return undefined;
  }
  for (const entry of entries) {
    const child = join(root, entry);
    try {
      if (!statSync(child).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    const hit = findBelow(child, relative, maxDepth - 1);
    if (hit) {
      return hit;
    }
  }
  return undefined;
}

function toolDirectory(storageRoot: string, tool: string, version: string): string {
  return join(storageRoot, 'tools', `${tool}-${version}`);
}

export async function installArmGcc(options: InstallOptions): Promise<InstalledArmGcc> {
  const target = toolDirectory(options.storageRoot, 'arm-gcc', ARM_GCC_VERSION);
  const archive = join(options.storageRoot, 'downloads', `arm-gcc-${ARM_GCC_VERSION}.zip`);
  if (existsSync(join(target, '.ready'))) {
    const existing = findBelow(target, join('bin', 'arm-none-eabi-gcc.exe'));
    if (existing) {
      return { version: ARM_GCC_VERSION, binDir: join(existing, '..') };
    }
  }
  rmSync(target, { recursive: true, force: true });
  await downloadArchive(options, ARM_GCC_URL, archive, ARM_GCC_EXPECTED_BYTES, 'ARM GNU 工具链');
  report(options, 'extract', '正在解压 ARM GNU 工具链…（约 300 MB，请稍候）');
  await (options.extractImpl ?? extractWithTar)(archive, target);
  rmSync(archive, { force: true });
  report(options, 'verify', '正在确认 arm-none-eabi-gcc…');
  const compiler = findBelow(target, join('bin', 'arm-none-eabi-gcc.exe'));
  if (!compiler) {
    rmSync(target, { recursive: true, force: true });
    throw new Error('解压后没有找到 arm-none-eabi-gcc.exe，下载包可能不完整。');
  }
  mkdirSync(join(target, '.ready'), { recursive: true });
  report(options, 'done', 'ARM GNU 工具链已安装。', 100);
  return { version: ARM_GCC_VERSION, binDir: join(compiler, '..') };
}

export async function installOpenOcd(options: InstallOptions): Promise<InstalledOpenOcd> {
  const target = toolDirectory(options.storageRoot, 'openocd', OPENOCD_VERSION);
  const archive = join(options.storageRoot, 'downloads', `openocd-${OPENOCD_VERSION}.zip`);
  if (existsSync(join(target, '.ready'))) {
    const existing = findBelow(target, join('bin', 'openocd.exe'));
    if (existing) {
      return { version: OPENOCD_VERSION, executable: existing };
    }
  }
  rmSync(target, { recursive: true, force: true });
  await downloadArchive(options, OPENOCD_URL, archive, OPENOCD_EXPECTED_BYTES, 'OpenOCD');
  report(options, 'extract', '正在解压 OpenOCD…');
  await (options.extractImpl ?? extractWithTar)(archive, target);
  rmSync(archive, { force: true });
  report(options, 'verify', '正在确认 openocd.exe…');
  const executable = findBelow(target, join('bin', 'openocd.exe'));
  if (!executable) {
    rmSync(target, { recursive: true, force: true });
    throw new Error('解压后没有找到 openocd.exe，下载包可能不完整。');
  }
  mkdirSync(join(target, '.ready'), { recursive: true });
  report(options, 'done', 'OpenOCD 已安装。', 100);
  return { version: OPENOCD_VERSION, executable };
}
