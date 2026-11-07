import assert from 'node:assert/strict';
import test from 'node:test';
import { packNameFromFileName, packVendorDisplayName, packVendorId } from '../packs/packIdentity';

test('splits a CMSIS archive name into pack name and full version', () => {
  assert.deepEqual(packNameFromFileName('GigaDevice.GD32F10x_DFP.2.0.3.pack'), {
    name: 'GigaDevice.GD32F10x_DFP',
    version: '2.0.3'
  });
  assert.deepEqual(packNameFromFileName('Keil.STM32F1xx_DFP.2.4.1.pack'), {
    name: 'Keil.STM32F1xx_DFP',
    version: '2.4.1'
  });
  assert.deepEqual(packNameFromFileName('C:/packs/GigaDevice.GD32F4xx_DFP.3.0.3.pack'), {
    name: 'GigaDevice.GD32F4xx_DFP',
    version: '3.0.3'
  });
  assert.deepEqual(packNameFromFileName('Vendor.Pack.1.0.pack'), {
    name: 'Vendor.Pack',
    version: '1.0'
  });
  assert.deepEqual(packNameFromFileName('Vendor.Pack.1.0.0-rc1.pack'), {
    name: 'Vendor.Pack',
    version: '1.0.0-rc1'
  });
});

test('a name without a trailing version has no version', () => {
  assert.deepEqual(packNameFromFileName('ms32f031.pack'), { name: 'ms32f031', version: undefined });
  assert.deepEqual(packNameFromFileName('first.pack'), { name: 'first', version: undefined });
});

test('normalizes vendor identity for registry and display', () => {
  assert.equal(packVendorId('GigaDevice'), 'GigaDevice');
  assert.equal(packVendorId('MS Semi'), 'MS_Semi');
  assert.equal(packVendorId('Sinomcu:985'), 'Sinomcu_985');
  assert.equal(packVendorDisplayName('Sinomcu:985'), 'Sinomcu');
  assert.equal(packVendorDisplayName('GigaDevice'), 'GigaDevice');
});
