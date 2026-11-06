import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getDeviceProfile,
  registerDeviceProfiles,
  unregisterDeviceProfilesByPack
} from '../devices/deviceProfiles';
import {
  buildSidebarState,
  defaultSidebarSelection,
  nextMcuSelection,
  sanitizeSidebarSelection
} from '../sidebar/state';

test('defaults to the first STM32 F1 device', () => {
  const selection = defaultSidebarSelection() as unknown as {
    mode: string;
    mcu: { vendor: string; packId: string; version: string; series: string; part: string };
    flash: { enabled: boolean };
  };

  assert.equal(selection.mode, 'mcu');
  assert.equal(selection.mcu.vendor, 'STM');
  assert.equal(selection.mcu.packId, 'builtin:STM');
  assert.equal(selection.mcu.version, 'builtin');
  assert.equal(selection.mcu.series, 'F1x');
  assert.equal(selection.mcu.part, 'STM32F103C8T6');
  assert.equal(selection.flash.enabled, false);
});

test('filters series and devices to the selected Pack version', () => {
  const stateApi = {
    sanitizeSidebarSelection,
    buildSidebarState
  } as unknown as {
    sanitizeSidebarSelection(
      value: unknown,
      fallback: ReturnType<typeof defaultSidebarSelection>,
      packOptions: Array<{
        packId: string;
        vendorId: string;
        name: string;
        version: string;
        origin: 'imported';
        packFile: string;
      }>
    ): ReturnType<typeof defaultSidebarSelection>;
    buildSidebarState(
      workspaceName: string,
      selection: ReturnType<typeof defaultSidebarSelection>,
      discoveredToolchains: unknown[],
      projects: unknown[],
      projectRoot: string,
      discoveringProjects: boolean,
      packOptions: Array<{
        packId: string;
        vendorId: string;
        name: string;
        version: string;
        origin: 'imported';
        packFile: string;
      }>
    ): ReturnType<typeof buildSidebarState>;
  };
  const original = getDeviceProfile('STM32F103C8T6');
  const oldVersion = {
    ...original,
    ram: { ...original.ram, length: 16 * 1024 }
  };
  registerDeviceProfiles([oldVersion], 'packs/STM/STM32F1xx_DFP.1.0.0.pack');
  const packOptions = [{
    packId: 'STM:STM32F1xx_DFP',
    vendorId: 'STM',
    name: 'STM32F1xx_DFP',
    version: '1.0.0',
    origin: 'imported' as const,
    packFile: 'packs/STM/STM32F1xx_DFP.1.0.0.pack'
  }];

  try {
    const selection = stateApi.sanitizeSidebarSelection({
      ...defaultSidebarSelection(),
      mcu: {
        vendor: 'STM',
        packId: 'STM:STM32F1xx_DFP',
        version: '1.0.0',
        series: 'F1x',
        part: 'STM32F103C8T6'
      }
    }, defaultSidebarSelection(), packOptions);
    const state = stateApi.buildSidebarState(
      'firmware',
      selection,
      [],
      [],
      '',
      false,
      packOptions
    );

    assert.deepEqual(state.devices.map((device) => device.value), ['STM32F103C8T6']);
    assert.equal(
      (state.selection.mcu as unknown as { version: string }).version,
      '1.0.0'
    );
  } finally {
    unregisterDeviceProfilesByPack('packs/STM/STM32F1xx_DFP.1.0.0.pack');
  }
});

test('replaces stale values with current registry defaults', () => {
  const selection = sanitizeSidebarSelection({
    mode: 'linux',
    mcu: { vendor: 'bad', series: 'bad', part: 'bad' },
    linux: { toolchainFamily: 'bad' },
    debugEnabled: 'yes',
    flash: { enabled: true, targetId: 'bad', probeId: 'bad', openocdPath: '  ' }
  });

  assert.equal(selection.mode, 'linux');
  assert.equal(selection.mcu.series, 'F0x');
  assert.equal(selection.mcu.part, 'STM32F030C8T6');
  assert.equal(selection.linux.toolchainFamily, 'loongson');
  assert.equal(selection.debugEnabled, false);
  assert.equal(selection.flash.enabled, false);
  assert.equal(selection.flash.probeId, 'stlink');
  assert.equal(selection.flash.openocdPath, 'openocd');
});

test('changing vendor selects its first series and part', () => {
  const updated = nextMcuSelection(defaultSidebarSelection(), { vendor: 'GD' });

  assert.equal(updated.mode, 'mcu');
  assert.equal(updated.mcu.vendor, 'GD');
  assert.equal(updated.mcu.series, 'F1x');
  assert.equal(updated.mcu.part, 'GD32F103C8T6');
});

test('changing series selects its first part', () => {
  const updated = nextMcuSelection(defaultSidebarSelection(), { series: 'F4x' });

  assert.equal(updated.mcu.series, 'F4x');
  assert.match(updated.mcu.part, /^STM32F4/);
});

test('a stored series from another vendor falls back to the vendor first series', () => {
  // Stale state after a pack import: vendor switched to GD but the stored
  // series belongs to STM32; the series must not survive the vendor change.
  const selection = sanitizeSidebarSelection({
    mcu: { vendor: 'GD', series: 'F1x', part: 'STM32F103C8T6' }
  });

  assert.equal(selection.mcu.vendor, 'GD');
  assert.equal(selection.mcu.series, 'F1x');
  assert.equal(selection.mcu.part, 'GD32F103C8T6');
});

test('bootstrap filters parts and annotates detected toolchains', () => {
  const state = buildSidebarState(
    'firmware',
    defaultSidebarSelection(),
    [{ family: 'arm', verified: true, binDir: 'C:\\Tools\\arm\\bin', source: 'path' }]
  );

  assert.ok(state.devices.every((device) => device.value.startsWith('STM32F1')));
  assert.ok(state.linuxToolchains.some((toolchain) => toolchain.value === 'arm'));
  assert.match(state.linuxToolchains.find((toolchain) => toolchain.value === 'arm')?.detail ?? '', /PATH/);
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
  const f1 = getDeviceProfile('STM32F103C8T6');
  const f4 = getDeviceProfile('STM32F407VGT6');
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
  const f4 = getDeviceProfile('STM32F407VGT6');
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
