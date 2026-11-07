/**
 * The MCU vendor list shown in the sidebar: a short curated set of mainstream
 * 32-bit ARM chip vendors, so the dropdown reads like a product menu instead
 * of a pack-index dump. `id` is the registry-safe PDSC `Dvendor` name (numeric
 * registry suffix stripped, non-alphanumerics collapsed to `_`), which is what
 * installed and imported packs resolve to; a locally present vendor replaces
 * the curated placeholder with its real pack data.
 */

export interface CuratedVendor {
  id: string;
  label: string;
}

export const curatedVendors: CuratedVendor[] = [
  { id: 'STMicroelectronics', label: 'STM32' },
  { id: 'GigaDevice', label: 'GD32' },
  { id: 'WCH', label: 'CH32' },
  { id: 'NXP', label: 'NXP' },
  { id: 'Infineon', label: 'Infineon' },
  { id: 'Microchip', label: 'Microchip' },
  { id: 'Texas_Instruments', label: 'TI' },
  { id: 'Renesas', label: 'Renesas' },
  { id: 'Silicon_Labs', label: 'Silicon Labs' },
  { id: 'NordicSemi', label: 'Nordic' }
];
