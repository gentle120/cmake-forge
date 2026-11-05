import assert from 'node:assert/strict';
import test from 'node:test';
import {
  armGccExecutablePath,
  inspectArmToolchainPath,
  normalizeArmToolchainPath,
  prioritizeArmToolchainHits
} from '../env/armToolchain';

const bin = 'C:/Arm GNU/bin';
const files = new Set(['gcc', 'g++', 'objcopy', 'size'].map(tool => `${bin}/arm-none-eabi-${tool}.exe`));

test('normalizes quoted Windows directories and GCC executable paths to a bin directory', () => {
  assert.equal(normalizeArmToolchainPath(' "C:\\Arm GNU\\bin\\" '), bin);
  assert.equal(normalizeArmToolchainPath(`${bin}/arm-none-eabi-gcc.exe`), bin);
  assert.equal(normalizeArmToolchainPath('/opt/arm/bin/arm-none-eabi-gcc'), '/opt/arm/bin');
});

test('uses the configured GCC executable for IntelliSense and falls back to a command on PATH', () => {
  assert.equal(armGccExecutablePath(bin, 'win32'), `${bin}/arm-none-eabi-gcc.exe`);
  assert.equal(armGccExecutablePath('/opt/arm/bin', 'linux'), '/opt/arm/bin/arm-none-eabi-gcc');
  assert.equal(armGccExecutablePath('', 'win32'), 'arm-none-eabi-gcc');
});

test('keeps the current installation first when a scan finds several toolchains', () => {
  const hits = [
    { path: 'C:/Users/dev/.eide/tools/gcc_arm/bin', label: 'EIDE' },
    { path: 'D:/STM32CubeCLT_1.20.0/GNU-tools-for-STM32/bin', label: 'CubeCLT' }
  ];
  assert.deepEqual(
    prioritizeArmToolchainHits(hits, 'D:\\STM32CubeCLT_1.20.0\\GNU-tools-for-STM32\\bin\\arm-none-eabi-gcc.exe')
      .map(hit => hit.label),
    ['CubeCLT', 'EIDE']
  );
  assert.deepEqual(prioritizeArmToolchainHits(hits, '').map(hit => hit.label), ['EIDE', 'CubeCLT']);
});

test('distinguishes inherited PATH, complete GNU tools and an incomplete directory', () => {
  assert.equal(inspectArmToolchainPath('').state, 'path');
  assert.equal(inspectArmToolchainPath(bin, path => files.has(path)).state, 'ready');
  const incomplete = inspectArmToolchainPath(bin, path => path.endsWith('/arm-none-eabi-gcc.exe'));
  assert.equal(incomplete.state, 'missing');
  assert.match(incomplete.message, /arm-none-eabi-g\+\+/);
  assert.match(incomplete.message, /arm-none-eabi-objcopy/);
  assert.match(incomplete.message, /arm-none-eabi-size/);
});

test('rejects host GCC and Keil armclang as substitutes for ARM GNU tools', () => {
  const status = inspectArmToolchainPath('C:/Keil/ARM/ARMCLANG/bin', path => /\/(gcc|armclang)\.exe$/.test(path));
  assert.equal(status.state, 'missing');
  assert.match(status.message, /arm-none-eabi-gcc/);
});
