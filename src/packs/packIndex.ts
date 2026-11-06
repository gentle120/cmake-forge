import { XMLParser } from 'fast-xml-parser';

export interface PackIndexEntry {
  vendorName: string;
  pdscUrl: string;
}

export interface PackIndexPack {
  name: string;
  version: string;
  description: string;
  packUrl: string;
  vendorName: string;
}

export interface PackSearchOptions {
  /** Reuses parsed vendor pack indexes between searches. */
  cache?: Map<string, PackSearchCacheEntry>;
  /** Optional cache for the vendor index itself. */
  vendorCache?: Map<string, VendorCacheEntry>;
  /** Limits simultaneous vendor index requests. */
  concurrency?: number;
  signal?: AbortSignal;
  /** Cache freshness in milliseconds. */
  ttlMs?: number;
  now?: () => number;
}

export interface PackSearchCacheEntry {
  packs: PackIndexPack[];
  expiresAt: number;
}

export interface VendorCacheEntry {
  vendors: PackIndexEntry[];
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

type XmlNode = Record<string, unknown>;

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** Fetches the keil.com vendor index (keil.pidx). */
export async function listPackVendors(fetcher: FetchLike): Promise<PackIndexEntry[]> {
  const response = await fetcher(packIndexUrl);
  if (!response.ok || response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to fetch pack vendor index ${packIndexUrl}: HTTP ${response.status}`);
  }
  const document = xmlParser.parse(await response.text()) as unknown;
  const entries: PackIndexEntry[] = [];
  const seen = new Set<string>();
  walkNodes(document, (node) => {
    // Vendor entries appear both as child elements (<name>/<url>) and as
    // attributes (name="..."/url="..."); anything else carrying a .pdidx
    // link (e.g. schema release notes) is not a vendor index.
    const pdscUrl = textField(node, 'url');
    if (!pdscUrl || !pdscUrl.toLowerCase().includes('.pdidx') || seen.has(pdscUrl)) {
      return;
    }
    seen.add(pdscUrl);
    const vendorName =
      textField(node, 'name') ?? textField(node, 'vendor') ?? vendorNameFromIndexUrl(pdscUrl);
    entries.push({ vendorName, pdscUrl });
  });
  return entries;
}

/**
 * Fetches a vendor pdidx. Entries that expose a direct .pack URL become
 * PackIndexPack; entries that only reference a .pdsc file are skipped because
 * there is no pack download link to hand to the importer and deriving one
 * from a directory URL would be guesswork.
 */
export async function listPacksForVendor(fetcher: FetchLike, entry: PackIndexEntry): Promise<PackIndexPack[]> {
  const response = await fetcher(entry.pdscUrl);
  if (!response.ok || response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to fetch pack index ${entry.pdscUrl}: HTTP ${response.status}`);
  }
  const document = xmlParser.parse(await response.text()) as unknown;
  const packs: PackIndexPack[] = [];
  const entryKeys: Record<string, true> = { package: true, pdsc: true };
  for (const node of collectEntries(document, entryKeys)) {
    const packUrl = textField(node, 'url');
    if (!packUrl || !/\.pack$/i.test(packUrl)) {
      continue;
    }
    packs.push({
      name: textField(node, 'name') ?? packNameFromUrl(packUrl),
      version: textField(node, 'version') ?? '',
      description: textField(node, 'description') ?? '',
      packUrl,
      vendorName: textField(node, 'vendor') ?? entry.vendorName
    });
  }
  return packs;
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
  const needle = keyword.trim().toLowerCase();
  const cache = options.cache ?? new Map<string, PackSearchCacheEntry>();
  const vendorCache = options.vendorCache ?? new Map<string, VendorCacheEntry>();
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? 5 * 60 * 1000;
  const vendorCacheKey = '\0vendors';
  const cachedVendors = vendorCache.get(vendorCacheKey);
  const vendors = cachedVendors && cachedVendors.expiresAt > now()
    ? cachedVendors.vendors
    : await listPackVendors(fetcher);
  if (!cachedVendors || cachedVendors.expiresAt <= now()) {
    vendorCache.set(vendorCacheKey, {
      vendors,
      expiresAt: now() + ttlMs
    });
  }
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 6));
  const results: PromiseSettledResult<PackIndexPack[]>[] = new Array(vendors.length);
  for (let index = 0; index < vendors.length; index += concurrency) {
    if (options.signal?.aborted) {
      throw new Error('Pack search cancelled.');
    }
    const batch = vendors.slice(index, index + concurrency);
    const settled = await Promise.allSettled(batch.map(async (entry) => {
      const cached = cache.get(entry.pdscUrl);
      if (cached && cached.expiresAt > now()) {
        return cached.packs;
      }
      const packs = await listPacksForVendor(fetcher, entry);
      cache.set(entry.pdscUrl, { packs, expiresAt: now() + ttlMs });
      return packs;
    }));
    settled.forEach((result, offset) => {
      results[index + offset] = result;
    });
  }
  const matches: PackIndexPack[] = [];
  for (const result of results) {
    if (result.status !== 'fulfilled') {
      continue;
    }
    for (const pack of result.value) {
      if (
        needle.length === 0 ||
        pack.vendorName.toLowerCase().includes(needle) ||
        pack.name.toLowerCase().includes(needle) ||
        pack.description.toLowerCase().includes(needle)
      ) {
        matches.push(pack);
      }
    }
  }
  const latest = new Map<string, PackIndexPack>();
  for (const pack of matches) {
    const key = `${pack.vendorName}\0${pack.name}`;
    const existing = latest.get(key);
    if (!existing || compareVersions(pack.version, existing.version) > 0) {
      latest.set(key, pack);
    }
  }
  return [...latest.values()].sort((left, right) => (
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

function walkNodes(node: unknown, visit: (node: XmlNode) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) {
      walkNodes(item, visit);
    }
    return;
  }
  if (node === null || typeof node !== 'object') {
    return;
  }
  const record = node as XmlNode;
  visit(record);
  for (const value of Object.values(record)) {
    walkNodes(value, visit);
  }
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

function vendorNameFromIndexUrl(url: string): string {
  const path = url.split(/[?#]/)[0];
  const base = path.substring(path.lastIndexOf('/') + 1);
  return base.replace(/\.pdidx$/i, '');
}

function packNameFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0];
  const base = path.substring(path.lastIndexOf('/') + 1);
  return base.replace(/\.pack$/i, '');
}
