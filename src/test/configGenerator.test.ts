import assert from 'node:assert/strict';
import test from 'node:test';
import { gd32F103Profile, stm32F407Profile, registerFixtureVendors } from './support/fixtureDevice';

registerFixtureVendors();
import { generateProjectConfig } from '../generator/configGenerator';

test('records the selected MCU memory and generated file lists', () => {
  const config = JSON.parse(generateProjectConfig(
    'gd32',
    gd32F103Profile(),
    [
      'CMakeLists.txt',
      'CMakePresets.json',
      'GD32F103C8T6.ld',
      'startup_gd32f10x_md.S',
      'cmake/gd32-toolchain.cmake',
      'system/syscalls.c',
      'system/sysmem.c'
    ],
    ['CMakeLists.txt', '.mcu-cmake.json']
  ));

  assert.equal(config.projectName, 'gd32');
  assert.equal(config.device, 'GD32F103C8T6');
  assert.deepEqual(config.memory.flash, {
    origin: '0x08000000',
    sizeBytes: 65536,
    sizeKB: 64
  });
  assert.deepEqual(config.memory.ram, {
    origin: '0x20000000',
    sizeBytes: 20480,
    sizeKB: 20
  });
  assert.deepEqual(config.memory.additional, []);
  assert.deepEqual(config.generatedFiles, [
    'CMakeLists.txt',
    'CMakePresets.json',
    'GD32F103C8T6.ld',
    'startup_gd32f10x_md.S',
    'cmake/gd32-toolchain.cmake',
    'system/syscalls.c',
    'system/sysmem.c'
  ]);
  assert.deepEqual(config.overwrittenFiles, ['CMakeLists.txt', '.mcu-cmake.json']);
  assert.deepEqual(config.integration, {
    cmakeTools: {
      preset: 'debug',
      configurePreset: 'debug',
      buildPreset: 'debug',
      settingsFile: '.vscode/settings.json'
    },
    cppTools: {
      configurationSource: 'CMake compile_commands.json',
      compileCommands: 'build/debug/compile_commands.json',
      dimInactiveRegions: true
    }
  });
});

test('records additional memory regions in the project config', () => {
  const config = JSON.parse(generateProjectConfig(
    'stm32',
    stm32F407Profile(),
    [],
    []
  ));

  assert.deepEqual(config.memory.additional, [
    {
      name: 'CCMRAM',
      attributes: 'rw',
      origin: '0x10000000',
      sizeBytes: 65536,
      sizeKB: 64
    }
  ]);
});

test('records the optional OpenOCD flash configuration', () => {
  const config = JSON.parse(generateProjectConfig(
    'firmware',
    stm32F407Profile(),
    ['flash.py'],
    [],
    {
      script: 'flash.py',
      probe: 'stlink',
      interfaceConfig: 'interface/stlink.cfg',
      openocdPath: 'openocd',
      target: 'target/stm32f4x.cfg',
      transport: 'swd'
    }
  ));

  assert.deepEqual(config.flash, {
    script: 'flash.py',
    probe: 'stlink',
    interfaceConfig: 'interface/stlink.cfg',
    openocdPath: 'openocd',
    target: 'target/stm32f4x.cfg',
    transport: 'swd'
  });
});
