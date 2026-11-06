import type { DeviceProfile, DeviceSeries, DeviceVendor } from './deviceProfiles';
import { getVendorMetadata } from './vendorRegistry';

export type DevicePackOrigin = 'builtin' | 'installed' | 'imported' | 'downloadable';

export interface DevicePackOption {
  packId: string;
  vendorId: string;
  name: string;
  version: string;
  origin: DevicePackOrigin;
  /**
   * Installation reference. For `imported` Packs this is the extension-storage
   * key that owns the profiles; for `installed` Packs it is the Keil
   * installation path, which is not a profile ownership key.
   */
  packFile?: string;
  source?: 'file' | 'directory';
  packUrl?: string;
  description?: string;
}

export interface DevicePackCatalogInput {
  vendorId: string;
  hasBuiltin: boolean;
  imported: Array<{
    packId: string;
    vendorId: string;
    name: string;
    version: string;
    packFile: string;
    vendorName: string;
    parts: string[];
  }>;
  /**
   * Installed Packs whose identity was resolved from the PDSC. `packFile` is the
   * installation reference; it is never the imported-profile ownership key.
   * `hasDevices` reports whether the PDSC yields at least one importable device.
   */
  installed: Array<{
    vendorId: string;
    name: string;
    version: string;
    packFile: string;
    source: 'file' | 'directory';
    hasDevices: boolean;
  }>;
  online: Array<{
    name: string;
    version: string;
    description: string;
    packUrl: string;
    vendorName: string;
  }>;
}

const builtinSeriesOrder = [
  'F0x', 'F1x', 'F2x', 'F3x', 'F4x', 'F7x', 'G0x', 'G4x', 'H7x',
  'L0x', 'L1x', 'L4x', 'L5x', 'U5x', 'WBx', 'WLx'
];

function seriesRank(series: DeviceSeries): number {
  const index = builtinSeriesOrder.indexOf(series);
  return index === -1 ? builtinSeriesOrder.length : index;
}

export function listDeviceVendors(profiles: DeviceProfile[]): DeviceVendor[] {
  return [...new Set(profiles.map((profile) => profile.vendor))]
    .sort((left, right) =>
      getVendorMetadata(left).order - getVendorMetadata(right).order
    );
}

export function listDeviceSeries(profiles: DeviceProfile[], vendor: DeviceVendor): DeviceSeries[] {
  return [...new Set(
    profiles
      .filter((profile) => profile.vendor === vendor)
      .map((profile) => profile.series)
  )].sort((left, right) =>
    seriesRank(left) - seriesRank(right) || left.localeCompare(right)
  );
}

export function listDeviceProfilesForSeries(
  profiles: DeviceProfile[],
  vendor: DeviceVendor,
  series: DeviceSeries
): DeviceProfile[] {
  return profiles
    .filter((profile) => profile.vendor === vendor && profile.series === series)
    .sort((left, right) => left.part.localeCompare(right.part));
}

export function buildDevicePackOptions(input: DevicePackCatalogInput): DevicePackOption[] {
  const options = new Map<string, DevicePackOption>();
  const add = (option: DevicePackOption): void => {
    options.set(`${option.packId}\0${option.version}`, option);
  };

  if (input.hasBuiltin) {
    add({
      packId: `builtin:${input.vendorId}`,
      vendorId: input.vendorId,
      name: '内置芯片支持',
      version: 'builtin',
      origin: 'builtin'
    });
  }

  for (const pack of input.imported) {
    if (pack.vendorId !== input.vendorId || pack.parts.length === 0) {
      continue;
    }
    add({
      packId: pack.packId,
      vendorId: pack.vendorId,
      name: pack.name,
      version: pack.version,
      origin: 'imported',
      packFile: pack.packFile
    });
  }

  for (const pack of input.installed) {
    if (pack.vendorId !== input.vendorId || !pack.hasDevices) {
      continue;
    }
    const packId = `${pack.vendorId}:${pack.name}`;
    const key = `${packId}\0${pack.version}`;
    if (!options.has(key)) {
      add({
        packId,
        vendorId: pack.vendorId,
        name: pack.name,
        version: pack.version,
        origin: 'installed',
        packFile: pack.packFile,
        source: pack.source
      });
    }
  }

  for (const pack of input.online) {
    const packId = `${input.vendorId}:${pack.name}`;
    const key = `${packId}\0${pack.version}`;
    if (!options.has(key)) {
      add({
        packId,
        vendorId: input.vendorId,
        name: pack.name,
        version: pack.version,
        origin: 'downloadable',
        packUrl: pack.packUrl,
        description: pack.description
      });
    }
  }

  return [...options.values()].sort((left, right) => {
    if (left.origin === 'builtin') return -1;
    if (right.origin === 'builtin') return 1;
    return left.name.localeCompare(right.name)
      || comparePackVersions(left.version, right.version)
      || left.origin.localeCompare(right.origin);
  });
}

/** Numeric-aware Pack version ordering for catalog display and defaults. */
export function comparePackVersions(left: string, right: string): number {
  const a = left.split(/[._-]/).map((part) => Number(part) || 0);
  const b = right.split(/[._-]/).map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
