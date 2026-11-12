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
  packServesSeries,
  sanitizeSidebarSelection
} from '../sidebar/state';
import { hasVendor, registerVendor } from '../devices/vendorRegistry';
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
});

test('keeps a curated vendor before its pack registry entry exists', () => {
  // GigaDevice is curated but not registered by these fixtures, exactly the
  // state of the registry while the first sidebar render happens: the persisted
  // vendor must survive so the series dropdown stays selectable.
  const selection = sanitizeSidebarSelection({
    mode: 'mcu',
    mcu: { vendor: 'GigaDevice', series: '' }
  });

  assert.equal(selection.mcu.vendor, 'GigaDevice');
  assert.equal(selection.mcu.series, 'F1x');

  const state = buildSidebarState('workspace', selection);
  assert.deepEqual(state.series.map((option) => option.value), [
    'F1x', 'F3x', 'F4x', 'E10x', 'E23x', 'E50x', 'L23x', 'W51x'
  ]);
  assert.equal(state.selection.mcu.series, 'F1x');
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
    flash: { targetId: 'bad', probeId: 'bad', openocdPath: '  ' }
  });

  assert.equal(selection.mode, 'linux');
  assert.equal(selection.mcu.vendor, '');
  assert.equal(selection.mcu.packId, '');
  assert.equal(selection.mcu.series, '');
  assert.equal(selection.mcu.part, '');
  assert.equal(selection.linux.toolchainFamily, 'loongson');
  assert.equal(selection.flash.probeId, 'stlink');
  assert.equal(selection.flash.openocdPath, 'openocd');
});

test('the Pack list only offers Packs that serve the selected series', () => {
  if (!hasVendor('STMicroelectronics')) {
    registerVendor({
      id: 'STMicroelectronics', label: 'STM32', definePrefixes: ['STM32'], order: 100
    });
  }
  const f1Pack = 'packs/STMicroelectronics/Keil.STM32F1xx_DFP.pack';
  const f4Pack = 'packs/STMicroelectronics/Keil.STM32F4xx_DFP.pack';
  registerDeviceProfiles([fixtureDeviceProfile({
    vendor: 'STMicroelectronics', series: 'STM32F1 Series', family: 'STM32F1 Series'
  })], f1Pack);
  registerDeviceProfiles([fixtureDeviceProfile({
    vendor: 'STMicroelectronics',
    part: 'STM32F407VGT6',
    series: 'STM32F4 Series',
    family: 'STM32F4 Series',
    defines: ['STM32F407xx'],
    compilerFlags: ['-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard'],
    flash: { origin: 0x08000000, length: 1024 * 1024 },
    ram: { origin: 0x20000000, length: 128 * 1024 },
    debugTarget: 'stm32f4x'
  })], f4Pack);
  const packOptions = [
    {
      packId: 'STMicroelectronics:Keil.STM32F1xx_DFP',
      vendorId: 'STMicroelectronics', name: 'Keil.STM32F1xx_DFP', version: '2.4.1',
      origin: 'imported' as const, packFile: f1Pack
    },
    {
      packId: 'STMicroelectronics:Keil.STM32F4xx_DFP',
      vendorId: 'STMicroelectronics', name: 'Keil.STM32F4xx_DFP', version: '2.17.1',
      origin: 'imported' as const, packFile: f4Pack
    }
  ];
  try {
    const f1Selection = sanitizeSidebarSelection({
      mcu: {
        vendor: 'STMicroelectronics',
        packId: 'STMicroelectronics:Keil.STM32F1xx_DFP',
        version: '2.4.1',
        sourcePack: f1Pack,
        series: 'F1x',
        part: 'STM32F103C8T6'
      }
    }, defaultSidebarSelection(), packOptions);
    const f1State = buildSidebarState('demo', f1Selection, [], [], '', false, packOptions, f1Selection.mcu.packId);
    assert.deepEqual(f1State.packs.map((option) => option.label), ['Keil.STM32F1xx_DFP']);
    assert.equal(f1State.mcuBlockedReason, '');

    // Choosing F4x while the F1 Pack is active must not keep the F1 Pack: the
    // Pack list, the selected Pack and the part list then all agree.
    const switched = sanitizeSidebarSelection(
      nextMcuSelection(f1Selection, { series: 'F4x' }, packOptions),
      f1Selection,
      packOptions
    );
    assert.equal(switched.mcu.series, 'F4x');
    assert.equal(switched.mcu.packId, '');
    const switchedState = buildSidebarState('demo', switched, [], [], '', false, packOptions, switched.mcu.packId);
    assert.deepEqual(switchedState.packs.map((option) => option.label), ['Keil.STM32F4xx_DFP']);
    assert.equal(switchedState.devices.length, 0);
    assert.match(switchedState.mcuBlockedReason, /STM32F4xx_DFP/);

    // Installed and downloadable entries carry no parsed parts, so their DFP
    // name decides: both the bare and the vendor-prefixed form serve the series.
    const nameOnly = [
      { packId: 'ST:STM32F1xx_DFP', vendorId: 'STMicroelectronics', name: 'STM32F1xx_DFP', version: '2.4.1', origin: 'installed' as const, packFile: 'C:/Keil/STM32F1xx_DFP' },
      { packId: 'ST:Keil.STM32F4xx_DFP', vendorId: 'STMicroelectronics', name: 'Keil.STM32F4xx_DFP', version: '2.17.1', origin: 'downloadable' as const, packUrl: 'https://example/F4.pack' },
      { packId: 'ST:GD32F4xx_DFP', vendorId: 'STMicroelectronics', name: 'GD32F4xx_DFP', version: '3.0.3', origin: 'installed' as const, packFile: 'C:/Keil/other' }
    ];
    const namesForF4 = nameOnly
      .filter((option) => packServesSeries('STMicroelectronics', 'F4x', option))
      .map((option) => option.name);
    assert.deepEqual(namesForF4, ['Keil.STM32F4xx_DFP']);

    // A series with no local Pack offers an empty list and names the DFP needed.
    const empty = sanitizeSidebarSelection({
      mcu: { vendor: 'STMicroelectronics', series: 'L4x', packId: '', version: '', part: '' }
    }, defaultSidebarSelection(), packOptions);
    const emptyState = buildSidebarState('demo', empty, [], [], '', false, packOptions, '');
    assert.deepEqual(emptyState.packs, []);
    assert.match(emptyState.mcuBlockedReason, /STM32L4xx_DFP/);
  } finally {
    unregisterDeviceProfilesByPack(f1Pack);
    unregisterDeviceProfilesByPack(f4Pack);
  }
});

test('a series persisted as the pack Dfamily text renders under its catalog id', () => {
  // The previous build stored the pack's own text ("STM32F1 Series") for the
  // STM32 series; the dropdown has no such option, so it showed the first entry
  // and the user could not switch back — the reported "series is stuck" state.
  // The curated series catalog is keyed by the real PDSC vendor name.
  if (!hasVendor('STMicroelectronics')) {
    registerVendor({
      id: 'STMicroelectronics', label: 'STM32', definePrefixes: ['STM32'], order: 100
    });
  }
  const packFile = 'packs/STMicroelectronics/Keil.STM32F1xx_DFP.pack';
  registerDeviceProfiles([fixtureDeviceProfile({
    vendor: 'STMicroelectronics', series: 'STM32F1 Series', family: 'STM32F1 Series'
  })], packFile);
  const packOptions = [{
    packId: 'STMicroelectronics:Keil.STM32F1xx_DFP',
    vendorId: 'STMicroelectronics',
    name: 'Keil.STM32F1xx_DFP',
    version: '2.4.1',
    origin: 'imported' as const,
    packFile
  }];
  try {
    const selection = sanitizeSidebarSelection({
      mcu: {
        vendor: 'STMicroelectronics',
        packId: 'STMicroelectronics:Keil.STM32F1xx_DFP',
        version: '2.4.1',
        sourcePack: packFile,
        series: 'STM32F1 Series',
        part: 'STM32F103C8T6'
      }
    }, defaultSidebarSelection(), packOptions);
    assert.equal(selection.mcu.series, 'F1x');
    assert.equal(selection.mcu.part, 'STM32F103C8T6');

    // The rendered state must agree with the option list, or the select shows
    // its first entry while the rest of the panel talks about another series.
    const state = buildSidebarState('demo', selection, [], [], '', false, packOptions, selection.mcu.packId);
    assert.equal(state.selection.mcu.series, 'F1x');
    assert.ok(state.series.some((option) => option.value === state.selection.mcu.series));
    assert.deepEqual(state.series.map((option) => option.label), [
      'STM32F0', 'STM32F1', 'STM32F2', 'STM32F3', 'STM32F4', 'STM32F7',
      'STM32G0', 'STM32G4', 'STM32H7', 'STM32L0', 'STM32L1', 'STM32L4',
      'STM32L5', 'STM32U5', 'STM32WB', 'STM32WL', 'STM32C0', 'STM32H5',
      'STM32U0', 'STM32WBA'
    ]);
  } finally {
    unregisterDeviceProfilesByPack(packFile);
  }
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

test('keeps the persisted Pack selection until the catalog has loaded', () => {
  const selection = sanitizeSidebarSelection({
    mode: 'mcu',
    mcu: {
      vendor: 'GD',
      packId: 'GD:GD32F10x_DFP',
      version: '2.0.3',
      sourcePack: 'packs/GigaDevice/GigaDevice.GD32F10x_DFP.2.0.3.pack',
      series: 'GD32F1',
      part: 'GD32F101C4'
    }
  }, undefined, [], true);

  // Before the Pack catalog arrives there is nothing to validate against; the
  // values must survive so the panel does not reset on every host start.
  assert.equal(selection.mcu.packId, 'GD:GD32F10x_DFP');
  assert.equal(selection.mcu.version, '2.0.3');
  assert.equal(selection.mcu.part, 'GD32F101C4');
  assert.equal(selection.mcu.sourcePack, 'packs/GigaDevice/GigaDevice.GD32F10x_DFP.2.0.3.pack');

  // Once the catalog is known, the same value is validated normally.
  const validated = sanitizeSidebarSelection({
    mcu: { vendor: 'GD', packId: 'GD:GD32F10x_DFP', version: '2.0.3', series: 'GD32F1', part: 'GD32F101C4' }
  }, undefined, [], false);
  assert.equal(validated.mcu.packId, '');
});

test('trims the persisted Linux sysroot', () => {
  const selection = sanitizeSidebarSelection({
    mode: 'linux',
    linux: { toolchainFamily: 'arm', targetType: 'shared', sysroot: '  /opt/sysroot  ' }
  });
  assert.equal(selection.linux.sysroot, '/opt/sysroot');
  assert.equal(selection.linux.targetType, 'shared');

  const cleared = sanitizeSidebarSelection({ mode: 'linux', linux: { sysroot: '' } });
  assert.equal(cleared.linux.sysroot, '');
});

const mcuToolchains = [{
  id: 'mcu:gcc',
  direction: 'mcu' as const,
  family: 'gcc' as const,
  prefix: 'arm-none-eabi',
  cCompiler: 'arm-none-eabi-gcc',
  cxxCompiler: 'arm-none-eabi-g++',
  cCompilerPath: 'C:/arm/bin/arm-none-eabi-gcc.exe',
  onPath: true,
  binDir: 'C:/arm/bin',
  label: 'Arm GNU Toolchain (arm-none-eabi)',
  detail: 'C:/arm/bin'
}];

test('offers discovered MCU compiler toolchains', () => {
  const selection = sanitizeSidebarSelection(
    {
      mode: 'native',
      mcu: { buildToolchain: 'mcu:gcc' }
    },
    undefined,
    [],
    false,
    mcuToolchains
  );
  assert.equal(selection.mcu.buildToolchain, 'mcu:gcc');

  const state = buildSidebarState(
    'demo', selection, [], [], '', false, [], '', undefined, '', '', [], mcuToolchains
  );
  assert.deepEqual(
    state.mcuToolchains.map((option) => option.value),
    ['mcu:gcc']
  );
  assert.equal(state.selection.mcu.buildToolchain, 'mcu:gcc');
});

test('drops a toolchain selection that is no longer installed', () => {
  const selection = sanitizeSidebarSelection(
    {
      mode: 'mcu',
      mcu: { buildToolchain: 'mcu:armclang' }
    },
    undefined,
    [],
    false,
    mcuToolchains
  );
  // MCU always has a concrete family once discovery found one, so a stale id
  // falls back to the first installed compiler instead of an empty selection.
  assert.equal(selection.mcu.buildToolchain, 'mcu:gcc');
});

test('defaults to a detected MCU family when the saved one is missing', () => {
  const missingGcc = { ...mcuToolchains[0], detected: false };
  const armclang = {
    ...mcuToolchains[0],
    id: 'mcu:armclang',
    family: 'armclang' as const,
    prefix: '',
    cCompiler: 'armclang',
    cCompilerPath: '',
    detected: true
  };
  const selection = sanitizeSidebarSelection(
    { mcu: { buildToolchain: 'mcu:clang' } },
    undefined,
    [],
    false,
    [missingGcc, armclang]
  );
  assert.equal(selection.mcu.buildToolchain, 'mcu:armclang');
});

test('keeps a persisted toolchain id before discovery has run', () => {
  // The first render may happen before the scan finishes; wiping the id there
  // would reset the dropdown on every window start.
  const selection = sanitizeSidebarSelection({
    mode: 'mcu',
    mcu: { buildToolchain: 'mcu:gcc' }
  });
  assert.equal(selection.mcu.buildToolchain, 'mcu:gcc');
});
