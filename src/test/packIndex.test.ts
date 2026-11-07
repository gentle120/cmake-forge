import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listPackIndexPacks,
  searchPacks,
  selectPacksForSelection,
  type FetchLike
} from '../packs/packIndex';

const PACK_INDEX_URL = 'https://www.keil.com/pack/index.pidx';
// The reader prefers the origin host the front door redirects to.
const INDEX_ORIGIN_URL = 'https://sadevicepacksdqaus.blob.core.windows.net/idxfile/index.pidx';

interface FetchStub {
  ok: boolean;
  status: number;
  textBody?: string;
  binaryBody?: Uint8Array;
  headers?: Record<string, string>;
}

function headersOf(source: Record<string, string> = {}): { get(name: string): string | null } {
  const lowered = new Map(Object.entries(source).map(([key, value]) => [key.toLowerCase(), value]));
  return { get: (name) => lowered.get(name.toLowerCase()) ?? null };
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
    <pdsc url="https://gd32mcu.com/data/documents/pack/" vendor="GigaDevice" name="GD32F10x_DFP" version="2.0.3" />
    <pdsc url="https://gd32mcu.com/data/documents/pack/" vendor="GigaDevice" name="GD32F30x_DFP" version="2.2.1" />
    <pdsc url="https://gd32mcu.com/data/documents/pack/" vendor="GigaDevice" name="GD32F4xx_DFP" version="3.0.3" />
    <pdsc url="https://www.keil.com/pack/" vendor="Keil" name="STM32F1xx_DFP" version="2.4.1" />
  </pindex>
</index>`;

function response(
  stub: FetchStub | undefined
): Awaited<ReturnType<FetchLike>> {
  return {
    ok: stub?.ok ?? false,
    status: stub?.status ?? 404,
    headers: headersOf(stub?.headers),
    body: null,
    text: async () => stub?.textBody ?? '',
    arrayBuffer: async () => (stub?.binaryBody ?? new Uint8Array()).slice().buffer as ArrayBuffer
  };
}

function createFetcher(stubs: Record<string, FetchStub>): { fetcher: FetchLike; requestedUrls: string[] } {
  const requestedUrls: string[] = [];
  const fetcher: FetchLike = async (url) => {
    requestedUrls.push(url);
    return response(stubs[url]);
  };
  return { fetcher, requestedUrls };
}

function indexStubs(): Record<string, FetchStub> {
  return { [INDEX_ORIGIN_URL]: { ok: true, status: 200, textBody: packIndexXml } };
}

test('listPackIndexPacks flattens pindex pdsc entries into downloadable packs', async () => {
  const { fetcher, requestedUrls } = createFetcher(indexStubs());
  const packs = await listPackIndexPacks(fetcher);

  // The complete public index carries vendor-hosted packs, not just Keil's own.
  assert.deepEqual(requestedUrls, [INDEX_ORIGIN_URL]);
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
  const vendorHosted = packs.find((pack) => pack.name === 'GD32F10x_DFP');
  assert.equal(
    vendorHosted?.packUrl,
    'https://gd32mcu.com/data/documents/pack/GigaDevice.GD32F10x_DFP.2.0.3.pack'
  );
});

test('deprecated index entries are not offered', async () => {
  const { fetcher } = createFetcher(indexStubs());
  const packs = await listPackIndexPacks(fetcher);
  assert.equal(packs.some((pack) => pack.name === 'MCB1500_BSP'), false);
});

test('index responses that are not 2xx are rejected', async () => {
  const { fetcher } = createFetcher({});
  await assert.rejects(listPackIndexPacks(fetcher), /HTTP 404/);
});

test('selectPacksForSelection prefers the named DFP of the selected series', async () => {
  const { fetcher } = createFetcher(indexStubs());
  const packs = await listPackIndexPacks(fetcher);

  // GD32 F4x is served by GD32F4xx_DFP, whichever pack version is newest.
  assert.deepEqual(
    selectPacksForSelection(packs, 'GigaDevice', 'GD32F4xx_DFP').map((pack) => [pack.name, pack.version]),
    [['GD32F4xx_DFP', '3.0.3']]
  );
  // A named DFP wins even when it is published under another vendor, as ST's
  // STM32F1xx_DFP is published by Keil.
  assert.deepEqual(
    selectPacksForSelection(packs, 'STMicroelectronics', 'STM32F1xx_DFP')
      .map((pack) => `${pack.vendorName}.${pack.name}`),
    ['Keil.STM32F1xx_DFP']
  );
});

test('selectPacksForSelection falls back to every pack of the vendor', async () => {
  const { fetcher } = createFetcher(indexStubs());
  const packs = await listPackIndexPacks(fetcher);

  // Without a catalog entry for the series, every vendor pack stays selectable,
  // newest version first.
  assert.deepEqual(
    selectPacksForSelection(packs, 'GigaDevice').map((pack) => pack.name),
    ['GD32F10x_DFP', 'GD32F30x_DFP', 'GD32F4xx_DFP']
  );
  assert.deepEqual(selectPacksForSelection(packs, 'UnknownVendor'), []);
});

test('searchPacks matches vendor name, pack name, and version case-insensitively', async () => {
  const { fetcher } = createFetcher(indexStubs());

  assert.equal((await searchPacks(fetcher, 'keil')).length, 4);
  assert.equal((await searchPacks(fetcher, 'tm4c')).length, 2);
  assert.equal((await searchPacks(fetcher, 'cmsis')).length, 1);
  assert.equal((await searchPacks(fetcher, 'gd32f')).length, 3);
  assert.equal((await searchPacks(fetcher, '   ')).length, 10);
});

test('searchPacks reuses a cached index between calls', async () => {
  const { fetcher, requestedUrls } = createFetcher(indexStubs());
  const cache = new Map();

  await searchPacks(fetcher, 'keil', { cache });
  await searchPacks(fetcher, 'tm4c', { cache });

  assert.deepEqual(requestedUrls, [INDEX_ORIGIN_URL]);
});

test('searchPacks passes its signal to the fetcher and stops on abort', async () => {
  const signals: Array<AbortSignal | undefined> = [];
  const fetcher: FetchLike = async (_url, init) => {
    signals.push(init?.signal);
    // A fetcher that honours the signal rejects like fetch does.
    throw Object.assign(new Error('This operation was aborted'), { name: 'AbortError' });
  };
  const controller = new AbortController();

  await assert.rejects(
    searchPacks(fetcher, 'keil', { signal: controller.signal }),
    /aborted/
  );
  assert.equal(signals.length, 1);
  assert.equal(signals[0], controller.signal);
});

test('falls back to the front door when the index origin fails', async () => {
  // Both hosts serve identical bytes, so one dead origin must not fail the search.
  const { fetcher, requestedUrls } = createFetcher({
    [INDEX_ORIGIN_URL]: { ok: false, status: 503 },
    [PACK_INDEX_URL]: { ok: true, status: 200, textBody: packIndexXml }
  });

  const packs = await listPackIndexPacks(fetcher);

  assert.equal(packs.length > 0, true);
  assert.deepEqual(requestedUrls, [INDEX_ORIGIN_URL, PACK_INDEX_URL]);
});

test('a cancelled index read does not try the remaining origin', async () => {
  const controller = new AbortController();
  controller.abort();
  const { fetcher, requestedUrls } = createFetcher(indexStubs());

  await assert.rejects(listPackIndexPacks(fetcher, undefined, controller.signal), /cancelled/);
  assert.deepEqual(requestedUrls, []);
});

test('searchPacks throws before fetching when already cancelled', async () => {
  const { fetcher, requestedUrls } = createFetcher(indexStubs());
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(searchPacks(fetcher, 'keil', { signal: controller.signal }), /cancelled/);
  assert.deepEqual(requestedUrls, []);
});

test('repeated index entries are collapsed', async () => {
  const duplicated = packIndexXml.replace(
    '  </pindex>',
    '    <pdsc url="https://gd32mcu.com/data/documents/pack/" vendor="GigaDevice" '
    + 'name="GD32F4xx_DFP" version="3.0.3" />\n  </pindex>'
  );
  const { fetcher } = createFetcher({
    [INDEX_ORIGIN_URL]: { ok: true, status: 200, textBody: duplicated }
  });

  const packs = await listPackIndexPacks(fetcher);
  const identities = packs.map((pack) => `${pack.vendorName}.${pack.name}.${pack.version}`);
  assert.equal(new Set(identities).size, identities.length);
  assert.equal(packs.filter((pack) => pack.name === 'GD32F4xx_DFP').length, 1);
});
