import assert from 'node:assert/strict';
import test from 'node:test';
import { generateLinkerScript, generateScatterFile } from '../generator/linkerGenerator';
import {
  fixtureDeviceProfile,
  gd32F103Profile,
  registerFixtureVendors,
  stm32F407Profile
} from './support/fixtureDevice';

registerFixtureVendors();

test('generates a linker memory map for a Cortex-M3 device', () => {
  const linker = generateLinkerScript(gd32F103Profile());

  assert.match(linker, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 64K/s);
  assert.match(linker, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 20K/s);
  assert.doesNotMatch(linker, /RAM \(xrw\)/);
  assert.match(linker, /KEEP\(\*\(\.isr_vector\)\)/);
  assert.match(linker, /ENTRY\(Reset_Handler\)/);
  assert.match(linker, /_sidata = LOADADDR\(\.data\)/);
  assert.match(linker, /_sdata = \.[\s\S]*_edata = \./);
  // LLD does not understand GNU ld's `(READONLY)` section qualifier; the
  // script must stay usable by both ld and ld.lld.
  assert.doesNotMatch(linker, /\(READONLY\)/);
  assert.match(linker, /\.ARM\.extab :/);
  assert.match(linker, /\.preinit_array :/);
  assert.match(linker, /\.init_array :/);
  assert.match(linker, /\.fini_array :/);
  // ORIGIN(RAM) must follow MEMORY for ld.lld.
  assert.ok(linker.indexOf('MEMORY') < linker.indexOf('_estack ='));
  assert.match(linker, /PROVIDE_HIDDEN\(__preinit_array_start/);
  assert.match(linker, /PROVIDE_HIDDEN\(__init_array_end/);
  assert.match(linker, /ASSERT\(/);
});

test('generates the Cortex-M4 memory map without an RWX RAM segment', () => {
  const linker = generateLinkerScript(stm32F407Profile());

  assert.match(linker, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 1024K/s);
  assert.match(linker, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 128K/s);
  assert.match(linker, /CCMRAM \(rw\).*ORIGIN = 0x10000000.*LENGTH = 64K/s);
  assert.doesNotMatch(linker, /RAM \(xrw\)/);
  assert.match(linker, /ASSERT\(_ebss \+ _Min_Heap_Size \+ _Min_Stack_Size/);
});

test('maps PDSC-declared read-write memory onto the linker map', () => {
  const linker = generateLinkerScript(gd32F103Profile({
    part: 'GD32F450VGT6',
    family: 'GD32F4xx',
    defines: ['GD32F450'],
    flash: { origin: 0x08000000, length: 1024 * 1024 },
    ram: { origin: 0x20000000, length: 256 * 1024 },
    linkerFileName: 'GD32F450VGT6.ld',
    gnuStartupFileName: 'startup_gd32f450.S',
    debugTarget: 'stm32f4x'
  }));

  assert.match(linker, /FLASH \(rx\).*LENGTH = 1024K/s);
  assert.match(linker, /RAM \(rw\).*LENGTH = 256K/s);
});

test('generates explicit CCMRAM for the same family with different package sizes', () => {
  const linker = generateLinkerScript(stm32F407Profile({ part: 'STM32F405RGT6', linkerFileName: 'STM32F405RGT6.ld', gnuStartupFileName: 'startup_stm32f405xx.S' }));

  assert.match(linker, /FLASH \(rx\).*LENGTH = 1024K/s);
  assert.match(linker, /RAM \(rw\).*LENGTH = 128K/s);
  assert.match(linker, /CCMRAM \(rw\).*LENGTH = 64K/s);
});

test('generates explicit TCMSRAM with the PDSC access flags', () => {
  const linker = generateLinkerScript(gd32F103Profile({
    part: 'GD32F407VGT6',
    family: 'GD32F4xx',
    defines: ['GD32F407'],
    compilerFlags: ['-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard'],
    ram: { origin: 0x20000000, length: 192 * 1024 },
    additionalMemory: [{ name: 'TCMSRAM', attributes: 'rwx', origin: 0x10000000, length: 64 * 1024 }],
    linkerFileName: 'GD32F407VGT6.ld',
    gnuStartupFileName: 'startup_gd32f407xx.S',
    debugTarget: 'stm32f4x'
  }));

  assert.match(linker, /RAM \(rw\).*LENGTH = 192K/s);
  assert.match(linker, /TCMSRAM \(rwx\).*LENGTH = 64K/s);
});

test('generates high-density F1 memory regions', () => {
  const linker = generateLinkerScript(fixtureDeviceProfile({
    part: 'STM32F103ZET6',
    defines: ['STM32F10X_HD'],
    flash: { origin: 0x08000000, length: 512 * 1024 },
    ram: { origin: 0x20000000, length: 64 * 1024 },
    linkerFileName: 'STM32F103ZET6.ld',
    gnuStartupFileName: 'startup_stm32f10x_hd.S'
  }));

  assert.match(linker, /FLASH \(rx\).*LENGTH = 512K/s);
  assert.match(linker, /RAM \(rw\).*LENGTH = 64K/s);
});

test('generates large-flash memory regions with CCMRAM', () => {
  const linker = generateLinkerScript(stm32F407Profile({
    part: 'STM32F429ZIT6',
    flash: { origin: 0x08000000, length: 2048 * 1024 },
    ram: { origin: 0x20000000, length: 192 * 1024 },
    linkerFileName: 'STM32F429ZIT6.ld',
    gnuStartupFileName: 'startup_stm32f429xx.S'
  }));

  assert.match(linker, /FLASH \(rx\).*LENGTH = 2048K/s);
  assert.match(linker, /RAM \(rw\).*LENGTH = 192K/s);
  assert.match(linker, /CCMRAM \(rw\).*LENGTH = 64K/s);
});

test('generates additional RAM banks from the profile', () => {
  const linker = generateLinkerScript(fixtureDeviceProfile({
    part: 'STM32L476RGT6',
    series: 'L4x',
    core: 'cortex-m4',
    defines: ['STM32L476xx'],
    compilerFlags: ['-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard'],
    flash: { origin: 0x08000000, length: 1024 * 1024 },
    ram: { origin: 0x20000000, length: 96 * 1024 },
    additionalMemory: [{ name: 'RAM2', attributes: 'rw', origin: 0x10000000, length: 32 * 1024 }],
    debugTarget: 'stm32l4x',
    linkerFileName: 'STM32L476RGT6.ld',
    gnuStartupFileName: 'startup_stm32l476xx.S'
  }));

  assert.match(linker, /FLASH \(rx\).*LENGTH = 1024K/s);
  assert.match(linker, /RAM \(rw\).*LENGTH = 96K/s);
  assert.match(linker, /RAM2 \(rw\).*LENGTH = 32K/s);
});

test('generates an armclang scatter file with vector-first flash and RW/ZI RAM', () => {
  const profile = { ...fixtureDeviceProfile(), toolchainFamily: 'armclang' as const };
  const scatter = generateScatterFile(profile);

  assert.match(scatter, /LR_IROM1 0x08000000 0x00010000 \{/);
  assert.match(scatter, /ER_IROM1 0x08000000 0x00010000 \{/);
  assert.match(scatter, /\*\(\.isr_vector, \+First\)/);
  assert.match(scatter, /RW_IRAM1 0x20000000 0x00005000 \{/);
  assert.match(scatter, /\.ANY \(\+RW \+ZI\)/);
  assert.doesNotMatch(scatter, /_estack|ENTRY\(/);
});
