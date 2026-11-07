import { readFile } from 'node:fs/promises';
import type { KeilPackEntry } from '../env/toolchainScanner';
import { readDirectoryEntries } from './packFs';
import { packNameFromFileName, packVendorDisplayName, packVendorId } from './packIdentity';
import {
  hasImportablePackDevice,
  isPackDeviceSourceEntry,
  parsePackIdentity
} from './packParser';
import { readZipEntries, type ZipEntry } from './zipReader';

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
  /** Registry-safe vendor id derived from the PDSC vendor sans registry number. */
  vendorId: string;
  /** PDSC vendor without the numeric suffix ('Sinomcu:985' -> 'Sinomcu'). */
  vendorName: string;
  name: string;
  version: string;
  /** True when the PDSC yields at least one device the importer would register. */
  hasDevices: boolean;
}

async function readArchiveSources(packFile: string): Promise<ZipEntry[]> {
  const buffer = await readFile(packFile);
  return readZipEntries(buffer, isPackDeviceSourceEntry);
}

async function readDirectorySources(directory: string): Promise<ZipEntry[]> {
  return readDirectoryEntries(directory, isPackDeviceSourceEntry);
}

/**
 * Resolves the identity of one installed Pack from its PDSC. Returns undefined
 * when the PDSC cannot be read or does not name a vendor, so a broken
 * installation entry is skipped instead of surfacing a folder-derived Pack.
 */
export async function resolveInstalledPackIdentity(
  entry: KeilPackEntry
): Promise<InstalledPackIdentity | undefined> {
  let entries: ZipEntry[];
  let identity: ReturnType<typeof parsePackIdentity>;
  try {
    entries = entry.source === 'directory'
      ? await readDirectorySources(entry.packFile)
      : await readArchiveSources(entry.packFile);
    identity = parsePackIdentity(entries);
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
    // The numeric Dvendor suffix is a registry artifact of the same vendor;
    // stripping it keeps packs like 'ARM' and 'ARM:82' on one vendor identity.
    vendorId: packVendorId(vendorName),
    vendorName,
    name,
    version,
    hasDevices: hasImportablePackDevice(entries)
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
  const entries = await readDirectoryEntries(
    directory,
    (name) => name.toLowerCase().endsWith('.pdsc')
  );
  return entries[0]?.name;
}

/** Looks up one installed Pack by its installation reference. */
export async function findInstalledPackEntry(
  entries: KeilPackEntry[],
  packFile: string
): Promise<KeilPackEntry | undefined> {
  return entries.find((entry) => entry.packFile === packFile);
}
