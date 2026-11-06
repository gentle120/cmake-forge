import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadPack,
  listPackVendors,
  listPacksForVendor,
  searchPacks,
  type FetchLike
} from '../packs/packIndex';

const PACK_INDEX_URL = 'https://www.keil.com/pack/keil.pidx';

interface FetchStub {
  ok: boolean;
  status: number;
  textBody?: string;
  binaryBody?: Uint8Array;
}

const packIndexXml = `<?xml version="1.0" encoding="utf-8"?>
<pidx schemaVersion="1.1">
  <vendor>
    <name>MS32</name>
    <url>https://packs.example.com/MS32.pdidx</url>
  </vendor>
  <vendor name="MindMotion" url="https://packs.example.com/MM32.pdidx"/>
  <vendor>
    <name>STMicro</name>
    <url lang="en">https://packs.example.com/ST.pdidx</url>
  </vendor>
  <vendor name="Duplicate" url="https://packs.example.com/MS32.pdidx"/>
  <releases>
    <url>https://packs.example.com/release-notes.html</url>
  </releases>
</pidx>`;

const ms32PdidxXml = `<?xml version="1.0" encoding="utf-8"?>
<pdidx schemaVersion="1.1">
  <pindex>
    <package name="MS32F0xx_DFP" version="1.2.0">
      <description>MS32F0xx Device Family Pack</description>
      <url>https://packs.example.com/MS32/MS32F0xx_DFP.1.2.0.pack</url>
    </package>
    <pdsc name="MS32F1xx_DFP" version="0.9.1" url="https://packs.example.com/MS32/MS32F1xx_DFP.0.9.1.pack"/>
    <package name="MS32F3xx_DFP" version="2.0.0">
      <description>Index entry without a direct pack link</description>
      <url>https://packs.example.com/MS32/MS32F3xx_DFP.pdsc</url>
    </package>
  </pindex>
</pdidx>`;

const mm32PdidxXml = `<?xml version="1.0" encoding="utf-8"?>
<pdidx>
  <pindex>
    <package name="MM32F5xx_DFP" version="3.1.4">
      <description>MindMotion MM32F5 series device support</description>
      <url>https://packs.example.com/MM32/MM32F5xx_DFP.3.1.4.pack</url>
    </package>
  </pindex>
</pdidx>`;

const packBytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);

function createFetcher(stubs: Record<string, FetchStub>): { fetcher: FetchLike; requestedUrls: string[] } {
  const requestedUrls: string[] = [];
  const fetcher: FetchLike = async (url) => {
    requestedUrls.push(url);
    const stub = stubs[url];
    if (!stub) {
      return { ok: false, status: 404, text: async () => '', arrayBuffer: async () => new ArrayBuffer(0) };
    }
    return {
      ok: stub.ok,
      status: stub.status,
      text: async () => stub.textBody ?? '',
      arrayBuffer: async () => (stub.binaryBody ?? new Uint8Array()).slice().buffer as ArrayBuffer
    };
  };
  return { fetcher, requestedUrls };
}

function indexStubs(): Record<string, FetchStub> {
  return {
    [PACK_INDEX_URL]: { ok: true, status: 200, textBody: packIndexXml },
    'https://packs.example.com/MS32.pdidx': { ok: true, status: 200, textBody: ms32PdidxXml },
    'https://packs.example.com/MM32.pdidx': { ok: true, status: 200, textBody: mm32PdidxXml }
  };
}

test('listPackVendors reads child-element, attribute, and text-node vendor entries', async () => {
  const { fetcher, requestedUrls } = createFetcher(indexStubs());
  const vendors = await listPackVendors(fetcher);
  assert.equal(requestedUrls[0], PACK_INDEX_URL);
  assert.deepEqual(vendors, [
    { vendorName: 'MS32', pdscUrl: 'https://packs.example.com/MS32.pdidx' },
    { vendorName: 'MindMotion', pdscUrl: 'https://packs.example.com/MM32.pdidx' },
    { vendorName: 'STMicro', pdscUrl: 'https://packs.example.com/ST.pdidx' }
  ]);
});

test('listPackVendors throws on non-2xx index responses', async () => {
  const { fetcher } = createFetcher({});
  await assert.rejects(listPackVendors(fetcher), /HTTP 404/);
});

test('listPacksForVendor keeps .pack entries and skips .pdsc-only entries', async () => {
  const { fetcher } = createFetcher(indexStubs());
  const packs = await listPacksForVendor(fetcher, {
    vendorName: 'MS32',
    pdscUrl: 'https://packs.example.com/MS32.pdidx'
  });
  assert.deepEqual(packs, [
    {
      name: 'MS32F0xx_DFP',
      version: '1.2.0',
      description: 'MS32F0xx Device Family Pack',
      packUrl: 'https://packs.example.com/MS32/MS32F0xx_DFP.1.2.0.pack',
      vendorName: 'MS32'
    },
    {
      name: 'MS32F1xx_DFP',
      version: '0.9.1',
      description: '',
      packUrl: 'https://packs.example.com/MS32/MS32F1xx_DFP.0.9.1.pack',
      vendorName: 'MS32'
    }
  ]);
});

test('listPacksForVendor throws when the vendor index is unavailable', async () => {
  const { fetcher } = createFetcher({});
  await assert.rejects(
    listPacksForVendor(fetcher, { vendorName: 'MS32', pdscUrl: 'https://packs.example.com/MS32.pdidx' }),
    /HTTP 404/
  );
});

test('searchPacks matches vendor name, pack name, and description case-insensitively', async () => {
  const { fetcher } = createFetcher(indexStubs());

  assert.equal((await searchPacks(fetcher, 'mindmotion')).length, 1);
  assert.equal((await searchPacks(fetcher, 'ms32f0')).length, 1);
  assert.equal((await searchPacks(fetcher, 'family pack')).length, 1);
  assert.equal((await searchPacks(fetcher, 'keil')).length, 0);
  assert.equal((await searchPacks(fetcher, '   ')).length, 3);
});

test('searchPacks keeps other vendors when one vendor index fails', async () => {
  const stubs = indexStubs();
  stubs['https://packs.example.com/MM32.pdidx'] = { ok: false, status: 503 };
  const { fetcher } = createFetcher(stubs);
  const packs = await searchPacks(fetcher, 'ms32');
  assert.equal(packs.length, 2);
});

test('downloadPack returns the raw pack bytes and rejects on non-2xx', async () => {
  const packUrl = 'https://packs.example.com/MS32/MS32F0xx_DFP.1.2.0.pack';
  const { fetcher } = createFetcher({
    [packUrl]: { ok: true, status: 200, binaryBody: packBytes }
  });
  const buffer = await downloadPack(fetcher, packUrl);
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(Buffer.from(packBytes).equals(buffer));

  await assert.rejects(downloadPack(fetcher, 'https://packs.example.com/missing.pack'), /HTTP 404/);
});

test('reuses cached vendor indexes and retains every available Pack version', async () => {
  const stubs = indexStubs();
  stubs['https://packs.example.com/MS32.pdidx'] = {
    ok: true,
    status: 200,
    textBody: ms32PdidxXml.replace(
      '</package>',
      '</package><package name="MS32F0xx_DFP" version="1.3.0"><url>https://packs.example.com/MS32/MS32F0xx_DFP.1.3.0.pack</url></package>'
    )
  };
  const { fetcher } = createFetcher(stubs);
  let vendorIndexRequests = 0;
  const counted: FetchLike = async (url) => {
    if (url.endsWith('.pdidx')) {
      vendorIndexRequests += 1;
    }
    return fetcher(url);
  };
  const options = { cache: new Map(), vendorCache: new Map(), now: () => 1000 };

  assert.equal((await searchPacks(counted, 'ms32', options)).length, 3);
  const requestsAfterFirstSearch = vendorIndexRequests;
  const second = await searchPacks(counted, 'ms32', options);

  assert.equal(vendorIndexRequests > requestsAfterFirstSearch, true);
  assert.deepEqual(
    second.map((pack) => pack.version),
    ['1.2.0', '1.3.0', '0.9.1']
  );
});

test('limits concurrent vendor index requests', async () => {
  let active = 0;
  let peak = 0;
  const fetcher: FetchLike = async (url) => {
    if (url.endsWith('keil.pidx')) {
      return { ok: true, status: 200, text: async () => packIndexXml, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    active += 1;
    peak = Math.max(peak, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1;
    return { ok: true, status: 200, text: async () => ms32PdidxXml, arrayBuffer: async () => new ArrayBuffer(0) };
  };

  await searchPacks(fetcher, 'ms32', { concurrency: 2, cache: new Map() });
  assert.ok(peak <= 2, `peak concurrency was ${peak}`);
});

test('stops starting vendor requests after cancellation', async () => {
  const controller = new AbortController();
  let requests = 0;
  const fetcher: FetchLike = async (url) => {
    if (url.endsWith('keil.pidx')) {
      return { ok: true, status: 200, text: async () => packIndexXml, arrayBuffer: async () => new ArrayBuffer(0) };
    }
    requests += 1;
    controller.abort();
    return { ok: true, status: 200, text: async () => ms32PdidxXml, arrayBuffer: async () => new ArrayBuffer(0) };
  };

  await assert.rejects(
    () => searchPacks(fetcher, 'ms32', { signal: controller.signal, concurrency: 1, cache: new Map() }),
    /cancelled/
  );
  assert.equal(requests, 1);
});
