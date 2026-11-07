import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPackVendorOptions } from '../packs/vendorOptions';

test('only device-backed pack sources become vendor options', () => {
  const options = buildPackVendorOptions({
    registered: [
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
    ],
    online: []
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
    registered: [],
    imported: [],
    installed: [
      { vendorId: 'ARM', vendorName: 'ARM', hasDevices: false },
      { vendorId: 'ARM', vendorName: 'ARM', hasDevices: true }
    ],
    online: []
  });

  assert.deepEqual(options, [{ value: 'ARM', label: 'ARM' }]);
});

test('online index vendors are listed after local sources and marked in the label', () => {
  const options = buildPackVendorOptions({
    registered: [{ id: 'STM', label: 'STM32' }],
    imported: [{ vendorId: 'GD', vendorName: 'GD32', hasDevices: true }],
    installed: [
      { vendorId: 'ARM', vendorName: 'ARM', hasDevices: true },
      { vendorId: 'Keil', vendorName: 'Keil', hasDevices: false }
    ],
    online: [
      { vendorId: 'STMicroelectronics', vendorName: 'STMicroelectronics' },
      { vendorId: 'ARM', vendorName: 'ARM' },
      { vendorId: 'WCH', vendorName: 'WCH' }
    ]
  });

  assert.deepEqual(options, [
    { value: 'STM', label: 'STM32' },
    { value: 'GD', label: 'GD32' },
    { value: 'ARM', label: 'ARM' },
    { value: 'STMicroelectronics', label: 'STMicroelectronics（在线）', description: '在线索引厂商：激活其 Pack 版本时下载导入' },
    { value: 'WCH', label: 'WCH（在线）', description: '在线索引厂商：激活其 Pack 版本时下载导入' }
  ]);
});
