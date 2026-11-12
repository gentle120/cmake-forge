/**
 * The ARM CMSIS Core pack (`ARM.CMSIS`) is not a device pack: it ships the
 * `core_cm*.h` headers that every vendor device header includes, but no chips.
 *
 * A generated MCU project cannot compile without them — `stm32f10x.h` includes
 * `core_cm3.h` and `gd32f4xx.h` includes `core_cm4.h`, neither of which exists
 * in the vendor DFP. The core pack is therefore installed separately and its
 * include directory is added to every generated project.
 */

import { copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { comparePackVersions } from '../shared/packVersion';
import { packNameFromFileName } from './packIdentity';
import { parsePackIdentity, type PackIdentity } from './packParser';
import { readZipEntries } from './zipReader';

/** CMSIS Core headers live in this directory inside the pack. */
export const coreIncludePrefix = 'CMSIS/Core/Include';

/**
 * Project-relative directory generated projects receive the core headers in.
 *
 * The headers are copied into the project instead of being referenced in
 * extension storage: a project that points at an absolute install path does not
 * build anywhere else, and the copy is the same 3 MB of header files.
 */
export const coreProjectIncludeDir = 'CMSIS/Include';

export interface CorePackRecord {
  /** PDSC vendor name, e.g. `ARM`. */
  vendor: string;
  /** PDSC pack name, e.g. `CMSIS`. */
  name: string;
  version: string;
  /** Include directory relative to the extension storage root. */
  includeDir: string;
  files: number;
  /** `archive` for an imported .pack; the path is kept for diagnostics. */
  sourceFile: string;
  installedAt: string;
}

interface CorePackManifest {
  version: 1;
  packs: CorePackRecord[];
}

const manifestRelativePath = 'cores/index.json';
const emptyManifest: CorePackManifest = { version: 1, packs: [] };

/** True for a relative archive path that cannot escape the directory it is written to. */
export function isSafeEntryName(name: string): boolean {
  if (name.length === 0 || name.includes('\0')) {
    return false;
  }
  if (name.startsWith('/') || name.startsWith('\\') || /^[A-Za-z]:/.test(name)) {
    return false;
  }
  return !name.split(/[\\/]/).some((segment) => segment === '..');
}

/** Selects the archive entries a core pack is made of: PDSC plus Core headers. */
export function isCorePackSourceEntry(name: string): boolean {
  if (!isSafeEntryName(name)) {
    return false;
  }
  const lower = name.toLowerCase();
  return lower.endsWith('.pdsc')
    || (lower.startsWith(`${coreIncludePrefix.toLowerCase()}/`) && lower.endsWith('.h'));
}

export interface ParsedCorePack {
  identity: PackIdentity;
  /** Core header entries keyed by their path inside the pack. */
  headers: Array<{ name: string; data: Buffer }>;
}

/**
 * Reads a pack archive as a CMSIS Core pack.
 *
 * Returns undefined when the archive carries no `CMSIS/Core/Include/**\/*.h`
 * entries — that is the functional test for "this is a core pack", because a
 * vendor DFP also parses as a package but cannot supply these headers.
 */
export function readCorePack(buffer: Buffer, fileName: string): ParsedCorePack | undefined {
  const entries = readZipEntries(buffer, isCorePackSourceEntry);
  const headers = entries.filter(
    (entry) => entry.name.toLowerCase().startsWith(`${coreIncludePrefix.toLowerCase()}/`)
  );
  if (headers.length === 0) {
    return undefined;
  }
  const identity = parsePackIdentity(entries);
  const fileIdentity = packNameFromFileName(fileName);
  return {
    identity: {
      vendorName: identity.vendorName,
      name: identity.name || fileIdentity.name,
      // The PDSC in a core pack nests <release> under <releases>, which the
      // device-pack identity reader does not descend into, so the archive name
      // is the reliable version source here.
      version: identity.version || fileIdentity.version || 'unknown'
    },
    headers: headers.sort((left, right) => left.name.localeCompare(right.name))
  };
}

/** Filesystem-safe path segment that can never become `.` or `..`. */
function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+$/, '_');
  return cleaned.length > 0 ? cleaned : '_';
}

/** Filesystem-safe directory name for one installed core pack version. */
function corePackDirectory(identity: PackIdentity): string {
  // Dot-only identity fields must never turn the install directory into `.` or
  // `..`: installing deletes that directory before writing the new headers.
  const vendor = sanitizeSegment(identity.vendorName);
  const name = sanitizeSegment(identity.name);
  const version = sanitizeSegment(identity.version);
  return `cores/${vendor}.${name}.${version}`;
}

async function readManifest(storageRoot: string): Promise<CorePackManifest> {
  try {
    const parsed = JSON.parse(
      await readFile(join(storageRoot, manifestRelativePath), 'utf8')
    ) as Partial<CorePackManifest>;
    const packs = Array.isArray(parsed.packs)
      ? parsed.packs.filter((pack): pack is CorePackRecord => (
          Boolean(pack)
          && typeof pack.name === 'string'
          && typeof pack.version === 'string'
          && typeof pack.includeDir === 'string'
        ))
      : [];
    return { version: 1, packs };
  } catch {
    // A missing or unreadable manifest means "nothing installed yet"; the
    // headers on disk are useless without a recorded include directory anyway.
    return { ...emptyManifest };
  }
}

async function writeManifest(storageRoot: string, manifest: CorePackManifest): Promise<void> {
  const path = join(storageRoot, manifestRelativePath);
  await mkdir(dirname(path), { recursive: true });
  // Write-then-rename keeps a crash from leaving a truncated manifest, which
  // would make every installed core pack disappear on the next read.
  const temporary = `${path}.tmp`;
  await writeFile(temporary, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await rename(temporary, path);
}

export interface CorePackInstall {
  record: CorePackRecord;
  /** Absolute include directory holding `core_cm*.h` and the rest. */
  includeDir: string;
}

/** True when an include directory still holds the CMSIS core headers. */
async function hasCoreHeaders(directory: string): Promise<boolean> {
  try {
    const names = await readdir(directory);
    return names.some((name) => /^core_cm.*\.h$/i.test(name));
  } catch {
    return false;
  }
}

/**
 * One installed core pack by version, or the newest installed one when version
 * is empty. Undefined when that version is not installed or its headers are
 * gone, so a caller never receives a path that does not resolve.
 */
export async function findInstalledCorePack(
  storageRoot: string,
  version = ''
): Promise<CorePackInstall | undefined> {
  const wanted = version.trim();
  const packs = (await listInstalledCorePacks(storageRoot))
    .filter((pack) => wanted === '' || pack.version === wanted);
  for (const pack of packs) {
    const includeDir = join(storageRoot, pack.includeDir);
    if (await hasCoreHeaders(includeDir)) {
      return { record: pack, includeDir };
    }
  }
  return undefined;
}

/** A header file a generation copies into the project. */
export interface CoreHeaderCopy {
  /** Absolute path inside the installed core pack. */
  source: string;
  /** Absolute path inside the generated project. */
  target: string;
  /** Path relative to the project root, forward slashes. */
  relative: string;
}

/** Core header that implements each supported core name, if the pack ships it. */
const coreHeaderByCore: Record<string, string> = {
  'cortex-m0': 'core_cm0.h',
  'cortex-m0plus': 'core_cm0plus.h',
  'cortex-m1': 'core_cm1.h',
  'cortex-m3': 'core_cm3.h',
  'cortex-m4': 'core_cm4.h',
  'cortex-m7': 'core_cm7.h',
  'cortex-m23': 'core_cm23.h',
  'cortex-m33': 'core_cm33.h',
  'cortex-m35p': 'core_cm35p.h',
  'cortex-m52': 'core_cm52.h',
  'cortex-m55': 'core_cm55.h',
  'cortex-m85': 'core_cm85.h',
  'sc000': 'core_sc000.h',
  'sc300': 'core_sc300.h'
};

/**
 * Headers one core actually needs: the mapped core header plus every header it
 * includes (CMSIS 4's `core_cmFunc.h`, CMSIS 6's `m-profile/armv7m_mpu.h`, and
 * so on).
 *
 * Copying the whole `Core/Include` directory drags every other core's headers
 * into the project — roughly 3 MB of `core_cm0.h` … `core_cm85.h` files that can
 * never be compiled against the selected device. The closure keeps the project
 * limited to the headers the device header really pulls in.
 */
async function neededCoreHeaders(
  includeDir: string,
  core: string,
  compilerFamily: 'gcc' | 'armclang'
): Promise<Set<string> | undefined> {
  const base = coreHeaderByCore[core.trim().toLowerCase()];
  if (!base) {
    return undefined;
  }
  const available: string[] = [];
  const collect = async (directory: string, prefix: string): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const relative = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
      if (dirent.isDirectory()) {
        await collect(join(directory, dirent.name), relative);
      } else if (dirent.isFile() && relative.toLowerCase().endsWith('.h')) {
        available.push(relative);
      }
    }
  };
  await collect(includeDir, '');
  const byLowerPath = new Map(available.map((relative) => [relative.toLowerCase(), relative]));
  const byLowerBasename = new Map<string, string>();
  for (const relative of available) {
    const basename = relative.split('/').pop()!.toLowerCase();
    if (!byLowerBasename.has(basename)) {
      byLowerBasename.set(basename, relative);
    }
  }
  if (!byLowerPath.has(base.toLowerCase())) {
    return undefined;
  }

  const needed = new Set<string>();
  const queue: Array<{ from: string; name: string }> = [
    { from: '', name: base },
    { from: '', name: 'cmsis_compiler.h' },
    { from: '', name: 'cmsis_version.h' }
  ];
  while (queue.length > 0) {
    const request = queue.shift()!;
    const included = request.name.replace(/\\/g, '/');
    // `#include "m-profile/armv7m_mpu.h"` resolves next to the including header
    // first and against the include root afterwards, exactly like the compiler.
    const candidates = included.includes('/')
      ? [
          join(request.from, included).replace(/\\/g, '/'),
          included
        ]
      : [included];
    const resolved = candidates
      .map((candidate) => byLowerPath.get(candidate.toLowerCase())
        ?? byLowerBasename.get((candidate.split('/').pop() ?? '').toLowerCase()))
      .find((candidate) => candidate !== undefined);
    if (!resolved || needed.has(resolved)) {
      continue;
    }
    needed.add(resolved);
    let content: string;
    try {
      content = await readFile(join(includeDir, resolved), 'utf8');
    } catch {
      continue;
    }
    const directory = resolved.includes('/') ? resolved.slice(0, resolved.lastIndexOf('/')) : '';
    for (const match of content.matchAll(/#\s*include\s+"([^"]+)"/g)) {
      const included = match[1].replace(/\\/g, '/');
      // `cmsis_compiler.h` includes every compiler variant behind #if guards;
      // only the selected family's header is part of the build. The A/R profile
      // trees and the other compiler headers are dead weight.
      const excluded = compilerFamily === 'armclang'
        ? /(^|\/)(cmsis_(gcc|clang|iccarm)[^/]*\.h|a-profile\/|r-profile\/)/i
        : /(^|\/)(cmsis_(armclang|clang|iccarm)[^/]*\.h|a-profile\/|r-profile\/)/i;
      if (excluded.test(included)) {
        continue;
      }
      queue.push({ from: directory, name: included });
    }
  }
  return needed;
}

/**
 * Files a generation copies into the project: the core headers the selected
 * core needs, mirrored under `CMSIS/Include` (one flat include directory, so
 * generated projects do not carry the pack's internal `CMSIS/Core/Include`
 * nesting).
 *
 * The plan is computed before the overwrite check so an existing project's
 * headers take part in it, and the copy is byte-for-byte: a CMSIS header carries
 * its own encoding and must not be rewritten as a UTF-8 string.
 *
 * Without a known core (a custom profile) every header is copied, which is the
 * safe behaviour for an unfamiliar core name.
 */
export async function planCoreHeaderCopy(
  includeDir: string,
  projectRoot: string,
  targetDir = coreProjectIncludeDir,
  core?: string,
  compilerFamily: 'gcc' | 'armclang' = 'gcc'
): Promise<CoreHeaderCopy[]> {
  const needed = core
    ? await neededCoreHeaders(includeDir, core, compilerFamily)
    : undefined;
  const plan: CoreHeaderCopy[] = [];
  const walk = async (directory: string, prefix: string): Promise<void> => {
    let dirents;
    try {
      dirents = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const dirent of dirents) {
      const source = join(directory, dirent.name);
      const relative = prefix === '' ? dirent.name : `${prefix}/${dirent.name}`;
      if (dirent.isDirectory()) {
        await walk(source, relative);
      } else if (dirent.isFile() && relative.toLowerCase().endsWith('.h')) {
        if (needed && !needed.has(relative)) {
          continue;
        }
        plan.push({
          source,
          target: join(projectRoot, targetDir, relative),
          relative: `${targetDir}/${relative}`
        });
      }
    }
  };
  await walk(includeDir, '');
  return plan.sort((left, right) => left.relative.localeCompare(right.relative));
}

/** Writes a copy plan into the project. */
export async function copyCoreHeaders(plan: CoreHeaderCopy[]): Promise<void> {
  for (const entry of plan) {
    await mkdir(dirname(entry.target), { recursive: true });
    await copyFile(entry.source, entry.target);
  }
}

export interface InstallCorePackResult {
  record: CorePackRecord;
  /** True when this install replaced a different version of the same pack. */
  replaced: boolean;
}

/**
 * Installs one CMSIS Core pack archive into the extension storage.
 *
 * Only `CMSIS/Core/Include/**` is written: the complete pack is hundreds of
 * megabytes of documentation, RTOS and DSP sources that a generated bare-metal
 * project never reads, and the include directory is all it needs.
 */
export async function installCorePack(
  buffer: Buffer,
  fileName: string,
  storageRoot: string
): Promise<InstallCorePackResult> {
  const parsed = readCorePack(buffer, fileName);
  if (!parsed) {
    throw new Error('这个包里没有 CMSIS 内核头文件（CMSIS/Core/Include），不是内核包。');
  }
  const directory = corePackDirectory(parsed.identity);
  const absoluteDirectory = join(storageRoot, directory);
  const manifest = await readManifest(storageRoot);
  const replaced = manifest.packs.some(
    (pack) => pack.vendor === parsed.identity.vendorName
      && pack.name === parsed.identity.name
      && pack.version !== parsed.identity.version
  );

  // A reinstall replaces the previous copy of the same version rather than
  // merging into it, so a pack upgrade cannot leave stale headers behind.
  // Build the new tree beside the old one and rename it into place: a failed
  // write must not destroy the headers the current projects still build with.
  const temporaryDirectory = `${absoluteDirectory}.tmp-${process.pid}-${Date.now()}`;
  try {
    await rm(temporaryDirectory, { recursive: true, force: true });
    for (const header of parsed.headers) {
      const target = join(temporaryDirectory, header.name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, header.data);
    }
    await rm(absoluteDirectory, { recursive: true, force: true });
    await rename(temporaryDirectory, absoluteDirectory);
  } catch (error) {
    await rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  const record: CorePackRecord = {
    vendor: parsed.identity.vendorName,
    name: parsed.identity.name,
    version: parsed.identity.version,
    includeDir: `${directory}/${coreIncludePrefix}`,
    files: parsed.headers.length,
    sourceFile: fileName.split(/[/\\]/).pop() ?? fileName,
    installedAt: new Date().toISOString()
  };
  manifest.packs = [
    ...manifest.packs.filter(
      (pack) => !(pack.vendor === record.vendor
        && pack.name === record.name
        && pack.version === record.version)
    ),
    record
  ];
  await writeManifest(storageRoot, manifest);
  return { record, replaced };
}

/** Every installed core pack, newest first. */
export async function listInstalledCorePacks(storageRoot: string): Promise<CorePackRecord[]> {
  const manifest = await readManifest(storageRoot);
  return [...manifest.packs].sort(
    (left, right) => comparePackVersions(right.version, left.version)
  );
}

/**
 * Include directory of the newest installed core pack, when its files are
 * actually present. Returns undefined instead of a stale path so a deleted
 * storage directory cannot make every generated project reference nothing.
 */
export async function installedCoreIncludeDir(storageRoot: string): Promise<string | undefined> {
  return (await findInstalledCorePack(storageRoot))?.includeDir;
}

export interface CorePackStatus {
  installed: boolean;
  version: string;
  /** Every installed version, newest first; the sidebar offers them as choices. */
  versions: string[];
  notice: string;
}

/** Sidebar copy describing the installed core pack, or the missing one. */
export async function describeCorePack(storageRoot: string): Promise<CorePackStatus> {
  const packs = await listInstalledCorePacks(storageRoot);
  const usable: CorePackRecord[] = [];
  for (const pack of packs) {
    if (await hasCoreHeaders(join(storageRoot, pack.includeDir))) {
      usable.push(pack);
    }
  }
  const versions = usable.map((pack) => pack.version);
  const current = usable[0];
  if (!current) {
    return {
      installed: false,
      version: '',
      versions,
      notice: '未安装 ARM CMSIS 内核包：器件头文件 #include core_cm*.h 无法编译。'
    };
  }
  return {
    installed: true,
    version: current.version,
    versions,
    notice: `已安装 ARM CMSIS 内核包 ${current.version}（${current.files} 个头文件）。`
  };
}
