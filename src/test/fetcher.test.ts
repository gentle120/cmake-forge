import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTimeoutFetcher,
  describeTimeout,
  isCancellationError,
  isTransientNetworkError,
  RequestTimeoutError
} from '../packs/fetcher';

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

test('recognises a user cancellation apart from a real failure', () => {
  assert.equal(isCancellationError(Object.assign(new Error('aborted'), { name: 'AbortError' })), true);
  assert.equal(isCancellationError(new Error('Pack search cancelled.')), true);
  assert.equal(isCancellationError(new Error('Pack request cancelled.')), true);
  assert.equal(isCancellationError(new Error('This operation was aborted')), true);
  assert.equal(isCancellationError(new Error('fetch failed')), false);
  assert.equal(isCancellationError(new Error('HTTP 404')), false);
  assert.equal(isCancellationError(undefined), false);
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

/** A fetch that never answers, so only the wrapper's own timer can settle it. */
function hangingFetch(): typeof fetch {
  return ((_url: string, init?: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
    }, { once: true });
  })) as unknown as typeof fetch;
}

test('the fetcher timeout is a failure, not a user cancellation', async () => {
  const fetcher = createTimeoutFetcher(20, hangingFetch());

  const error = await fetcher('https://example.test/pack').then(() => undefined, (reason) => reason);

  assert.ok(error instanceof RequestTimeoutError);
  assert.equal(error.name, 'RequestTimeoutError');
  // The shared AbortError must never reach the "cancelled" branch.
  assert.equal(isCancellationError(error), false);
  assert.equal(isTransientNetworkError(error), false);
});

test('a timeout is not retried', async () => {
  let attempts = 0;
  const hanging = ((_url: string, init?: { signal?: AbortSignal }) => {
    attempts += 1;
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('This operation was aborted'), { name: 'AbortError' }));
      }, { once: true });
    });
  }) as unknown as typeof fetch;

  await assert.rejects(createTimeoutFetcher(20, hanging)('https://example.test/pack'), RequestTimeoutError);
  assert.equal(attempts, 1);
});

test('a caller cancellation still aborts and stays a cancellation', async () => {
  const controller = new AbortController();
  const pending = createTimeoutFetcher(60_000, hangingFetch())(
    'https://example.test/pack',
    controller.signal
  );
  controller.abort();

  const error = await pending.then(() => undefined, (reason) => reason);
  assert.notEqual(error, null);
  assert.equal(error instanceof RequestTimeoutError, false);
  assert.equal(isCancellationError(error), true);
});

test('describes how long the timeout waited in user-facing copy', () => {
  assert.match(describeTimeout(new RequestTimeoutError(30_000)), /30 秒/);
  assert.match(describeTimeout(new RequestTimeoutError(600_000)), /10 分钟/);
  assert.match(describeTimeout(new RequestTimeoutError(500)), /500 毫秒/);
});
