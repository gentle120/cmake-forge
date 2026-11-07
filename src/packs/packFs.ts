import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { ZipEntry } from './zipReader';

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
 * Collects the entries of an extracted CMSIS pack directory relative to its
 * root, mirroring the entry set a .pack ZIP would have produced: the .pdsc
 * plus every other file (SVD, startup sources, and so on).
 *
 * `select` limits which files are read, so identity resolution does not load a
 * whole pack tree.
 */
export async function readDirectoryEntries(
  root: string,
  select?: (name: string) => boolean
): Promise<ZipEntry[]> {
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
      } else if (!select || select(relative)) {
        entries.push({ name: relative, data: await readFile(absolute) });
      }
    }
  };
  await walk(root, '');
  return entries;
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
