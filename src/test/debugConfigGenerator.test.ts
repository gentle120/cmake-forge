import assert from 'node:assert/strict';
import test from 'node:test';
import { getFlashProbeProfile } from '../flash/probeProfiles';
import { getFlashTargetProfile } from '../flash/targets/targetProfiles';
import { generateCortexDebugLaunchJson } from '../generator/debugConfigGenerator';

test('generates a standard Cortex-Debug OpenOCD launch configuration', () => {
  const launch = JSON.parse(generateCortexDebugLaunchJson(undefined, {
    openocdPath: 'openocd',
    target: getFlashTargetProfile('gd32f1xx'),
    probe: getFlashProbeProfile('stlink')
  }));
  const config = launch.configurations[0];

  assert.equal(launch.version, '0.2.0');
  assert.equal(config.name, 'CMake Embedded OpenOCD');
  assert.equal(config.type, 'cortex-debug');
  assert.equal(config.request, 'launch');
  assert.equal(config.cwd, '${workspaceRoot}');
  assert.equal(config.servertype, 'openocd');
  assert.equal(config.executable, '${command:cmake.launchTargetPath}');
  assert.equal(config.serverpath, undefined);
  assert.equal(config.toolchainPrefix, 'arm-none-eabi');
  assert.equal(config.armToolchainPath, undefined);
  assert.deepEqual(config.configFiles, ['interface/stlink.cfg', 'target/stm32f1x.cfg']);
  assert.equal(config.openOCDLaunchCommands, undefined);
  assert.equal(config.runToEntryPoint, 'main');
});

test('uses the concrete preset ELF path when the generator supplies one', () => {
  const launch = JSON.parse(generateCortexDebugLaunchJson(undefined, {
    openocdPath: 'openocd',
    target: getFlashTargetProfile('stm32f1xx'),
    probe: getFlashProbeProfile('stlink'),
    executable: '${workspaceFolder}/build/debug/project.elf'
  }));
  // `${command:cmake.launchTargetPath}` is empty when CMake Tools has no launch
  // target (for example in the Extension Development Host); the presets always
  // build into build/debug, so the concrete path always resolves.
  assert.equal(launch.configurations[0].executable, '${workspaceFolder}/build/debug/project.elf');
});

test('preserves user Cortex-Debug configurations and replaces its generated entry', () => {
  const existing = `{
    // Keep user configurations and JSONC comments valid.
    "version": "0.2.0",
    "configurations": [
      { "name": "User Debug", "type": "cortex-debug", },
      { "name": "CMake Embedded OpenOCD", "type": "cortex-debug", },
    ],
  }`;
  const launch = JSON.parse(generateCortexDebugLaunchJson(existing, {
    openocdPath: 'D:\\Tools\\OpenOCD\\bin\\openocd.exe',
    target: getFlashTargetProfile('stm32f4xx'),
    probe: getFlashProbeProfile('jlink'),
    searchDirs: ['D:\\Tools\\OpenOCD\\scripts']
  }));

  // The generated entry is first so a plain F5 does not run a stale config
  // another extension left behind; the user's own entries keep their order.
  assert.deepEqual(launch.configurations.map((config: { name: string }) => config.name), [
    'CMake Embedded OpenOCD',
    'User Debug'
  ]);
  assert.equal(launch.configurations[0].serverpath, 'D:\\Tools\\OpenOCD\\bin\\openocd.exe');
  assert.equal(launch.configurations[0].cwd, '${workspaceRoot}');
  assert.deepEqual(launch.configurations[0].searchDir, ['D:\\Tools\\OpenOCD\\scripts']);
  assert.deepEqual(launch.configurations[0].configFiles, [
    'interface/jlink.cfg',
    'target/stm32f4x.cfg'
  ]);
});

test('does not inject a machine-local ARM GNU toolchain path for Cortex-Debug', () => {
  const launch = JSON.parse(generateCortexDebugLaunchJson(undefined, {
    openocdPath: 'D:\\Tools\\OpenOCD\\bin\\openocd.exe',
    target: getFlashTargetProfile('stm32f4xx'),
    probe: getFlashProbeProfile('stlink')
  }));

  const config = launch.configurations[0];
  assert.equal(config.armToolchainPath, undefined);
  assert.equal(config.toolchainPrefix, 'arm-none-eabi');
});
