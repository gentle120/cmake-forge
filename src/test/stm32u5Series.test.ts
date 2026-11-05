import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDeviceProfile } from '../devices/profileValidation';
import { stm32u5xxProfiles } from '../devices/stm32/stm32u5xx';
import {
  stm32u575InterruptHandlers,
  stm32u585InterruptHandlers
} from '../devices/stm32/stm32u5xx/common';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';

const u575 = stm32u5xxProfiles.find((profile) => profile.part === 'STM32U575RGT6');
const u585 = stm32u5xxProfiles.find((profile) => profile.part === 'STM32U585RIT6');

test('registers the STM32U5 profiles with the specified parameters', () => {
  assert.ok(u575 && u585);
  for (const profile of [u575, u585]) {
    validateDeviceProfile(profile);
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'U5x');
    assert.equal(profile.family, 'STM32U5xx');
    assert.equal(profile.core, 'cortex-m33');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.deepEqual(profile.compilerFlags, [
      '-mcpu=cortex-m33', '-mthumb', '-mfpu=fpv5-sp-d16', '-mfloat-abi=hard'
    ]);
    assert.deepEqual(profile.ram, { origin: 0x20000000, length: 256 * 1024 });
    assert.deepEqual(profile.flash, { origin: 0x08000000, length: profile === u585 ? 2048 * 1024 : 1024 * 1024 });
    assert.equal(profile.toolchainFileName, 'stm32u5-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32u5x');
  }
  assert.deepEqual(u575.defines, ['STM32U575xx']);
  assert.equal(u575.gnuStartupFileName, 'startup_stm32u575xx.S');
  assert.deepEqual(u585.defines, ['STM32U585xx']);
  assert.equal(u585.gnuStartupFileName, 'startup_stm32u585xx.S');
  assert.equal(u575.linkerFileName, 'STM32U575RGT6.ld');
  assert.equal(u585.linkerFileName, 'STM32U585RIT6.ld');
});

test('keeps the reserved U575 slots empty where the U585 fills them', () => {
  assert.equal(stm32u575InterruptHandlers.length, stm32u585InterruptHandlers.length);
  for (const [index, handler] of stm32u575InterruptHandlers.entries()) {
    if (handler === '0') {
      assert.match(stm32u585InterruptHandlers[index], /_IRQHandler$/);
    }
  }
  // ST reserves IRQ 28 (SAES), 93 (AES), 97 (PKA) and 108/109 (OTFDEC) on the U575.
  assert.equal(stm32u575InterruptHandlers[28], '0');
  assert.equal(stm32u575InterruptHandlers[93], '0');
  assert.equal(stm32u575InterruptHandlers[97], '0');
  assert.deepEqual(stm32u575InterruptHandlers.slice(108, 110), ['0', '0']);
  assert.equal(stm32u585InterruptHandlers[28], 'SAES_IRQHandler');
  assert.equal(stm32u585InterruptHandlers[93], 'AES_IRQHandler');
  assert.equal(stm32u585InterruptHandlers[97], 'PKA_IRQHandler');
  assert.deepEqual(stm32u585InterruptHandlers.slice(108, 110), ['OTFDEC1_IRQHandler', 'OTFDEC2_IRQHandler']);
  assert.equal(stm32u575InterruptHandlers[125], 'LSECSSD_IRQHandler');
  assert.equal(stm32u585InterruptHandlers[125], 'LSECSSD_IRQHandler');
});

test('generates the U5 startup with Cortex-M33 settings and U5-only handlers', () => {
  assert.ok(u575 && u585);
  const u575Startup = generateGnuStartup(u575);
  const u585Startup = generateGnuStartup(u585);

  assert.match(u575Startup, /\.cpu cortex-m33/);
  assert.match(u585Startup, /\.cpu cortex-m33/);
  assert.match(u575Startup, /\.weak ICACHE_IRQHandler/);
  assert.match(u575Startup, /\.word LSECSSD_IRQHandler/);
  // The U575 leaves the security peripherals out of its table entirely.
  assert.doesNotMatch(u575Startup, /SAES_IRQHandler|AES_IRQHandler|PKA_IRQHandler|OTFDEC[12]_IRQHandler/);
  assert.match(u585Startup, /\.weak SAES_IRQHandler/);
  assert.match(u585Startup, /\.weak AES_IRQHandler/);
  assert.match(u585Startup, /\.weak PKA_IRQHandler/);
  assert.match(u585Startup, /\.word OTFDEC2_IRQHandler/);
  // IRQ 29 stays reserved on the U575: exactly one hole between IWDG and GPDMA1 channel 0.
  assert.match(u575Startup, /\.word IWDG_IRQHandler\n  \.word 0\n  \.word GPDMA1_Channel0_IRQHandler/);
  assert.match(u585Startup, /\.word IWDG_IRQHandler\n  \.word SAES_IRQHandler\n  \.word GPDMA1_Channel0_IRQHandler/);
  // 16 core vectors + 126 peripheral slots.
  assert.equal((u575Startup.match(/^  \.word /gm) ?? []).length, 142);
  assert.equal((u585Startup.match(/^  \.word /gm) ?? []).length, 142);
});

test('generates the U5 linker script with the datasheet memory layout', () => {
  assert.ok(u575 && u585);
  const u575Linker = generateLinkerScript(u575);
  const u585Linker = generateLinkerScript(u585);

  assert.match(u575Linker, /FLASH \(rx\)\s+: ORIGIN = 0x08000000, LENGTH = 1024K/);
  assert.match(u585Linker, /FLASH \(rx\)\s+: ORIGIN = 0x08000000, LENGTH = 2048K/);
  assert.match(u575Linker, /RAM \(rw\)\s+: ORIGIN = 0x20000000, LENGTH = 256K/);
  assert.match(u585Linker, /RAM \(rw\)\s+: ORIGIN = 0x20000000, LENGTH = 256K/);
  assert.doesNotMatch(u575Linker, /SRAM2|CCMRAM/);
});

test('generates the stm32u5 toolchain file with the Cortex-M33 hard-float flags', () => {
  assert.ok(u575);
  const toolchain = generateToolchainFile(u575);

  assert.match(toolchain, /-mcpu=cortex-m33/);
  assert.match(toolchain, /fpv5-sp-d16/);
  assert.match(toolchain, /hard/);
});
