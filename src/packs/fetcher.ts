import type { FetchLike } from './packIndex';

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

/**
 * Reports whether a failure is the user cancelling, not a real fault.
 *
 * Cancelling a progress notification rejects the awaited request with an
 * `AbortError` (or the guard's own cancellation message), and that must reach the
 * user as "cancelled" rather than as an error.
 */
export function isCancellationError(error: unknown): boolean {
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
 * Fetch wrapper with a fixed per-attempt timeout, an optional caller signal, and
 * one retry for connection-level failures.
 *
 * The caller's signal must abort the in-flight request: cancelling a progress
 * notification otherwise leaves a large pack download running to completion.
 */
export function createTimeoutFetcher(
  timeoutMs: number,
  fetchImpl: typeof fetch = fetch
): FetchLike {
  return async (url, signal) => {
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const forwardAbort = (): void => controller.abort();
      if (signal) {
        if (signal.aborted) {
          controller.abort();
        } else {
          signal.addEventListener('abort', forwardAbort, { once: true });
        }
      }
      try {
        return await fetchImpl(url, { signal: controller.signal });
      } catch (error) {
        if (attempt >= 1 || signal?.aborted || !isTransientNetworkError(error)) {
          throw error;
        }
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener('abort', forwardAbort);
      }
    }
  };
}
