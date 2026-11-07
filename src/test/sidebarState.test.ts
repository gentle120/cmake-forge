import assert from 'node:assert/strict';
import test from 'node:test';
import {
  registerDeviceProfiles,
  unregisterDeviceProfilesByPack
} from '../devices/deviceProfiles';
import {
  buildSidebarState,
  defaultSidebarSelection,
  nextMcuSelection,
  sanitizeSidebarSelection
} from '../sidebar/state';
import {
  fixtureDeviceProfile,
  registerFixtureVendors
} from './support/fixtureDevice';

registerFixtureVendors();

const fixturePackOptions = [{
  packId: 'STM:Fixture_DFP',
  vendorId: 'STM',
  name: 'Fixture_DFP',
  version: '1.0.0',
  origin: 'imported' as const,
  packFile: 'packs/STM/Fixture_DFP.pack'
}];

function registerFixturePack(parts: Array<Parameters<typeof fixtureDeviceProfile>[0]> = [undefined]): string {
  const packFile = 'packs/STM/Fixture_DFP.pack';
  registerDeviceProfiles(parts.map((overrides) => fixtureDeviceProfile(overrides)), packFile);
  return packFile;
}

test('defaults to an empty MCU selection until a Pack provides devices', () => {
  const selection = defaultSidebarSelection() as unknown as {
    mode: string;
    mcu: { vendor: string; packId: string; version: string; series: string; part: string };
    flash: { enabled: boolean };
  };

  assert.equal(selection.mode, 'mcu');
  assert.equal(selection.mcu.vendor, '');
  assert.equal(selection.mcu.packId, '');
  assert.equal(selection.mcu.version, '');
  assert.equal(selection.mcu.series, '');
  assert.equal(selection.mcu.part, '');
  assert.equal(selection.flash.enabled, false);
});

test('a persisted builtin selection collapses to an empty MCU column', () => {
  // The vendor survives (it is still a registered vendor); every Pack-owned
  // column collapses because no Pack owns the selection anymore.
  const selection = sanitizeSidebarSelection({
    mode: 'mcu',
    mcu: { vendor: 'STM', packId: 'builtin:STM', version: 'builtin', series: 'F1x', part: 'STM32F103C8T6' }
  });

  assert.equal(selection.mcu.vendor, 'STM');
  assert.equal(selection.mcu.packId, '');
  assert.equal(selection.mcu.version, '');
  assert.equal(selection.mcu.series, '');
  assert.equal(selection.mcu.part, '');
});

test('filters series and devices to the selected Pack version', () => {
  const packFile = registerFixturePack();
  try {
    const selection = sanitizeSidebarSelection({
      ...defaultSidebarSelection(),
      mcu: {
        vendor: 'STM',
        packId: 'STM:Fixture_DFP',
        version: '1.0.0',
        series: 'F1x',
        part: 'STM32F103C8T6'
      }
    }, defaultSidebarSelection(), fixturePackOptions);
    const state = buildSidebarState(
      'firmware',
      selection,
      [],
      [],
      '',
      false,
      fixturePackOptions
    );

    assert.deepEqual(state.devices.map((device) => device.value), ['STM32F103C8T6']);
    assert.equal(
      (state.selection.mcu as unknown as { version: string }).version,
      '1.0.0'
    );
  } finally {
    unregisterDeviceProfilesByPack(packFile);
  }
});

test('replaces stale MCU values with empty fields when no Pack owns the selection', () => {
  const selection = sanitizeSidebarSelection({
    mode: 'linux',
    mcu: { vendor: 'bad', packId: 'bad', series: 'bad', part: 'bad' },
    linux: { toolchainFamily: 'bad' },
    debugEnabled: 'yes',
    flash: { enabled: true, targetId: 'bad', probeId: 'bad', openocdPath: '  ' }
  });

  assert.equal(selection.mode, 'linux');
  assert.equal(selection.mcu.vendor, '');
  assert.equal(selection.mcu.packId, '');
  assert.equal(selection.mcu.series, '');
  assert.equal(selection.mcu.part, '');
  assert.equal(selection.linux.toolchainFamily, 'loongson');
  assert.equal(selection.debugEnabled, false);
  assert.equal(selection.flash.enabled, false);
  assert.equal(selection.flash.probeId, 'stlink');
  assert.equal(selection.flash.openocdPath, 'openocd');
});

test('changing MCU fields keeps the sidebar mode of the input selection', () => {
  const selection = { ...defaultSidebarSelection(), mode: 'linux' as const };
  const updated = nextMcuSelection(selection, { vendor: 'GD' });

  assert.equal(updated.mode, 'linux');
  assert.equal(updated.mcu.vendor, 'GD');
});

test('a stored series from another vendor falls back to the vendor first series', () => {
  // Stale state after a pack import: the persisted series belongs to another
  // vendor; the series must not survive the vendor change.
  const gdPackFile = 'packs/GD/GD32F1_DFP.pack';
  registerDeviceProfiles([
    fixtureDeviceProfile({ vendor: 'GD', part: 'GD32F103C8T6', family: 'GD32F10x', defines: ['GD32F10X_MD'] })
  ], gdPackFile);
  const gdPackOptions = [{
    packId: 'GD:GD32F1_DFP',
    vendorId: 'GD',
    name: 'GD32F1_DFP',
    version: '1.0.0',
    origin: 'imported' as const,
    packFile: gdPackFile
  }];
  try {
    const selection = sanitizeSidebarSelection({
      mcu: {
        vendor: 'GD',
        packId: 'GD:GD32F1_DFP',
        version: '1.0.0',
        sourcePack: 'packs/GD/Stale_DFP.pack',
        series: 'F4x',
        part: 'STM32F103C8T6'
      }
    }, defaultSidebarSelection(), gdPackOptions);

    assert.equal(selection.mcu.vendor, 'GD');
    assert.equal(selection.mcu.series, 'F1x');
    assert.equal(selection.mcu.part, 'GD32F103C8T6');
  } finally {
    unregisterDeviceProfilesByPack(gdPackFile);
  }
});

test('bootstrap filters parts and annotates detected toolchains', () => {
  const packFile = registerFixturePack();
  try {
    const selection = sanitizeSidebarSelection({
      ...defaultSidebarSelection(),
      mcu: {
        vendor: 'STM',
        packId: 'STM:Fixture_DFP',
        version: '1.0.0',
        series: 'F1x',
        part: 'STM32F103C8T6'
      }
    }, defaultSidebarSelection(), fixturePackOptions);
    const state = buildSidebarState(
      'firmware',
      selection,
      [{ family: 'arm', verified: true, binDir: 'C:\\Tools\\arm\\bin', source: 'path' }],
      [],
      '',
      false,
      fixturePackOptions
    );

    assert.ok(state.devices.every((device) => device.value.startsWith('STM32F1')));
    assert.ok(state.linuxToolchains.some((toolchain) => toolchain.value === 'arm'));
    assert.match(state.linuxToolchains.find((toolchain) => toolchain.value === 'arm')?.detail ?? '', /PATH/);
  } finally {
    unregisterDeviceProfilesByPack(packFile);
  }
});

test('normalizes incompatible probes and only offers probes supported by the selected backend', () => {
  for (const [backend, unsupported, expected] of [
    ['jlink', 'stlink', 'jlink-ob'], ['pyocd', 'jlink', 'stlink']
  ]) {
    const selection = sanitizeSidebarSelection({ ...defaultSidebarSelection(), flash: { backend, probeId: unsupported } });
    const state = buildSidebarState('firmware', selection);
    assert.equal(selection.flash.probeId, expected);
    assert.ok(state.flashProbes.some(probe => probe.value === expected));
    assert.ok(!state.flashProbes.some(probe => probe.value === unsupported));
  }
});

test('defaults ordinary C/C++ projects to a C11/C++17 executable', () => {
  const selection = defaultSidebarSelection();

  assert.equal(selection.native.targetType, 'executable');
  assert.equal(selection.native.cStandard, 11);
  assert.equal(selection.native.cxxStandard, 17);
});

test('accepts native mode and rejects unsupported native options', () => {
  const selection = sanitizeSidebarSelection({
    ...defaultSidebarSelection(),
    mode: 'native',
    native: {
      targetType: 'shared',
      cStandard: 23,
      cxxStandard: 23
    }
  });
  const invalid = sanitizeSidebarSelection({
    ...defaultSidebarSelection(),
    mode: 'native',
    native: {
      targetType: 'plugin',
      cStandard: 99,
      cxxStandard: 99
    }
  });

  assert.equal(selection.mode, 'native');
  assert.equal(selection.native.targetType, 'shared');
  assert.equal(selection.native.cStandard, 23);
  assert.equal(selection.native.cxxStandard, 23);
  assert.equal(invalid.native.targetType, 'executable');
  assert.equal(invalid.native.cStandard, 11);
  assert.equal(invalid.native.cxxStandard, 17);
});

test('keeps the selected project root in persisted sidebar state', () => {
  const selection = sanitizeSidebarSelection({
    ...defaultSidebarSelection(),
    projectRoot: 'C:/workspace/firmware'
  });
  assert.equal(selection.projectRoot, 'C:/workspace/firmware');
  assert.equal(
    sanitizeSidebarSelection({ ...defaultSidebarSelection(), projectRoot: 42 }).projectRoot,
    ''
  );
});

test('uses the selected project label and exposes project discovery state', () => {
  const state = buildSidebarState(
    'workspace',
    defaultSidebarSelection(),
    [],
    [
      { value: 'C:/work/firmware', label: 'work/firmware' },
      { value: 'C:/work/desktop', label: 'work/desktop' }
    ],
    'C:/work/desktop',
    true
  );
  assert.equal(state.workspaceName, 'work/desktop');
  assert.equal(state.projectRoot, 'C:/work/desktop');
  assert.equal(state.discoveringProjects, true);
  assert.deepEqual(state.projects.map((project) => project.label), ['work/firmware', 'work/desktop']);
});

test('switching to another imported Pack of the same vendor also switches its profile owner', () => {
  const f1 = fixtureDeviceProfile();
  const f4 = fixtureDeviceProfile({
    part: 'STM32F407VGT6',
    series: 'F4x',
    defines: ['STM32F407xx'],
    compilerFlags: ['-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard'],
    flash: { origin: 0x08000000, length: 1024 * 1024 },
    ram: { origin: 0x20000000, length: 128 * 1024 },
    debugTarget: 'stm32f4x'
  });
  registerDeviceProfiles([f1], 'packs/STM/A_DFP.pack');
  registerDeviceProfiles([f4], 'packs/STM/B_DFP.pack');
  const packOptions = [
    {
      packId: 'STM:A_DFP', vendorId: 'STM', name: 'A_DFP', version: '1.0.0',
      origin: 'imported' as const, packFile: 'packs/STM/A_DFP.pack'
    },
    {
      packId: 'STM:B_DFP', vendorId: 'STM', name: 'B_DFP', version: '1.0.0',
      origin: 'imported' as const, packFile: 'packs/STM/B_DFP.pack'
    }
  ];
  const current = sanitizeSidebarSelection({
    ...defaultSidebarSelection(),
    mcu: {
      vendor: 'STM',
      packId: 'STM:A_DFP',
      version: '1.0.0',
      sourcePack: 'packs/STM/A_DFP.pack',
      series: 'F1x',
      part: 'STM32F103C8T6'
    }
  }, defaultSidebarSelection(), packOptions);

  try {
    const switched = sanitizeSidebarSelection(
      nextMcuSelection(current, { packId: 'STM:B_DFP', version: '1.0.0' }, packOptions),
      current,
      packOptions
    );

    assert.equal(switched.mcu.packId, 'STM:B_DFP');
    assert.equal(switched.mcu.sourcePack, 'packs/STM/B_DFP.pack');
    assert.equal(switched.mcu.series, 'F4x');
    assert.equal(switched.mcu.part, 'STM32F407VGT6');
  } finally {
    unregisterDeviceProfilesByPack('packs/STM/A_DFP.pack');
    unregisterDeviceProfilesByPack('packs/STM/B_DFP.pack');
  }
});

test('a persisted profile owner that contradicts the selected Pack is corrected', () => {
  const f4 = fixtureDeviceProfile({
    part: 'STM32F407VGT6',
    series: 'F4x',
    defines: ['STM32F407xx'],
    compilerFlags: ['-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard'],
    flash: { origin: 0x08000000, length: 1024 * 1024 },
    ram: { origin: 0x20000000, length: 128 * 1024 },
    debugTarget: 'stm32f4x'
  });
  registerDeviceProfiles([f4], 'packs/STM/B_DFP.pack');
  const packOptions = [{
    packId: 'STM:B_DFP', vendorId: 'STM', name: 'B_DFP', version: '1.0.0',
    origin: 'imported' as const, packFile: 'packs/STM/B_DFP.pack'
  }];
  const stale = {
    ...defaultSidebarSelection(),
    mcu: {
      vendor: 'STM',
      packId: 'STM:B_DFP',
      version: '1.0.0',
      sourcePack: 'packs/STM/Old_DFP.pack',
      series: 'F4x',
      part: 'STM32F407VGT6'
    }
  };

  try {
    const healed = sanitizeSidebarSelection(stale, defaultSidebarSelection(), packOptions);

    assert.equal(healed.mcu.packId, 'STM:B_DFP');
    assert.equal(healed.mcu.sourcePack, 'packs/STM/B_DFP.pack');
    assert.equal(healed.mcu.part, 'STM32F407VGT6');
  } finally {
    unregisterDeviceProfilesByPack('packs/STM/B_DFP.pack');
  }
});
