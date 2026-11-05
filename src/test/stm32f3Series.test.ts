import assert from 'node:assert/strict';
import test from 'node:test';
import { stm32f3xxProfiles } from '../devices/stm32/stm32f3xx';
import {
  createStm32F3Profile,
  stm32f303InterruptHandlers,
  stm32f334InterruptHandlers,
  stm32f373InterruptHandlers
} from '../devices/stm32/stm32f3xx/common';
import { validateDeviceProfile } from '../devices/profileValidation';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';

const f303cc = stm32f3xxProfiles.find((profile) => profile.part === 'STM32F303CCT6');
const f303rc = stm32f3xxProfiles.find((profile) => profile.part === 'STM32F303RCT6');
const f303vc = stm32f3xxProfiles.find((profile) => profile.part === 'STM32F303VCT6');
const f334 = stm32f3xxProfiles.find((profile) => profile.part === 'STM32F334C8T6');
const f373 = stm32f3xxProfiles.find((profile) => profile.part === 'STM32F373CCT6');

test('registers the STM32F3 profiles with the datasheet parameters', () => {
  assert.ok(f303cc && f303rc && f303vc && f334 && f373);
  for (const profile of stm32f3xxProfiles) {
    validateDeviceProfile(profile);
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'F3x');
    assert.equal(profile.family, 'STM32F3xx');
    assert.equal(profile.core, 'cortex-m4');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.deepEqual(profile.compilerFlags, [
      '-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard'
    ]);
    assert.equal(profile.toolchainFileName, 'stm32f3-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32f3x');
  }
  for (const profile of [f303cc, f303rc, f303vc, f373]) {
    assert.deepEqual(profile.flash, { origin: 0x08000000, length: 256 * 1024 });
  }
  // DS9118 Rev 14 Table 2: every F303xC density maps 40K SRAM on the data bus
  // plus 8K CCM; the "48 Kbytes" in the overview counts both regions.
  assert.deepEqual(f334.flash, { origin: 0x08000000, length: 64 * 1024 });
  assert.deepEqual(f334.ram, { origin: 0x20000000, length: 12 * 1024 });
  assert.deepEqual(f373.ram, { origin: 0x20000000, length: 32 * 1024 });
  for (const profile of [f303cc, f303rc, f303vc]) {
    assert.deepEqual(profile.ram, { origin: 0x20000000, length: 40 * 1024 });
    assert.deepEqual(profile.additionalMemory, [
      { name: 'CCMRAM', attributes: 'rw', origin: 0x10000000, length: 8 * 1024 }
    ]);
  }
  assert.deepEqual(f334.additionalMemory, [
    { name: 'CCMRAM', attributes: 'rw', origin: 0x10000000, length: 4 * 1024 }
  ]);
  assert.equal(f373.additionalMemory, undefined);
  assert.deepEqual(f303cc.defines, ['STM32F303xC']);
  assert.deepEqual(f303rc.defines, ['STM32F303xC']);
  assert.deepEqual(f303vc.defines, ['STM32F303xC']);
  assert.deepEqual(f334.defines, ['STM32F334x8']);
  assert.deepEqual(f373.defines, ['STM32F373xC']);
  assert.equal(f303cc.gnuStartupFileName, 'startup_stm32f303xc.S');
  assert.equal(f303rc.gnuStartupFileName, 'startup_stm32f303xc.S');
  assert.equal(f303vc.gnuStartupFileName, 'startup_stm32f303xc.S');
  assert.equal(f334.gnuStartupFileName, 'startup_stm32f334x8.S');
  assert.equal(f373.gnuStartupFileName, 'startup_stm32f373xc.S');
  assert.equal(f303cc.linkerFileName, 'STM32F303CCT6.ld');
  assert.equal(f334.linkerFileName, 'STM32F334C8T6.ld');
  assert.equal(f373.linkerFileName, 'STM32F373CCT6.ld');
});

test('copies the ST F3 vector tables without disturbing reserved slots', () => {
  for (const table of [stm32f303InterruptHandlers, stm32f334InterruptHandlers, stm32f373InterruptHandlers]) {
    assert.equal(table.length, 82);
    assert.equal(table[81], 'FPU_IRQHandler');
  }
  // ST reserves IRQ 48-50, 62-63 and 77-80 on the F303xC.
  assert.deepEqual(stm32f303InterruptHandlers.slice(48, 51), ['0', '0', '0']);
  assert.deepEqual(stm32f303InterruptHandlers.slice(62, 64), ['0', '0']);
  assert.deepEqual(stm32f303InterruptHandlers.slice(77, 81), ['0', '0', '0', '0']);
  // The F334x8 leaves the USB, SPI2 and TIM4 slots empty.
  assert.equal(stm32f334InterruptHandlers[30], '0');
  assert.deepEqual(stm32f334InterruptHandlers.slice(19, 22), ['CAN_TX_IRQHandler', 'CAN_RX0_IRQHandler', 'CAN_RX1_IRQHandler']);
  // The F373xC swaps the F303 ADC1_2/USB names for its own peripherals.
  assert.equal(stm32f373InterruptHandlers[19], 'CAN_TX_IRQHandler');
  assert.equal(stm32f373InterruptHandlers[76], 'USBWakeUp_IRQHandler');
  assert.equal(stm32f303InterruptHandlers[76], 'USBWakeUp_RMP_IRQHandler');
});

test('generates the F303 startup with Cortex-M4 hard-float vector table', () => {
  assert.ok(f303cc);
  const startup = generateGnuStartup(f303cc);

  assert.match(startup, /\.cpu cortex-m4/);
  assert.match(startup, /\.thumb/);
  assert.match(startup, /\.word EXTI2_TSC_IRQHandler/);
  assert.match(startup, /\.word ADC4_IRQHandler/);
  assert.match(startup, /\.word COMP1_2_3_IRQHandler/);
  assert.match(startup, /\.word USBWakeUp_RMP_IRQHandler/);
  assert.match(startup, /\.weak FPU_IRQHandler/);
  assert.match(startup, /\.word FPU_IRQHandler/);
  // ST reserves IRQ 48-50 between ADC3 and SPI3.
  assert.match(startup, /\.word ADC3_IRQHandler\n  \.word 0\n  \.word 0\n  \.word 0\n  \.word SPI3_IRQHandler/);
  // No F4-style DMA streams, no F334 HRTIM.
  assert.doesNotMatch(startup, /DMA1_Stream7_IRQHandler|HRTIM1_Master_IRQHandler|SDADC1_IRQHandler/);
  assert.doesNotMatch(startup, /\.weak 0\b/);
  // 16 core vectors + 82 peripheral slots.
  assert.equal((startup.match(/^  \.word /gm) ?? []).length, 98);
});

test('generates the F334 startup with HRTIM handlers and no USB entries', () => {
  assert.ok(f334);
  const startup = generateGnuStartup(f334);

  assert.match(startup, /\.cpu cortex-m4/);
  assert.match(startup, /\.word TIM6_DAC1_IRQHandler/);
  assert.match(startup, /\.weak HRTIM1_Master_IRQHandler/);
  assert.match(startup, /\.word HRTIM1_FLT_IRQHandler/);
  assert.match(startup, /\.weak FPU_IRQHandler/);
  // ST reserves IRQ 30 (TIM4) between TIM3 and I2C1_EV on the F334x8.
  assert.match(startup, /\.word TIM3_IRQHandler\n  \.word 0\n  \.word I2C1_EV_IRQHandler/);
  assert.doesNotMatch(startup, /USB|SPI2_IRQHandler|TIM4_IRQHandler|ADC3_IRQHandler/);
  assert.equal((startup.match(/^  \.word /gm) ?? []).length, 98);
});

test('generates the F373 startup with SDADC and CEC handlers', () => {
  assert.ok(f373);
  const startup = generateGnuStartup(f373);

  assert.match(startup, /\.cpu cortex-m4/);
  assert.match(startup, /\.word SDADC1_IRQHandler/);
  assert.match(startup, /\.word CEC_IRQHandler/);
  assert.match(startup, /\.word TIM19_IRQHandler/);
  assert.match(startup, /\.weak FPU_IRQHandler/);
  // The F373 keeps the shared EXTI2_TSC vector; HRTIM/ADC4 belong to the F334
  // and the _RMP USB names to the F303.
  assert.doesNotMatch(startup, /HRTIM1|ADC4_IRQHandler|USBWakeUp_RMP_IRQHandler/);
  assert.equal((startup.match(/^  \.word /gm) ?? []).length, 98);
});

test('generates the F3 linker scripts with the datasheet memory layout', () => {
  assert.ok(f303rc && f334 && f373);
  const f303Linker = generateLinkerScript(f303rc);
  const f334Linker = generateLinkerScript(f334);
  const f373Linker = generateLinkerScript(f373);

  assert.match(f303Linker, /FLASH \(rx\)\s+: ORIGIN = 0x08000000, LENGTH = 256K/);
  assert.match(f303Linker, /RAM \(rw\)\s+: ORIGIN = 0x20000000, LENGTH = 40K/);
  assert.match(f303Linker, /CCMRAM \(rw\)\s+: ORIGIN = 0x10000000, LENGTH = 8K/);
  assert.match(f334Linker, /FLASH \(rx\)\s+: ORIGIN = 0x08000000, LENGTH = 64K/);
  assert.match(f334Linker, /RAM \(rw\)\s+: ORIGIN = 0x20000000, LENGTH = 12K/);
  assert.match(f334Linker, /CCMRAM \(rw\)\s+: ORIGIN = 0x10000000, LENGTH = 4K/);
  // The F373 has no CCM region.
  assert.match(f373Linker, /RAM \(rw\)\s+: ORIGIN = 0x20000000, LENGTH = 32K/);
  assert.doesNotMatch(f373Linker, /CCMRAM/);
});

test('generates the stm32f3 toolchain file with the fpv4 hard-float flags', () => {
  assert.ok(f303cc);
  const toolchain = generateToolchainFile(f303cc);

  assert.match(toolchain, /set\(TARGET_FLAGS "-mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard"\)/);
  assert.match(toolchain, /STM32F303CCT6\.ld/);
});

test('builds additional profiles through the shared factory', () => {
  const custom = createStm32F3Profile('STM32F303K8T6', 'CUSTOM.ld', {
    define: 'STM32F303x8',
    flashLength: 64 * 1024,
    ramLength: 16 * 1024,
    gnuStartupFileName: 'startup_stm32f303x8.S',
    interruptHandlers: stm32f303InterruptHandlers
  });

  assert.equal(custom.series, 'F3x');
  assert.equal(custom.toolchainFileName, 'stm32f3-toolchain.cmake');
  assert.equal(custom.additionalMemory, undefined);
});
