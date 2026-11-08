/**
 * Static vendor → series catalog backing the reordered sidebar flow
 * (vendor → series → pack → version → part): the user picks a chip series
 * first and the catalog determines which Device Family Pack serves it.
 *
 * This is a navigation directory, not chip data: it names packs and filters
 * parts, it never carries registers/memory/vectors. `packName` is the DFP
 * name under the vendor's own distribution; empty for vendors whose pack
 * names are not verifiable (installation guidance applies instead).
 * `partPrefix` filters the activated pack's parts down to the series.
 */

export interface CuratedSeries {
  /** Series id persisted in the sidebar selection. */
  series: string;
  /** Dropdown label. */
  label: string;
  /** Prefix matching the part numbers of this series. */
  partPrefix: string;
  /** DFP pack name serving this series; '' when not verifiable. */
  packName: string;
}

interface VendorSeriesCatalog {
  /** Registry-safe vendor id (matches pack vendorId / curated vendor). */
  vendorId: string;
  series: CuratedSeries[];
  /**
   * Official DFP download page for this vendor; `{fam2}` is replaced with the
   * first two characters of the series id (e.g. F1x → GD32F1). Undefined for
   * vendors without a stable public download page. Used only when the online
   * pack index has no pack for the selected series.
   */
  downloadPage?: string;
}

const STM32_SERIES: Array<[string, string]> = [
  ['F0x', 'STM32F0'], ['F1x', 'STM32F1'], ['F2x', 'STM32F2'], ['F3x', 'STM32F3'],
  ['F4x', 'STM32F4'], ['F7x', 'STM32F7'], ['G0x', 'STM32G0'], ['G4x', 'STM32G4'],
  ['H7x', 'STM32H7'], ['L0x', 'STM32L0'], ['L1x', 'STM32L1'], ['L4x', 'STM32L4'],
  ['L5x', 'STM32L5'], ['U5x', 'STM32U5'], ['WBx', 'STM32WB'], ['WLx', 'STM32WL'],
  ['C0x', 'STM32C0'], ['H5x', 'STM32H5'], ['U0x', 'STM32U0'], ['WBAx', 'STM32WBA']
];

const GD32_SERIES: Array<[string, string, string]> = [
  ['F1x', 'GD32F1', 'GD32F10x_DFP'],
  ['F3x', 'GD32F3', 'GD32F30x_DFP'],
  ['F4x', 'GD32F4', 'GD32F4xx_DFP'],
  ['E10x', 'GD32E10', 'GD32E10x_DFP'],
  ['E23x', 'GD32E23', 'GD32E23x_DFP'],
  ['E50x', 'GD32E50', 'GD32E50x_DFP'],
  ['L23x', 'GD32L23', 'GD32L23x_DFP'],
  ['W51x', 'GD32W51', 'GD32W51x_DFP']
];

/**
 * `[series id, label, part prefix, DFP pack name]`.
 *
 * The DFP name is filled in only when one Pack clearly serves the whole series;
 * otherwise it stays empty and the pack dropdown lists every Pack of the vendor
 * (the part list then filters by the prefix). Part prefixes are the real CMSIS
 * part-number stems, because the sidebar filters a Pack's parts with
 * `part.startsWith(prefix)`.
 */
type SeriesRow = [string, string, string, string?];

const NXP_SERIES: SeriesRow[] = [
  ['LPC55', 'LPC55', 'LPC55'],
  ['LPC54', 'LPC54', 'LPC54'],
  ['LPC17', 'LPC17', 'LPC17'],
  ['LPC11', 'LPC11', 'LPC11'],
  ['LPC8', 'LPC8', 'LPC8'],
  ['RT1xxx', 'i.MX RT', 'MIMXRT'],
  ['MCX', 'MCX', 'MCX'],
  ['KLx', 'Kinetis KL', 'MKL'],
  ['KVx', 'Kinetis KV', 'MKV'],
  ['KEx', 'Kinetis KE', 'MKE'],
  ['Kx', 'Kinetis K', 'MK']
];

const NORDIC_SERIES: SeriesRow[] = [
  ['nRF51', 'nRF51', 'nRF51', 'nRF_DeviceFamilyPack'],
  ['nRF52', 'nRF52', 'nRF52', 'nRF_DeviceFamilyPack'],
  ['nRF53', 'nRF53', 'nRF53', 'nRF_DeviceFamilyPack'],
  ['nRF54', 'nRF54', 'nRF54', 'nRF_DeviceFamilyPack'],
  ['nRF91', 'nRF91', 'nRF91', 'nRF_DeviceFamilyPack']
];
const MICROCHIP_SERIES: SeriesRow[] = [
  ['SAMD21', 'SAM D21', 'ATSAMD21', 'SAMD21_DFP'],
  ['SAMD51', 'SAM D51', 'ATSAMD51', 'SAMD51_DFP'],
  ['SAME70', 'SAM E70', 'ATSAME70', 'SAME70_DFP'],
  ['SAMC21', 'SAM C21', 'ATSAMC21', 'SAMC21_DFP'],
  ['PIC32', 'PIC32', 'PIC32']
];
function seriesRows(rows: SeriesRow[]): CuratedSeries[] {
  return rows.map(([series, label, partPrefix, packName]) => ({
    series,
    label,
    partPrefix,
    packName: packName ?? ''
  }));
}

/** STM32 part prefix: `F1x` → `STM32F1`, but `WBAx` needs the full `STM32WBA`. */
function stm32PartPrefix(series: string): string {
  return series === 'WBAx' ? 'STM32WBA' : `STM32${series.slice(0, 2)}`;
}

function packNameForStm32(series: string): string {
  return `${stm32PartPrefix(series)}xx_DFP`;
}

const seriesCatalog: VendorSeriesCatalog[] = [
  {
    vendorId: 'STMicroelectronics',
    downloadPage: 'https://www.st.com/en/microcontrollers-microprocessors/stm32-32-bit-arm-mcus.html',
    series: STM32_SERIES.map(([series, label]) => ({
      series,
      label,
      partPrefix: stm32PartPrefix(series),
      packName: packNameForStm32(series)
    }))
  },
  {
    vendorId: 'GigaDevice',
    downloadPage: 'https://www.gd32mcu.com/en/download/0?kw=GD32{fam2}',
    series: GD32_SERIES.map(([series, label, packName]) => ({
      series,
      label,
      partPrefix: `GD32${series.slice(0, 2)}`,
      packName
    }))
  },
  {
    vendorId: 'NXP',
    series: seriesRows(NXP_SERIES)
  },
  {
    vendorId: 'NordicSemiconductor',
    series: seriesRows(NORDIC_SERIES)
  },
  {
    vendorId: 'Microchip',
    series: seriesRows(MICROCHIP_SERIES)
  },
];

/** Returns the catalog series of one vendor; '' vendor or unknown → []. */
export function seriesCatalogFor(vendorId: string): CuratedSeries[] {
  return seriesCatalog.find((vendor) => vendor.vendorId === vendorId)?.series ?? [];
}

/**
 * The official DFP download page for a selected vendor+series; undefined when
 * the vendor has no stable public download page.
 */
export function seriesDownloadPage(vendorId: string, series: string): string | undefined {
  const vendor = seriesCatalog.find((vendor) => vendor.vendorId === vendorId);
  const template = vendor?.downloadPage;
  if (!template) {
    return undefined;
  }
  return template.replace('{fam2}', series.slice(0, 2));
}

/** Returns the catalog entry of one persisted series id. */
export function findCatalogSeries(vendorId: string, series: string): CuratedSeries | undefined {
  return seriesCatalogFor(vendorId).find((entry) => entry.series === series);
}

/**
 * True when a device profile belongs to a selected series.
 *
 * Two naming systems meet here: the curated series id (`F1x`) that the sidebar
 * persists, and the PDSC text a vendor pack uses (`STM32F1 Series`, or a
 * `<subFamily Dname>`). A pack serves the series when either the profile's own
 * series string matches exactly or the catalog's part prefix does — without the
 * prefix branch, activating a Pack would replace the persisted `F1x` with
 * `STM32F1 Series` and no further series switch could ever match again.
 */
export function seriesServesProfile(
  vendorId: string,
  series: string,
  profile: { part: string; series: string }
): boolean {
  if (profile.series === series) {
    return true;
  }
  const catalog = findCatalogSeries(vendorId, series);
  if (!catalog) {
    return false;
  }
  const part = profile.part.toUpperCase();
  // Longest matching prefix wins: vendor catalogs nest (`MK` for Kinetis K,
  // `MKL` for Kinetis KL), so the shorter prefix must not claim the other.
  const matching = seriesCatalogFor(vendorId)
    .filter((entry) => part.startsWith(entry.partPrefix.toUpperCase()))
    .sort((left, right) => right.partPrefix.length - left.partPrefix.length)[0];
  return matching?.series === series;
}

/**
 * Maps a vendor pack's own series text back to the curated series id.
 *
 * Older sidebar versions persisted the PDSC text (`STM32F1 Series`) instead of
 * the curated id (`F1x`); without this, such a persisted value would keep the
 * dropdown empty and unselectable, exactly the state that looked "stuck".
 */
export function catalogSeriesIdForText(
  vendorId: string,
  vendorSeries: string,
  profiles: Array<{ part: string; series: string }>
): string | undefined {
  const vendor = seriesCatalog.find((entry) => entry.vendorId === vendorId);
  return vendor?.series.find((entry) =>
    profiles.some((profile) =>
      profile.series === vendorSeries
      && profile.part.toUpperCase().startsWith(entry.partPrefix.toUpperCase())
    )
  )?.series;
}

/**
 * Maps a PDSC series name back to a curated series id serving it.
 *
 * Adopting a pack's raw series name would add a second entry next to the
 * curated one (`STM32F1` and `STM32F1 Series`), so a series the catalog covers
 * is reported under its curated id.
 */
export function canonicalSeriesId(
  vendorId: string,
  profiles: Array<{ part: string }>
): string | undefined {
  const vendor = seriesCatalog.find((entry) => entry.vendorId === vendorId);
  return vendor?.series.find((entry) => profiles.some(
    (profile) => profile.part.toUpperCase().startsWith(entry.partPrefix.toUpperCase())
  ))?.series;
}
