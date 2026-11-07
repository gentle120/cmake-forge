import {
  listDeviceProfiles,
  listDeviceProfilesForPack,
  type DeviceSeries,
  type DeviceVendor
} from '../devices/deviceProfiles';
import {
  buildDevicePackOptions,
  type DevicePackOption,
  listDeviceVendors
} from '../devices/deviceSelection';
import { findCatalogSeries, seriesCatalogFor } from '../devices/seriesCatalog';
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

/**
 * A series id is selectable when the vendor's catalog defines it (the curated
 * trial vendors) or a locally registered profile uses it. Catalog series stay
 * selectable before any Pack is activated — selecting one determines the Pack.
 */
function isKnownSeries(vendor: DeviceVendor, value: unknown): value is DeviceSeries {
  if (typeof value !== 'string' || value.trim() === '') {
    return false;
  }
  const series = value.trim();
  return findCatalogSeries(vendor, series) !== undefined
    || listDeviceProfiles().some((profile) => profile.vendor === vendor && profile.series === series);
}

/** Parts of the activated Pack matching the selected series (catalog-aware). */
function seriesPool(
  profiles: ReturnType<typeof listDeviceProfiles>,
  vendor: DeviceVendor,
  series: DeviceSeries
): ReturnType<typeof listDeviceProfiles> {
  const catalog = findCatalogSeries(vendor, series);
  const pool = catalog
    ? profiles.filter((profile) => profile.part.toUpperCase().startsWith(catalog.partPrefix.toUpperCase()))
    : profiles.filter((profile) => profile.vendor === vendor && profile.series === series);
  return [...pool].sort((left, right) => left.part.localeCompare(right.part));
}

function partFor(
  profiles: ReturnType<typeof listDeviceProfiles>,
  vendor: DeviceVendor,
  series: DeviceSeries,
  value: unknown
): string {
  const selected = typeof value === 'string' ? value.trim().toUpperCase() : '';
  const pool = seriesPool(profiles, vendor, series);
  return pool.find((profile) => profile.part.toUpperCase() === selected)?.part
    ?? pool[0]?.part
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
      vendor: '',
      packId: '',
      version: '',
      series: '',
      part: ''
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
  const selectedPackId = typeof mcu?.packId === 'string' ? mcu.packId : '';
  const selectedSourcePack = typeof mcu?.sourcePack === 'string' ? mcu.sourcePack : undefined;
  const vendorProfiles = packProfiles(
    vendor,
    selectedPackId,
    mcu?.version,
    packOptions,
    selectedSourcePack
  );
  // Without an owning Pack the whole MCU column stays empty; there is no
  // built-in fallback anymore.
  const packId = vendorProfiles.length > 0 ? selectedPackId : '';
  const version = packId === ''
    ? ''
    : typeof mcu?.version === 'string' && mcu.version.trim()
      ? mcu.version
      : packOptions.find((option) => option.packId === packId)?.version ?? '';
  // Persist the owner that actually supplied the profiles: the catalog entry
  // wins once loaded, so a stale key from another Pack cannot survive.
  const sourcePack = packId === ''
    ? undefined
    : profileOwner(packId, version, packOptions, selectedSourcePack);
  const series = isKnownSeries(vendor, mcu?.series)
    ? (mcu!.series as string).trim()
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
    projectRoot: typeof record?.projectRoot === 'string'
      ? record.projectRoot
      : fallback.projectRoot,
    mcu: {
      vendor,
      packId,
      version,
      ...(sourcePack === undefined ? {} : { sourcePack }),
      series,
      part: packId === '' ? '' : partFor(vendorProfiles, vendor, series, mcu?.part)
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

/** Series dropdown fallback order: catalog first, then locally imported series. */
function firstSeriesForVendor(vendor: DeviceVendor): DeviceSeries {
  return seriesCatalogFor(vendor)[0]?.series
    ?? listDeviceProfiles().find((profile) => profile.vendor === vendor)?.series
    ?? '';
}

/** Series dropdown entries: catalog series first, then local pack series. */
function vendorSeriesOptions(vendor: DeviceVendor): SidebarOption[] {
  const options = new Map<string, SidebarOption>();
  for (const entry of seriesCatalogFor(vendor)) {
    options.set(entry.series, { value: entry.series, label: entry.label });
  }
  for (const profile of listDeviceProfiles()) {
    if (profile.vendor === vendor && !options.has(profile.series)) {
      options.set(profile.series, { value: profile.series, label: profile.series });
    }
  }
  return [...options.values()];
}

/**
 * Resolves the profile ownership key of a selected Pack version.
 *
 * A catalog entry for an imported Pack carries that key in `packFile` and is
 * authoritative once loaded. An installed or downloadable entry carries an
 * installation path or nothing, so the persisted key remains the only owner
 * candidate — including right after an activation that has not been re-listed
 * as `imported` yet.
 */
function profileOwner(
  packId: string,
  version: unknown,
  packOptions: DevicePackOption[],
  sourcePack?: string
): string | undefined {
  const option = packOptions.find((candidate) =>
    candidate.packId === packId && candidate.version === version
  );
  return option?.origin === 'imported' && option.packFile ? option.packFile : sourcePack;
}

function packProfiles(
  vendor: DeviceVendor,
  packId: string,
  version: unknown,
  packOptions: DevicePackOption[],
  sourcePack?: string
): ReturnType<typeof listDeviceProfiles> {
  const owner = profileOwner(packId, version, packOptions, sourcePack);
  return owner ? listDeviceProfilesForPack(owner) : [];
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
  const packId = change.packId ?? (vendorChanged ? '' : selection.mcu.packId);
  const version = packId === ''
    ? ''
    : change.version ?? (vendorChanged ? '' : selection.mcu.version);
  const requestedSourcePack = change.sourcePack ?? (
    vendorChanged ? undefined : selection.mcu.sourcePack
  );
  const packChanged = vendorChanged
    || packId !== selection.mcu.packId
    || version !== selection.mcu.version;
  // Switching Pack or version must switch the profile owner too; otherwise the
  // previous Pack's parts stay visible under the new Pack.
  const owner = packChanged && change.sourcePack === undefined
    ? profileOwner(packId, version, packOptions, undefined)
    : requestedSourcePack;
  const profiles = packProfiles(vendor, packId, version, packOptions, owner);
  // The series is user-chosen (vendor → series → pack): it survives pack
  // switches and only falls back when unknown for the vendor. When the newly
  // activated pack does not serve the chosen series, adopt the pack's first
  // series so the part list never empties out.
  const chosenSeries = change.series ?? (isKnownSeries(vendor, selection.mcu.series)
    ? selection.mcu.series
    : firstSeriesForVendor(vendor));
  const series = profiles.length === 0 || profiles.some((profile) => profile.series === chosenSeries)
    ? chosenSeries
    : [...new Set(profiles.map((profile) => profile.series))]
      .sort((left, right) => left.localeCompare(right))[0];
  const seriesChanged = series !== selection.mcu.series;
  const part = change.part
    ? partFor(profiles, vendor, series, change.part)
    : (packChanged || seriesChanged
      ? partFor(profiles, vendor, series, undefined)
      : selection.mcu.part);

  return {
    ...selection,
    mcu: {
      vendor,
      packId,
      version,
      ...(packId === '' || owner === undefined ? {} : { sourcePack: owner }),
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
  return seriesPool(profiles, vendor, series).map((profile) => ({
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
  );
  const selectedPackChoices = packOptions.filter((option) => option.packId === safe.mcu.packId);
  const packMap = new Map<string, DevicePackOption>();
  packOptions.forEach((option) => {
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
      label: option.version,
      description: option.origin
    })),
    series: vendorSeriesOptions(safe.mcu.vendor),
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
    versions: packOptions
      .filter((option) => option.packId === pendingPackId)
      .map((option) => ({
        value: option.version,
        label: option.version,
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
