import { readdir, readFile, realpath, stat } from 'node:fs/promises';
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
 * whole pack tree. `readdir` reports the entry types, so the walk never stats a
 * path just to learn whether it is a directory — a large pack has thousands of
 * files and only a handful are ever read.
 *
 * Symbolic links are the one exception: a dirent only says "link", so the target
 * type needs one stat. Linking is how a shared PDSC or a pack kept on another
 * drive is wired into a CMSIS root, and skipping links would silently hide those
 * packs. Linked directories are followed with a real-path guard, so a cycle is
 * skipped instead of recursed into.
 */
export async function readDirectoryEntries(
  root: string,
  select?: (name: string) => boolean
): Promise<ZipEntry[]> {
  const entries: ZipEntry[] = [];
  const visitedDirectories = new Set<string>();
  const walk = async (directory: string, prefix: string): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const absolute = join(directory, dirent.name);
      const relative = prefix.length === 0 ? dirent.name : `${prefix}/${dirent.name}`;
      let isDirectory = dirent.isDirectory();
      let isFile = dirent.isFile();
      if (dirent.isSymbolicLink()) {
        try {
          const target = await stat(absolute);
          isDirectory = target.isDirectory();
          isFile = target.isFile();
        } catch {
          // A broken link is not a pack entry.
          continue;
        }
        if (isDirectory) {
          const real = await realpath(absolute).catch(() => absolute);
          if (visitedDirectories.has(real)) {
            continue;
          }
          visitedDirectories.add(real);
        }
      }
      if (isDirectory) {
        await walk(absolute, relative);
      } else if (isFile && (!select || select(relative))) {
        try {
          entries.push({ name: relative, data: await readFile(absolute) });
        } catch {
          // A file removed between readdir and read must not fail the pack.
        }
      }
    }
  };
  visitedDirectories.add(await realpath(root).catch(() => root));
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
  // A directory path may be given with a trailing separator; strip it before
  // taking the last segment or every parent-level archive lookup misses.
  const trimmed = root.replace(/[\\/]+$/, '');
  const name = trimmed.replace(/\\/g, '/').split('/').pop();
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
