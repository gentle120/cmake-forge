import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPackVendorOptions } from '../packs/vendorOptions';

test('only device-backed pack sources become vendor options', () => {
  const options = buildPackVendorOptions({
    builtin: [
      { id: 'STM', label: 'STM32' },
      { id: 'GD', label: 'GD32' }
    ],
    imported: [
      { vendorId: 'Sinomcu', vendorName: 'Sinomcu', hasDevices: true },
      { vendorId: 'Empty', vendorName: 'Empty', hasDevices: false }
    ],
    installed: [
      { vendorId: 'ARM', vendorName: 'ARM', hasDevices: true },
      { vendorId: 'Keil', vendorName: 'Keil', hasDevices: false },
      { vendorId: 'NXP', vendorName: 'NXP', hasDevices: false }
    ]
  });

  assert.deepEqual(options, [
    { value: 'STM', label: 'STM32' },
    { value: 'GD', label: 'GD32' },
    { value: 'Sinomcu', label: 'Sinomcu' },
    { value: 'ARM', label: 'ARM' }
  ]);
});

test('a vendor is listed once no matter how many of its packs are installed', () => {
  const options = buildPackVendorOptions({
    builtin: [],
    imported: [],
    installed: [
      { vendorId: 'ARM', vendorName: 'ARM', hasDevices: false },
      { vendorId: 'ARM', vendorName: 'ARM', hasDevices: true }
    ]
  });

  assert.deepEqual(options, [{ value: 'ARM', label: 'ARM' }]);
});
