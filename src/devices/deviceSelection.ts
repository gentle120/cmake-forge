import type { DeviceProfile, DeviceSeries, DeviceVendor } from './deviceProfiles';
import { getVendorMetadata } from './vendorRegistry';

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
