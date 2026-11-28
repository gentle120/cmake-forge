/**
 * Downloads the tools a generated MCU project actually needs: the GNU Arm
 * toolchain that compiles it, CMake and Ninja that drive the build, and OpenOCD
 * that flashes it.
 *
 * Both are plain zip archives on purpose — asking a user without a compiler to
 * click through vendor installers (and possibly an admin prompt) is the step
 * where a first-run session dies. Extraction uses the `tar` shipped with
 * Windows 10+, so no extra dependency is bundled.
 */

import { spawn } from 'node:child_process';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs';
import { join } from 'node:path';

/**
 * Arm's own CDN is the canonical source but is very slow from mainland China,
 * and no university mirror carries the zip. GitHub is fast there, so the
 * primary source is the same GCC 15.2.1 built for Windows by xpack and fetched
 * through a public GitHub proxy; the official Arm archive stays as a fallback.
 */
export const GITHUB_PROXY = 'https://gh-proxy.com/';

export const ARM_GCC_VERSION = '15.2.1-1.1';
export const ARM_GCC_URL =
  `${GITHUB_PROXY}https://github.com/xpack-dev-tools/arm-none-eabi-gcc-xpack/releases/download/`
  + `v${ARM_GCC_VERSION}/xpack-arm-none-eabi-gcc-${ARM_GCC_VERSION}-win32-x64.zip`;
export const ARM_GCC_OFFICIAL_URL =
  'https://developer.arm.com/-/media/Files/downloads/gnu/15.2.rel1/binrel/'
  + 'arm-gnu-toolchain-15.2.rel1-mingw-w64-x86_64-arm-none-eabi.zip';
export const ARM_GCC_SOURCES = [ARM_GCC_URL, ARM_GCC_OFFICIAL_URL];

export const OPENOCD_VERSION = '0.12.0-7';
export const OPENOCD_URL =
  `${GITHUB_PROXY}https://github.com/xpack-dev-tools/openocd-xpack/releases/download/`
  + `v${OPENOCD_VERSION}/xpack-openocd-${OPENOCD_VERSION}-win32-x64.zip`;
export const OPENOCD_SOURCES = [
  OPENOCD_URL,
  'https://github.com/xpack-dev-tools/openocd-xpack/releases/download/'
    + `v${OPENOCD_VERSION}/xpack-openocd-${OPENOCD_VERSION}-win32-x64.zip`
];

/** Rough sizes, used for a percentage before the server reports a length. */
export const ARM_GCC_EXPECTED_BYTES = 296_000_000;
export const OPENOCD_EXPECTED_BYTES = 3_300_000;

export const NINJA_EXPECTED_BYTES = 291_570;

/** Python package index mirror used by the pyOCD install step. */
export const PYPI_MIRROR = 'https://pypi.tuna.tsinghua.edu.cn/simple';

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

function parseTotalFromRange(header: string | null): number | undefined {
  const match = /\/(\d+)$/.exec(header ?? '');
  if (!match) {
    return undefined;
  }
  const total = Number(match[1]);
  return Number.isFinite(total) && total > 0 ? total : undefined;
}

async function downloadSingle(
  options: InstallOptions,
  fetcher: typeof fetch,
  url: string,
  destination: string,
  expectedBytes: number,
  label: string
): Promise<void> {
  report(options, 'download', `正在下载 ${label}…`, 0);
  // A single stream has no per-chunk timeout of its own; the proxy used to stall
  // mid-body and leave the promise pending forever. Abort after 60 s of silence.
  const idle = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, idle.signal]) : idle.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const arm = (): void => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => idle.abort(), REQUEST_TIMEOUT_MS * 2);
  };
  arm();
  let response: Response;
  try {
    response = await fetcher(url, { signal, redirect: 'follow' });
  } catch (error) {
    if (timer) {
      clearTimeout(timer);
    }
    if (idle.signal.aborted) {
      throw new Error(`下载 ${label} 失败：${REQUEST_TIMEOUT_MS * 2 / 1000} 秒内没有收到响应。`);
    }
    throw error;
  }
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
      arm();
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
  } catch (error) {
    if (idle.signal.aborted && !options.signal?.aborted) {
      throw new Error(`下载 ${label} 失败：${REQUEST_TIMEOUT_MS * 2 / 1000} 秒内没有收到数据。`);
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    stream.destroy();
    if (existsSync(partial)) {
      rmSync(partial, { force: true });
    }
  }
}

/**
 * Single connections to international CDNs are throttled hard here, so a
 * ranged download with several parallel connections is where most of the
 * speed comes from. Falls back to one stream when the server ignores `Range`.
 */
const CHUNK_BYTES = 1024 * 1024;
const CHUNK_WORKERS = 24;
/** 单个请求的兜底超时：代理偶尔挂住连接，不能让一个分片拖死整次下载。 */
const REQUEST_TIMEOUT_MS = 30_000;
const CHUNK_ATTEMPTS = 3;

async function downloadChunks(
  options: InstallOptions,
  fetcher: typeof fetch,
  url: string,
  destination: string,
  total: number,
  label: string
): Promise<void> {
  const chunks = Math.ceil(total / CHUNK_BYTES);
  const controller = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  const parts: (string | undefined)[] = new Array(chunks);
  let nextChunk = 0;
  let completedBytes = 0;
  let lastPercent = -1;
  let failure: unknown;

  /**
   * A proxy that drops the connection mid-body used to leave a short part file
   * behind, and awaiting `drain` on a dead stream could hang the whole download.
   * `pipeline` propagates stream errors and honours the abort signal, and the
   * byte count check turns a truncated part into a retry instead of a corrupt
   * archive.
   */
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = nextChunk;
      nextChunk += 1;
      if (index >= chunks || failure) {
        return;
      }
      const start = index * CHUNK_BYTES;
      const end = Math.min(total - 1, start + CHUNK_BYTES - 1);
      const expected = end - start + 1;
      const partPath = `${destination}.part${index}`;
      try {
        for (let attempt = 1; ; attempt += 1) {
          try {
            const response = await fetcher(url, {
              headers: { Range: `bytes=${start}-${end}` },
              signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
              redirect: 'follow'
            });
            if (response.status !== 206 || !response.body) {
              throw new Error(`分片 ${index} 返回 HTTP ${response.status}`);
            }
            await pipeline(
              Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]),
              createWriteStream(partPath),
              { signal }
            );
            const received = statSync(partPath).size;
            if (received !== expected) {
              throw new Error(`分片 ${index} 只收到 ${received}/${expected} 字节`);
            }
            break;
          } catch (error) {
            rmSync(partPath, { force: true });
            if (failure || signal.aborted || attempt >= CHUNK_ATTEMPTS) {
              throw error;
            }
            await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
          }
        }
        parts[index] = partPath;
        completedBytes += expected;
        const percent = Math.min(99, Math.floor((completedBytes / total) * 100));
        if (percent !== lastPercent) {
          lastPercent = percent;
          report(options, 'download', `正在下载 ${label}… ${percent}%`, percent);
        }
      } catch (error) {
        if (!failure) {
          failure = error;
        }
        // Stop the other workers instead of letting them finish a doomed download.
        controller.abort();
        return;
      }
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CHUNK_WORKERS, chunks) }, () => worker()));
    if (failure) {
      throw failure;
    }
    const assembled = `${destination}.part`;
    rmSync(assembled, { force: true });
    for (let index = 0; index < chunks; index += 1) {
      const part = parts[index];
      if (!part) {
        throw new Error(`分片 ${index} 缺失，下载未完成。`);
      }
      appendFileSync(assembled, readFileSync(part));
      rmSync(part, { force: true });
    }
    renameSync(assembled, destination);
  } finally {
    for (const part of parts) {
      if (part) {
        rmSync(part, { force: true });
      }
    }
  }
}

async function downloadFrom(
  options: InstallOptions,
  fetcher: typeof fetch,
  url: string,
  destination: string,
  expectedBytes: number,
  label: string
): Promise<void> {
  mkdirSync(join(destination, '..'), { recursive: true });
  let probe: Response | undefined;
  try {
    probe = await fetcher(url, {
      headers: { Range: 'bytes=0-0' },
      signal: options.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)])
        : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      redirect: 'follow'
    });
  } catch (error) {
    if (options.signal?.aborted) {
      throw error;
    }
    probe = undefined;
  }
  if (probe) {
    if (!probe.ok) {
      await probe.body?.cancel().catch(() => undefined);
      throw new Error(`下载 ${label} 失败：HTTP ${probe.status}`);
    }
    const total = parseTotalFromRange(probe.headers.get('content-range'));
    await probe.body?.cancel().catch(() => undefined);
    if (probe.status === 206 && total !== undefined && total > 1024 * 1024) {
      await downloadChunks(options, fetcher, url, destination, total, label);
      return;
    }
  }
  await downloadSingle(options, fetcher, url, destination, expectedBytes, label);
}

async function downloadArchive(
  options: InstallOptions,
  sources: string[],
  destination: string,
  expectedBytes: number,
  label: string
): Promise<void> {
  const fetcher = options.fetchImpl ?? fetch;
  let lastError: unknown;
  for (const url of sources) {
    try {
      await downloadFrom(options, fetcher, url, destination, expectedBytes, label);
      return;
    } catch (error) {
      if (options.signal?.aborted) {
        throw new Error('已取消下载。');
      }
      lastError = error;
      if (sources.indexOf(url) < sources.length - 1) {
        report(options, 'download', `${label} 的当前镜像不可用，正在换下一个…`);
      }
    }
  }
  throw lastError ?? new Error(`下载 ${label} 失败。`);
}

function tarExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const bundled = join(systemRoot, 'System32', 'tar.exe');
  return existsSync(bundled) ? bundled : 'tar';
}

function powershellExecutable(): string {
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const bundled = join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(bundled) ? bundled : 'powershell.exe';
}

function runExtractor(executable: string, args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true });
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
      reject(new Error(`${executable} 退出码 ${code}${stderr.trim() ? `：${stderr.trim()}` : ''}`));
    });
  });
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Extracts the archive with the bundled `tar.exe` and falls back to
 * PowerShell's `Expand-Archive`.
 *
 * Windows only ships `tar.exe` since 10 1803; on older or trimmed-down
 * machines a download would otherwise unpack into nothing and report a bare
 * ENOENT. `Expand-Archive` exists since PowerShell 5 / .NET 4.5.
 */
async function extractWithTar(archive: string, destination: string): Promise<void> {
  mkdirSync(destination, { recursive: true });
  try {
    await runExtractor(tarExecutable(), ['-xf', archive, '-C', destination]);
    return;
  } catch (first) {
    try {
      await runExtractor(powershellExecutable(), [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        `Expand-Archive -LiteralPath ${quotePowerShell(archive)} -DestinationPath ${quotePowerShell(destination)} -Force`
      ]);
      return;
    } catch (second) {
      const primary = first instanceof Error ? first.message : String(first);
      const fallback = second instanceof Error ? second.message : String(second);
      throw new Error(`解压失败：${primary}；PowerShell 回退也失败：${fallback}`);
    }
  }
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
  await downloadArchive(options, ARM_GCC_SOURCES, archive, ARM_GCC_EXPECTED_BYTES, 'ARM GNU 工具链');
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
  await downloadArchive(options, OPENOCD_SOURCES, archive, OPENOCD_EXPECTED_BYTES, 'OpenOCD');
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
