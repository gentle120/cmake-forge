import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { parsePack, parsePackEntries, type PackDeviceCandidate } from '../packs/packParser';
import { readDirectoryEntries } from '../packs/packFs';
import { registerDeviceProfiles, type DeviceProfile } from './deviceProfiles';
import { validateDeviceProfile } from './profileValidation';
import { getVendorMetadata, hasVendor, importedVendorBaseOrder, registerVendor } from './vendorRegistry';

export interface ImportedPackRecord {
  packFile: string;
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
  version: 1;
  packs: ImportedPackRecord[];
  vendors: StoredVendor[];
  profiles: StoredProfile[];
}

const EMPTY_STORE: PackStoreFile = { version: 1, packs: [], vendors: [], profiles: [] };

export async function importPack(
  buffer: Buffer,
  fileName: string,
  storageRoot: string
): Promise<ImportPackResult> {
  const { vendorName, devices } = parsePack(buffer);
  return importParsedPack(devices, vendorName, basename(fileName), storageRoot, async (packDir, packFile) => {
    await writeFile(join(packDir, packFile), buffer);
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
  const entries = await readDirectoryEntries(root);
  const { vendorName, devices } = parsePackEntries(entries);
  const fileName = basename(pdscPath).replace(/\.pdsc$/i, '.pack');
  return importParsedPack(devices, vendorName, fileName, storageRoot, async () => {
    // Directory packs stay where the pack manager put them.
  });
}

async function importParsedPack(
  devices: PackDeviceCandidate[],
  vendorName: string,
  packFile: string,
  storageRoot: string,
  storePackFile: (packDir: string, packFile: string) => Promise<void>
): Promise<ImportPackResult> {
  const vendorId = sanitizeIdentifier(vendorName);
  const vendorLabel = vendorDisplayName(vendorName);
  const packFilePath = ['packs', vendorId, packFile].join('/');

  const store = await readStore(storageRoot);
  dropPackRecord(store, packFilePath);

  const firstUsableSeries = devices.find((device) => !device.error)?.series ?? '';
  const vendor = await ensureVendor(store, vendorId, vendorLabel, firstUsableSeries);

  const result: ImportPackResult = { imported: [], skipped: [] };
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
      registerDeviceProfiles([profile]);
    } catch (error) {
      result.skipped.push({ part: device.part, reason: errorMessage(error) });
      continue;
    }
    result.imported.push(profile.part);
    store.profiles.push({ packFile: packFilePath, profile });
  }

  const packDir = join(storageRoot, 'packs', vendorId);
  await mkdir(packDir, { recursive: true });
  await storePackFile(packDir, packFile);

  store.packs.push({
    packFile: packFilePath,
    vendorName: vendorLabel,
    importedAt: new Date().toISOString(),
    parts: result.imported
  });
  await writeStore(storageRoot, store);
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
  for (const stored of store.profiles) {
    try {
      validateDeviceProfile(stored.profile);
      registerDeviceProfiles([stored.profile]);
    } catch {
      continue;
    }
    loaded.push(stored.profile);
  }
  return loaded;
}

export async function listImportedPacks(storageRoot: string): Promise<ImportedPackRecord[]> {
  const store = await readStore(storageRoot);
  return store.packs.map((record) => ({ ...record, parts: [...record.parts] }));
}

export async function removePack(storageRoot: string, packFile: string): Promise<void> {
  const normalized = packFile.replace(/\\/g, '/');
  const store = await readStore(storageRoot);
  const stillPresent = store.packs.some((record) => record.packFile === normalized);
  if (!stillPresent) {
    return;
  }
  store.packs = store.packs.filter((record) => record.packFile !== normalized);
  store.profiles = store.profiles.filter((stored) => stored.packFile !== normalized);
  await writeStore(storageRoot, store);
  const packPath = join(storageRoot, normalized);
  if (resolve(packPath).startsWith(resolve(storageRoot) + sep)) {
    await rm(packPath, { force: true });
  }
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

function dropPackRecord(store: PackStoreFile, packFilePath: string): void {
  store.packs = store.packs.filter((record) => record.packFile !== packFilePath);
  store.profiles = store.profiles.filter((stored) => stored.packFile !== packFilePath);
}

async function readStore(storageRoot: string): Promise<PackStoreFile> {
  try {
    const raw = await readFile(join(storageRoot, 'packs.json'), 'utf8');
    const parsed = JSON.parse(raw) as Partial<PackStoreFile>;
    return {
      version: 1,
      packs: Array.isArray(parsed.packs) ? parsed.packs : [],
      vendors: Array.isArray(parsed.vendors) ? parsed.vendors : [],
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : []
    };
  } catch {
    return { ...EMPTY_STORE, packs: [], vendors: [], profiles: [] };
  }
}

async function writeStore(storageRoot: string, store: PackStoreFile): Promise<void> {
  await writeFile(join(storageRoot, 'packs.json'), `${JSON.stringify(store, null, 2)}\n`, 'utf8');
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
