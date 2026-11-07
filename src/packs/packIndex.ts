import { XMLParser } from 'fast-xml-parser';

export interface PackIndexEntry {
  vendorName: string;
}

export interface PackIndexPack {
  name: string;
  version: string;
  description: string;
  packUrl: string;
  vendorName: string;
}

export interface PackSearchOptions {
  /** Reuses the parsed pack index between searches. */
  cache?: Map<string, PackSearchCacheEntry>;
  signal?: AbortSignal;
}

export interface PackSearchCacheEntry {
  packs: PackIndexPack[];
  expiresAt: number;
}

/**
 * Minimal subset of the DOM fetch Response consumed here. The extension host
 * wraps its own fetch with an AbortController timeout; this module never
 * cancels requests on its own.
 */
export type FetchLike = (url: string) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

const packIndexUrl = 'https://www.keil.com/pack/keil.pidx';
const indexTtlMs = 5 * 60 * 1000;

type XmlNode = Record<string, unknown>;

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/**
 * Fetches keil.pidx and flattens its `<pindex><pdsc url vendor name version/>`
 * entries into direct Pack entries. The CMSIS naming convention resolves the
 * download URL as `<root><vendor>.<name>.<version>.pack`; keil.com serves
 * these under a 302 to its CDN. Entries missing any identity field are
 * skipped because there is no download URL to hand to the importer.
 */
export async function listPackIndexPacks(
  fetcher: FetchLike,
  cache?: Map<string, PackSearchCacheEntry>
): Promise<PackIndexPack[]> {
  const cached = cache?.get(packIndexUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.packs;
  }
  const response = await fetcher(packIndexUrl);
  if (!response.ok || response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to fetch pack index ${packIndexUrl}: HTTP ${response.status}`);
  }
  const document = xmlParser.parse(await response.text()) as unknown;
  const packs: PackIndexPack[] = [];
  for (const node of collectEntries(document, { pdsc: true })) {
    const url = textField(node, 'url');
    const vendor = textField(node, 'vendor');
    const name = textField(node, 'name');
    const version = textField(node, 'version');
    if (!url || !vendor || !name || !version) {
      continue;
    }
    const root = url.endsWith('/') ? url : `${url}/`;
    packs.push({
      name,
      version,
      description: '',
      packUrl: `${root}${vendor}.${name}.${version}.pack`,
      vendorName: vendor
    });
  }
  cache?.set(packIndexUrl, { packs, expiresAt: Date.now() + indexTtlMs });
  return packs;
}

/** Lists each vendor of the pack index once, in first-appearance order. */
export async function listPackVendors(
  fetcher: FetchLike,
  cache?: Map<string, PackSearchCacheEntry>
): Promise<PackIndexEntry[]> {
  const packs = await listPackIndexPacks(fetcher, cache);
  return [...new Set(packs.map((pack) => pack.vendorName))].map((vendorName) => ({ vendorName }));
}

/** Lists every version of one vendor's packs from the index. */
export async function listPacksForVendor(
  fetcher: FetchLike,
  vendorName: string,
  cache?: Map<string, PackSearchCacheEntry>
): Promise<PackIndexPack[]> {
  return (await listPackIndexPacks(fetcher, cache)).filter(
    (pack) => pack.vendorName === vendorName
  );
}

/** Case-insensitive substring search over vendor name, pack name, and description. */
export async function searchPacks(
  fetcher: FetchLike,
  keyword: string,
  options: PackSearchOptions = {}
): Promise<PackIndexPack[]> {
  if (options.signal?.aborted) {
    throw new Error('Pack search cancelled.');
  }
  const packs = await listPackIndexPacks(fetcher, options.cache);
  if (options.signal?.aborted) {
    throw new Error('Pack search cancelled.');
  }
  const needle = keyword.trim().toLowerCase();
  return packs
    .filter((pack) =>
      needle.length === 0 ||
      pack.vendorName.toLowerCase().includes(needle) ||
      pack.name.toLowerCase().includes(needle) ||
      pack.description.toLowerCase().includes(needle)
    )
    .sort((left, right) => (
      left.vendorName.localeCompare(right.vendorName)
      || left.name.localeCompare(right.name)
      || compareVersions(left.version, right.version)
    ));
}

function compareVersions(left: string, right: string): number {
  const a = left.split(/[._-]/).map((part) => Number(part) || 0);
  const b = right.split(/[._-]/).map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export async function downloadPack(fetcher: FetchLike, packUrl: string): Promise<Buffer> {
  const response = await fetcher(packUrl);
  if (!response.ok || response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to download pack ${packUrl}: HTTP ${response.status}`);
  }
  return Buffer.from(await response.arrayBuffer());
}

/** Reads a value from attribute (@_key), child element, or #text content. */
function textField(node: XmlNode, key: string): string | undefined {
  const raw = node[`@_${key}`] ?? node[key];
  if (raw === undefined || raw === null || typeof raw === 'object') {
    if (raw !== null && typeof raw === 'object') {
      const text = (raw as XmlNode)['#text'];
      if (typeof text === 'string') {
        return text;
      }
    }
    return undefined;
  }
  return String(raw);
}

function collectEntries(node: unknown, entryKeys: Record<string, true>, out: XmlNode[] = []): XmlNode[] {
  if (Array.isArray(node)) {
    for (const item of node) {
      collectEntries(item, entryKeys, out);
    }
    return out;
  }
  if (node === null || typeof node !== 'object') {
    return out;
  }
  for (const [key, value] of Object.entries(node)) {
    if (entryKeys[key]) {
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (item !== null && typeof item === 'object') {
          out.push(item as XmlNode);
        }
      }
      continue;
    }
    collectEntries(value, entryKeys, out);
  }
  return out;
}
