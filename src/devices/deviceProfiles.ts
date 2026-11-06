export interface MemoryRegion {
  origin: number;
  length: number;
}

export type DeviceSeries = string;
export type DeviceVendor = string;

export interface AdditionalMemoryRegion {
  name: string;
  attributes: 'rx' | 'rw' | 'rwx';
  origin: number;
  length: number;
}

export interface DeviceProfile {
  part: string;
  vendor: DeviceVendor;
  series: DeviceSeries;
  family: string;
  core: string;
  architecture: 'arm';
  toolchainPrefix: string;
  defines: string[];
  compilerFlags: string[];
  flash: MemoryRegion;
  ram: MemoryRegion;
  additionalMemory?: AdditionalMemoryRegion[];
  linkerFileName: string;
  gnuStartupFileName: string;
  toolchainFileName: string;
  interruptHandlers: string[];
  debugTarget?: string;
}

import { gd32Profiles } from './gd32';
import { stm32Profiles } from './stm32';
import { validateDeviceProfile } from './profileValidation';

const allProfiles = [...gd32Profiles, ...stm32Profiles];
const profiles: Record<string, DeviceProfile> = {};
const builtinProfiles = new Map<string, DeviceProfile>();
const importedProfilesByPart = new Map<string, Map<string, DeviceProfile>>();
const importedSourceByPart = new Map<string, string>();
for (const profile of allProfiles) {
  addProfile(profile, false);
  builtinProfiles.set(profile.part.toUpperCase(), profile);
}

function addProfile(profile: DeviceProfile, replace: boolean, sourcePack?: string): void {
  validateDeviceProfile(profile);
  const key = profile.part.toUpperCase();
  if (!replace && profiles[key]) {
    throw new Error(`Invalid MCU profile ${profile.part}: duplicate part`);
  }
  profiles[key] = profile;
  if (replace && sourcePack) {
    const normalizedSource = sourcePack.replace(/\\/g, '/');
    const sources = importedProfilesByPart.get(key) ?? new Map<string, DeviceProfile>();
    sources.set(normalizedSource, profile);
    importedProfilesByPart.set(key, sources);
    importedSourceByPart.set(key, normalizedSource);
  }
}

/**
 * Appends runtime-imported device profiles (CMSIS packs). Registering a part
 * again replaces the previous record so pack upgrades win.
 */
export function registerDeviceProfiles(imported: DeviceProfile[], sourcePack?: string): void {
  for (const profile of imported) {
    addProfile(profile, true, sourcePack);
  }
}

export function unregisterDeviceProfiles(parts: string[], sourcePack?: string): void {
  for (const part of parts) {
    const key = part.trim().toUpperCase();
    if (sourcePack) {
      const normalizedSource = sourcePack.replace(/\\/g, '/');
      const sources = importedProfilesByPart.get(key);
      if (!sources?.delete(normalizedSource)) {
        continue;
      }
      if (importedSourceByPart.get(key) !== normalizedSource) {
        continue;
      }
      const nextSource = [...sources.entries()].at(-1);
      if (nextSource) {
        importedSourceByPart.set(key, nextSource[0]);
        profiles[key] = nextSource[1];
        continue;
      }
    }
    importedProfilesByPart.delete(key);
    importedSourceByPart.delete(key);
    const builtin = builtinProfiles.get(key);
    if (builtin) {
      profiles[key] = builtin;
    } else {
      delete profiles[key];
    }
  }
}

/** Removes only the profiles owned by one imported pack and restores the next source. */
export function unregisterDeviceProfilesByPack(sourcePack: string): void {
  const normalizedSource = sourcePack.replace(/\\/g, '/');
  for (const [key, sources] of [...importedProfilesByPart]) {
    if (!sources.has(normalizedSource)) {
      continue;
    }
    if (importedSourceByPart.get(key) !== normalizedSource) {
      sources.delete(normalizedSource);
      continue;
    }
    sources.delete(normalizedSource);
    const nextSource = [...sources.entries()].at(-1);
    if (nextSource) {
      importedSourceByPart.set(key, nextSource[0]);
      profiles[key] = nextSource[1];
      continue;
    }
    importedProfilesByPart.delete(key);
    importedSourceByPart.delete(key);
    const builtin = builtinProfiles.get(key);
    if (builtin) {
      profiles[key] = builtin;
    } else {
      delete profiles[key];
    }
  }
}

function copyProfile(profile: DeviceProfile): DeviceProfile {
  return {
    ...profile,
    defines: [...profile.defines],
    compilerFlags: [...profile.compilerFlags],
    interruptHandlers: [...profile.interruptHandlers],
    flash: { ...profile.flash },
    ram: { ...profile.ram },
    additionalMemory: profile.additionalMemory?.map((region) => ({ ...region }))
  };
}

export function listDeviceProfiles(): DeviceProfile[] {
  return Object.values(profiles).map(copyProfile);
}

export function getDeviceProfile(part: string): DeviceProfile {
  const profile = profiles[part.trim().toUpperCase()];
  if (!profile) {
    throw new Error(`Unsupported MCU: ${part}`);
  }
  return copyProfile(profile);
}

/** Lists only the built-in or imported profiles owned by one selected Pack. */
export function listDeviceProfilesForPack(sourcePack: string): DeviceProfile[] {
  if (sourcePack.startsWith('builtin:')) {
    const vendor = sourcePack.slice('builtin:'.length);
    return [...builtinProfiles.values()]
      .filter((profile) => profile.vendor === vendor)
      .map(copyProfile);
  }
  const normalizedSource = sourcePack.replace(/\\/g, '/');
  const owned = [...importedProfilesByPart.values()]
    .map((sources) => sources.get(normalizedSource))
    .filter((profile): profile is DeviceProfile => profile !== undefined);
  return owned.map(copyProfile);
}

/** Resolves a device from its selected Pack, not from the global latest override. */
export function getDeviceProfileForPack(part: string, sourcePack: string): DeviceProfile {
  const selected = part.trim().toUpperCase();
  const profile = listDeviceProfilesForPack(sourcePack)
    .find((candidate) => candidate.part.toUpperCase() === selected);
  if (!profile) {
    throw new Error(`Unsupported MCU: ${part} in Pack ${sourcePack}`);
  }
  return profile;
}

/** True when the current registry entry came from an imported pack. */
export function isRuntimeDeviceProfile(part: string): boolean {
  return importedSourceByPart.has(part.trim().toUpperCase());
}
