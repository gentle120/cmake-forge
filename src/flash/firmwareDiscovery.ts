/**
 * Picks the firmware image that should be flashed from a generated build tree.
 *
 * A workspace can hold several presets and stale artefacts. Asking the user to
 * browse `build/` for an ELF is error-prone, so discovery narrows the tree to
 * the preset that is most useful for flashing and prefers the freshest image.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

export type FirmwarePreset = 'debug' | 'release' | 'other';

export interface FirmwareCandidate {
  /** Absolute path. */
  path: string;
  preset: FirmwarePreset;
  size: number;
  mtimeMs: number;
}

export interface FirmwareDiscoveryResult {
  candidates: FirmwareCandidate[];
  selected?: FirmwareCandidate;
  /** 为空表示可用；否则是给用户看的原因，例如"还没有构建产物"。 */
  reason: string;
}

export interface FirmwareDiscoveryFs {
  readdir(path: string): Promise<Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>>;
  stat(path: string): Promise<{ size: number; mtimeMs: number }>;
  readFile?(path: string, encoding: 'utf8'): Promise<string>;
}

const PRESET_PRIORITY: Record<FirmwarePreset, number> = {
  debug: 0,
  release: 1,
  other: 2
};

/**
 * Four levels reach the usual `build/<preset>/CMakeFiles/<target>.dir/...`
 * layout without walking into dependency trees that never hold firmware.
 */
const MAX_SCAN_DEPTH = 4;

/** Build-system internals are either huge or never contain the linked image. */
const SKIPPED_DIRECTORIES = new Set([
  'cmakefiles',
  'node_modules',
  '.git',
  'testing',
  '_deps'
]);

const defaultFs: FirmwareDiscoveryFs = {
  async readdir(directory: string) {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: () => entry.isDirectory(),
      isFile: () => entry.isFile()
    }));
  },
  async stat(filePath: string) {
    const info = await stat(filePath);
    return { size: info.size, mtimeMs: info.mtimeMs };
  },
  readFile: (filePath, encoding) => readFile(filePath, encoding)
};

function presetFromName(name: string): FirmwarePreset {
  const normalized = name.trim().toLowerCase();
  if (normalized === 'debug') {
    return 'debug';
  }
  if (normalized === 'release') {
    return 'release';
  }
  return 'other';
}

/**
 * Preset directories are normally named after their build type, but a custom
 * preset (`dev`, `ci`, ...) still records CMAKE_BUILD_TYPE in its cache.
 * Reading that keeps custom trees in the right priority bucket.
 */
async function presetForDirectory(
  buildDirectory: string,
  name: string,
  fs: FirmwareDiscoveryFs
): Promise<FirmwarePreset> {
  const byName = presetFromName(name);
  if (byName !== 'other') {
    return byName;
  }
  const readCache = fs.readFile;
  if (!readCache) {
    return 'other';
  }
  try {
    const cache = await readCache(join(buildDirectory, name, 'CMakeCache.txt'), 'utf8');
    const match = /^CMAKE_BUILD_TYPE:[^=\r\n]*=(.*)$/im.exec(cache);
    if (match) {
      return presetFromName(match[1]);
    }
  } catch {
    // A preset that was never configured has no cache; "other" is still valid.
  }
  return 'other';
}

function isElfName(name: string): boolean {
  return name.toLowerCase().endsWith('.elf');
}

function isSideArtefact(name: string): boolean {
  // Side files share the ELF stem (firmware.elf.map); never let them shadow it.
  return name.toLowerCase().includes('.elf.');
}

function isNewer(candidate: FirmwareCandidate, current: FirmwareCandidate | undefined): boolean {
  if (!current) {
    return true;
  }
  if (candidate.mtimeMs !== current.mtimeMs) {
    return candidate.mtimeMs > current.mtimeMs;
  }
  // Equal timestamps happen on coarse filesystems; keep the result stable.
  return candidate.path.localeCompare(current.path) < 0;
}

async function newestElfUnder(
  directory: string,
  depth: number,
  preset: FirmwarePreset,
  fs: FirmwareDiscoveryFs
): Promise<FirmwareCandidate | undefined> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await fs.readdir(directory);
  } catch {
    // Directories disappear between listing and scanning when a build cleans.
    return undefined;
  }

  let newest: FirmwareCandidate | undefined;
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (depth >= MAX_SCAN_DEPTH || SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) {
        continue;
      }
      const nested = await newestElfUnder(entryPath, depth + 1, preset, fs);
      if (nested && isNewer(nested, newest)) {
        newest = nested;
      }
      continue;
    }
    if (!entry.isFile() || !isElfName(entry.name) || isSideArtefact(entry.name)) {
      continue;
    }
    let info: { size: number; mtimeMs: number };
    try {
      info = await fs.stat(entryPath);
    } catch {
      // The linker may be rewriting the file while the sidebar refreshes.
      continue;
    }
    if (info.size <= 0) {
      // A zero-byte ELF is a failed link, not a flashable image.
      continue;
    }
    const candidate: FirmwareCandidate = {
      path: entryPath,
      preset,
      size: info.size,
      mtimeMs: info.mtimeMs
    };
    if (isNewer(candidate, newest)) {
      newest = candidate;
    }
  }
  return newest;
}

function compareCandidates(left: FirmwareCandidate, right: FirmwareCandidate): number {
  const byPreset = PRESET_PRIORITY[left.preset] - PRESET_PRIORITY[right.preset];
  if (byPreset !== 0) {
    return byPreset;
  }
  if (left.mtimeMs !== right.mtimeMs) {
    return right.mtimeMs - left.mtimeMs;
  }
  return left.path.localeCompare(right.path);
}

export async function findFirmwareCandidates(
  root: string,
  fs: FirmwareDiscoveryFs = defaultFs
): Promise<FirmwareCandidate[]> {
  const buildDirectory = join(root, 'build');
  let presets: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    presets = await fs.readdir(buildDirectory);
  } catch {
    // No configure has run yet, so there is nothing to scan.
    return [];
  }

  const candidates: FirmwareCandidate[] = [];
  for (const entry of presets) {
    if (!entry.isDirectory()) {
      continue;
    }
    const preset = await presetForDirectory(buildDirectory, entry.name, fs);
    const candidate = await newestElfUnder(join(buildDirectory, entry.name), 0, preset, fs);
    if (candidate) {
      candidates.push(candidate);
    }
  }
  return candidates.sort(compareCandidates);
}

/**
 * Workspace-level fallback: projects are not always built into `build/`
 * (Keil/CubeMX trees and hand-written Makefiles keep the ELF elsewhere), yet
 * the user still expects the newest image to be found without browsing.
 */
const WORKSPACE_SKIPPED_DIRECTORIES = new Set([
  ...SKIPPED_DIRECTORIES,
  'build',
  '.vscode',
  'out',
  'dist',
  '.venv'
]);

async function collectElves(
  directory: string,
  depth: number,
  fs: FirmwareDiscoveryFs,
  found: FirmwareCandidate[]
): Promise<void> {
  let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
  try {
    entries = await fs.readdir(directory);
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      if (depth >= MAX_SCAN_DEPTH || WORKSPACE_SKIPPED_DIRECTORIES.has(entry.name.toLowerCase())) {
        continue;
      }
      await collectElves(entryPath, depth + 1, fs, found);
      continue;
    }
    if (!entry.isFile() || !isElfName(entry.name) || isSideArtefact(entry.name)) {
      continue;
    }
    let info: { size: number; mtimeMs: number };
    try {
      info = await fs.stat(entryPath);
    } catch {
      continue;
    }
    if (info.size <= 0) {
      continue;
    }
    found.push({ path: entryPath, preset: 'other', size: info.size, mtimeMs: info.mtimeMs });
  }
}

/** Newest ELF anywhere in the workspace, build trees excluded (they are scanned first). */
export async function findWorkspaceFirmware(
  root: string,
  fs: FirmwareDiscoveryFs = defaultFs
): Promise<FirmwareCandidate[]> {
  if (!root.trim()) {
    return [];
  }
  const found: FirmwareCandidate[] = [];
  await collectElves(root, 0, fs, found);
  return found.sort((left, right) =>
    right.mtimeMs - left.mtimeMs || left.path.localeCompare(right.path)
  );
}

function isFlashable(candidate: FirmwareCandidate): boolean {
  if (candidate.size <= 0) {
    return false;
  }
  return !isSideArtefact(basename(candidate.path));
}

export function pickFirmware(candidates: FirmwareCandidate[]): FirmwareCandidate | undefined {
  let selected: FirmwareCandidate | undefined;
  for (const candidate of candidates) {
    if (!isFlashable(candidate)) {
      continue;
    }
    if (!selected || compareCandidates(candidate, selected) < 0) {
      selected = candidate;
    }
  }
  return selected;
}

export async function discoverFirmware(
  root: string,
  fs: FirmwareDiscoveryFs = defaultFs
): Promise<FirmwareDiscoveryResult> {
  if (!root.trim()) {
    return { candidates: [], reason: '请先选择目标工程。' };
  }
  const candidates = await findFirmwareCandidates(root, fs);
  const selected = pickFirmware(candidates);
  if (!selected) {
    return { candidates, reason: '还没有构建产物：先执行 cmake --build --preset debug。' };
  }
  return { candidates, selected, reason: '' };
}
