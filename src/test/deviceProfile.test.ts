import assert from 'node:assert/strict';
import test from 'node:test';
import * as deviceProfiles from '../devices/deviceProfiles';
import {
  getDeviceProfile,
  listDeviceProfiles,
  registerDeviceProfiles,
  unregisterDeviceProfiles,
  unregisterDeviceProfilesByPack
} from '../devices/deviceProfiles';
import * as deviceSelection from '../devices/deviceSelection';
import { validateDeviceProfile } from '../devices/profileValidation';
import {
  listDeviceProfilesForSeries,
  listDeviceSeries,
  listDeviceVendors
} from '../devices/deviceSelection';
import {
  fixtureDeviceProfile,
  registerFixtureVendors
} from './support/fixtureDevice';

registerFixtureVendors();

test('starts with an empty registry and no vendors', () => {
  assert.deepEqual(listDeviceProfiles(), []);
  assert.deepEqual(listDeviceVendors(listDeviceProfiles()), []);
});

test('rejects an unsupported device', () => {
  assert.throws(() => getDeviceProfile('NOT_A_REAL_MCU'), /Unsupported MCU/);
});

test('normalizes the selected part name', () => {
  registerDeviceProfiles([fixtureDeviceProfile()], 'packs/STM/Fixture_DFP.pack');

  try {
    assert.equal(getDeviceProfile(' stm32f103c8t6 ').part, 'STM32F103C8T6');
  } finally {
    unregisterDeviceProfilesByPack('packs/STM/Fixture_DFP.pack');
  }
});

test('builds progressive vendor, series, and device choices', () => {
  registerDeviceProfiles([
    fixtureDeviceProfile(),
    fixtureDeviceProfile({ part: 'STM32F103RCT6', flash: { origin: 0x08000000, length: 256 * 1024 }, ram: { origin: 0x20000000, length: 48 * 1024 } }),
    fixtureDeviceProfile({ part: 'GD32F103C8T6', vendor: 'GD', family: 'GD32F10x', defines: ['GD32F10X_MD'] })
  ], 'packs/STM/Fixture_DFP.pack');

  try {
    const profiles = listDeviceProfiles();

    assert.deepEqual(listDeviceVendors(profiles), ['STM', 'GD']);
    assert.deepEqual(listDeviceSeries(profiles, 'STM'), ['F1x']);
    assert.deepEqual(listDeviceSeries(profiles, 'GD'), ['F1x']);
    assert.deepEqual(
      listDeviceProfilesForSeries(profiles, 'STM', 'F1x').map((profile) => profile.part),
      ['STM32F103C8T6', 'STM32F103RCT6']
    );
  } finally {
    unregisterDeviceProfilesByPack('packs/STM/Fixture_DFP.pack');
  }
});

test('rejects incomplete device profiles before registry exposure', () => {
  const profile = fixtureDeviceProfile();

  assert.throws(
    () => validateDeviceProfile({ ...profile, interruptHandlers: [] }),
    /Invalid MCU profile.*interruptHandlers/
  );
  assert.throws(
    () => validateDeviceProfile({ ...profile, compilerFlags: [] }),
    /Invalid MCU profile.*compilerFlags/
  );
  assert.throws(
    () => validateDeviceProfile({ ...profile, flash: { ...profile.flash, length: 0 } }),
    /Invalid MCU profile.*flash/
  );
  assert.throws(
    () => validateDeviceProfile({ ...profile, ram: { ...profile.ram, length: 0 } }),
    /Invalid MCU profile.*ram/
  );
});

test('returns defensive copies of profile data', () => {
  registerDeviceProfiles([fixtureDeviceProfile()], 'packs/STM/Fixture_DFP.pack');

  try {
    const profile = getDeviceProfile('STM32F103C8T6');
    profile.defines.push('MUTATED');
    profile.compilerFlags.length = 0;
    profile.interruptHandlers[0] = 'MUTATED_IRQHandler';
    profile.flash.length = 1;

    const freshProfile = getDeviceProfile('STM32F103C8T6');
    assert.doesNotMatch(freshProfile.defines.join(' '), /MUTATED/);
    assert.notEqual(freshProfile.compilerFlags.length, 0);
    assert.notEqual(freshProfile.interruptHandlers[0], 'MUTATED_IRQHandler');
    assert.equal(freshProfile.flash.length, 64 * 1024);
  } finally {
    unregisterDeviceProfilesByPack('packs/STM/Fixture_DFP.pack');
  }
});

test('removes a runtime profile when it is unregistered', () => {
  const imported = {
    ...fixtureDeviceProfile(),
    part: 'RUNTIME_ONLY_MCU'
  };
  registerDeviceProfiles([imported]);
  assert.equal(getDeviceProfile('RUNTIME_ONLY_MCU').part, 'RUNTIME_ONLY_MCU');

  unregisterDeviceProfiles(['RUNTIME_ONLY_MCU']);
  assert.throws(() => getDeviceProfile('RUNTIME_ONLY_MCU'), /Unsupported MCU/);
});

test('keeps the newest pack source and drops the part when every source is unregistered', () => {
  const original = fixtureDeviceProfile();
  registerDeviceProfiles([{ ...original, ram: { origin: 0x20000000, length: 0x1000 } }], 'first.pack');
  registerDeviceProfiles([{ ...original, ram: { origin: 0x20000000, length: 0x2000 } }], 'second.pack');
  assert.equal(getDeviceProfile('STM32F103C8T6').ram.length, 0x2000);

  unregisterDeviceProfilesByPack('second.pack');
  assert.equal(getDeviceProfile('STM32F103C8T6').ram.length, 0x1000);

  unregisterDeviceProfilesByPack('first.pack');
  assert.throws(() => getDeviceProfile('STM32F103C8T6'), /Unsupported MCU/);
});

test('resolves a profile from the selected Pack instead of the global latest override', () => {
  const packApi = deviceProfiles as unknown as {
    getDeviceProfileForPack(part: string, sourcePack: string): ReturnType<typeof getDeviceProfile>;
    listDeviceProfilesForPack(sourcePack: string): ReturnType<typeof listDeviceProfiles>;
  };
  const original = fixtureDeviceProfile();
  const older = {
    ...original,
    ram: { ...original.ram, length: 16 * 1024 }
  };
  const newer = {
    ...original,
    ram: { ...original.ram, length: 32 * 1024 }
  };
  registerDeviceProfiles([older], 'packs/STMicro/STM32F1.1.0.pack');
  registerDeviceProfiles([newer], 'packs/STMicro/STM32F1.2.0.pack');

  try {
    assert.equal(getDeviceProfile('STM32F103C8T6').ram.length, 32 * 1024);
    assert.equal(
      packApi.getDeviceProfileForPack('STM32F103C8T6', 'packs/STMicro/STM32F1.1.0.pack').ram.length,
      16 * 1024
    );
    assert.equal(
      packApi.listDeviceProfilesForPack('packs/STMicro/STM32F1.1.0.pack')[0].part,
      'STM32F103C8T6'
    );
    assert.deepEqual(packApi.listDeviceProfilesForPack('builtin:STM'), []);
  } finally {
    unregisterDeviceProfilesByPack('packs/STMicro/STM32F1.2.0.pack');
    unregisterDeviceProfilesByPack('packs/STMicro/STM32F1.1.0.pack');
  }
});

test('pack choices preserve origin and every selectable version', () => {
  const options = deviceSelection.buildDevicePackOptions({
    vendorId: 'STM',
    imported: [{
      packId: 'STM:STM32F1xx_DFP',
      vendorId: 'STM',
      name: 'STM32F1xx_DFP',
      version: '1.0.0',
      packFile: 'packs/STM/STM32F1xx_DFP.1.0.0.pack',
      vendorName: 'STMicroelectronics',
      parts: ['STM32F103C8T6']
    }],
    installed: [{
      vendorId: 'STM',
      name: 'STM32F1xx_DFP',
      version: '1.1.0',
      packFile: 'C:/Arm/Packs/ST/STM32F1xx_DFP/1.1.0/ST.STM32F1xx_DFP.1.1.0.pack',
      source: 'file',
      hasDevices: true
    }],
    online: [{
      name: 'STM32F1xx_DFP',
      version: '1.2.0',
      packUrl: 'https://packs.example/STM32F1xx_DFP.1.2.0.pack',
      vendorName: 'STMicroelectronics'
    }]
  });

  assert.deepEqual(
    options.map(({ packId, version, origin }) => [packId, version, origin]),
    [
      ['STM:STM32F1xx_DFP', '1.0.0', 'imported'],
      ['STM:STM32F1xx_DFP', '1.1.0', 'installed'],
      ['STM:STM32F1xx_DFP', '1.2.0', 'downloadable']
    ]
  );
  assert.equal(options[0].packFile, 'packs/STM/STM32F1xx_DFP.1.0.0.pack');
});

test('a device-less installed Pack is not offered in the catalog', () => {
  const options = deviceSelection.buildDevicePackOptions({
    vendorId: 'ARM',
    imported: [],
    installed: [{
      vendorId: 'ARM',
      name: 'CMSIS',
      version: '6.3.0',
      packFile: 'C:/Arm/Packs/ARM/CMSIS/6.3.0',
      source: 'directory',
      hasDevices: false
    }],
    online: []
  });

  assert.deepEqual(options, []);
});

test('an imported record without usable parts is not offered in the catalog', () => {
  const options = deviceSelection.buildDevicePackOptions({
    vendorId: 'Sinomcu',
    imported: [{
      packId: 'Sinomcu:MS32F0xx_DFP',
      vendorId: 'Sinomcu',
      name: 'MS32F0xx_DFP',
      version: '1.1.1',
      packFile: 'packs/Sinomcu/MS32F0xx_DFP.pack',
      vendorName: 'Sinomcu',
      parts: []
    }],
    installed: [],
    online: []
  });

  assert.deepEqual(options, []);
});

test('same-named Packs from different vendors keep distinct catalog identities', () => {
  const options = deviceSelection.buildDevicePackOptions({
    vendorId: 'VendorA',
    imported: [{
      packId: 'VendorA:Shared_DFP',
      vendorId: 'VendorA',
      name: 'Shared_DFP',
      version: '1.0.0',
      packFile: 'packs/VendorA/Shared_DFP.1.0.0.pack',
      vendorName: 'Vendor A',
      parts: ['A100']
    }, {
      packId: 'VendorB:Shared_DFP',
      vendorId: 'VendorB',
      name: 'Shared_DFP',
      version: '1.0.0',
      packFile: 'packs/VendorB/Shared_DFP.1.0.0.pack',
      vendorName: 'Vendor B',
      parts: ['B100']
    }],
    installed: [],
    online: []
  });

  assert.deepEqual(options.map((option) => [
    option.packId,
    option.vendorId,
    option.packFile
  ]), [[
    'VendorA:Shared_DFP',
    'VendorA',
    'packs/VendorA/Shared_DFP.1.0.0.pack'
  ]]);
});

test('an installed Pack is grouped under its own PDSC vendor, not the selected folder vendor', () => {
  const installed = {
    vendorId: 'Sinomcu',
    name: 'MS32F0xx_DFP',
    version: '1.1.1',
    packFile: 'C:/Arm/Packs/Keil/MS32F0xx_DFP/1.1.1',
    source: 'directory' as const,
    hasDevices: true
  };

  const matching = deviceSelection.buildDevicePackOptions({
    vendorId: 'Sinomcu',
    imported: [],
    installed: [installed],
    online: []
  });
  assert.deepEqual(matching.map((option) => [option.packId, option.vendorId, option.origin]), [[
    'Sinomcu:MS32F0xx_DFP',
    'Sinomcu',
    'installed'
  ]]);

  const otherVendor = deviceSelection.buildDevicePackOptions({
    vendorId: 'STM',
    imported: [],
    installed: [installed],
    online: []
  });
  assert.deepEqual(otherVendor, []);
});

test('an installed version is not duplicated by a downloadable entry of the same version', () => {
  const options = deviceSelection.buildDevicePackOptions({
    vendorId: 'STM',
    imported: [],
    installed: [{
      vendorId: 'STM',
      name: 'STM32F1xx_DFP',
      version: '1.1.0',
      packFile: 'C:/Arm/Packs/ST/STM32F1xx_DFP/1.1.0',
      source: 'directory',
      hasDevices: true
    }],
    online: [{
      name: 'STM32F1xx_DFP',
      version: '1.1.0',
      packUrl: 'https://packs.example/STM32F1xx_DFP.1.1.0.pack',
      vendorName: 'STMicroelectronics'
    }]
  });

  assert.deepEqual(options.map((option) => [option.version, option.origin]), [['1.1.0', 'installed']]);
});
