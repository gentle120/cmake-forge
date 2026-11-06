import {
  listDeviceProfiles,
  listDeviceProfilesForPack,
  type DeviceSeries,
  type DeviceVendor
} from '../devices/deviceProfiles';
import {
  buildDevicePackOptions,
  type DevicePackOption,
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
  projectRoot: string;
  mcu: {
    vendor: DeviceVendor;
    packId: string;
    version: string;
    sourcePack?: string;
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
  projects: SidebarOption[];
  projectRoot: string;
  discoveringProjects: boolean;
  vendors: SidebarOption[];
  packs: SidebarOption[];
  versions: SidebarOption[];
  pendingPackId: string;
  packCatalogNotice: string;
  series: SidebarOption[];
  devices: SidebarOption[];
  flashTargets: SidebarOption[];
  flashProbes: SidebarOption[];
  flashBackends: SidebarOption[];
  linuxToolchains: SidebarOption[];
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
  profiles: ReturnType<typeof listDeviceProfiles>,
  vendor: DeviceVendor,
  series: DeviceSeries,
  value: unknown
): string {
  const selected = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return profiles.find((profile) =>
    profile.vendor === vendor
    && profile.series === series
    && profile.part.toUpperCase() === selected
  )?.part
    ?? listDeviceProfilesForSeries(profiles, vendor, series)[0]?.part
    ?? '';
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
    projectRoot: '',
    mcu: {
      vendor: defaultVendor,
      packId: `builtin:${defaultVendor}`,
      version: 'builtin',
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
  fallback: SidebarSelection = defaultSidebarSelection(),
  packOptions: DevicePackOption[] = []
): SidebarSelection {
  const record = asRecord(value);
  const mcu = asRecord(record?.mcu);
  const linux = asRecord(record?.linux);
  const native = asRecord(record?.native);
  const flash = asRecord(record?.flash);
  const vendor = isVendor(mcu?.vendor) ? mcu.vendor : fallback.mcu.vendor;
  const selectedPackId = typeof mcu?.packId === 'string' ? mcu.packId : `builtin:${vendor}`;
  const selectedSourcePack = typeof mcu?.sourcePack === 'string' ? mcu.sourcePack : undefined;
  const vendorProfiles = packProfiles(
    vendor,
    selectedPackId,
    mcu?.version,
    packOptions,
    selectedSourcePack
  );
  const packId = vendorProfiles.length > 0 ? selectedPackId : `builtin:${vendor}`;
  const profiles = vendorProfiles.length > 0
    ? vendorProfiles
    : listDeviceProfilesForPack(`builtin:${vendor}`);
  const version = packId === `builtin:${vendor}`
    ? 'builtin'
    : typeof mcu?.version === 'string' && mcu.version.trim()
      ? mcu.version
      : packOptions.find((option) => option.packId === packId)?.version ?? '';
  const series = isSeries(mcu?.series) && seriesBelongsToVendor(mcu.series, vendor, profiles)
    ? mcu.series
    : firstSeriesForVendor(vendor, profiles);
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
    projectRoot: typeof record?.projectRoot === 'string'
      ? record.projectRoot
      : fallback.projectRoot,
    mcu: {
      vendor,
      packId,
      version,
      ...(packId === `builtin:${vendor}` ? {} : { sourcePack: selectedSourcePack }),
      series,
      part: partFor(profiles, vendor, series, mcu?.part)
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

function firstSeriesForVendor(
  vendor: DeviceVendor,
  profiles: ReturnType<typeof listDeviceProfiles> = listDeviceProfilesForPack(`builtin:${vendor}`)
): DeviceSeries {
  return listDeviceSeries(profiles, vendor)[0]
    ?? listDeviceProfiles().find((profile) => profile.vendor === vendor)?.series
    ?? defaultSeries;
}

function seriesBelongsToVendor(
  series: DeviceSeries,
  vendor: DeviceVendor,
  profiles: ReturnType<typeof listDeviceProfiles> = listDeviceProfiles()
): boolean {
  return profiles.some((profile) =>
    profile.vendor === vendor && profile.series === series
  );
}

function packProfiles(
  vendor: DeviceVendor,
  packId: string,
  version: unknown,
  packOptions: DevicePackOption[],
  sourcePack?: string
): ReturnType<typeof listDeviceProfiles> {
  if (packId === `builtin:${vendor}`) {
    return listDeviceProfilesForPack(packId);
  }
  // The persisted `sourcePack` is the imported-profile ownership key. An
  // installed Pack's catalog `packFile` is a Keil installation path, so it only
  // owns profiles once it has been imported and its storage key is known.
  if (sourcePack) {
    return listDeviceProfilesForPack(sourcePack);
  }
  const option = packOptions.find((candidate) =>
    candidate.packId === packId && candidate.version === version
  );
  return option?.origin === 'imported' && option.packFile
    ? listDeviceProfilesForPack(option.packFile)
    : [];
}

export function nextMcuSelection(
  selection: SidebarSelection,
  change: {
    vendor?: DeviceVendor;
    packId?: string;
    version?: string;
    sourcePack?: string;
    series?: DeviceSeries;
    part?: string;
  },
  packOptions: DevicePackOption[] = []
): SidebarSelection {
  const vendor = change.vendor ?? selection.mcu.vendor;
  const vendorChanged = vendor !== selection.mcu.vendor;
  const packId = change.packId ?? (vendorChanged ? `builtin:${vendor}` : selection.mcu.packId);
  const version = change.version ?? (
    packId === `builtin:${vendor}` ? 'builtin' : (vendorChanged ? '' : selection.mcu.version)
  );
  const sourcePack = change.sourcePack ?? (
    vendorChanged && packId === `builtin:${vendor}` ? undefined : selection.mcu.sourcePack
  );
  const profiles = packProfiles(vendor, packId, version, packOptions, sourcePack);
  const packChanged = vendorChanged
    || packId !== selection.mcu.packId
    || version !== selection.mcu.version;
  const series = change.series ?? (packChanged
    ? firstSeriesForVendor(vendor, profiles)
    : selection.mcu.series);
  const seriesChanged = series !== selection.mcu.series;
  const part = change.part
    ? partFor(profiles, vendor, series, change.part)
    : (packChanged || seriesChanged
      ? partFor(profiles, vendor, series, undefined)
      : selection.mcu.part);

  return {
    ...selection,
    mode: 'mcu',
    mcu: {
      vendor,
      packId,
      version,
      ...(packId === `builtin:${vendor}` ? {} : { sourcePack }),
      series,
      part
    }
  };
}

function deviceOptions(
  profiles: ReturnType<typeof listDeviceProfiles>,
  vendor: DeviceVendor,
  series: DeviceSeries
): SidebarOption[] {
  return listDeviceProfilesForSeries(profiles, vendor, series).map((profile) => ({
    value: profile.part,
    label: profile.part,
    description: `${profile.family} / ${profile.core}`,
    detail: `${profile.flash.length / 1024} KB Flash, ${profile.ram.length / 1024} KB RAM`
  }));
}

export function optionsForPackSelection(
  selection: SidebarSelection,
  packOptions: DevicePackOption[]
): {
  packs: SidebarOption[];
  versions: SidebarOption[];
  series: SidebarOption[];
  devices: SidebarOption[];
} {
  const safe = sanitizeSidebarSelection(selection, selection, packOptions);
  const profiles = packProfiles(
    safe.mcu.vendor,
    safe.mcu.packId,
    safe.mcu.version,
    packOptions
  ).length > 0
    ? packProfiles(safe.mcu.vendor, safe.mcu.packId, safe.mcu.version, packOptions)
    : listDeviceProfilesForPack(`builtin:${safe.mcu.vendor}`);
  const choices = packOptions.length > 0
    ? packOptions
    : buildDevicePackOptions({
        vendorId: safe.mcu.vendor,
        hasBuiltin: listDeviceProfilesForPack(`builtin:${safe.mcu.vendor}`).length > 0,
        imported: [],
        installed: [],
        online: []
      });
  const selectedPackChoices = choices.filter((option) => option.packId === safe.mcu.packId);
  const packMap = new Map<string, DevicePackOption>();
  choices.forEach((option) => {
    if (!packMap.has(option.packId)) packMap.set(option.packId, option);
  });
  return {
    packs: [...packMap.values()].map((option) => ({
      value: option.packId,
      label: option.name,
      description: option.origin
    })),
    versions: selectedPackChoices.map((option) => ({
      value: option.version,
      label: option.version === 'builtin' ? '内置' : option.version,
      description: option.origin
    })),
    series: listDeviceSeries(profiles, safe.mcu.vendor).map((series) => ({
      value: series,
      label: listDeviceProfilesForSeries(profiles, safe.mcu.vendor, series)[0]?.family ?? series
    })),
    devices: deviceOptions(profiles, safe.mcu.vendor, safe.mcu.series)
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
  projects: SidebarOption[] = [],
  projectRoot = '',
  discoveringProjects = false,
  packOptions: DevicePackOption[] = [],
  pendingPackId = selection.mcu.packId,
  vendorOptions?: SidebarOption[],
  packCatalogNotice = ''
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
  const safeSelection = sanitizeSidebarSelection(selection, selection, packOptions);
  const mcuOptions = optionsForPackSelection(safeSelection, packOptions);
  const availablePacks = packOptions.length > 0
    ? packOptions
    : buildDevicePackOptions({
        vendorId: safeSelection.mcu.vendor,
        hasBuiltin: listDeviceProfilesForPack(`builtin:${safeSelection.mcu.vendor}`).length > 0,
        imported: [],
        installed: [],
        online: []
      });

  return {
    workspaceName: selectedProjectLabel(workspaceName, projects, projectRoot),
    projects,
    projectRoot,
    discoveringProjects,
    vendors: vendorOptions ?? listDeviceVendors(profiles).map((vendor) => ({
      value: vendor,
      label: getVendorMetadata(vendor).label
    })),
    packs: mcuOptions.packs,
    versions: availablePacks
      .filter((option) => option.packId === pendingPackId)
      .map((option) => ({
        value: option.version,
        label: option.version === 'builtin' ? '内置' : option.version,
        description: option.origin
      })),
    pendingPackId,
    packCatalogNotice,
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
    selection
  };
}

function selectedProjectLabel(
  workspaceName: string,
  projects: SidebarOption[],
  projectRoot: string
): string {
  return projects.find((project) => project.value === projectRoot)?.label || workspaceName;
}
