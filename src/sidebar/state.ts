import {
  listDeviceProfiles,
  listDeviceProfilesForPack,
  type DeviceSeries,
  type DeviceVendor
} from '../devices/deviceProfiles';
import {
  type DevicePackOption,
  listDeviceVendors
} from '../devices/deviceSelection';
import {
  canonicalSeriesId,
  catalogSeriesIdForText,
  findCatalogSeries,
  seriesCatalogFor,
  seriesServesProfile
} from '../devices/seriesCatalog';
import { listFlashProbeProfiles, type FlashProbeId } from '../flash/probeProfiles';
import { listFlashTargetProfiles } from '../flash/targets/targetProfiles';
import { buildLinuxToolchainChoices } from '../linux/toolchainChoices';
import {
  getLinuxToolchainDefaults,
  isLinuxToolchainFamily,
  type LinuxTargetType,
  type LinuxToolchainFamily,
  type LinuxToolchainHit
} from '../linux/types';
import { getVendorMetadata, hasVendor } from '../devices/vendorRegistry';
import {
  findBuildToolchain,
  type BuildToolchain,
  type DiscoveredBuildToolchains
} from '../env/buildToolchains';
import { curatedVendors } from '../devices/curatedVendors';
import { backendSupportsProbe, listFlashBackendProfiles, type FlashBackendId } from '../flash/backendProfiles';

export type SidebarMode = 'mcu' | 'linux' | 'native';

export interface SidebarFlashSelection {
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
    /**
     * Installed CMSIS core pack version copied into generated projects;
     * empty means the newest installed one.
     */
    corePackVersion: string;
    /** Selected MCU compiler toolchain id; empty means the device default. */
    buildToolchain: string;
  };
  linux: {
    toolchainFamily: LinuxToolchainFamily;
    /** Output kind of the cross-compiled project. */
    targetType: LinuxTargetType;
    /** Optional target root passed to CMake as `CMAKE_SYSROOT`. */
    sysroot: string;
  };
  native: {
    targetType: 'executable' | 'static' | 'shared';
    cStandard: 11 | 17 | 23;
    cxxStandard: 14 | 17 | 20 | 23;
    /** Selected host compiler toolchain id; empty lets CMake detect one. */
    buildToolchain: string;
  };
  /** Adds the installed CMSIS core pack include directory to generated projects. */
  corePackInclude: boolean;
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
  /** Installed ARM CMSIS core pack, which device packs rely on for core_cm*.h. */
  corePackNotice: string;
  /**
   * Why an MCU project cannot be generated right now; empty when it can.
   * The sidebar disables its generation actions on a non-empty value instead of
   * letting the user run a command that can only fail.
   */
  mcuBlockedReason: string;
  /** Installed core pack versions offered by the MCU panel. */
  corePackVersions: SidebarOption[];
  series: SidebarOption[];
  devices: SidebarOption[];
  flashTargets: SidebarOption[];
  flashProbes: SidebarOption[];
  flashBackends: SidebarOption[];
  linuxToolchains: SidebarOption[];
  mcuToolchains: SidebarOption[];
  nativeToolchains: SidebarOption[];
  selection: SidebarSelection;
}

const defaultMode: SidebarMode = 'mcu';
const defaultLinuxToolchain: LinuxToolchainFamily = 'loongson';
const defaultFlashTarget = 'stm32f1xx';
const defaultFlashProbe = 'stlink';

/** Persisted Linux output kind, defaulting to an executable. */
function linuxTargetType(value: unknown): LinuxTargetType {
  return value === 'static' || value === 'shared' ? value : 'executable';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

/**
 * A vendor is valid when it is registered or is one of the curated vendors.
 *
 * Curated vendors are always offered in the vendor dropdown, but their pack
 * registry entry only appears after the asynchronous pack scan. Accepting them
 * here keeps the persisted vendor/series selection intact during that window
 * instead of collapsing the whole MCU column on the first sidebar open.
 */
function isVendor(value: unknown): value is DeviceVendor {
  return typeof value === 'string'
    && (hasVendor(value) || curatedVendors.some((vendor) => vendor.id === value));
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
  const pool = profiles.filter((profile) =>
    profile.vendor === vendor && seriesServesProfile(vendor, series, profile)
  );
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

/** Falls back to the first probe the backend supports, never to nothing. */
function probeForBackend(backend: FlashBackendId, requested: FlashProbeId): FlashProbeId {
  if (backendSupportsProbe(backend, requested)) {
    return requested;
  }
  return listFlashProbeProfiles().find((probe) => backendSupportsProbe(backend, probe.id))?.id
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
      part: '',
      corePackVersion: '',
      buildToolchain: ''
    },
    linux: {
      toolchainFamily: defaultLinuxToolchain,
      targetType: 'executable',
      sysroot: ''
    },
    native: {
      targetType: 'executable',
      cStandard: 11,
      cxxStandard: 17,
      buildToolchain: ''
    },
    corePackInclude: true,
    flash: {
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
  packOptions: DevicePackOption[] = [],
  preservePackSelection = false,
  buildToolchains?: DiscoveredBuildToolchains
): SidebarSelection {
  const record = asRecord(value);
  const mcu = asRecord(record?.mcu);
  const linux = asRecord(record?.linux);
  const native = asRecord(record?.native);
  const flash = asRecord(record?.flash);
  const vendor = isVendor(mcu?.vendor) ? mcu.vendor : fallback.mcu.vendor;
  const selectedPackId = typeof mcu?.packId === 'string' ? mcu.packId : '';
  const selectedSourcePack = typeof mcu?.sourcePack === 'string' ? mcu.sourcePack : undefined;
  // Persisted series from an older build may be the pack's own Dfamily text;
  // normalize it to the curated id so the dropdown keeps a matching entry.
  const persistedSeries = isKnownSeries(vendor, mcu?.series)
    ? (mcu!.series as string).trim()
    : '';
  const rawSeries = persistedSeries === '' || findCatalogSeries(vendor, persistedSeries) !== undefined
    ? ''
    : catalogSeriesIdForText(vendor, persistedSeries, listDeviceProfiles()) ?? '';
  const series = persistedSeries === ''
    ? firstSeriesForVendor(vendor)
    : rawSeries !== '' ? rawSeries : persistedSeries;
  const vendorProfiles = packProfiles(
    vendor,
    selectedPackId,
    mcu?.version,
    packOptions,
    selectedSourcePack
  ).filter((profile) => seriesServesProfile(vendor, series, profile));
  // Without an owning Pack the whole MCU column stays empty; there is no
  // built-in fallback anymore. A Pack that serves a different series than the
  // one selected is not an owning Pack here: keeping it would show a Pack the
  // part list can never fill.
  // Before the Pack catalog has loaded there is nothing to validate against;
  // keeping the persisted Pack/version/part prevents the panel from resetting on
  // every window (and Extension Development Host) start, which otherwise leaves
  // "版本 — 选择版本 —" and a generation that can never find a device.
  const keepPersisted = preservePackSelection && packOptions.length === 0;
  const packId = keepPersisted
    ? selectedPackId
    : vendorProfiles.length > 0 ? selectedPackId : '';
  const version = keepPersisted
    ? (typeof mcu?.version === 'string' ? mcu.version.trim() : '')
    : packId === ''
      ? ''
      : typeof mcu?.version === 'string' && mcu.version.trim()
        ? mcu.version
        : packOptions.find((option) => option.packId === packId)?.version ?? '';
  // Persist the owner that actually supplied the profiles: the catalog entry
  // wins once loaded, so a stale key from another Pack cannot survive.
  const sourcePack = keepPersisted
    ? selectedSourcePack
    : packId === ''
      ? undefined
      : profileOwner(packId, version, packOptions, selectedSourcePack);
  const family = typeof linux?.toolchainFamily === 'string'
    && isLinuxToolchainFamily(linux.toolchainFamily)
    ? linux.toolchainFamily
    : fallback.linux.toolchainFamily;
  const backend = validBackend(flash?.backend);
  const requestedMcuToolchain = typeof mcu?.buildToolchain === 'string'
    ? mcu.buildToolchain.trim()
    : '';
  const mcuToolchainList = buildToolchains?.mcu ?? [];
  const mcuBuildToolchain = buildToolchains === undefined
    ? requestedMcuToolchain
    : findBuildToolchain(buildToolchains, 'mcu', requestedMcuToolchain) !== undefined
      ? requestedMcuToolchain
      : mcuToolchainList[0]?.id ?? '';
  const requestedNativeToolchain = typeof native?.buildToolchain === 'string'
    ? native.buildToolchain.trim()
    : '';
  const nativeBuildToolchain = buildToolchains === undefined
    ? requestedNativeToolchain
    : findBuildToolchain(buildToolchains, 'native', requestedNativeToolchain) === undefined
      ? ''
      : requestedNativeToolchain;
  const requestedProbe = validProbe(flash?.probeId);
  const probeId = probeForBackend(backend, requestedProbe);

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
      part: keepPersisted
        ? (typeof mcu?.part === 'string' ? mcu.part.trim() : '')
        : packId === ''
          ? ''
          // Between catalog load and profile restore the pool is empty; keep the
          // persisted part instead of replacing it with the first profile later.
          : vendorProfiles.length === 0 && typeof mcu?.part === 'string' && mcu.part.trim()
            ? mcu.part.trim()
            : partFor(vendorProfiles, vendor, series, mcu?.part),
      corePackVersion: typeof mcu?.corePackVersion === 'string'
        ? mcu.corePackVersion.trim()
        : fallback.mcu.corePackVersion,
      buildToolchain: mcuBuildToolchain
    },
    linux: {
      toolchainFamily: family,
      targetType: linuxTargetType(linux?.targetType),
      sysroot: typeof linux?.sysroot === 'string' ? linux.sysroot.trim() : fallback.linux.sysroot
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
        : 17,
      buildToolchain: nativeBuildToolchain
    },
    // Defaults to on: without the core headers a generated project cannot build.
    corePackInclude: typeof record?.corePackInclude === 'boolean'
      ? record.corePackInclude
      : true,
    flash: {
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

/**
 * True when a Pack can serve at least one part of the selected series.
 *
 * Choosing a series first makes the Pack list and the part list one decision:
 * offering a Pack that cannot serve the series lets the user end up with a Pack
 * selected and an empty part list, which reads as a broken panel. Imported Packs
 * are judged by their parsed parts; installed and downloadable Packs by their
 * DFP name, because their PDSC is not parsed until they are activated.
 */
export function packServesSeries(
  vendor: DeviceVendor,
  series: DeviceSeries,
  option: DevicePackOption
): boolean {
  if (series === '') {
    return true;
  }
  if (option.origin === 'imported' && option.packFile) {
    return listDeviceProfilesForPack(option.packFile)
      .some((profile) => seriesServesProfile(vendor, series, profile));
  }
  // A DFP name is the only signal before the Pack is parsed: "STM32F1xx_DFP"
  // appears both bare and vendor-prefixed ("Keil.STM32F1xx_DFP").
  const packName = findCatalogSeries(vendor, series)?.packName;
  if (!packName) {
    // Vendors outside the curated catalog define no DFP name; hiding all their
    // Packs would leave nothing to select.
    return true;
  }
  const wanted = packName.toLowerCase();
  const actual = option.name.trim().toLowerCase();
  return actual === wanted || actual.endsWith(`.${wanted}`);
}

/** Packs of the selected vendor that can serve the selected series. */
function servingPacks(
  vendor: DeviceVendor,
  series: DeviceSeries,
  packOptions: DevicePackOption[]
): DevicePackOption[] {
  return packOptions.filter((option) => packServesSeries(vendor, series, option));
}

/**
 * Guidance shown when the selected series has no part to show.
 *
 * Three states need different words: the activated Pack serves another series, a
 * Pack that serves this series is available but not activated yet, and nothing
 * local can serve it at all. Saying "no Pack installed" while the dropdown lists
 * the very Pack needed would be wrong.
 */
function missingSeriesNotice(
  vendor: DeviceVendor,
  series: DeviceSeries,
  hasPack: boolean,
  hasServingPack: boolean
): string {
  const catalog = findCatalogSeries(vendor, series);
  const label = catalog?.label ?? series;
  const pack = catalog?.packName;
  if (hasPack) {
    return pack
      ? `当前 Pack 不含「${label}」系列：需要 ${pack}，点「在线安装 Pack…」可下载导入。`
      : `当前 Pack 不含「${label}」系列：请选择其它系列，或安装该系列对应的器件包。`;
  }
  if (hasServingPack) {
    return pack
      ? `「${label}」系列需要用 ${pack} 载入型号：在「芯片支持包 / Pack」里选中它即可。`
      : `「${label}」系列需要先选择对应的芯片支持包，才能列出型号。`;
  }
  return pack
    ? `「${label}」系列还没有芯片支持包：点「在线安装 Pack…」下载 ${pack}。`
    : `「${label}」系列还没有芯片支持包：请点「在线安装 Pack…」或「导入 Pack 包…」。`;
}

/**
 * Series dropdown entries: catalog series first, then local pack series.
 *
 * A vendor pack names its series in its own words (`STM32F1 Series`), which is
 * the same series as the curated `F1x`. Showing both would put two rows for one
 * series in the dropdown, so a pack series covered by the catalog is dropped.
 */
function vendorSeriesOptions(vendor: DeviceVendor): SidebarOption[] {
  const options = new Map<string, SidebarOption>();
  const catalog = seriesCatalogFor(vendor);
  for (const entry of catalog) {
    options.set(entry.series, { value: entry.series, label: entry.label });
  }
  for (const profile of listDeviceProfiles()) {
    if (profile.vendor !== vendor || options.has(profile.series)) {
      continue;
    }
    const covered = catalog.some((entry) =>
      profile.part.toUpperCase().startsWith(entry.partPrefix.toUpperCase())
    );
    if (!covered) {
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

/**
 * Profiles of the selected Pack that belong to the selected vendor. The vendor
 * filter matters after a vendor switch: the persisted owner still points at the
 * previous vendor's Pack until the new catalog resolves, and the sidebar must
 * not keep a foreign Pack selected under the new vendor.
 */
function packProfiles(
  vendor: DeviceVendor,
  packId: string,
  version: unknown,
  packOptions: DevicePackOption[],
  sourcePack?: string
): ReturnType<typeof listDeviceProfiles> {
  const owner = profileOwner(packId, version, packOptions, sourcePack);
  return owner
    ? listDeviceProfilesForPack(owner).filter((profile) => profile.vendor === vendor)
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
  // Changing the series must never be undone by the activated Pack: a Pack that
  // serves another series is the normal state right before the user installs the
  // right one, and snapping back to the Pack's own text made the dropdown look
  // stuck. Only an explicit Pack switch adopts that Pack's series, so its parts
  // are visible instead of an empty list.
  const packServesSeries = profiles.length === 0
    || profiles.some((profile) => seriesServesProfile(vendor, chosenSeries, profile));
  const series = packServesSeries || !packChanged
    ? chosenSeries
    : canonicalSeriesId(vendor, profiles)
      ?? [...new Set(profiles.map((profile) => profile.series))]
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
      part,
      // The core pack and compiler toolchain are independent of the device
      // Pack, so they survive Pack/series switches.
      corePackVersion: selection.mcu.corePackVersion,
      buildToolchain: selection.mcu.buildToolchain
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

function optionsForPackSelection(
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
  servingPacks(safe.mcu.vendor, safe.mcu.series, packOptions).forEach((option) => {
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

/** Dropdown entries for one direction: an automatic choice plus the found toolchains. */
function toolchainOptions(
  toolchains: BuildToolchain[],
  autoLabel: string,
  autoDescription: string
): SidebarOption[] {
  return [
    { value: '', label: autoLabel, description: autoDescription },
    ...toolchains.map((toolchain) => ({
      value: toolchain.id,
      label: toolchain.label,
      description: toolchain.binDir,
      detail: toolchain.cCompiler
    }))
  ];
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
  packCatalogNotice = '',
  corePackNotice = '',
  corePackVersions: SidebarOption[] = [],
  buildToolchains?: DiscoveredBuildToolchains
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
  const safeSelection = sanitizeSidebarSelection(
    selection,
    selection,
    packOptions,
    false,
    buildToolchains
  );
  const mcuOptions = optionsForPackSelection(safeSelection, packOptions);
  const resolvedPendingPackId = mcuOptions.packs.some((option) => option.value === pendingPackId)
    ? pendingPackId
    : mcuOptions.packs[0]?.value ?? '';
  // Generation needs a Pack that serves the series and a part inside it; without
  // both, every generation command fails the same way, so the reason is part of
  // the state rather than an error after the click. This one sentence also
  // explains an empty part list — the panel would otherwise show the same text
  // twice, once here and once in the catalog notice.
  const mcuBlockedReason = safeSelection.mode !== 'mcu' || safeSelection.mcu.part !== ''
    ? ''
    : missingSeriesNotice(
        safeSelection.mcu.vendor,
        safeSelection.mcu.series,
        safeSelection.mcu.packId !== '',
        mcuOptions.packs.length > 0
      );

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
      .filter((option) => option.packId === resolvedPendingPackId)
      .map((option) => ({
        value: option.version,
        label: option.version,
        description: option.origin
      })),
    pendingPackId: resolvedPendingPackId,
    packCatalogNotice,
    corePackNotice,
    corePackVersions,
    mcuBlockedReason,
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
    // MCU offers only the compiler families that are actually installed; an
    // empty list hides the row instead of showing an unusable dropdown.
    mcuToolchains: (buildToolchains?.mcu ?? []).map((toolchain) => ({
      value: toolchain.id,
      label: toolchain.label,
      description: toolchain.binDir,
      detail: toolchain.cCompiler
    })),
    nativeToolchains: toolchainOptions(
      buildToolchains?.native ?? [],
      '自动（CMake 检测）',
      '让 CMake 在当前环境中挑选本机编译器'
    ),
    selection: {
      ...selection,
      // The dropdown renders these values; a series or core pack version the
      // option list cannot match would silently show the first entry instead.
      mcu: {
        ...selection.mcu,
        series: safeSelection.mcu.series,
        corePackVersion: corePackVersions.some((option) =>
          option.value === selection.mcu.corePackVersion
        )
          ? selection.mcu.corePackVersion
          : corePackVersions[0]?.value ?? '',
        buildToolchain: safeSelection.mcu.buildToolchain
      },
      native: {
        ...selection.native,
        buildToolchain: safeSelection.native.buildToolchain
      }
    }
  };
}

function selectedProjectLabel(
  workspaceName: string,
  projects: SidebarOption[],
  projectRoot: string
): string {
  return projects.find((project) => project.value === projectRoot)?.label || workspaceName;
}
