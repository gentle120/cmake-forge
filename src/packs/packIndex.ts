import { XMLParser } from 'fast-xml-parser';
import { packVendorId } from './packIdentity';
import { comparePackVersions } from '../shared/packVersion';

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
 * Minimal subset of the DOM fetch Response consumed here.
 *
 * `signal` is the caller's cancellation signal: the fetcher must abort the
 * request when it fires, so cancelling a progress notification really stops the
 * network work instead of letting it run to completion.
 */
export type FetchLike = (url: string, signal?: AbortSignal) => Promise<{
  ok: boolean;
  status: number;
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

// The complete public CMSIS pack index. The vendor-specific keil.pidx only
// lists Keil-hosted packs and therefore cannot serve chip vendors such as
// GigaDevice or STMicroelectronics, whose DFPs are hosted by the vendor.
const packIndexUrl = 'https://www.keil.com/pack/index.pidx';
const indexTtlMs = 5 * 60 * 1000;

type XmlNode = Record<string, unknown>;

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/**
 * Fetches the CMSIS pack index and flattens its
 * `<pindex><pdsc url vendor name version/>` entries into direct Pack entries.
 * The CMSIS naming convention resolves the download URL as
 * `<root><vendor>.<name>.<version>.pack`; keil.com redirects its own packs to a
 * CDN while vendor-hosted packs point straight at the vendor site. Entries
 * missing any identity field are skipped because there is no download URL to
 * hand to the importer, and deprecated entries are skipped so the catalog never
 * offers a superseded DFP. The live index repeats a few entries verbatim, which
 * would show the same Pack twice in the picker, so identical identities collapse.
 */
export async function listPackIndexPacks(
  fetcher: FetchLike,
  cache?: Map<string, PackSearchCacheEntry>,
  signal?: AbortSignal
): Promise<PackIndexPack[]> {
  const cached = cache?.get(packIndexUrl);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.packs;
  }
  const response = await fetcher(packIndexUrl, signal);
  if (!response.ok || response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to fetch pack index ${packIndexUrl}: HTTP ${response.status}`);
  }
  const document = xmlParser.parse(await respondText(response, signal)) as unknown;
  const packs: PackIndexPack[] = [];
  const seen = new Set<string>();
  for (const node of collectEntries(document, { pdsc: true })) {
    const url = textField(node, 'url');
    const vendor = textField(node, 'vendor');
    const name = textField(node, 'name');
    const version = textField(node, 'version');
    if (!url || !vendor || !name || !version || textField(node, 'deprecated')) {
      continue;
    }
    const identity = `${vendor}\u0000${name}\u0000${version}`;
    if (seen.has(identity)) {
      continue;
    }
    seen.add(identity);
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

/**
 * Index packs serving one sidebar selection, newest version first.
 *
 * A curated series names its DFP, so an exact name match wins even when the
 * DFP is published under another vendor (Keil publishes ST's STM32F1xx_DFP).
 * Without a named DFP, every pack of the selected registry vendor qualifies,
 * which also absorbs numeric Dvendor suffixes and vendor display variants.
 */
export function selectPacksForSelection(
  packs: PackIndexPack[],
  vendorId: string,
  packName = ''
): PackIndexPack[] {
  const wantedName = packName.trim().toLowerCase();
  const byName = wantedName === ''
    ? []
    : packs.filter((pack) => pack.name.toLowerCase() === wantedName);
  const pool = byName.length > 0
    ? byName
    : packs.filter((pack) => vendorId !== '' && packVendorId(pack.vendorName) === vendorId);
  return [...pool].sort((left, right) =>
    left.name.localeCompare(right.name) || comparePackVersions(right.version, left.version)
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
  const packs = await listPackIndexPacks(fetcher, options.cache, options.signal);
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
      || comparePackVersions(left.version, right.version)
    ));
}

export async function downloadPack(
  fetcher: FetchLike,
  packUrl: string,
  signal?: AbortSignal
): Promise<Buffer> {
  const response = await fetcher(packUrl, signal);
  if (!response.ok || response.status < 200 || response.status >= 300) {
    throw new Error(`Failed to download pack ${packUrl}: HTTP ${response.status}`);
  }
  return Buffer.from(await respondArrayBuffer(response, signal));
}

/**
 * Reads a response body, rejecting as soon as the caller's signal fires. A
 * fetcher that aborts correctly rejects before this runs, but a body that is
 * still streaming must not keep the command alive after cancellation.
 */
function respondText(
  response: { text(): Promise<string> },
  signal?: AbortSignal
): Promise<string> {
  return guardCancellation(response.text(), signal);
}

function respondArrayBuffer(
  response: { arrayBuffer(): Promise<ArrayBuffer> },
  signal?: AbortSignal
): Promise<ArrayBuffer> {
  return guardCancellation(response.arrayBuffer(), signal);
}

function guardCancellation<T>(work: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) {
    return work;
  }
  if (signal.aborted) {
    return Promise.reject(new Error('Pack request cancelled.'));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(new Error('Pack request cancelled.'));
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
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
