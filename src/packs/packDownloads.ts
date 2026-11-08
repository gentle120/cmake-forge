import type { FetchLike } from './fetchTypes';
import { isCancellationError, RequestTimeoutError } from './fetcher';

export interface DownloadProgress {
  /** Cumulative bytes received so far. */
  receivedBytes: number;
  /** Total archive size, when the transport declares it. */
  totalBytes?: number;
}

export interface DownloadOptions {
  signal?: AbortSignal;
  /** Reports cumulative progress; the downloader throttles the callbacks. */
  onProgress?: (progress: DownloadProgress) => void;
  /** Base URL of a Pack mirror; the archive file name is appended. */
  mirror?: string;
  /** Concurrent ranged requests used for large archives. */
  concurrency?: number;
}

const keilFrontDoor = 'https://www.keil.com/pack/';
const keilPackCdn = 'https://keilpack.azureedge.net/pack/';

/**
 * Archives under `www.keil.com/pack/` are a front door that answers with a 302 to
 * this CDN. Going through the front door costs an extra TCP+TLS round trip to a
 * host that is slow from mainland China, so the redirect target is used directly
 * and the front-door URL stays as the fallback.
 */
export function preferCdnUrl(packUrl: string): string {
  return packUrl.startsWith(keilFrontDoor)
    ? `${keilPackCdn}${packUrl.slice(keilFrontDoor.length)}`
    : packUrl;
}

/**
 * A mirror is a flat directory of `<vendor>.<name>.<version>.pack` archives, so
 * the URL becomes `<mirror>/<file name>`. Returns undefined when no mirror is
 * configured, letting the caller keep the index URL.
 */
export function mirrorUrl(packUrl: string, mirror: string | undefined): string | undefined {
  const base = mirror?.trim();
  if (!base) {
    return undefined;
  }
  const fileName = packUrl.split('/').pop();
  if (!fileName) {
    return undefined;
  }
  return `${base.replace(/\/+$/, '')}/${fileName}`;
}

/**
 * Download URLs in the order they are attempted: a configured mirror first, then
 * the CDN target, then the index URL exactly as published. Duplicates collapse so
 * an unmodified public URL is not fetched twice.
 */
export function downloadCandidates(packUrl: string, mirror?: string): string[] {
  const candidates = [mirrorUrl(packUrl, mirror), preferCdnUrl(packUrl), packUrl]
    .filter((url): url is string => typeof url === 'string' && url.length > 0);
  return [...new Set(candidates)];
}

/** Below this size one request beats the overhead of splitting the archive. */
const minimumParallelBytes = 2 * 1024 * 1024;
const defaultConcurrency = 8;
const chunkSize = 1024 * 1024;
/** Attempts per chunk before the whole download is abandoned. */
const chunkAttempts = 5;
/** Hard cap for a ranged download, so a bogus Content-Range cannot force a huge allocation. */
const maxArchiveBytes = 512 * 1024 * 1024;
/** Backoff before retrying a chunk, so a blip is not hammered through instantly. */
const chunkRetryDelayMs = 250;
/** Progress callbacks are throttled; more than ~10/s only floods the UI. */
const reportIntervalMs = 100;

type FetchResponse = Awaited<ReturnType<FetchLike>>;

function headerValue(response: FetchResponse, name: string): string {
  return response.headers?.get(name) ?? '';
}

function declaredLength(response: FetchResponse): number | undefined {
  const value = Number(headerValue(response, 'content-length'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Parses `bytes <start>-<end>/<total>` and returns the archive size. */
function rangedTotal(response: FetchResponse): number | undefined {
  const match = /\/(\d+)\s*$/.exec(headerValue(response, 'content-range'));
  const value = match ? Number(match[1]) : Number.NaN;
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function assertOk(response: FetchResponse, url: string): void {
  if (!response.ok || response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to download pack ${url}: HTTP ${response.status}`);
  }
}

function notCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new Error('Pack request cancelled.');
  }
}

/** Sleeps, rejecting as soon as the caller cancels. */
function delay(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error('Pack request cancelled.'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function guard<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return work;
  }
  if (signal.aborted) {
    return Promise.reject(new Error('Pack request cancelled.'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('Pack request cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}

/** Streams a response body into one buffer, reporting as chunks arrive. */
async function readBody(
  response: FetchResponse,
  options: DownloadOptions,
  totalBytes: number | undefined
): Promise<Buffer> {
  let received = 0;
  let lastReport = 0;
  const onChunk = (bytes: number): void => {
    received += bytes;
    const now = Date.now();
    if (now - lastReport >= reportIntervalMs) {
      lastReport = now;
      options.onProgress?.(totalBytes === undefined
        ? { receivedBytes: received }
        : { receivedBytes: received, totalBytes });
    }
  };

  const body = response.body;
  if (!body) {
    const buffer = Buffer.from(await guard(response.arrayBuffer(), options.signal));
    onChunk(buffer.length);
    options.onProgress?.(totalBytes === undefined
      ? { receivedBytes: buffer.length }
      : { receivedBytes: buffer.length, totalBytes });
    return buffer;
  }

  const reader = body.getReader();
  const parts: Buffer[] = [];
  try {
    for (;;) {
      notCancelled(options.signal);
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (value && value.length > 0) {
        parts.push(Buffer.from(value));
        onChunk(value.length);
      }
    }
  } finally {
    reader.releaseLock();
  }
  const buffer = Buffer.concat(parts);
  options.onProgress?.(totalBytes === undefined
    ? { receivedBytes: buffer.length }
    : { receivedBytes: buffer.length, totalBytes });
  return buffer;
}

/**
 * Concurrent ranged download of the chunks after the one already in hand.
 *
 * A single connection from mainland China is throttled hard enough that a 50 MB
 * DFP never finishes; eight ranged requests measured roughly 0.5 MB/s and do
 * complete. Each chunk is retried on its own, so a dropped connection costs one
 * chunk instead of the whole archive.
 */
async function downloadRanged(
  fetcher: FetchLike,
  url: string,
  options: DownloadOptions,
  totalBytes: number,
  head: Buffer
): Promise<Buffer> {
  const concurrency = Math.max(1, Math.min(Math.trunc(options.concurrency ?? defaultConcurrency), 16));
  // The archive size arrives from the server; refuse absurd values instead of
  // allocating an attacker- or corruption-controlled buffer up front.
  if (totalBytes > maxArchiveBytes) {
    throw new Error(`Pack 归档过大（${totalBytes} 字节），已超过 ${maxArchiveBytes} 字节上限。`);
  }
  const output = Buffer.alloc(totalBytes);
  head.copy(output, 0);

  const chunkCount = Math.ceil(totalBytes / chunkSize);
  const filled = new Uint8Array(chunkCount).fill(0);
  for (let index = 0; index * chunkSize < head.length; index += 1) {
    filled[index] = 1;
  }
  let received = head.length;
  let lastReport = 0;
  const publish = (): void => {
    options.onProgress?.({ receivedBytes: received, totalBytes });
  };
  publish();

  const ranges: Array<{ index: number; start: number; end: number }> = [];
  for (let start = head.length; start < totalBytes; start += chunkSize) {
    ranges.push({
      index: Math.floor(start / chunkSize),
      start,
      end: Math.min(start + chunkSize, totalBytes) - 1
    });
  }
  let next = 0;
  // One chunk failing three times abandons the archive; the remaining workers
  // must stop rather than keep pulling bytes nobody will use.
  let abandoned = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (abandoned) {
        return;
      }
      const range = ranges[next];
      next += 1;
      if (!range) {
        return;
      }
      let lastError: unknown;
      for (let attempt = 0; attempt < chunkAttempts; attempt += 1) {
        notCancelled(options.signal);
        try {
          const response = await fetcher(url, {
            signal: options.signal,
            headers: { Range: `bytes=${range.start}-${range.end}` }
          });
          if (response.status !== 206) {
            throw new Error(`Ranged download rejected for ${url}: HTTP ${response.status}`);
          }
          const body = Buffer.from(await guard(response.arrayBuffer(), options.signal));
          if (body.length !== range.end - range.start + 1) {
            throw new Error(`Short ranged response for ${url}`);
          }
          body.copy(output, range.start);
          filled[range.index] = 1;
          received += body.length;
          const now = Date.now();
          if (now - lastReport >= reportIntervalMs) {
            lastReport = now;
            publish();
          }
          lastError = undefined;
          break;
        } catch (error) {
          lastError = error;
          if (isCancellationError(error) || options.signal?.aborted) {
            throw error;
          }
          // A timeout already waited the full timeout window; retrying every
          // chunk would multiply it by the attempt count.
          if (error instanceof RequestTimeoutError) {
            throw error;
          }
          if (attempt < chunkAttempts - 1) {
            await delay(chunkRetryDelayMs * (attempt + 1), options.signal);
          }
        }
      }
      if (lastError !== undefined) {
        abandoned = true;
        throw lastError;
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  if (filled.some((value) => value === 0)) {
    throw new Error(`Incomplete ranged download for ${url}`);
  }
  publish();
  return output;
}

/**
 * One URL, one or more requests.
 *
 * The first request asks for a single chunk so it doubles as the capability
 * probe: a `206` reveals the archive size and enables the parallel tail, while a
 * `200` means the host ignored the range and the body is the whole archive. That
 * keeps the common small-Pack case at exactly one request.
 */
async function downloadFrom(
  fetcher: FetchLike,
  url: string,
  options: DownloadOptions
): Promise<Buffer> {
  const first = await fetcher(url, {
    signal: options.signal,
    headers: { Range: `bytes=0-${chunkSize - 1}` }
  });
  assertOk(first, url);

  if (first.status === 206) {
    const total = rangedTotal(first);
    if (total === undefined) {
      // A partial body with no declared size cannot be completed safely.
      throw new Error(`Ranged response without a total size for ${url}`);
    }
    const head = Buffer.from(await guard(first.arrayBuffer(), options.signal));
    if (head.length > total) {
      throw new Error(`Ranged response exceeded the declared size for ${url}`);
    }
    // The head is real progress even before the tail requests start; small
    // archives would otherwise jump straight from 0% to 100%.
    options.onProgress?.({ receivedBytes: head.length, totalBytes: total });
    if (head.length === total) {
      return head;
    }
    if (total < minimumParallelBytes) {
      // Small archive: the tail is one more ranged request, never a full re-read.
      const fetched = await fetcher(url, {
        signal: options.signal,
        headers: { Range: `bytes=${head.length}-${total - 1}` }
      });
      assertOk(fetched, url);
      const rest = Buffer.from(await guard(fetched.arrayBuffer(), options.signal));
      if (head.length + rest.length !== total) {
        throw new Error(`Incomplete download for ${url}`);
      }
      options.onProgress?.({ receivedBytes: total, totalBytes: total });
      return Buffer.concat([head, rest]);
    }
    try {
      return await downloadRanged(fetcher, url, options, total, head);
    } catch (error) {
      if (isCancellationError(error) || options.signal?.aborted) {
        throw error;
      }
      if (error instanceof RequestTimeoutError) {
        throw error;
      }
      // Many sockets dropped mid-archive: one streaming request is slow but
      // finishes, and it is the only remaining way to get the bytes.
      const retry = await fetcher(url, { signal: options.signal });
      assertOk(retry, url);
      const whole = await readBody(retry, options, total);
      if (whole.length !== total) {
        throw new Error(`Incomplete download for ${url}`);
      }
      return whole;
    }
  }

  // The host ignored the Range header and answered with the whole archive.
  return readBody(first, options, declaredLength(first));
}

/**
 * Downloads one Pack archive, trying the mirror, the CDN target, and the indexed
 * URL in order. Cancellation and timeouts stop immediately; any other failure
 * moves to the next candidate so a single dead host cannot block the install.
 */
export async function downloadPack(
  fetcher: FetchLike,
  packUrl: string,
  options: DownloadOptions = {}
): Promise<Buffer> {
  let lastError: unknown;
  // A failed candidate restarts its byte count from zero; the reported number
  // must not walk backwards when the next host is tried.
  let highWater = 0;
  for (const url of downloadCandidates(packUrl, options.mirror)) {
    notCancelled(options.signal);
    try {
      const forwarded: DownloadOptions = options.onProgress
        ? {
            ...options,
            onProgress: (progress) => {
              const total = progress.totalBytes;
              highWater = total === undefined
                ? Math.max(highWater, progress.receivedBytes)
                : Math.max(highWater, Math.min(progress.receivedBytes, total));
              options.onProgress?.(total === undefined
                ? { receivedBytes: highWater }
                : { receivedBytes: highWater, totalBytes: total });
            }
          }
        : options;
      return await downloadFrom(fetcher, url, forwarded);
    } catch (error) {
      if (isCancellationError(error) || options.signal?.aborted) {
        throw error;
      }
      if (error instanceof RequestTimeoutError) {
        throw error;
      }
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`Failed to download pack ${packUrl}`);
}

/** Human byte size: 512 B / 48.2 KB / 50.2 MB, with no trailing `.0`. */
export function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1;
  return `${value.toFixed(digits)} ${units[unit]}`;
}

/**
 * Progress copy for the notification: "4.2 MB / 50.2 MB（8%）", or just the
 * transferred size when the host never declared a total. The fraction drives the
 * progress bar, so a missing total leaves it as a spinner.
 */
export function describeDownloadProgress(progress: DownloadProgress): {
  message: string;
  fraction?: number;
} {
  const received = formatByteSize(progress.receivedBytes);
  const total = progress.totalBytes;
  if (total === undefined || total <= 0) {
    return { message: `已下载 ${received}` };
  }
  const ratio = Math.min(1, Math.max(0, progress.receivedBytes / total));
  return {
    message: `${received} / ${formatByteSize(total)}（${Math.floor(ratio * 100)}%）`,
    fraction: ratio
  };
}
