import assert from 'node:assert/strict';
import test from 'node:test';
import {
  downloadPack,
  listPackIndexPacks,
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

/** The format keil.com has served since 2026: <pindex> with direct <pdsc> entries. */
const packIndexXml = `<?xml version="1.0" encoding="UTF-8" ?>
<index schemaVersion="1.1.0">
  <vendor>Keil</vendor>
  <url>https://www.keil.com/pack/</url>
  <timestamp>2026-11-05T07:37:17+00:00</timestamp>
  <pindex>
    <pdsc url="https://www.keil.com/pack/" vendor="Keil" name="ARM_Compiler" version="1.7.2" />
    <pdsc url="http://www.keil.com/pack/" vendor="Keil" name="TM4C_DFP" version="1.1.0" />
    <pdsc url="https://www.keil.com/pack/" vendor="Keil" name="TM4C_DFP" version="1.2.0" />
    <pdsc url="https://www.keil.com/pack/" vendor="ARM" name="CMSIS" version="6.3.0" />
    <pdsc url="https://packs.example.com/vendor-pack/" vendor="MS32" name="MS32F0xx_DFP" version="1.2.0" />
    <pdsc url="https://www.keil.com/pack" vendor="NoSlash" name="Example_DFP" version="2.0.0" />
    <pdsc url="https://www.keil.com/pack/" vendor="Keil" name="MCB1500_BSP" version="1.2.0" deprecated="2021-10-28" />
  </pindex>
</index>`;

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
  return { [PACK_INDEX_URL]: { ok: true, status: 200, textBody: packIndexXml } };
}

test('listPackIndexPacks flattens pindex pdsc entries into downloadable packs', async () => {
  const { fetcher, requestedUrls } = createFetcher(indexStubs());
  const packs = await listPackIndexPacks(fetcher);

  assert.deepEqual(requestedUrls, [PACK_INDEX_URL]);
  // The CMSIS naming convention resolves the direct pack download URL, with a
  // slash inserted when the index root lacks one.
  assert.deepEqual(packs.slice(0, 2), [
    {
      name: 'ARM_Compiler',
      version: '1.7.2',
      description: '',
      packUrl: 'https://www.keil.com/pack/Keil.ARM_Compiler.1.7.2.pack',
      vendorName: 'Keil'
    },
    {
      name: 'TM4C_DFP',
      version: '1.1.0',
      description: '',
      packUrl: 'http://www.keil.com/pack/Keil.TM4C_DFP.1.1.0.pack',
      vendorName: 'Keil'
    }
  ]);
  const noSlash = packs.find((pack) => pack.vendorName === 'NoSlash');
  assert.equal(noSlash?.packUrl, 'https://www.keil.com/pack/NoSlash.Example_DFP.2.0.0.pack');
});

test('listPackVendors lists each index vendor once', async () => {
  const { fetcher } = createFetcher(indexStubs());
  const vendors = await listPackVendors(fetcher);

  assert.deepEqual(
    vendors.map((vendor) => vendor.vendorName),
    ['Keil', 'ARM', 'MS32', 'NoSlash']
  );
});

test('listPackVendors throws on non-2xx index responses', async () => {
  const { fetcher } = createFetcher({});
  await assert.rejects(listPackVendors(fetcher), /HTTP 404/);
});

test('listPacksForVendor keeps every version of the selected vendor', async () => {
  const { fetcher } = createFetcher(indexStubs());
  const packs = await listPacksForVendor(fetcher, 'Keil');

  assert.deepEqual(packs.map((pack) => [pack.name, pack.version]), [
    ['ARM_Compiler', '1.7.2'],
    ['TM4C_DFP', '1.1.0'],
    ['TM4C_DFP', '1.2.0'],
    ['MCB1500_BSP', '1.2.0']
  ]);
});

test('searchPacks matches vendor name, pack name, and version case-insensitively', async () => {
  const { fetcher } = createFetcher(indexStubs());

  assert.equal((await searchPacks(fetcher, 'keil')).length, 4);
  assert.equal((await searchPacks(fetcher, 'tm4c')).length, 2);
  assert.equal((await searchPacks(fetcher, 'cmsis')).length, 1);
  assert.equal((await searchPacks(fetcher, '   ')).length, 7);
});

test('searchPacks reuses a cached index between calls', async () => {
  const { fetcher, requestedUrls } = createFetcher(indexStubs());
  const cache = new Map();
  const options = { cache, now: () => 1000 };

  await searchPacks(fetcher, 'keil', options);
  await searchPacks(fetcher, 'tm4c', options);

  assert.deepEqual(requestedUrls, [PACK_INDEX_URL]);
});

test('downloadPack returns the raw pack bytes and rejects on non-2xx', async () => {
  const packUrl = 'https://www.keil.com/pack/Keil.ARM_Compiler.1.7.2.pack';
  const { fetcher } = createFetcher({
    [packUrl]: { ok: true, status: 200, binaryBody: packBytes }
  });
  const buffer = await downloadPack(fetcher, packUrl);
  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(Buffer.from(packBytes).equals(buffer));

  await assert.rejects(downloadPack(fetcher, 'https://www.keil.com/pack/missing.pack'), /HTTP 404/);
});
