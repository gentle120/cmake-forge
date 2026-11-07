/**
 * The ARM CMSIS Core pack (`ARM.CMSIS`) is not a device pack: it ships the
 * `core_cm*.h` headers that every vendor device header includes, but no chips.
 *
 * A generated MCU project cannot compile without them — `stm32f10x.h` includes
 * `core_cm3.h` and `gd32f4xx.h` includes `core_cm4.h`, neither of which exists
 * in the vendor DFP. The core pack is therefore installed separately and its
 * include directory is added to every generated project.
 */

import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { comparePackVersions } from '../shared/packVersion';
import { packNameFromFileName } from './packIdentity';
import { parsePackIdentity, type PackIdentity } from './packParser';
import { readZipEntries } from './zipReader';

/** CMSIS Core headers live in this directory inside the pack. */
export const coreIncludePrefix = 'CMSIS/Core/Include';

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

/** Selects the archive entries a core pack is made of: PDSC plus Core headers. */
export function isCorePackSourceEntry(name: string): boolean {
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

/** Filesystem-safe directory name for one installed core pack version. */
function corePackDirectory(identity: PackIdentity): string {
  const raw = `${identity.vendorName}.${identity.name}.${identity.version}`;
  return `cores/${raw.replace(/[^A-Za-z0-9._-]/g, '_')}`;
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
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
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
    (pack) => pack.name === parsed.identity.name && pack.version !== parsed.identity.version
  );

  // A reinstall replaces the previous copy of the same version rather than
  // merging into it, so a pack upgrade cannot leave stale headers behind.
  await rm(absoluteDirectory, { recursive: true, force: true });
  for (const header of parsed.headers) {
    const target = join(absoluteDirectory, header.name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, header.data);
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
      (pack) => !(pack.name === record.name && pack.version === record.version)
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
  for (const pack of await listInstalledCorePacks(storageRoot)) {
    const absolute = join(storageRoot, pack.includeDir);
    try {
      const names = await readdir(absolute);
      if (names.some((name) => /^core_cm.*\.h$/i.test(name))) {
        return absolute;
      }
    } catch {
      // Missing directory: fall through to the next installed pack.
    }
  }
  return undefined;
}

/** Sidebar copy describing the installed core pack, or the missing one. */
export async function describeCorePack(
  storageRoot: string
): Promise<{ installed: boolean; version: string; notice: string }> {
  const packs = await listInstalledCorePacks(storageRoot);
  const includeDir = await installedCoreIncludeDir(storageRoot);
  const current = packs.find((pack) => includeDir !== undefined && join(storageRoot, pack.includeDir) === includeDir);
  if (!current) {
    return {
      installed: false,
      version: '',
      notice: '未安装 ARM CMSIS 内核包：器件头文件 #include core_cm*.h 无法编译。'
    };
  }
  return {
    installed: true,
    version: current.version,
    notice: `已安装 ARM CMSIS 内核包 ${current.version}（${current.files} 个头文件）。`
  };
}
