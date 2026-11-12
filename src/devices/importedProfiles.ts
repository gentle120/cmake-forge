import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve, sep } from 'node:path';
import {
  parsePackEntries,
  isPackDeviceSourceEntry,
  type PackDeviceCandidate
} from '../packs/packParser';
import { findAdjacentPackArchive, readDirectoryEntries } from '../packs/packFs';
import {
  annotateDeviceHeaders,
  removeDeviceSupportSnapshot,
  writeDeviceSupportSnapshot
} from '../packs/deviceSupport';
import { readZipEntries } from '../packs/zipReader';
import {
  packNameFromFileName,
  packVendorDisplayName,
  packVendorId
} from '../packs/packIdentity';
import {
  registerDeviceProfiles,
  unregisterDeviceProfilesByPack,
  type DeviceProfile
} from './deviceProfiles';
import { validateDeviceProfile } from './profileValidation';
import { getVendorMetadata, hasVendor, importedVendorBaseOrder, registerVendor } from './vendorRegistry';

export interface ImportedPackRecord {
  packId: string;
  vendorId: string;
  name: string;
  version: string;
  packFile: string;
  source: 'archive' | 'directory';
  /** Absolute path to the real .pack archive used by pyOCD, when available. */
  archiveFile?: string;
  /**
   * Directory a directory-sourced Pack was imported from. Kept so the device
   * support snapshot can be rebuilt when the record predates it.
   */
  sourceRoot?: string;
  vendorName: string;
  importedAt: string;
  parts: string[];
}

export interface ImportPackResult {
  imported: string[];
  skipped: Array<{ part: string; reason: string }>;
  pack?: Pick<ImportedPackRecord, 'packId' | 'vendorId' | 'name' | 'version' | 'packFile'>;
}

export interface PackIdentityMetadata {
  name?: string;
  version?: string;
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
  storageRoot: string,
  metadata?: PackIdentityMetadata
): Promise<ImportPackResult> {
  return queueStoreWrite(storageRoot, async () => {
    const entries = readZipEntries(buffer, isPackDeviceSourceEntry);
    const { vendorName, devices } = parsePackEntries(entries);
    annotateDeviceHeaders(devices, entries);
    return importParsedPack(
      devices,
      vendorName,
      basename(fileName),
      storageRoot,
      SOURCE_ARCHIVE,
      async (packDir, packFile) => {
        await writeFile(join(packDir, packFile), buffer);
      },
      entries,
      undefined,
      undefined,
      metadata
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
  storageRoot: string,
  metadata?: PackIdentityMetadata
): Promise<ImportPackResult> {
  return queueStoreWrite(storageRoot, async () => {
    const entries = await readDirectoryEntries(root, isPackDeviceSourceEntry);
    const { vendorName, devices } = parsePackEntries(entries);
    annotateDeviceHeaders(devices, entries);
    const fileName = basename(pdscPath).replace(/\.pdsc$/i, '.pack');
    return importParsedPack(
      devices,
      vendorName,
      fileName,
      storageRoot,
      SOURCE_DIRECTORY,
      async () => {
        // Directory packs stay where the pack manager put them.
      },
      entries,
      await findAdjacentPackArchive(root),
      root,
      metadata
    );
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
  const vendorId = record.vendorId || packVendorId(record.vendorName);
  const identity = record.packId && record.name && record.version
    ? {
        packId: record.packId,
        vendorId,
        name: record.name,
        version: record.version
      }
    : packIdentity(record.packFile, vendorId, packVendorDisplayName(record.vendorName));
  return {
    ...record,
    ...identity,
    source,
    archiveFile: record.archiveFile
      ? normalizedPackPath(record.packFile, storageRoot, record.archiveFile)
      : source === SOURCE_ARCHIVE
        ? runtimeArchivePath(storageRoot, record.packFile)
        : undefined,
    parts: [...record.parts]
  };
}

/** True when the Pack ships the header a device declares. */
function packContainsHeader(entries: Array<{ name: string }>, header: string): boolean {
  const normalized = header.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const base = normalized.split('/').pop() ?? normalized;
  return entries.some((entry) => {
    const name = entry.name.replace(/\\/g, '/').toLowerCase();
    return name === normalized || name.endsWith(`/${base}`) || name.split('/').pop() === base;
  });
}

async function importParsedPack(
  devices: PackDeviceCandidate[],
  vendorName: string,
  packFile: string,
  storageRoot: string,
  source: 'archive' | 'directory',
  storePackFile: (packDir: string, packFile: string) => Promise<void>,
  entries: Array<{ name: string; data: Buffer }>,
  archiveFile?: string,
  sourceRoot?: string,
  metadata?: PackIdentityMetadata
): Promise<ImportPackResult> {
  const vendorLabel = packVendorDisplayName(vendorName);
  const vendorId = packVendorId(vendorLabel);
  const identity = packIdentity(packFile, vendorId, vendorLabel, metadata);
  const packFilePath = ['packs', vendorId, packFile].join('/');

  const store = await readStore(storageRoot);
  const existingPack = store.packs.some((record) => record.packFile === packFilePath);

  const firstUsableSeries = devices.find((device) => !device.error)?.series ?? '';
  await ensureVendor(store, vendorId, vendorLabel, firstUsableSeries);

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
    if (device.header && !packContainsHeader(entries, device.header)) {
      result.skipped.push({ part: device.part, reason: `device header ${device.header} is missing from the Pack` });
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
  // Snapshot the device header and system files next to the archive: a later
  // generation must not depend on the Pack install still being available.
  await writeDeviceSupportSnapshot(storageRoot, packFilePath, entries);

  store.packs = store.packs.filter((record) => record.packFile !== packFilePath);
  store.profiles = store.profiles.filter((stored) => stored.packFile !== packFilePath);
  store.profiles.push(...importedProfiles);
  store.packs.push({
    ...identity,
    packFile: packFilePath,
    source,
    archiveFile: archiveFile
      ? resolve(archiveFile)
      : source === SOURCE_ARCHIVE
        ? runtimeArchivePath(storageRoot, packFilePath)
        : undefined,
    sourceRoot,
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
  return metadata ? {
    ...result,
    pack: { ...identity, packFile: packFilePath }
  } : result;
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
    await removeDeviceSupportSnapshot(storageRoot, normalized);
  });
}

/**
 * Driver-library switches a DFP may declare.
 *
 * The generated project ships the device header, not the vendor's StdPeriph
 * library, so keeping `USE_STDPERIPH_DRIVER` makes the device header include a
 * `*_conf.h` that pulls in driver headers which are intentionally absent.
 * Users who add their own driver folder add the define back themselves.
 */
function withoutDriverSwitches(defines: string[]): string[] {
  return defines.filter((define) => !/^USE_(STD|STANDARD)_?PERIPH(ERAL)?_DRIVER$/i.test(define));
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
    defines: withoutDriverSwitches(device.defines),
    compilerFlags: compilerFlagsFor(device.core, device.fpu),
    flash: { ...device.flash },
    ram: { ...device.ram },
    additionalMemory: device.additionalMemory.map((region) => ({ ...region })),
    linkerFileName: `${device.part}.ld`,
    gnuStartupFileName: `startup_${device.part}.S`,
    toolchainFileName: `${packVendorId(vendorName + device.family).toLowerCase()}-toolchain.cmake`,
    interruptHandlers: [...(device.interruptHandlers ?? [])],
    debugTarget: debugTargetForSeries(device.series, vendorId),
    deviceHeader: device.header
  };
}

/** Cores that can carry an FPU at all; a Dfpu claim on other cores is pack junk. */
const FPU_CAPABLE_CORES = new Set(['cortex-m4', 'cortex-m7', 'cortex-m33', 'cortex-m35p', 'cortex-m52', 'cortex-m55', 'cortex-m85']);

function compilerFlagsFor(core: string, fpu: string): string[] {
  // GCC (and armclang) have no `-mcpu=sc000/sc300`; these legacy SecurCore
  // parts are architecturally ARMv6-M / ARMv7-M, so build them with the
  // equivalent Cortex-M core flag while keeping the vendor core header.
  const gccCore = core === 'sc000' ? 'cortex-m0' : core === 'sc300' ? 'cortex-m3' : core;
  const flags = [`-mcpu=${gccCore}`, '-mthumb'];
  if (!FPU_CAPABLE_CORES.has(core) || fpu.length === 0 || fpu.toUpperCase() === 'NO_FPU') {
    return flags;
  }
  const isDoublePrecision = /DP/i.test(fpu);
  if (core === 'cortex-m4') {
    flags.push('-mfpu=fpv4-sp-d16', '-mfloat-abi=hard');
  } else if (core === 'cortex-m7' || core === 'cortex-m55') {
    // Cortex-M55's FPU is FPv5 and comes in single- and double-precision builds.
    flags.push(isDoublePrecision ? '-mfpu=fpv5-d16' : '-mfpu=fpv5-sp-d16', '-mfloat-abi=hard');
  } else {
    flags.push('-mfpu=fpv5-sp-d16', '-mfloat-abi=hard');
  }
  return flags;
}

function debugTargetForSeries(series: string, vendorId: string): string | undefined {
  // Only ST and GigaDevice publish DFP families whose OpenOCD target names are
  // known here. Third-party STM32-compatible vendors must not inherit an ST
  // target just because their series text happens to start with `STM32`.
  const vendor = vendorId.toLowerCase();
  const knownVendor = vendor.includes('stmicro')
    || vendor === 'st'
    || vendor.includes('gigadevice')
    || vendor === 'gd';
  if (!knownVendor) {
    return undefined;
  }
  // OpenOCD names the L0/L1 targets without the trailing x. GD32 families use
  // the same Cortex-M peripherals as their STM32 counterparts, so the GD32
  // prefix bridges to the matching STM32 target config.
  const match = /^(?:STM32|GD32)?(F0|F1|F2|F3|F4|F7|G0|G4|H7|L0|L1|L4|L5|U5|WB|WL)/.exec(series);
  if (!match) {
    return undefined;
  }
  const family = match[1].toLowerCase();
  return family === 'l0' || family === 'l1' ? `stm32${family}` : `stm32${family}x`;
}

async function ensureVendor(
  store: PackStoreFile,
  vendorId: string,
  vendorName: string,
  series: string
): Promise<void> {
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
    return;
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
      const vendorId = record.vendorId || packVendorId(record.vendorName || '');
      const identity = record.packId && record.name && record.version
        ? {
            packId: record.packId,
            vendorId,
            name: record.name,
            version: record.version
          }
        : packIdentity(
            basename(record.packFile),
            vendorId,
            packVendorDisplayName(record.vendorName || vendorId)
          );
      selectedPacks.push({ ...record, ...identity, source, archiveFile });
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
      if (code !== 'EEXIST' && code !== 'EPERM') {
        throw error;
      }
      // Windows cannot rename over an existing file. Move the current store
      // aside first and restore it when the new one cannot be installed, so a
      // failure never leaves the Pack store missing.
      const backup = `${target}.${process.pid}.${Date.now()}.bak`;
      let backedUp = false;
      try {
        await rename(target, backup);
        backedUp = true;
      } catch {
        // No current store (or it vanished): nothing to back up.
      }
      try {
        await rename(temporary, target);
      } catch (installError) {
        if (backedUp) {
          await rename(backup, target).catch(() => {});
        }
        throw installError;
      }
      if (backedUp) {
        await rm(backup, { force: true });
      }
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function packIdentity(
  packFile: string,
  vendorId: string,
  vendorName: string,
  metadata?: PackIdentityMetadata
): Pick<ImportedPackRecord, 'packId' | 'vendorId' | 'name' | 'version'> {
  const fileIdentity = packNameFromFileName(packFile);
  const vendorPrefix = `${vendorName}.`;
  const name = metadata?.name?.trim()
    || (fileIdentity.name.toLowerCase().startsWith(vendorPrefix.toLowerCase())
      ? fileIdentity.name.slice(vendorPrefix.length)
      : fileIdentity.name);
  const version = metadata?.version?.trim() || fileIdentity.version || 'unknown';
  return {
    packId: `${vendorId}:${name}`,
    vendorId,
    name,
    version
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
