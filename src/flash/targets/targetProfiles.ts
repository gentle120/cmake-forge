import { stm32FlashTargets } from './stm32';
import { gd32FlashTargets } from './gd32';
import type { DeviceProfile } from '../../devices/deviceProfiles';
import { getVendorMetadata } from '../../devices/vendorRegistry';

export type FlashTargetVendor = string;
export type FlashTargetTransport = 'swd' | 'jtag';

export interface FlashTargetProfile {
  id: string;
  label: string;
  vendor: FlashTargetVendor;
  series: string;
  targetConfig: string;
  transport: FlashTargetTransport;
  flashBase: number;
}

const allFlashTargets: FlashTargetProfile[] = [...stm32FlashTargets, ...gd32FlashTargets];
const targetMap = new Map(allFlashTargets.map((target) => [target.id, target]));

export function listFlashTargetProfiles(): FlashTargetProfile[] {
  return allFlashTargets.map((target) => ({ ...target }));
}

export function listFlashTargetVendors(): FlashTargetVendor[] {
  return [...new Set(allFlashTargets.map((target) => target.vendor))];
}

export function listFlashTargetSeries(vendor: FlashTargetVendor): string[] {
  return [...new Set(
    allFlashTargets
      .filter((target) => target.vendor === vendor)
      .map((target) => target.series)
  )];
}

export function listFlashTargetsForSeries(vendor: FlashTargetVendor, series: string): FlashTargetProfile[] {
  return allFlashTargets
    .filter((target) => target.vendor === vendor && target.series === series)
    .map((target) => ({ ...target }));
}

export function getFlashTargetProfile(id: string): FlashTargetProfile {
  const target = targetMap.get(id.trim().toLowerCase());
  if (!target) {
    throw new Error(`Unsupported flash target: ${id}`);
  }
  return { ...target };
}

export function getFlashTargetProfileForDevice(profile: Pick<DeviceProfile, 'vendor' | 'debugTarget'>): FlashTargetProfile {
  if (!profile.debugTarget) {
    throw new Error('The selected MCU has no OpenOCD target mapping.');
  }

  const targetConfig = `target/${profile.debugTarget}.cfg`;
  const matches = allFlashTargets.filter((candidate) => candidate.targetConfig === targetConfig);
  // The target table names vendors by product family (`STM32`, `GD32`), while a
  // registered vendor carries a PDSC display name, a registry id, and define
  // prefixes. Compare all of them: an imported Pack registers `GigaDevice`,
  // whose define prefix is `GD32`, so comparing only the display name would
  // silently fall back to the first match (an STM32 entry sharing the cfg).
  const metadata = getVendorMetadata(profile.vendor);
  const vendorKeys = [metadata.label, metadata.id, ...metadata.definePrefixes]
    .map((value) => value.toUpperCase())
    .filter((value) => value.length > 0);
  const target = matches.find((candidate) =>
    vendorKeys.some((key) => key === candidate.vendor.toUpperCase())
  ) ?? matches.find((candidate) =>
    vendorKeys.some((key) =>
      key.startsWith(candidate.vendor.toUpperCase())
      || candidate.vendor.toUpperCase().startsWith(key)
    )
  ) ?? matches[0];
  if (!target) {
    throw new Error(`Unsupported OpenOCD target mapping: ${profile.vendor}/${profile.debugTarget}`);
  }
  return { ...target };
}
