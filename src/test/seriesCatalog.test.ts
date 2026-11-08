import assert from 'node:assert/strict';
import test from 'node:test';
import { curatedVendors } from '../devices/curatedVendors';
import {
  findCatalogSeries,
  seriesCatalogFor,
  seriesServesProfile
} from '../devices/seriesCatalog';

function serves(vendor: string, series: string, part: string): boolean {
  return seriesServesProfile(vendor, series, { part, series: '' });
}

test('every curated vendor offers at least one series', () => {
  for (const vendor of curatedVendors) {
    assert.ok(
      seriesCatalogFor(vendor.id).length > 0,
      `${vendor.id} has no catalog series`
    );
  }
});

test('real part numbers land in the curated series', () => {
  const samples: Array<[string, string, string]> = [
    ['STMicroelectronics', 'F1x', 'STM32F103C8T6'],
    ['GigaDevice', 'F1x', 'GD32F101C4'],
    ['NXP', 'LPC55', 'LPC55S69JBD100'],
    ['NXP', 'RT1xxx', 'MIMXRT1062DVL6A'],
    ['NordicSemiconductor', 'nRF52', 'nRF52840-QIAA'],
    ['Microchip', 'SAMD21', 'ATSAMD21G18A-MU'],
  ];
  for (const [vendor, series, part] of samples) {
    assert.equal(serves(vendor, series, part), true, `${part} should be ${vendor}/${series}`);
  }
});

test('nested part prefixes resolve to the most specific series', () => {
  // Kinetis KL/KV/KE share the `MK` stem with Kinetis K.
  assert.equal(serves('NXP', 'KLx', 'MKL27Z256VFT4'), true);
  assert.equal(serves('NXP', 'Kx', 'MKL27Z256VFT4'), false);
  assert.equal(serves('NXP', 'Kx', 'MK64FN1M0VLL12'), true);
  // STM32WBA parts also start with STM32WB.
  assert.equal(serves('STMicroelectronics', 'WBAx', 'STM32WBA55CGU6'), true);
  assert.equal(serves('STMicroelectronics', 'WBx', 'STM32WBA55CGU6'), false);
  assert.equal(serves('STMicroelectronics', 'WBx', 'STM32WB55CGU6'), true);
});

test('curated series name the DFP when one Pack serves them', () => {
  assert.equal(findCatalogSeries('STMicroelectronics', 'F1x')?.packName, 'STM32F1xx_DFP');
  assert.equal(findCatalogSeries('GigaDevice', 'E23x')?.packName, 'GD32E23x_DFP');
  assert.equal(findCatalogSeries('NordicSemiconductor', 'nRF52')?.packName, 'nRF_DeviceFamilyPack');
  // Series spanning several DFPs intentionally leave the name empty.
  assert.equal(findCatalogSeries('NXP', 'LPC55')?.packName, '');
});
