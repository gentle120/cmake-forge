import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ZipEntry } from './zipReader';

export interface DirectoryPackEntry {
  /** Root directory that contained the .pdsc file. */
  root: string;
  /** Path of the .pdsc file relative to the root, using forward slashes. */
  pdscPath: string;
}

function toPosix(path: string): string {
  return path.replace(/\\/g, '/');
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function safeReaddir(path: string): Promise<string[]> {
  try {
    return await readdir(path);
  } catch {
    return [];
  }
}

/**
 * Collects every entry of an extracted CMSIS pack directory relative to its
 * root, mirroring the entry set a .pack ZIP would have produced: the .pdsc
 * plus every other file (SVD, startup sources, and so on).
 */
export async function readDirectoryEntries(root: string): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    for (const name of await safeReaddir(directory)) {
      const absolute = join(directory, name);
      const relative = prefix.length === 0 ? name : `${prefix}/${name}`;
      let isDirectory: boolean;
      try {
        isDirectory = (await stat(absolute)).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) {
        await walk(absolute, relative);
      } else {
        entries.push({ name: relative, data: await readFile(absolute) });
      }
    }
  };
  await walk(root, '');
  return entries;
}

/** Finds .pdsc files at the top level of every version directory of a pack root. */
export async function findDirectoryPacks(packRoots: string[]): Promise<DirectoryPackEntry[]> {
  const results: DirectoryPackEntry[] = [];
  const seen = new Set<string>();
  for (const packRoot of packRoots) {
    for (const vendor of await safeReaddir(packRoot)) {
      const vendorDirectory = join(packRoot, vendor);
      for (const name of await safeReaddir(vendorDirectory)) {
        const nameDirectory = join(vendorDirectory, name);
        for (const version of await safeReaddir(nameDirectory)) {
          const versionDirectory = join(nameDirectory, version);
          for (const file of await safeReaddir(versionDirectory)) {
            if (!file.toLowerCase().endsWith('.pdsc')) {
              continue;
            }
            const pdscPath = toPosix(join(versionDirectory, file));
            if (!seen.has(pdscPath) && await isFile(join(versionDirectory, file))) {
              seen.add(pdscPath);
              results.push({ root: toPosix(versionDirectory), pdscPath });
            }
          }
        }
      }
    }
  }
  return results.sort((left, right) => left.pdscPath.localeCompare(right.pdscPath));
}

/** Finds a .pack archive beside or above the extracted pack directory. */
export async function findAdjacentPackArchive(root: string): Promise<string | undefined> {
  const names = await safeReaddir(root);
  const local = names
    .filter((name) => name.toLowerCase().endsWith('.pack'))
    .map((name) => join(root, name))
    .sort();
  for (const candidate of local) {
    if (await isFile(candidate)) {
      return candidate;
    }
  }
  const parent = join(root, '..');
  const parentNames = await safeReaddir(parent);
  const name = root.replace(/\\/g, '/').split('/').pop();
  const candidates = parentNames
    .filter((entry) => name && entry.startsWith(`${name}.`) && entry.toLowerCase().endsWith('.pack'))
    .map((entry) => join(parent, entry))
    .sort();
  for (const candidate of candidates) {
    if (await isFile(candidate)) {
      return candidate;
    }
  }
  return undefined;
}
