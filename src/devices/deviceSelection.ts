import type { DeviceProfile, DeviceSeries, DeviceVendor } from './deviceProfiles';
import { getVendorMetadata, hasVendor } from './vendorRegistry';
import { comparePackVersions } from '../shared/packVersion';

export type DevicePackOrigin = 'installed' | 'imported' | 'downloadable';

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
    packUrl: string;
    vendorName: string;
  }>;
}

export function listDeviceVendors(profiles: DeviceProfile[]): DeviceVendor[] {
  // A profile whose vendor is not registered yet (restore order during startup)
  // must not abort the whole list: skip it until its pack registration lands.
  return [...new Set(
    profiles
      .filter((profile) => hasVendor(profile.vendor))
      .map((profile) => profile.vendor)
  )].sort((left, right) =>
    getVendorMetadata(left).order - getVendorMetadata(right).order
    || left.localeCompare(right)
  );
}

export function listDeviceSeries(profiles: DeviceProfile[], vendor: DeviceVendor): DeviceSeries[] {
  return [...new Set(
    profiles
      .filter((profile) => profile.vendor === vendor)
      .map((profile) => profile.series)
  )].sort((left, right) => left.localeCompare(right));
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
        packUrl: pack.packUrl
      });
    }
  }

  return [...options.values()].sort((left, right) =>
    left.name.localeCompare(right.name)
    || comparePackVersions(left.version, right.version)
    || left.origin.localeCompare(right.origin)
  );
}
