import assert from 'node:assert/strict';
import test from 'node:test';
import { createTimeoutFetcher, isTransientNetworkError } from '../packs/fetcher';

function networkError(code: string): Error {
  return Object.assign(new Error('fetch failed'), { cause: { code } });
}

test('a transient connection failure is retried once', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    if (attempts === 1) {
      throw networkError('UND_ERR_CONNECT_TIMEOUT');
    }
    return { ok: true, status: 200, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
  };

  const fetcher = createTimeoutFetcher(1000, fetchImpl as unknown as typeof fetch);
  const response = await fetcher('https://example.test/index.pidx');

  assert.equal(response.status, 200);
  assert.equal(attempts, 2);
});

test('a cancellation is never retried', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  };
  const controller = new AbortController();
  controller.abort();

  const fetcher = createTimeoutFetcher(1000, fetchImpl as unknown as typeof fetch);
  await assert.rejects(fetcher('https://example.test/pack', controller.signal), /aborted/);
  assert.equal(attempts, 1);
});

test('a non-transient failure is not retried', async () => {
  let attempts = 0;
  const fetchImpl = async () => {
    attempts += 1;
    throw networkError('ENOTFOUND');
  };

  const fetcher = createTimeoutFetcher(1000, fetchImpl as unknown as typeof fetch);
  await assert.rejects(fetcher('https://example.test/pack'), /fetch failed/);
  assert.equal(attempts, 1);
});

test('only connection-level codes count as transient', () => {
  assert.equal(isTransientNetworkError(networkError('ECONNRESET')), true);
  assert.equal(isTransientNetworkError(networkError('EAI_AGAIN')), true);
  assert.equal(isTransientNetworkError(networkError('ENOTFOUND')), false);
  assert.equal(isTransientNetworkError(Object.assign(new Error('x'), { name: 'AbortError' })), false);
  assert.equal(isTransientNetworkError(new Error('boom')), false);
});

test('the caller signal aborts the in-flight request', async () => {
  const controller = new AbortController();
  let receivedSignal: AbortSignal | undefined;
  const fetchImpl = (_url: string, init?: { signal?: AbortSignal }) => {
    receivedSignal = init?.signal;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
      }, { once: true });
    });
  };

  const fetcher = createTimeoutFetcher(60_000, fetchImpl as unknown as typeof fetch);
  const pending = fetcher('https://example.test/pack', controller.signal);
  controller.abort();

  await assert.rejects(pending, /aborted/);
  assert.equal(receivedSignal?.aborted, true);
});
