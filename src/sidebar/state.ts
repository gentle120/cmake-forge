import {
  listDeviceProfiles,
  type DeviceSeries,
  type DeviceVendor
} from '../devices/deviceProfiles';
import {
  listDeviceProfilesForSeries,
  listDeviceSeries,
  listDeviceVendors
} from '../devices/deviceSelection';
import { listFlashProbeProfiles, type FlashProbeId } from '../flash/probeProfiles';
import { listFlashTargetProfiles } from '../flash/targets/targetProfiles';
import { buildLinuxToolchainChoices } from '../linux/toolchainChoices';
import {
  getLinuxToolchainDefaults,
  isLinuxToolchainFamily,
  type LinuxToolchainFamily,
  type LinuxToolchainHit
} from '../linux/types';
import { getVendorMetadata, hasVendor } from '../devices/vendorRegistry';
import { backendSupportsProbe, listFlashBackendProfiles, type FlashBackendId } from '../flash/backendProfiles';
import { inspectArmToolchainPath, type ArmToolchainStatus } from '../env/armToolchain';

export type SidebarMode = 'mcu' | 'linux' | 'native';

export interface SidebarFlashSelection {
  enabled: boolean;
  targetId: string;
  probeId: FlashProbeId;
  openocdPath: string;
  backend: FlashBackendId;
}

export interface SidebarSelection {
  mode: SidebarMode;
  mcu: {
    vendor: DeviceVendor;
    series: DeviceSeries;
    part: string;
  };
  linux: {
    toolchainFamily: LinuxToolchainFamily;
  };
  native: {
    targetType: 'executable' | 'static' | 'shared';
    cStandard: 11 | 17 | 23;
    cxxStandard: 14 | 17 | 20 | 23;
  };
  debugEnabled: boolean;
  flash: SidebarFlashSelection;
}

export interface SidebarOption {
  value: string;
  label: string;
  description?: string;
  detail?: string;
}

export interface SidebarBootstrapState {
  workspaceName: string;
  vendors: SidebarOption[];
  series: SidebarOption[];
  devices: SidebarOption[];
  flashTargets: SidebarOption[];
  flashProbes: SidebarOption[];
  flashBackends: SidebarOption[];
  linuxToolchains: SidebarOption[];
  armToolchain: ArmToolchainStatus;
  selection: SidebarSelection;
}

const defaultMode: SidebarMode = 'mcu';
const defaultVendor: DeviceVendor = 'STM';
const defaultSeries: DeviceSeries = 'F1x';
const defaultPart = 'STM32F103C8T6';
const defaultLinuxToolchain: LinuxToolchainFamily = 'loongson';
const defaultFlashTarget = 'stm32f1xx';
const defaultFlashProbe = 'stlink';

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isVendor(value: unknown): value is DeviceVendor {
  return typeof value === 'string' && hasVendor(value);
}

function isSeries(value: unknown): value is DeviceSeries {
  return typeof value === 'string'
    && listDeviceProfiles().some((profile) => profile.series === value);
}

function partFor(
  vendor: DeviceVendor,
  series: DeviceSeries,
  value: unknown
): string {
  const profiles = listDeviceProfiles();
  const selected = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return profiles.find((profile) =>
    profile.vendor === vendor
    && profile.series === series
    && profile.part.toUpperCase() === selected
  )?.part
    ?? listDeviceProfilesForSeries(profiles, vendor, series)[0]?.part
    ?? defaultPart;
}

function validTarget(value: unknown): string {
  const selected = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return listFlashTargetProfiles().find((target) => target.id === selected)?.id
    ?? defaultFlashTarget;
}

function validProbe(value: unknown): FlashProbeId {
  const selected = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return listFlashProbeProfiles().find((probe) => probe.id === selected)?.id
    ?? defaultFlashProbe;
}

function validBackend(value: unknown): FlashBackendId {
  const selected = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return listFlashBackendProfiles().find((backend) => backend.id === selected)?.id
    ?? 'openocd';
}

export function defaultSidebarSelection(): SidebarSelection {
  return {
    mode: defaultMode,
    mcu: {
      vendor: defaultVendor,
      series: defaultSeries,
      part: defaultPart
    },
    linux: {
      toolchainFamily: defaultLinuxToolchain
    },
    native: {
      targetType: 'executable',
      cStandard: 11,
      cxxStandard: 17
    },
    debugEnabled: false,
    flash: {
      enabled: false,
      targetId: defaultFlashTarget,
      probeId: defaultFlashProbe,
      openocdPath: 'openocd',
      backend: 'openocd'
    }
  };
}

export function sanitizeSidebarSelection(
  value: unknown,
  fallback: SidebarSelection = defaultSidebarSelection()
): SidebarSelection {
  const record = asRecord(value);
  const mcu = asRecord(record?.mcu);
  const linux = asRecord(record?.linux);
  const native = asRecord(record?.native);
  const flash = asRecord(record?.flash);
  const vendor = isVendor(mcu?.vendor) ? mcu.vendor : fallback.mcu.vendor;
  // The stored series may belong to another vendor (stale state after a pack
  // import); it is valid only when the vendor actually offers it.
  const series = isSeries(mcu?.series) && seriesBelongsToVendor(mcu.series, vendor)
    ? mcu.series
    : firstSeriesForVendor(vendor);
  const family = typeof linux?.toolchainFamily === 'string'
    && isLinuxToolchainFamily(linux.toolchainFamily)
    ? linux.toolchainFamily
    : fallback.linux.toolchainFamily;
  const backend = validBackend(flash?.backend);
  const requestedProbe = validProbe(flash?.probeId);
  const probeId = backendSupportsProbe(backend, requestedProbe)
    ? requestedProbe
    : listFlashProbeProfiles().find(probe => backendSupportsProbe(backend, probe.id))!.id;

  return {
    mode: record?.mode === 'mcu' || record?.mode === 'linux' || record?.mode === 'native'
      ? record.mode
      : fallback.mode,
    mcu: {
      vendor,
      series,
      part: partFor(vendor, series, mcu?.part)
    },
    linux: {
      toolchainFamily: family
    },
    native: {
      targetType: native?.targetType === 'static' || native?.targetType === 'shared'
        ? native.targetType
        : 'executable',
      cStandard: native?.cStandard === 17 || native?.cStandard === 23
        ? native.cStandard
        : 11,
      cxxStandard: native?.cxxStandard === 14 || native?.cxxStandard === 20 || native?.cxxStandard === 23
        ? native.cxxStandard
        : 17
    },
    debugEnabled: typeof record?.debugEnabled === 'boolean'
      ? record.debugEnabled
      : false,
    flash: {
      // Flash details are meaningful only while the option is enabled.
      enabled: typeof flash?.enabled === 'boolean' && validTarget(flash.targetId) === flash.targetId
        ? flash.enabled
        : false,
      targetId: validTarget(flash?.targetId),
      probeId,
      backend,
      openocdPath: typeof flash?.openocdPath === 'string' && flash.openocdPath.trim()
        ? flash.openocdPath.trim()
        : 'openocd'
    }
  };
}

function firstSeriesForVendor(vendor: DeviceVendor): DeviceSeries {
  return listDeviceSeries(listDeviceProfiles(), vendor)[0] ?? defaultSeries;
}

function seriesBelongsToVendor(series: DeviceSeries, vendor: DeviceVendor): boolean {
  return listDeviceProfiles().some((profile) =>
    profile.vendor === vendor && profile.series === series
  );
}

export function nextMcuSelection(
  selection: SidebarSelection,
  change: { vendor?: DeviceVendor; series?: DeviceSeries; part?: string }
): SidebarSelection {
  const vendor = change.vendor ?? selection.mcu.vendor;
  const vendorChanged = vendor !== selection.mcu.vendor;
  const series = change.series ?? (vendorChanged
    ? firstSeriesForVendor(vendor)
    : selection.mcu.series);
  const seriesChanged = series !== selection.mcu.series;
  const part = change.part
    ? partFor(vendor, series, change.part)
    : (vendorChanged || seriesChanged
      ? partFor(vendor, series, undefined)
      : selection.mcu.part);

  return {
    ...selection,
    mode: 'mcu',
    mcu: {
      vendor,
      series,
      part
    }
  };
}

function deviceOptions(vendor: DeviceVendor, series: DeviceSeries): SidebarOption[] {
  return listDeviceProfilesForSeries(listDeviceProfiles(), vendor, series).map((profile) => ({
    value: profile.part,
    label: profile.part,
    description: `${profile.family} / ${profile.core}`,
    detail: `${profile.flash.length / 1024} KB Flash, ${profile.ram.length / 1024} KB RAM`
  }));
}

export function optionsForSelection(selection: SidebarSelection): {
  series: SidebarOption[];
  devices: SidebarOption[];
} {
  const profiles = listDeviceProfiles();
  const safe = nextMcuSelection(selection, {});
  return {
    series: listDeviceSeries(profiles, safe.mcu.vendor).map((series) => ({
      value: series,
      label: listDeviceProfilesForSeries(profiles, safe.mcu.vendor, series)[0]?.family ?? series
    })),
    devices: deviceOptions(safe.mcu.vendor, safe.mcu.series)
  };
}

export function buildSidebarState(
  workspaceName: string,
  selection: SidebarSelection,
  discoveredToolchains: Array<{
    family: LinuxToolchainFamily;
    verified: boolean;
    binDir?: string;
    source: string;
  }> = [],
  armToolchain: ArmToolchainStatus = inspectArmToolchainPath('')
): SidebarBootstrapState {
  const profiles = listDeviceProfiles();
  const hits: LinuxToolchainHit[] = discoveredToolchains.map((hit) => ({
    ...getLinuxToolchainDefaults(hit.family),
    label: getLinuxToolchainDefaults(hit.family).label,
    source: hit.source as LinuxToolchainHit['source'],
    verified: hit.verified,
    binDir: hit.binDir
  }));
  const choices = buildLinuxToolchainChoices(hits, selection.linux.toolchainFamily);
  const mcuOptions = optionsForSelection(selection);

  return {
    workspaceName,
    vendors: listDeviceVendors(profiles).map((vendor) => ({
      value: vendor,
      label: getVendorMetadata(vendor).label
    })),
    series: mcuOptions.series,
    devices: mcuOptions.devices,
    flashTargets: listFlashTargetProfiles().map((target) => ({
      value: target.id,
      label: target.label,
      description: `${target.vendor} / ${target.series}`,
      detail: target.targetConfig
    })),
    flashProbes: listFlashProbeProfiles().filter(probe => backendSupportsProbe(selection.flash.backend, probe.id)).map((probe) => ({
      value: probe.id,
      label: probe.label,
      description: probe.interfaceConfig
    })),
    flashBackends: listFlashBackendProfiles().map((backend) => ({
      value: backend.id,
      label: backend.label,
      description: backend.probes.join(', ')
    })),
    linuxToolchains: choices.map((choice) => ({
      value: choice.family,
      label: choice.label,
      description: choice.description,
      detail: choice.detail
    })),
    armToolchain,
    selection
  };
}
