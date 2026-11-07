import assert from 'node:assert/strict';
import test from 'node:test';
import {
  describeDownloadProgress,
  downloadCandidates,
  downloadPack,
  formatByteSize,
  mirrorUrl,
  preferCdnUrl
} from '../packs/packDownloads';
import type { FetchLike } from '../packs/fetchTypes';

const keilPack = 'https://www.keil.com/pack/Keil.STM32F1xx_DFP.2.4.1.pack';
const keilCdn = 'https://keilpack.azureedge.net/pack/Keil.STM32F1xx_DFP.2.4.1.pack';
const gd32Pack = 'https://gd32mcu.com/data/documents/pack/GigaDevice.GD32F4xx_DFP.3.0.3.pack';

interface StubOptions {
  ok?: boolean;
  status?: number;
  body?: Uint8Array;
  headers?: Record<string, string>;
  /** Serve this many bytes per ranged request, ignoring the requested range. */
  rangeBody?: (start: number, end: number) => Uint8Array;
}

function headersOf(source: Record<string, string> = {}): { get(name: string): string | null } {
  const lowered = new Map(Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => lowered.get(name.toLowerCase()) ?? null };
}

/** Splits `bytes=a-b` into its bounds, so stubs can answer like a real CDN. */
function parseRange(value: string | undefined): { start: number; end: number } | undefined {
  const match = /^bytes=(\d+)-(\d+)$/.exec(value ?? '');
  if (!match) {
    return undefined;
  }
  return { start: Number(match[1]), end: Number(match[2]) };
}

interface Stub {
  fetcher: FetchLike;
  requests: Array<{ url: string; range?: string }>;
}

/** A fetcher keyed by URL; unknown URLs fail like a 404. */
function fetcherFor(stubs: Record<string, StubOptions>): Stub {
  const requests: Array<{ url: string; range?: string }> = [];
  const fetcher: FetchLike = async (url, init) => {
    const rangeHeader = init?.headers?.Range;
    requests.push({ url, range: rangeHeader });
    const stub = stubs[url];
    if (!stub) {
      return {
        ok: false,
        status: 404,
        headers: headersOf(),
        body: null,
        text: async () => '',
        arrayBuffer: async () => new ArrayBuffer(0)
      };
    }
    const status = stub.status ?? 200;
    const range = parseRange(rangeHeader);
    let body = stub.body ?? new Uint8Array();
    const headers: Record<string, string> = { ...(stub.headers ?? {}) };
    if (stub.rangeBody && range) {
      body = stub.rangeBody(range.start, range.end);
      headers['content-range'] = `bytes ${range.start}-${range.end}/${stub.body?.length ?? body.length}`;
    }
    headers['content-length'] = headers['content-length'] ?? String(body.length);
    return {
      ok: status >= 200 && status < 300,
      status,
      headers: headersOf(headers),
      body: null,
      text: async () => Buffer.from(body).toString('utf8'),
      arrayBuffer: async () => body.slice().buffer as ArrayBuffer
    };
  };
  return { fetcher, requests };
}

/** A full archive served the way a ranged-capable CDN serves it. */
function rangedArchive(totalSize: number, status = 206): StubOptions {
  const body = new Uint8Array(totalSize);
  for (let index = 0; index < totalSize; index += 1) {
    body[index] = index % 251;
  }
  return {
    status,
    body,
    rangeBody: (start, end) => body.slice(start, end + 1)
  };
}

test('rewrites the Keil front door to the CDN it redirects to', () => {
  assert.equal(preferCdnUrl(keilPack), keilCdn);
  // Vendor-hosted packs are already the real origin; they must not be rewritten.
  assert.equal(preferCdnUrl(gd32Pack), gd32Pack);
  assert.equal(
    preferCdnUrl('https://packs.example.com/vendor-pack/MS32.MS32F0xx_DFP.1.2.0.pack'),
    'https://packs.example.com/vendor-pack/MS32.MS32F0xx_DFP.1.2.0.pack'
  );
});

test('a mirror is addressed by the archive file name', () => {
  assert.equal(
    mirrorUrl(keilPack, 'https://mirror.example.com/cmsis'),
    'https://mirror.example.com/cmsis/Keil.STM32F1xx_DFP.2.4.1.pack'
  );
  // Trailing slashes must not produce a doubled separator.
  assert.equal(
    mirrorUrl(keilPack, 'https://mirror.example.com/cmsis/'),
    'https://mirror.example.com/cmsis/Keil.STM32F1xx_DFP.2.4.1.pack'
  );
  assert.equal(mirrorUrl(keilPack, '   '), undefined);
  assert.equal(mirrorUrl(keilPack, undefined), undefined);
});

test('candidates try the mirror, then the CDN, then the published URL', () => {
  assert.deepEqual(downloadCandidates(keilPack), [keilCdn, keilPack]);
  assert.deepEqual(downloadCandidates(keilPack, 'https://mirror.example.com/packs/'), [
    'https://mirror.example.com/packs/Keil.STM32F1xx_DFP.2.4.1.pack',
    keilCdn,
    keilPack
  ]);
  // A vendor URL has nothing to rewrite, so it is fetched exactly once.
  assert.deepEqual(downloadCandidates(gd32Pack), [gd32Pack]);
});

test('downloads the archive from the CDN without touching the front door', async () => {
  const { fetcher, requests } = fetcherFor({ [keilCdn]: rangedArchive(64) });

  const buffer = await downloadPack(fetcher, keilPack);

  assert.equal(buffer.length, 64);
  assert.deepEqual([...new Set(requests.map((entry) => entry.url))], [keilCdn]);
});

test('falls back to the published URL when the CDN refuses the archive', async () => {
  const { fetcher, requests } = fetcherFor({
    [keilCdn]: { status: 503 },
    [keilPack]: { body: new Uint8Array([9, 9, 9]), status: 200 }
  });

  const buffer = await downloadPack(fetcher, keilPack);

  assert.deepEqual([...buffer], [9, 9, 9]);
  const hosts = [...new Set(requests.map((entry) => entry.url))];
  assert.deepEqual(hosts, [keilCdn, keilPack]);
});

test('a configured mirror is preferred over the CDN', async () => {
  const mirrorPack = 'https://mirror.example.com/packs/Keil.STM32F1xx_DFP.2.4.1.pack';
  const { fetcher, requests } = fetcherFor({ [mirrorPack]: rangedArchive(32) });

  const buffer = await downloadPack(fetcher, keilPack, { mirror: 'https://mirror.example.com/packs' });

  assert.equal(buffer.length, 32);
  assert.equal(requests[0].url, mirrorPack);
});

test('a host that ignores Range still yields the whole archive', async () => {
  // A plain 200 response is the whole archive, not just the requested chunk.
  const body = new Uint8Array(10).fill(4);
  const { fetcher } = fetcherFor({ [keilCdn]: { body, status: 200 } });

  const buffer = await downloadPack(fetcher, keilPack);

  assert.equal(buffer.length, 10);
});

test('splits a large archive across ranged requests', async () => {
  // 3 MB crosses the parallel threshold; the stub answers 206 per chunk.
  const total = 3 * 1024 * 1024;
  const { fetcher, requests } = fetcherFor({ [keilCdn]: rangedArchive(total) });

  const buffer = await downloadPack(fetcher, keilPack);

  assert.equal(buffer.length, total);
  // Content must be reassembled in order, not merely sized correctly.
  assert.equal(buffer[0], 0);
  assert.equal(buffer[1024], 1024 % 251);
  assert.equal(buffer[total - 1], (total - 1) % 251);
  assert.ok(requests.length > 1, 'expected more than one ranged request');
  assert.ok(requests.every((entry) => entry.url === keilCdn));
});

test('a dropped chunk is retried without restarting the archive', async () => {
  // 3 MB split into chunks; the second ranged request fails twice, then succeeds.
  const total = 3 * 1024 * 1024;
  const archive = rangedArchive(total);
  const body = archive.body as Uint8Array;
  let rangedCalls = 0;
  const fetcher: FetchLike = async (_url, init) => {
    const range = parseRange(init?.headers?.Range);
    if (range && range.start > 0) {
      rangedCalls += 1;
      if (rangedCalls <= 2) {
        throw Object.assign(new Error('socket hang up'), { cause: { code: 'ECONNRESET' } });
      }
    }
    const slice = range ? body.slice(range.start, range.end + 1) : body;
    const headers: Record<string, string> = { 'content-length': String(slice.length) };
    if (range) {
      headers['content-range'] = `bytes ${range.start}-${range.end}/${total}`;
    }
    return {
      ok: true,
      status: range ? 206 : 200,
      headers: headersOf(headers),
      body: null,
      text: async () => '',
      arrayBuffer: async () => slice.slice().buffer as ArrayBuffer
    };
  };

  const buffer = await downloadPack(fetcher, keilPack);

  assert.equal(buffer.length, total);
  assert.ok(rangedCalls > 2, 'the failed chunk must be retried');
});

test('falls back to one streaming request when every chunk keeps failing', async () => {
  // Eight sockets dying repeatedly would drop the install entirely; a single
  // streaming request is slower but finishes, so it is the last resort.
  const total = 3 * 1024 * 1024;
  const archive = rangedArchive(total);
  const body = archive.body as Uint8Array;
  let rangedAttempts = 0;
  let streamingRequests = 0;
  const fetcher: FetchLike = async (_url, init) => {
    const range = parseRange(init?.headers?.Range);
    if (range && range.start > 0) {
      rangedAttempts += 1;
      throw Object.assign(new Error('socket hang up'), { cause: { code: 'ECONNRESET' } });
    }
    if (!range) {
      // The plain request the fallback makes.
      streamingRequests += 1;
      return {
        ok: true,
        status: 200,
        headers: headersOf({ 'content-length': String(total) }),
        body: null,
        text: async () => '',
        arrayBuffer: async () => body.slice().buffer as ArrayBuffer
      };
    }
    const head = body.slice(0, range.end + 1);
    return {
      ok: true,
      status: 206,
      headers: headersOf({
        'content-length': String(head.length),
        'content-range': `bytes 0-${head.length - 1}/${total}`
      }),
      body: null,
      text: async () => '',
      arrayBuffer: async () => head.slice().buffer as ArrayBuffer
    };
  };

  const buffer = await downloadPack(fetcher, keilPack);

  assert.equal(buffer.length, total);
  assert.ok(rangedAttempts >= 5, 'each chunk must be retried before giving up');
  assert.equal(streamingRequests, 1);
});

test('reports cumulative progress with the declared total', async () => {
  const { fetcher } = fetcherFor({ [keilCdn]: rangedArchive(128) });
  const seen: Array<{ receivedBytes: number; totalBytes?: number }> = [];

  await downloadPack(fetcher, keilPack, { onProgress: (progress) => seen.push(progress) });

  assert.ok(seen.length > 0);
  const last = seen[seen.length - 1];
  assert.equal(last.receivedBytes, 128);
  assert.equal(last.totalBytes, 128);
  for (let index = 1; index < seen.length; index += 1) {
    assert.ok(seen[index].receivedBytes >= seen[index - 1].receivedBytes);
  }
});

test('progress never walks backwards when a host is abandoned', async () => {
  // The mirror sends part of the archive and then dies; the CDN starts over at
  // zero. The user must not see the counter drop back.
  const total = 3 * 1024 * 1024;
  const archive = rangedArchive(total);
  const body = archive.body as Uint8Array;
  const mirrorPack = 'https://mirror.example.com/packs/Keil.STM32F1xx_DFP.2.4.1.pack';
  const fetcher: FetchLike = async (url, init) => {
    const range = parseRange(init?.headers?.Range);
    if (url === mirrorPack) {
      if (range && range.start === 0) {
        const head = body.slice(0, range.end + 1);
        return {
          ok: true,
          status: 206,
          headers: headersOf({
            'content-length': String(head.length),
            'content-range': `bytes 0-${head.length - 1}/${total}`
          }),
          body: null,
          text: async () => '',
          arrayBuffer: async () => head.slice().buffer as ArrayBuffer
        };
      }
      throw Object.assign(new Error('socket hang up'), { cause: { code: 'ECONNRESET' } });
    }
    const slice = range ? body.slice(range.start, range.end + 1) : body;
    const headers: Record<string, string> = { 'content-length': String(slice.length) };
    if (range) {
      headers['content-range'] = `bytes ${range.start}-${range.end}/${total}`;
    }
    return {
      ok: true,
      status: range ? 206 : 200,
      headers: headersOf(headers),
      body: null,
      text: async () => '',
      arrayBuffer: async () => slice.slice().buffer as ArrayBuffer
    };
  };
  const seen: number[] = [];

  const buffer = await downloadPack(fetcher, keilPack, {
    mirror: 'https://mirror.example.com/packs',
    onProgress: (progress) => seen.push(progress.receivedBytes)
  });

  assert.equal(buffer.length, total);
  for (let index = 1; index < seen.length; index += 1) {
    assert.ok(
      seen[index] >= seen[index - 1],
      `progress went backwards: ${seen[index - 1]} -> ${seen[index]}`
    );
  }
  assert.equal(seen[seen.length - 1], total);
});

test('a cancelled download stops instead of falling back to the next host', async () => {
  const controller = new AbortController();
  controller.abort();
  const { fetcher, requests } = fetcherFor({});

  await assert.rejects(downloadPack(fetcher, keilPack, { signal: controller.signal }), /cancelled/);
  assert.deepEqual(requests, []);
});

test('a failed mirror does not stop the install', async () => {
  const { fetcher } = fetcherFor({
    'https://mirror.example.com/packs/Keil.STM32F1xx_DFP.2.4.1.pack': { status: 404 },
    [keilCdn]: rangedArchive(16)
  });

  const buffer = await downloadPack(fetcher, keilPack, { mirror: 'https://mirror.example.com/packs' });

  assert.equal(buffer.length, 16);
});

test('formats byte sizes for the progress copy', () => {
  assert.equal(formatByteSize(0), '0 B');
  assert.equal(formatByteSize(512), '512 B');
  assert.equal(formatByteSize(1024), '1.0 KB');
  assert.equal(formatByteSize(48.2 * 1024), '48.2 KB');
  assert.equal(formatByteSize(50.2 * 1024 * 1024), '50.2 MB');
  assert.equal(formatByteSize(1024 * 1024 * 1024), '1.0 GB');
});

test('describes progress with and without a declared total', () => {
  const withTotal = describeDownloadProgress({ receivedBytes: 4 * 1024 * 1024, totalBytes: 50 * 1024 * 1024 });
  assert.match(withTotal.message, /4\.0 MB \/ 50\.0 MB/);
  assert.match(withTotal.message, /8%/);
  assert.ok(withTotal.fraction !== undefined && Math.abs(withTotal.fraction - 0.08) < 0.001);

  const withoutTotal = describeDownloadProgress({ receivedBytes: 2 * 1024 * 1024 });
  assert.equal(withoutTotal.message, '已下载 2.0 MB');
  assert.equal(withoutTotal.fraction, undefined);

  // A complete download reports 100%, never a rounding artefact above it.
  assert.match(
    describeDownloadProgress({ receivedBytes: 50 * 1024 * 1024, totalBytes: 50 * 1024 * 1024 }).message,
    /100%/
  );
});
