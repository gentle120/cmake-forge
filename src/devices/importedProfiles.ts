import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import { parsePack, parsePackEntries, type PackDeviceCandidate } from '../packs/packParser';
import { findAdjacentPackArchive, readDirectoryEntries } from '../packs/packFs';
import {
  registerDeviceProfiles,
  unregisterDeviceProfilesByPack,
  type DeviceProfile
} from './deviceProfiles';
import { validateDeviceProfile } from './profileValidation';
import { getVendorMetadata, hasVendor, importedVendorBaseOrder, registerVendor } from './vendorRegistry';

export interface ImportedPackRecord {
  packFile: string;
  source: 'archive' | 'directory';
  /** Absolute path to the real .pack archive used by pyOCD, when available. */
  archiveFile?: string;
  vendorName: string;
  importedAt: string;
  parts: string[];
}

export interface ImportPackResult {
  imported: string[];
  skipped: Array<{ part: string; reason: string }>;
}

interface StoredVendor {
  id: string;
  label: string;
  definePrefixes: string[];
  order: number;
}

interface StoredProfile {
  packFile: string;
  profile: DeviceProfile;
}

interface PackStoreFile {
  version: 2;
  packs: ImportedPackRecord[];
  vendors: StoredVendor[];
  profiles: StoredProfile[];
}

const EMPTY_STORE: PackStoreFile = { version: 2, packs: [], vendors: [], profiles: [] };
const SOURCE_ARCHIVE = 'archive' as const;
const SOURCE_DIRECTORY = 'directory' as const;
const storeQueues = new Map<string, Promise<unknown>>();

export async function importPack(
  buffer: Buffer,
  fileName: string,
  storageRoot: string
): Promise<ImportPackResult> {
  return queueStoreWrite(storageRoot, async () => {
    const { vendorName, devices } = parsePack(buffer);
    return importParsedPack(
      devices,
      vendorName,
      basename(fileName),
      storageRoot,
      SOURCE_ARCHIVE,
      async (packDir, packFile) => {
        await writeFile(join(packDir, packFile), buffer);
      }
    );
  });
}

/**
 * Imports an extracted CMSIS pack directory (the Keil installation layout).
 * The directory is referenced in place, not copied into the storage root.
 */
export async function importPackDirectory(
  root: string,
  pdscPath: string,
  storageRoot: string
): Promise<ImportPackResult> {
  return queueStoreWrite(storageRoot, async () => {
    const entries = await readDirectoryEntries(root);
    const { vendorName, devices } = parsePackEntries(entries);
    const fileName = basename(pdscPath).replace(/\.pdsc$/i, '.pack');
    return importParsedPack(devices, vendorName, fileName, storageRoot, SOURCE_DIRECTORY, async () => {
      // Directory packs stay where the pack manager put them.
    }, await findAdjacentPackArchive(root));
  });
}

function queueStoreWrite<T>(storageRoot: string, operation: () => Promise<T>): Promise<T> {
  const key = resolve(storageRoot);
  const previous = storeQueues.get(key) ?? Promise.resolve();
  const current = previous
    .catch(() => undefined)
    .then(operation);
  storeQueues.set(key, current);
  return current.finally(() => {
    if (storeQueues.get(key) === current) {
      storeQueues.delete(key);
    }
  });
}

function runtimeArchivePath(storageRoot: string, packFilePath: string): string {
  return resolve(storageRoot, packFilePath);
}

function normalizedPackPath(packFile: string, storageRoot: string, archiveFile?: string): string {
  if (archiveFile) {
    return isAbsolute(archiveFile)
      ? resolve(archiveFile)
      : resolve(storageRoot, archiveFile);
  }
  return runtimeArchivePath(storageRoot, packFile);
}

async function isRealFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function sourceOf(record: Partial<ImportedPackRecord>): 'archive' | 'directory' {
  return record.source === SOURCE_DIRECTORY ? SOURCE_DIRECTORY : SOURCE_ARCHIVE;
}

function copyRecord(record: ImportedPackRecord, storageRoot: string): ImportedPackRecord {
  const source = sourceOf(record);
  return {
    ...record,
    source,
    archiveFile: record.archiveFile
      ? normalizedPackPath(record.packFile, storageRoot, record.archiveFile)
      : source === SOURCE_ARCHIVE
        ? runtimeArchivePath(storageRoot, record.packFile)
        : undefined,
    parts: [...record.parts]
  };
}

async function importParsedPack(
  devices: PackDeviceCandidate[],
  vendorName: string,
  packFile: string,
  storageRoot: string,
  source: 'archive' | 'directory',
  storePackFile: (packDir: string, packFile: string) => Promise<void>,
  archiveFile?: string
): Promise<ImportPackResult> {
  const vendorId = sanitizeIdentifier(vendorName);
  const vendorLabel = vendorDisplayName(vendorName);
  const packFilePath = ['packs', vendorId, packFile].join('/');

  const store = await readStore(storageRoot);
  const existingPack = store.packs.some((record) => record.packFile === packFilePath);

  const firstUsableSeries = devices.find((device) => !device.error)?.series ?? '';
  const vendor = await ensureVendor(store, vendorId, vendorLabel, firstUsableSeries);

  const result: ImportPackResult = { imported: [], skipped: [] };
  const importedProfiles: StoredProfile[] = [];
  for (const device of devices) {
    if (device.error) {
      result.skipped.push({ part: device.part || '(unnamed device)', reason: device.error });
      continue;
    }
    if (!device.interruptHandlers || device.interruptHandlers.length === 0) {
      result.skipped.push({ part: device.part || '(unnamed device)', reason: 'no interrupt source' });
      continue;
    }
    const profile = packDeviceToProfile(device, vendorId, vendorLabel);
    try {
      validateDeviceProfile(profile);
    } catch (error) {
      result.skipped.push({ part: device.part, reason: errorMessage(error) });
      continue;
    }
    result.imported.push(profile.part);
    importedProfiles.push({ packFile: packFilePath, profile });
  }

  // A broken upgrade must not erase the last known-good pack.
  if (existingPack && result.imported.length === 0) {
    return result;
  }

  const packDir = join(storageRoot, 'packs', vendorId);
  await mkdir(packDir, { recursive: true });
  await storePackFile(packDir, packFile);

  store.packs = store.packs.filter((record) => record.packFile !== packFilePath);
  store.profiles = store.profiles.filter((stored) => stored.packFile !== packFilePath);
  store.profiles.push(...importedProfiles);
  store.packs.push({
    packFile: packFilePath,
    source,
    archiveFile: archiveFile
      ? resolve(archiveFile)
      : source === SOURCE_ARCHIVE
        ? runtimeArchivePath(storageRoot, packFilePath)
        : undefined,
    vendorName: vendorLabel,
    importedAt: new Date().toISOString(),
    parts: result.imported
  });
  await writeStore(storageRoot, store);
  unregisterDeviceProfilesByPack(packFilePath);
  registerDeviceProfiles(
    importedProfiles.map((stored) => stored.profile),
    packFilePath
  );
  return result;
}

/**
 * Restores imported profiles from packs.json: vendors that are missing from
 * the runtime registry are re-registered first so profile validation passes.
 */
export async function loadImportedProfiles(storageRoot: string): Promise<DeviceProfile[]> {
  const store = await readStore(storageRoot);
  const loaded: DeviceProfile[] = [];
  for (const vendor of store.vendors) {
    if (!hasVendor(vendor.id)) {
      registerVendor({
        id: vendor.id,
        label: vendor.label,
        definePrefixes: [...vendor.definePrefixes],
        order: vendor.order
      });
    }
  }
  const loadedParts = new Set<string>();
  for (const pack of store.packs) {
    const profiles = store.profiles
      .filter((stored) => stored.packFile === pack.packFile)
      .map((stored) => stored.profile)
      .filter((profile) => {
        try {
          validateDeviceProfile(profile);
          return true;
        } catch {
          return false;
        }
      });
    registerDeviceProfiles(profiles, pack.packFile);
    profiles.forEach((profile) => loadedParts.add(profile.part.toUpperCase()));
  }
  for (const stored of store.profiles) {
    if (loadedParts.has(stored.profile.part.toUpperCase())) {
      loaded.push(stored.profile);
      continue;
    }
    try {
      validateDeviceProfile(stored.profile);
      registerDeviceProfiles([stored.profile], stored.packFile);
      loaded.push(stored.profile);
    } catch {
      continue;
    }
  }
  return loaded;
}

export async function listImportedPacks(storageRoot: string): Promise<ImportedPackRecord[]> {
  const store = await readStore(storageRoot);
  return store.packs.map((record) => copyRecord(record, storageRoot));
}

export async function removePack(storageRoot: string, packFile: string): Promise<void> {
  return queueStoreWrite(storageRoot, async () => {
    const normalized = packFile.replace(/\\/g, '/');
    const store = await readStore(storageRoot);
    const pack = store.packs.find((record) => record.packFile === normalized);
    if (!pack) {
      return;
    }
    store.packs = store.packs.filter((record) => record.packFile !== normalized);
    store.profiles = store.profiles.filter((stored) => stored.packFile !== normalized);
    await writeStore(storageRoot, store);
    unregisterDeviceProfilesByPack(normalized);
    if (sourceOf(pack) === SOURCE_ARCHIVE) {
      const packPath = normalizedPackPath(normalized, storageRoot, pack.archiveFile);
      if (resolve(packPath).startsWith(resolve(storageRoot) + sep)) {
        await rm(packPath, { force: true });
      }
    }
  });
}

function packDeviceToProfile(device: PackDeviceCandidate, vendorId: string, vendorName: string): DeviceProfile {
  return {
    part: device.part,
    vendor: vendorId,
    series: device.series,
    family: device.family,
    core: device.core,
    architecture: 'arm',
    toolchainPrefix: 'arm-none-eabi',
    defines: [...device.defines],
    compilerFlags: compilerFlagsFor(device.core, device.fpu),
    flash: { ...device.flash },
    ram: { ...device.ram },
    additionalMemory: device.additionalMemory.map((region) => ({ ...region })),
    linkerFileName: `${device.part}.ld`,
    gnuStartupFileName: `startup_${device.part}.S`,
    toolchainFileName: `${sanitizeIdentifier(vendorName + device.family).toLowerCase()}-toolchain.cmake`,
    interruptHandlers: [...(device.interruptHandlers ?? [])],
    debugTarget: debugTargetForSeries(device.series)
  };
}

function compilerFlagsFor(core: string, fpu: string): string[] {
  const flags = [`-mcpu=${core}`, '-mthumb'];
  const hasFpu = fpu.length > 0 && fpu.toUpperCase() !== 'NO_FPU';
  if (!hasFpu) {
    return flags;
  }
  const isDoublePrecision = /DP/i.test(fpu);
  if (core === 'cortex-m4') {
    flags.push('-mfpu=fpv4-sp-d16', '-mfloat-abi=hard');
  } else if (core === 'cortex-m7') {
    flags.push(isDoublePrecision ? '-mfpu=fpv5-d16' : '-mfpu=fpv5-sp-d16', '-mfloat-abi=hard');
  } else if (['cortex-m23', 'cortex-m33', 'cortex-m35p', 'cortex-m55'].includes(core)) {
    flags.push('-mfpu=fpv5-sp-d16', '-mfloat-abi=hard');
  }
  return flags;
}

function debugTargetForSeries(series: string): string | undefined {
  // OpenOCD names the L0/L1 targets without the trailing x.
  const match = /^(STM32)?(F0|F1|F2|F3|F4|F7|G0|G4|H7|L0|L1|L4|L5|U5|WB|WL)/.exec(series);
  if (!match) {
    return undefined;
  }
  const family = match[2].toLowerCase();
  return family === 'l0' || family === 'l1' ? `stm32${family}` : `stm32${family}x`;
}

async function ensureVendor(
  store: PackStoreFile,
  vendorId: string,
  vendorName: string,
  series: string
): Promise<StoredVendor> {
  if (hasVendor(vendorId)) {
    const metadata = getVendorMetadata(vendorId);
    const existing = {
      id: metadata.id,
      label: metadata.label,
      definePrefixes: metadata.definePrefixes,
      order: metadata.order
    };
    store.vendors = store.vendors.some((vendor) => vendor.id === vendorId)
      ? store.vendors
      : [...store.vendors, existing];
    return existing;
  }
  const definePrefix = /^[A-Za-z]+\d*/.exec(series)?.[0] ?? vendorId;
  const order = importedVendorBaseOrder + store.vendors.length;
  registerVendor({
    id: vendorId,
    label: vendorName || vendorId,
    definePrefixes: [definePrefix],
    order
  });
  const vendor: StoredVendor = {
    id: vendorId,
    label: vendorName || vendorId,
    definePrefixes: [definePrefix],
    order
  };
  store.vendors.push(vendor);
  return vendor;
}

async function readStore(storageRoot: string): Promise<PackStoreFile> {
  const storePath = join(storageRoot, 'packs.json');
  let raw: string;
  try {
    raw = await readFile(storePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...EMPTY_STORE, packs: [], vendors: [], profiles: [] };
    }
    throw error;
  }

  let parsed: Partial<PackStoreFile>;
  try {
    parsed = JSON.parse(raw) as Partial<PackStoreFile>;
  } catch {
    throw new Error(`Invalid packs.json: expected valid JSON at ${storePath}`);
  }
  {
    const selectedPacks: ImportedPackRecord[] = [];
    for (const record of Array.isArray(parsed.packs) ? parsed.packs : []) {
      let source = sourceOf(record);
      let archiveFile = record.archiveFile
        ? normalizedPackPath(record.packFile, storageRoot, record.archiveFile)
        : undefined;
      if (!archiveFile && record.source === undefined) {
        const legacyArchive = runtimeArchivePath(storageRoot, record.packFile);
        if (await isRealFile(legacyArchive)) {
          archiveFile = legacyArchive;
        } else {
          // Version 1 could not distinguish an extracted directory from an archive.
          source = SOURCE_DIRECTORY;
        }
      } else if (!archiveFile && source === SOURCE_ARCHIVE) {
        archiveFile = runtimeArchivePath(storageRoot, record.packFile);
      }
      selectedPacks.push({ ...record, source, archiveFile });
    }
    return {
      version: 2,
      packs: selectedPacks,
      vendors: Array.isArray(parsed.vendors) ? parsed.vendors : [],
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : []
    };
  }
}

async function writeStore(storageRoot: string, store: PackStoreFile): Promise<void> {
  const target = join(storageRoot, 'packs.json');
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  const content = `${JSON.stringify(store, null, 2)}\n`;
  await writeFile(temporary, content, 'utf8');
  try {
    JSON.parse(await readFile(temporary, 'utf8'));
    try {
      await rename(temporary, target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      // POSIX replaces atomically; Windows reports EEXIST/EPERM and needs no target left behind.
      if (code === 'EEXIST' || code === 'EPERM') {
        await rm(target, { force: true });
      } else {
        throw error;
      }
      await rename(temporary, target);
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function sanitizeIdentifier(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'Unknown';
}

/** PDSC Dvendor values carry a numeric suffix ('Sinomcu:985'); drop it for display. */
function vendorDisplayName(vendorName: string): string {
  return vendorName.replace(/:\d+$/, '') || vendorName;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
