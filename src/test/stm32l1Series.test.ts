import assert from 'node:assert/strict';
import test from 'node:test';
import { stm32l1xxProfiles } from '../devices/stm32/stm32l1xx';
import {
  stm32l100xcInterruptHandlers,
  stm32l151xbInterruptHandlers,
  stm32l151xcInterruptHandlers,
  stm32l152xeInterruptHandlers
} from '../devices/stm32/stm32l1xx/l1Factory';
import { validateDeviceProfile } from '../devices/profileValidation';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';

const l100rc = stm32l1xxProfiles.find((profile) => profile.part === 'STM32L100RCT6');
const l151rb = stm32l1xxProfiles.find((profile) => profile.part === 'STM32L151RBT6');
const l151rc = stm32l1xxProfiles.find((profile) => profile.part === 'STM32L151RCT6');
const l152re = stm32l1xxProfiles.find((profile) => profile.part === 'STM32L152RET6');

test('registers the STM32L1 profiles with the specified parameters', () => {
  assert.ok(l100rc && l151rb && l151rc && l152re);
  for (const profile of stm32l1xxProfiles) {
    validateDeviceProfile(profile);
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'L1x');
    assert.equal(profile.family, 'STM32L1xx');
    assert.equal(profile.core, 'cortex-m3');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.deepEqual(profile.compilerFlags, ['-mcpu=cortex-m3', '-mthumb']);
    assert.equal(profile.flash.origin, 0x08000000);
    assert.equal(profile.ram.origin, 0x20000000);
    assert.equal(profile.additionalMemory, undefined);
    assert.equal(profile.toolchainFileName, 'stm32l1-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32l1');
    assert.equal(profile.linkerFileName, `${profile.part}.ld`);
    assert.equal(profile.gnuStartupFileName, `startup_${profile.defines[0].toLowerCase()}.S`);
  }
  assert.deepEqual(l100rc.defines, ['STM32L100xC']);
  assert.deepEqual(l100rc.flash, { origin: 0x08000000, length: 256 * 1024 });
  assert.deepEqual(l100rc.ram, { origin: 0x20000000, length: 32 * 1024 });
  assert.deepEqual(l151rb.defines, ['STM32L151xB']);
  assert.deepEqual(l151rb.flash, { origin: 0x08000000, length: 128 * 1024 });
  assert.deepEqual(l151rb.ram, { origin: 0x20000000, length: 16 * 1024 });
  assert.deepEqual(l151rc.defines, ['STM32L151xC']);
  assert.deepEqual(l151rc.flash, { origin: 0x08000000, length: 256 * 1024 });
  assert.deepEqual(l151rc.ram, { origin: 0x20000000, length: 32 * 1024 });
  assert.deepEqual(l152re.defines, ['STM32L152xE']);
  assert.deepEqual(l152re.flash, { origin: 0x08000000, length: 512 * 1024 });
  assert.deepEqual(l152re.ram, { origin: 0x20000000, length: 80 * 1024 });
  assert.deepEqual(
    stm32l1xxProfiles.map((profile) => profile.part),
    ['STM32L100RCT6', 'STM32L151RBT6', 'STM32L151RCT6', 'STM32L152RET6']
  );
});

test('keeps the density-specific L1 vector tables from the ST startup files', () => {
  // Medium density stops after TIM7 (IRQ 44); IRQ 24 is reserved without LCD.
  assert.equal(stm32l151xbInterruptHandlers.length, 45);
  assert.equal(stm32l151xbInterruptHandlers[0], 'WWDG_IRQHandler');
  assert.equal(stm32l151xbInterruptHandlers[24], '0');
  assert.equal(stm32l151xbInterruptHandlers[25], 'TIM9_IRQHandler');
  assert.equal(stm32l151xbInterruptHandlers[44], 'TIM7_IRQHandler');
  // High density continues through COMP_ACQ (IRQ 56).
  for (const table of [stm32l151xcInterruptHandlers, stm32l100xcInterruptHandlers, stm32l152xeInterruptHandlers]) {
    assert.equal(table.length, 57);
    assert.equal(table[56], 'COMP_ACQ_IRQHandler');
    assert.equal(table[44], 'TIM7_IRQHandler');
  }
  assert.equal(stm32l151xcInterruptHandlers[24], '0');
  assert.equal(stm32l151xcInterruptHandlers[46], 'TIM5_IRQHandler');
  // The L100 value line swaps TIM5 for a reserved pair and carries the LCD.
  assert.equal(stm32l100xcInterruptHandlers[24], 'LCD_IRQHandler');
  assert.equal(stm32l100xcInterruptHandlers[45], '0');
  assert.equal(stm32l100xcInterruptHandlers[46], '0');
  // The L152 adds LCD, UART4, and UART5 to the L151 high-density table.
  assert.equal(stm32l152xeInterruptHandlers[24], 'LCD_IRQHandler');
  assert.equal(stm32l152xeInterruptHandlers[48], 'UART4_IRQHandler');
  assert.equal(stm32l152xeInterruptHandlers[49], 'UART5_IRQHandler');
});

test('generates the L151 startup table with the L1-only handler names', () => {
  assert.ok(l151rc);
  const startup = generateGnuStartup(l151rc);

  assert.match(startup, /\.cpu cortex-m3/);
  assert.match(startup, /\.word USB_FS_WKUP_IRQHandler/);
  assert.match(startup, /\.weak USB_FS_WKUP_IRQHandler/);
  assert.match(startup, /\.word TAMPER_STAMP_IRQHandler/);
  assert.match(startup, /\.word COMP_ACQ_IRQHandler/);
  assert.match(startup, /\.word RTC_WKUP_IRQHandler/);
  // The F1 vector table names must not leak into L1.
  assert.doesNotMatch(startup, /TAMPER_IRQHandler[^_]|USB_HP_CAN1_TX_IRQHandler|RTCAlarm_IRQHandler|USBWakeUp_IRQHandler/);
  assert.doesNotMatch(startup, /FPU_IRQHandler|ETH_IRQHandler|LCD_IRQHandler/);
});

test('generates the L100 and L152 startup tables with their added peripherals', () => {
  assert.ok(l100rc && l152re && l151rb);
  const l100Startup = generateGnuStartup(l100rc);
  const l152Startup = generateGnuStartup(l152re);
  const l151rbStartup = generateGnuStartup(l151rb);

  assert.match(l100Startup, /\.word LCD_IRQHandler/);
  assert.doesNotMatch(l100Startup, /\.word TIM5_IRQHandler/);
  assert.match(l152Startup, /\.word LCD_IRQHandler/);
  assert.match(l152Startup, /\.word UART4_IRQHandler/);
  assert.match(l152Startup, /\.word UART5_IRQHandler/);
  // The medium-density L151 table has neither the LCD nor the DMA2 block.
  assert.doesNotMatch(l151rbStartup, /LCD_IRQHandler|DMA2_Channel1_IRQHandler|COMP_ACQ_IRQHandler/);
});

test('keeps the Cortex-M3 L1 toolchain flags free of floating-point ABI flags', () => {
  assert.ok(l151rb);
  const toolchain = generateToolchainFile(l151rb);

  assert.match(toolchain, /set\(TARGET_FLAGS "-mcpu=cortex-m3 -mthumb"\)/);
  assert.doesNotMatch(toolchain, /-mfpu=|-mfloat-abi=/);
  assert.match(toolchain, /STM32L151RBT6\.ld/);
});

test('generates the four L1 flash densities over their RAM sizes', () => {
  assert.ok(l100rc && l151rb && l151rc && l152re);
  const l100 = generateLinkerScript(l100rc);
  const l151rbLinker = generateLinkerScript(l151rb);
  const l151rcLinker = generateLinkerScript(l151rc);
  const l152 = generateLinkerScript(l152re);

  assert.match(l100, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 256K/s);
  assert.match(l100, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 32K/s);
  assert.match(l151rbLinker, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 128K/s);
  assert.match(l151rbLinker, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 16K/s);
  assert.match(l151rcLinker, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 256K/s);
  assert.match(l151rcLinker, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 32K/s);
  assert.match(l152, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 512K/s);
  assert.match(l152, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 80K/s);
  // The L1 series has no CCM or second SRAM bank.
  for (const linker of [l100, l151rbLinker, l151rcLinker, l152]) {
    assert.doesNotMatch(linker, /RAM2|CCMRAM|SRAM2/);
  }
});
