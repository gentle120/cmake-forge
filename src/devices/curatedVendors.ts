/**
 * The MCU vendor list shown in the sidebar: a short curated set of mainstream
 * 32-bit ARM chip vendors, so the dropdown reads like a product menu instead
 * of a pack-index dump. `id` is the registry-safe PDSC `Dvendor` name (numeric
 * registry suffix stripped, non-alphanumerics collapsed to `_`), which is what
 * installed and imported packs resolve to; a locally present vendor replaces
 * the curated placeholder with its real pack data.
 *
 * Five vendors cover most Cortex-M work. Other vendors still appear after a
 * local `.pack` import (their profiles register from the PDSC); the curated
 * list only drives the guided series→pack flow and online install. Every vendor here needs
 * at least one series entry, otherwise selecting it shows an empty dropdown.
 */

export interface CuratedVendor {
  id: string;
  label: string;
}

export const curatedVendors: CuratedVendor[] = [
  { id: 'STMicroelectronics', label: 'STM32' },
  { id: 'GigaDevice', label: 'GD32' },
  { id: 'NXP', label: 'NXP' },
  { id: 'NordicSemiconductor', label: 'nRF' },
  { id: 'Microchip', label: 'Microchip' }
];
