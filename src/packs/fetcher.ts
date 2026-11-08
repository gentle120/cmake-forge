import type { FetchLike, FetchResponseBody, FetchResponseLike } from './fetchTypes';

/**
 * Connection-level failures worth one more attempt. The CMSIS index host and the
 * Keil pack CDN intermittently refuse or reset TCP connections; a single failed
 * connect should not fail a whole install.
 */
const transientErrorCodes = new Set([
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'ECONNRESET',
  'ECONNREFUSED',
  'ECONNABORTED',
  'EPIPE',
  'EAI_AGAIN',
  'ETIMEDOUT'
]);

export function isTransientNetworkError(error: unknown): boolean {
  // A cancellation is never retried: the user asked for the work to stop.
  if (isCancellationError(error)) {
    return false;
  }
  const code = (error as { cause?: { code?: string } } | undefined)?.cause?.code
    ?? (error as { code?: string } | undefined)?.code
    ?? '';
  return transientErrorCodes.has(code);
}

/** Raised when the fetcher's own attempt timeout expires. */
export class RequestTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super('请求超时。');
    this.name = 'RequestTimeoutError';
  }
}

export function describeTimeout(error: RequestTimeoutError): string {
  const ms = error.timeoutMs;
  const waited = ms >= 60000
    ? `${Math.round(ms / 60000)} 分钟`
    : ms >= 1000
      ? `${Math.round(ms / 1000)} 秒`
      : `${ms} 毫秒`;
  return `在线索引或厂商下载站在 ${waited}内没有响应`;
}

/**
 * Reports whether a failure is the user cancelling, not a real fault.
 *
 * Cancelling a progress notification rejects the awaited request with an
 * `AbortError` (or the guard's own cancellation message), and that must reach the
 * user as "cancelled" rather than as an error.
 *
 * A timeout must NOT be reported as a cancellation: the fetcher aborts with the
 * same `AbortError` when its own timer fires, so the timer path is converted to
 * `RequestTimeoutError` before this ever sees it.
 */
export function isCancellationError(error: unknown): boolean {
  if (error instanceof RequestTimeoutError) {
    return false;
  }
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.name === 'AbortError') {
    return true;
  }
  return /^(Pack search cancelled\.|Pack request cancelled\.|This operation was aborted|The operation was aborted\.?)$/
    .test(error.message.trim());
}

/**
 * Fetch wrapper with a fixed per-attempt timeout, a caller signal, and one retry
 * for connection-level failures.
 *
 * The caller's signal must abort the in-flight request: cancelling a progress
 * notification otherwise leaves a large pack download running to completion.
 */
export function createTimeoutFetcher(
  timeoutMs: number,
  fetchImpl: FetchLike = defaultFetch
): FetchLike {
  return async (url, init) => {
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const forwardAbort = (): void => controller.abort();
      const callerSignal = init?.signal;
      if (callerSignal) {
        if (callerSignal.aborted) {
          controller.abort();
        } else {
          callerSignal.addEventListener('abort', forwardAbort, { once: true });
        }
      }
      let cleanedUp = false;
      const cleanup = (): void => {
        if (cleanedUp) {
          return;
        }
        cleanedUp = true;
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', forwardAbort);
      };
      try {
        const response = await fetchImpl(url, { ...init, signal: controller.signal });
        // fetch() resolves on the response headers. Keep the timeout armed until
        // the body is actually consumed, otherwise a stalled transfer hangs.
        return watchResponseBody(response, timeoutMs, () => timedOut, cleanup);
      } catch (error) {
        cleanup();
        // A timeout is a failure, not a user action: convert it before anyone can
        // mistake the shared AbortError for a cancellation.
        if (timedOut && !callerSignal?.aborted) {
          throw new RequestTimeoutError(timeoutMs);
        }
        if (attempt >= 1 || callerSignal?.aborted || !isTransientNetworkError(error)) {
          throw error;
        }
      } finally {
        // Covers paths that never reached a returned response (already cleaned up
        // idempotently). A returned response keeps the timer until its body ends.
        if (timedOut || callerSignal?.aborted) {
          cleanup();
        }
      }
    }
  };
}

/**
 * Wraps the body accessors so the request timeout also covers the transfer.
 *
 * `fetch` resolves as soon as headers arrive; without the wrappers the timer
 * would be cleared while the payload is still arriving and a stalled body could
 * hang the install forever.
 */
function watchResponseBody(
  response: FetchResponseLike,
  timeoutMs: number,
  timedOut: () => boolean,
  cleanup: () => void
): FetchResponseLike {
  const guard = async <T>(work: Promise<T>): Promise<T> => {
    try {
      return await work;
    } catch (error) {
      if (timedOut() && !(error instanceof RequestTimeoutError)) {
        throw new RequestTimeoutError(timeoutMs);
      }
      throw error;
    } finally {
      cleanup();
    }
  };
  const body = response.body;
  let reader: ReturnType<FetchResponseBody['getReader']> | undefined;
  return {
    ...response,
    body: body ? {
      getReader() {
        reader = reader ?? body.getReader();
        const current = reader;
        return {
          read: () => guard(current.read()),
          releaseLock: () => current.releaseLock()
        };
      }
    } : null,
    text: () => guard(response.text()),
    arrayBuffer: () => guard(response.arrayBuffer())
  };
}

/** Adapts the platform `fetch` to the narrow response shape used here. */
const defaultFetch: FetchLike = (url, init) =>
  fetch(url, init) as unknown as ReturnType<FetchLike>;
