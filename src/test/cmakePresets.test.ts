import assert from 'node:assert/strict';
import test from 'node:test';
import { generateCMakePresets } from '../shared/cmakePresets';

function parse(options?: { toolchainFileName?: string }) {
  return JSON.parse(generateCMakePresets(options));
}

test('a cross-compiled preset points at the generated toolchain file', () => {
  const presets = parse({ toolchainFileName: 'stm32f1-toolchain.cmake' });

  assert.equal(presets.version, 3);
  assert.deepEqual(presets.configurePresets.map((preset: { name: string }) => preset.name), ['debug', 'release']);
  assert.equal(presets.configurePresets[0].binaryDir, '${sourceDir}/build/debug');
  assert.equal(presets.configurePresets[1].binaryDir, '${sourceDir}/build/release');
  assert.equal(presets.configurePresets[0].cacheVariables.CMAKE_BUILD_TYPE, 'Debug');
  assert.equal(presets.configurePresets[1].cacheVariables.CMAKE_BUILD_TYPE, 'Release');
  assert.equal(
    presets.configurePresets[0].cacheVariables.CMAKE_TOOLCHAIN_FILE,
    '${sourceDir}/cmake/stm32f1-toolchain.cmake'
  );
  for (const preset of presets.configurePresets) {
    assert.equal(preset.cacheVariables.CMAKE_EXPORT_COMPILE_COMMANDS, undefined);
  }
  assert.deepEqual(presets.buildPresets, [
    { name: 'debug', configurePreset: 'debug' },
    { name: 'release', configurePreset: 'release' }
  ]);
});

test('a native preset enables the compile database instead of a toolchain', () => {
  const presets = parse();

  for (const preset of presets.configurePresets) {
    assert.equal(preset.cacheVariables.CMAKE_EXPORT_COMPILE_COMMANDS, 'ON');
    assert.equal(preset.cacheVariables.CMAKE_TOOLCHAIN_FILE, undefined);
  }
  assert.equal(presets.configurePresets[0].generator, 'Ninja');
});

test('presets are valid JSON with a trailing newline', () => {
  const text = generateCMakePresets({ toolchainFileName: 'x.cmake' });
  assert.ok(text.endsWith('\n'));
  assert.doesNotThrow(() => JSON.parse(text));
});
