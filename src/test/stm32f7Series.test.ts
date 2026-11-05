import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDeviceProfile } from '../devices/profileValidation';
import { stm32f7xxProfiles } from '../devices/stm32/stm32f7xx';
import {
  stm32f746InterruptHandlers,
  stm32f767InterruptHandlers
} from '../devices/stm32/stm32f7xx/common';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';

const f746vet6 = stm32f7xxProfiles.find((profile) => profile.part === 'STM32F746VET6');
const f746zgt6 = stm32f7xxProfiles.find((profile) => profile.part === 'STM32F746ZGT6');
const f767zgt6 = stm32f7xxProfiles.find((profile) => profile.part === 'STM32F767ZGT6');
const f767zit6 = stm32f7xxProfiles.find((profile) => profile.part === 'STM32F767ZIT6');

test('registers the STM32F7 profiles with the verified memory layout', () => {
  for (const profile of stm32f7xxProfiles) {
    validateDeviceProfile(profile);
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'F7x');
    assert.equal(profile.family, 'STM32F7xx');
    assert.equal(profile.core, 'cortex-m7');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.equal(profile.toolchainFileName, 'stm32f7-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32f7x');
    assert.deepEqual(profile.compilerFlags, [
      '-mcpu=cortex-m7', '-mthumb', '-mfpu=fpv5-sp-d16', '-mfloat-abi=hard'
    ]);
    assert.equal(profile.flash.origin, 0x08000000);
  }
  assert.ok(f746vet6 && f746zgt6 && f767zgt6 && f767zit6);

  assert.equal(f746vet6.flash.length, 512 * 1024);
  assert.equal(f746zgt6.flash.length, 1024 * 1024);
  assert.equal(f767zgt6.flash.length, 1024 * 1024);
  assert.equal(f767zit6.flash.length, 2048 * 1024);

  // RM0385: DTCM 64K, then SRAM1 240K + SRAM2 16K contiguous after it.
  for (const profile of [f746vet6, f746zgt6]) {
    assert.deepEqual(profile.ram, { origin: 0x20000000, length: 64 * 1024 });
    assert.deepEqual(profile.additionalMemory, [
      { name: 'SRAM', attributes: 'rw', origin: 0x20010000, length: 256 * 1024 },
      { name: 'ITCM', attributes: 'rwx', origin: 0x00000000, length: 16 * 1024 }
    ]);
  }
  // RM0410: DTCM 128K, then SRAM1 368K + SRAM2 16K contiguous after it.
  for (const profile of [f767zgt6, f767zit6]) {
    assert.deepEqual(profile.ram, { origin: 0x20000000, length: 128 * 1024 });
    assert.deepEqual(profile.additionalMemory, [
      { name: 'SRAM', attributes: 'rw', origin: 0x20020000, length: 384 * 1024 },
      { name: 'ITCM', attributes: 'rwx', origin: 0x00000000, length: 16 * 1024 }
    ]);
  }

  assert.deepEqual(f746vet6.defines, ['STM32F746xx']);
  assert.deepEqual(f746zgt6.defines, ['STM32F746xx']);
  assert.deepEqual(f767zgt6.defines, ['STM32F767xx']);
  assert.deepEqual(f767zit6.defines, ['STM32F767xx']);
  assert.equal(f746vet6.gnuStartupFileName, 'startup_stm32f746xx.S');
  assert.equal(f746zgt6.gnuStartupFileName, 'startup_stm32f746xx.S');
  assert.equal(f767zgt6.gnuStartupFileName, 'startup_stm32f767xx.S');
  assert.equal(f767zit6.gnuStartupFileName, 'startup_stm32f767xx.S');
  for (const profile of stm32f7xxProfiles) {
    assert.equal(profile.linkerFileName, `${profile.part}.ld`);
  }
});

test('keeps the F767 table as the F746 prefix plus the added peripherals', () => {
  assert.equal(stm32f746InterruptHandlers.length, 98);
  assert.equal(stm32f767InterruptHandlers.length, 110);
  assert.deepEqual(stm32f767InterruptHandlers.slice(0, 98), stm32f746InterruptHandlers);
  // ST reserves the slot after DCMI (IRQ 79) on the F746 and the slot after
  // SPDIF_RX (IRQ 98) on the F767.
  assert.equal(stm32f746InterruptHandlers[78], 'DCMI_IRQHandler');
  assert.equal(stm32f746InterruptHandlers[79], '0');
  assert.equal(stm32f746InterruptHandlers[91], 'SAI2_IRQHandler');
  assert.equal(stm32f746InterruptHandlers[97], 'SPDIF_RX_IRQHandler');
  assert.equal(stm32f767InterruptHandlers[98], '0');
  assert.equal(stm32f767InterruptHandlers[99], 'DFSDM1_FLT0_IRQHandler');
  assert.equal(stm32f767InterruptHandlers[102], 'DFSDM1_FLT3_IRQHandler');
  assert.equal(stm32f767InterruptHandlers[103], 'SDMMC2_IRQHandler');
  assert.equal(stm32f767InterruptHandlers[104], 'CAN3_TX_IRQHandler');
  assert.equal(stm32f767InterruptHandlers[109], 'MDIOS_IRQHandler');
});

test('generates the F7 startup with Cortex-M7 settings and F7-only handlers', () => {
  assert.ok(f746vet6 && f767zit6);
  const f746Startup = generateGnuStartup(f746vet6);
  const f767Startup = generateGnuStartup(f767zit6);

  assert.match(f746Startup, /\.cpu cortex-m7/);
  assert.match(f767Startup, /\.cpu cortex-m7/);
  assert.match(f746Startup, /\.weak SAI2_IRQHandler/);
  assert.match(f746Startup, /\.word SPDIF_RX_IRQHandler/);
  assert.match(f746Startup, /\.weak FPU_IRQHandler/);
  // The F746 table ends with SPDIF_RX: no D2-only handlers.
  assert.doesNotMatch(f746Startup, /MDIOS_IRQHandler|DFSDM1_FLT[01]_IRQHandler|CAN3_TX_IRQHandler/);
  assert.match(f767Startup, /\.weak MDIOS_IRQHandler/);
  assert.match(f767Startup, /\.word CAN3_TX_IRQHandler/);
  // Reserved holes: after DCMI on both, after SPDIF_RX on the F767.
  assert.match(f746Startup, /\.word DCMI_IRQHandler\n  \.word 0\n  \.word RNG_IRQHandler/);
  assert.match(f767Startup, /\.word SPDIF_RX_IRQHandler\n  \.word 0\n  \.word DFSDM1_FLT0_IRQHandler/);
  // 16 core vectors + 98 (F746) / 110 (F767) peripheral slots.
  assert.equal((f746Startup.match(/^  \.word /gm) ?? []).length, 114);
  assert.equal((f767Startup.match(/^  \.word /gm) ?? []).length, 126);
});

test('generates the F7 linker script with the datasheet memory layout', () => {
  assert.ok(f746vet6 && f746zgt6 && f767zgt6 && f767zit6);
  const f746vet6Linker = generateLinkerScript(f746vet6);
  const f746zgt6Linker = generateLinkerScript(f746zgt6);
  const f767zgt6Linker = generateLinkerScript(f767zgt6);
  const f767zit6Linker = generateLinkerScript(f767zit6);

  assert.match(f746vet6Linker, /FLASH \(rx\)\s+: ORIGIN = 0x08000000, LENGTH = 512K/);
  assert.match(f746zgt6Linker, /FLASH \(rx\)\s+: ORIGIN = 0x08000000, LENGTH = 1024K/);
  assert.match(f767zgt6Linker, /FLASH \(rx\)\s+: ORIGIN = 0x08000000, LENGTH = 1024K/);
  assert.match(f767zit6Linker, /FLASH \(rx\)\s+: ORIGIN = 0x08000000, LENGTH = 2048K/);

  assert.match(f746vet6Linker, /RAM \(rw\)\s+: ORIGIN = 0x20000000, LENGTH = 64K/);
  assert.match(f767zit6Linker, /RAM \(rw\)\s+: ORIGIN = 0x20000000, LENGTH = 128K/);
  assert.match(f746zgt6Linker, /SRAM \(rw\) : ORIGIN = 0x20010000, LENGTH = 256K/);
  assert.match(f767zgt6Linker, /SRAM \(rw\) : ORIGIN = 0x20020000, LENGTH = 384K/);
  for (const linker of [f746vet6Linker, f746zgt6Linker, f767zgt6Linker, f767zit6Linker]) {
    assert.match(linker, /ITCM \(rwx\) : ORIGIN = 0x00000000, LENGTH = 16K/);
    // F7 has no D1 AXI SRAM and no D2/D3 SRAM; those addresses belong to H7 parts.
    assert.doesNotMatch(linker, /0x24000000|0x30000000|0x38000000/);
  }
});

test('generates the stm32f7 toolchain file with the Cortex-M7 hard-float flags', () => {
  assert.ok(f767zgt6);
  const toolchain = generateToolchainFile(f767zgt6);

  assert.match(toolchain, /-mcpu=cortex-m7/);
  assert.match(toolchain, /fpv5-sp-d16/);
  assert.match(toolchain, /hard/);
  assert.match(toolchain, /F767ZGT6\.ld/);
});
