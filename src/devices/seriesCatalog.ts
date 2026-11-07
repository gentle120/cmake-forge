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

export interface VendorSeriesCatalog {
  /** Registry-safe vendor id (matches pack vendorId / curated vendor). */
  vendorId: string;
  series: CuratedSeries[];
}

const STM32_SERIES: Array<[string, string]> = [
  ['F0x', 'STM32F0'], ['F1x', 'STM32F1'], ['F2x', 'STM32F2'], ['F3x', 'STM32F3'],
  ['F4x', 'STM32F4'], ['F7x', 'STM32F7'], ['G0x', 'STM32G0'], ['G4x', 'STM32G4'],
  ['H7x', 'STM32H7'], ['L0x', 'STM32L0'], ['L1x', 'STM32L1'], ['L4x', 'STM32L4'],
  ['L5x', 'STM32L5'], ['U5x', 'STM32U5'], ['WBx', 'STM32WB'], ['WLx', 'STM32WL']
];

const GD32_SERIES: Array<[string, string, string]> = [
  ['F1x', 'GD32F1', 'GD32F10x_DFP'],
  ['F3x', 'GD32F3', 'GD32F30x_DFP'],
  ['F4x', 'GD32F4', 'GD32F40x_DFP']
];

export const seriesCatalog: VendorSeriesCatalog[] = [
  {
    vendorId: 'STMicroelectronics',
    series: STM32_SERIES.map(([series, label]) => ({
      series,
      label,
      partPrefix: `STM32${series.slice(0, 2)}`,
      packName: `STM32${series.slice(0, 2)}xx_DFP`
    }))
  },
  {
    vendorId: 'GigaDevice',
    series: GD32_SERIES.map(([series, label, packName]) => ({
      series,
      label,
      partPrefix: `GD32${series.slice(0, 2)}`,
      packName
    }))
  },
  {
    // WCH's DFP naming is not verifiable from public sources; the series is
    // offered but pack determination falls back to installation guidance.
    vendorId: 'WCH',
    series: [{ series: 'F1x', label: 'CH32F1', partPrefix: 'CH32F1', packName: '' }]
  }
];

/** Returns the catalog series of one vendor; '' vendor or unknown → []. */
export function seriesCatalogFor(vendorId: string): CuratedSeries[] {
  return seriesCatalog.find((vendor) => vendor.vendorId === vendorId)?.series ?? [];
}

/** Returns the catalog entry of one persisted series id. */
export function findCatalogSeries(vendorId: string, series: string): CuratedSeries | undefined {
  return seriesCatalogFor(vendorId).find((entry) => entry.series === series);
}
