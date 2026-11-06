import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { KeilPackEntry } from '../env/toolchainScanner';
import { readDirectoryEntries } from './packFs';
import { packNameFromFileName, packVendorDisplayName, packVendorId } from './packIdentity';
import { parsePackIdentity } from './packParser';
import { readZipEntries } from './zipReader';

/**
 * A Pack found in a Keil/CMSIS installation root, identified by its PDSC.
 *
 * `packFile` is an installation reference (archive path or extracted version
 * directory) and must not be used as the imported-profile ownership key; that
 * key is the extension storage path produced by the importer.
 */
export interface InstalledPackIdentity {
  packFile: string;
  source: 'file' | 'directory';
  /** Registry-safe vendor id derived from the PDSC vendor. */
  vendorId: string;
  /** PDSC vendor without the numeric suffix ('Sinomcu:985' -> 'Sinomcu'). */
  vendorName: string;
  name: string;
  version: string;
}

/** Only the .pdsc is needed to identify an installed archive. */
function isPdscEntry(name: string): boolean {
  return name.toLowerCase().endsWith('.pdsc');
}

async function readArchiveIdentity(packFile: string): Promise<ReturnType<typeof parsePackIdentity>> {
  const buffer = await readFile(packFile);
  return parsePackIdentity(readZipEntries(buffer, isPdscEntry));
}

async function readDirectoryIdentity(
  directory: string
): Promise<ReturnType<typeof parsePackIdentity>> {
  const entries = await readDirectoryEntries(directory, isPdscEntry);
  return parsePackIdentity(entries);
}

/**
 * Resolves the identity of one installed Pack from its PDSC. Returns undefined
 * when the PDSC cannot be read or does not name a vendor, so a broken
 * installation entry is skipped instead of surfacing a folder-derived Pack.
 */
export async function resolveInstalledPackIdentity(
  entry: KeilPackEntry
): Promise<InstalledPackIdentity | undefined> {
  let identity: ReturnType<typeof parsePackIdentity>;
  try {
    identity = entry.source === 'directory'
      ? await readDirectoryIdentity(entry.packFile)
      : await readArchiveIdentity(entry.packFile);
  } catch {
    return undefined;
  }
  const vendorName = packVendorDisplayName(identity.vendorName);
  const fallback = packNameFromFileName(entry.packFile);
  const name = identity.name.trim() || fallback.name;
  const version = identity.version.trim() || entry.version || fallback.version || 'unknown';
  return {
    packFile: entry.packFile,
    source: entry.source,
    vendorId: packVendorId(identity.vendorName),
    vendorName,
    name,
    version
  };
}

/** Resolves every readable installed Pack, preserving catalog order. */
export async function listInstalledPackIdentities(
  entries: KeilPackEntry[]
): Promise<InstalledPackIdentity[]> {
  const identities = await Promise.all(entries.map((entry) => resolveInstalledPackIdentity(entry)));
  return identities.filter((identity): identity is InstalledPackIdentity => identity !== undefined);
}

/** Finds the .pdsc file of an extracted Pack directory. */
export async function findPackPdsc(directory: string): Promise<string | undefined> {
  const entries = await readDirectoryEntries(directory, isPdscEntry);
  return entries[0]?.name;
}

/** Looks up one installed Pack by its installation reference. */
export async function findInstalledPackEntry(
  entries: KeilPackEntry[],
  packFile: string
): Promise<KeilPackEntry | undefined> {
  return entries.find((entry) => entry.packFile === packFile);
}
