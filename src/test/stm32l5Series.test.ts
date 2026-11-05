import assert from 'node:assert/strict';
import test from 'node:test';
import { stm32l5xxProfiles } from '../devices/stm32/stm32l5xx';
import {
  stm32l552InterruptHandlers,
  stm32l562InterruptHandlers
} from '../devices/stm32/stm32l5xx/l5Factory';
import { validateDeviceProfile } from '../devices/profileValidation';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';

const parts = ['STM32L552RCT6', 'STM32L552ZET6', 'STM32L562RCT6', 'STM32L562ZET6'];

test('provides valid L5 profiles that survive profile registry validation', () => {
  assert.deepEqual(stm32l5xxProfiles.map((profile) => profile.part), parts);

  for (const profile of stm32l5xxProfiles) {
    validateDeviceProfile(profile);
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'L5x');
    assert.equal(profile.family, 'STM32L5xx');
    assert.equal(profile.core, 'cortex-m33');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.equal(profile.flash, profile.flash);
    assert.equal(profile.ram.origin, 0x20000000);
    // SRAM1 and SRAM2 form one contiguous 256K block on the L5.
    assert.equal(profile.ram.length, 256 * 1024);
    assert.equal(profile.additionalMemory, undefined);
    assert.equal(profile.toolchainFileName, 'stm32l5-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32l5x');
  }
});

test('uses the per-density ST defines and startup files', () => {
  const [l552r, l552z, l562r, l562z] = stm32l5xxProfiles;

  assert.deepEqual(l552r.defines, ['STM32L552xx']);
  assert.deepEqual(l552z.defines, ['STM32L552xx']);
  assert.deepEqual(l562r.defines, ['STM32L562xx']);
  assert.deepEqual(l562z.defines, ['STM32L562xx']);
  assert.equal(l552r.gnuStartupFileName, 'startup_stm32l552xx.S');
  assert.equal(l552z.gnuStartupFileName, 'startup_stm32l552xx.S');
  assert.equal(l562r.gnuStartupFileName, 'startup_stm32l562xx.S');
  assert.equal(l562z.gnuStartupFileName, 'startup_stm32l562xx.S');
  assert.equal(l552r.flash.length, 256 * 1024);
  assert.equal(l552z.flash.length, 512 * 1024);
  assert.equal(l562r.flash.length, 256 * 1024);
  assert.equal(l562z.flash.length, 512 * 1024);
});

test('transcribes the L552 vector table with reserved ST slots', () => {
  // IRQ n is entry n of the external section, which follows the 16 core slots.
  assert.equal(stm32l552InterruptHandlers.length, 109);
  assert.equal(stm32l552InterruptHandlers[0], 'WWDG_IRQHandler');
  assert.equal(stm32l552InterruptHandlers[39], 'FDCAN1_IT0_IRQHandler');
  assert.equal(stm32l552InterruptHandlers[76], 'OCTOSPI1_IRQHandler');
  // IRQ 77 and 79 stay reserved between OCTOSPI1, SDMMC1, and DMA2.
  assert.equal(stm32l552InterruptHandlers[77], '0');
  assert.equal(stm32l552InterruptHandlers[78], 'SDMMC1_IRQHandler');
  assert.equal(stm32l552InterruptHandlers[79], '0');
  assert.equal(stm32l552InterruptHandlers[93], '0');
  assert.equal(stm32l552InterruptHandlers[94], 'RNG_IRQHandler');
  assert.equal(stm32l552InterruptHandlers[95], 'FPU_IRQHandler');
  assert.equal(stm32l552InterruptHandlers[96], 'HASH_IRQHandler');
  assert.equal(stm32l552InterruptHandlers[97], '0');
  assert.equal(stm32l552InterruptHandlers[107], 'ICACHE_IRQHandler');
  assert.equal(stm32l552InterruptHandlers[108], '0');
});

test('fills the L562 AES, PKA, and OTFDEC1 slots the L552 reserves', () => {
  assert.equal(stm32l562InterruptHandlers.length, 109);
  assert.equal(stm32l562InterruptHandlers[77], '0');
  assert.equal(stm32l562InterruptHandlers[79], '0');
  assert.equal(stm32l562InterruptHandlers[93], 'AES_IRQHandler');
  assert.equal(stm32l562InterruptHandlers[97], 'PKA_IRQHandler');
  assert.equal(stm32l562InterruptHandlers[108], 'OTFDEC1_IRQHandler');

  const changed = stm32l552InterruptHandlers.filter(
    (handler, irq) => handler !== stm32l562InterruptHandlers[irq]
  );
  assert.deepEqual(changed, ['0', '0', '0']);
});

test('keeps named handlers unique inside each L5 table', () => {
  for (const table of [stm32l552InterruptHandlers, stm32l562InterruptHandlers]) {
    const named = table.filter((handler) => handler !== '0');
    assert.equal(new Set(named).size, named.length);
  }
});

test('generates a Cortex-M33 L5 startup with the ST L5 handlers', () => {
  const startup = generateGnuStartup(stm32l5xxProfiles[0]);

  assert.match(startup, /\.cpu cortex-m33/);
  assert.match(startup, /\.thumb/);
  assert.match(startup, /\.weak ICACHE_IRQHandler/);
  assert.match(startup, /\.thumb_set ICACHE_IRQHandler, Default_Handler/);
  assert.match(startup, /\.weak FDCAN1_IT0_IRQHandler/);
  assert.match(startup, /\.weak GTZC_IRQHandler/);
  assert.match(startup, /\.weak OCTOSPI1_IRQHandler/);
  // The L5 external section plus the 16 core slots fill the table.
  const entries = vectorEntries(startup);
  assert.equal(entries.length, 125);
  assert.equal(entries[16 + 107], 'ICACHE_IRQHandler');
  assert.equal(entries[16 + 77], '0');
});

test('generates the L562 startup with the security handlers', () => {
  const startup = generateGnuStartup(stm32l5xxProfiles[3]);

  assert.match(startup, /\.weak AES_IRQHandler/);
  assert.match(startup, /\.weak PKA_IRQHandler/);
  assert.match(startup, /\.weak OTFDEC1_IRQHandler/);
  const entries = vectorEntries(startup);
  assert.equal(entries[16 + 93], 'AES_IRQHandler');
  assert.equal(entries[16 + 97], 'PKA_IRQHandler');
  assert.equal(entries[16 + 108], 'OTFDEC1_IRQHandler');
  assert.doesNotMatch(startup, /FDCAN2/);
});

test('generates hard-float Cortex-M33 flags in the L5 toolchain file', () => {
  const toolchain = generateToolchainFile(stm32l5xxProfiles[0]);

  assert.match(toolchain, /arm-none-eabi-gcc/);
  assert.match(toolchain, /set\(TARGET_FLAGS "-mcpu=cortex-m33 -mthumb -mfpu=fpv5-sp-d16 -mfloat-abi=hard"\)/);
  assert.match(toolchain, /STM32L552RCT6\.ld/);
  assert.match(toolchain, /--specs=nano\.specs/);
});

test('generates the L5 memory regions without extra RAM banks', () => {
  const dense = generateLinkerScript(stm32l5xxProfiles[1]);
  const small = generateLinkerScript(stm32l5xxProfiles[2]);

  assert.match(dense, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 512K/s);
  assert.match(dense, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 256K/s);
  assert.doesNotMatch(dense, /RAM2|SRAM2|CCMRAM/);
  assert.match(small, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 256K/s);
  assert.match(small, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 256K/s);
});

/** Reads the vector table entries in declaration order. */
function vectorEntries(startup: string): string[] {
  const body = startup.match(/__Vectors:\n([\s\S]*?)\n\.size __Vectors/)?.[1] ?? '';
  return body
    .split('\n')
    .map((line) => line.trim().replace(/^\.word\s+/, ''))
    .filter((entry) => entry.length > 0);
}
