import assert from 'node:assert/strict';
import test from 'node:test';
import { curatedVendors } from '../devices/curatedVendors';
import { buildPackVendorOptions } from '../packs/vendorOptions';

const NO_LOCAL_PACK_HINT = '本地暂无此厂商的 Pack';

test('the curated list starts with the mainstream MCU families', () => {
  assert.deepEqual(curatedVendors.slice(0, 5).map((vendor) => vendor.label), [
    'STM32',
    'GD32',
    'NXP',
    'nRF',
    'Microchip'
  ]);
  const ids = new Set(curatedVendors.map((vendor) => vendor.id));
  for (const id of [
    'STMicroelectronics', 'GigaDevice', 'NXP', 'NordicSemiconductor', 'Microchip'
  ]) {
    assert.ok(ids.has(id), `missing curated vendor ${id}`);
  }
  assert.equal(curatedVendors.length, 5);
});

test('curated vendors fill the list behind local sources and reuse curated labels', () => {
  const options = buildPackVendorOptions({
    registered: [],
    imported: [
      { vendorId: 'GigaDevice', vendorName: 'GigaDevice', hasDevices: true },
      { vendorId: 'Sinomcu', vendorName: 'Sinomcu', hasDevices: true }
    ],
    installed: [
      { vendorId: 'NXP', vendorName: 'NXP', hasDevices: false }
    ],
    curated: [
      { id: 'STMicroelectronics', label: 'STM32' },
      { id: 'GigaDevice', label: 'GD32' },
      { id: 'WCH', label: 'CH32' },
      { id: 'NXP', label: 'NXP' }
    ]
  });

  assert.deepEqual(options, [
    // Local sources come first; a curated vendor locally present keeps its
    // friendly curated label instead of the raw PDSC vendor name.
    { value: 'GigaDevice', label: 'GD32' },
    { value: 'Sinomcu', label: 'Sinomcu' },
    // Curated vendors without local packs follow with an install hint.
    { value: 'STMicroelectronics', label: 'STM32', description: `${NO_LOCAL_PACK_HINT}：请用 Keil Pack Installer 安装器件包，或导入本地 .pack` },
    { value: 'WCH', label: 'CH32', description: `${NO_LOCAL_PACK_HINT}：请用 Keil Pack Installer 安装器件包，或导入本地 .pack` },
    { value: 'NXP', label: 'NXP', description: `${NO_LOCAL_PACK_HINT}：请用 Keil Pack Installer 安装器件包，或导入本地 .pack` }
  ]);
});

test('a vendor is listed once no matter how many of its packs are installed', () => {
  const options = buildPackVendorOptions({
    registered: [],
    imported: [],
    installed: [
      { vendorId: 'GigaDevice', vendorName: 'GigaDevice', hasDevices: false },
      { vendorId: 'GigaDevice', vendorName: 'GigaDevice', hasDevices: true }
    ],
    curated: []
  });

  assert.deepEqual(options, [{ value: 'GigaDevice', label: 'GigaDevice' }]);
});

test('device-less pack sources never create vendor entries', () => {
  const options = buildPackVendorOptions({
    registered: [],
    imported: [{ vendorId: 'Empty', vendorName: 'Empty', hasDevices: false }],
    installed: [
      { vendorId: 'Keil', vendorName: 'Keil', hasDevices: false },
      { vendorId: 'ARM', vendorName: 'ARM', hasDevices: false }
    ],
    curated: []
  });

  assert.deepEqual(options, []);
});
