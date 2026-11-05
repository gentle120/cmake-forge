import assert from 'node:assert/strict';
import test from 'node:test';
import {
  stm32f030x8InterruptHandlers,
  stm32f031x6InterruptHandlers,
  stm32f051x8InterruptHandlers,
  stm32f072xbInterruptHandlers,
  stm32f091xcInterruptHandlers
} from '../devices/stm32/stm32f0xx/common';
import { STM32F030C8T6 } from '../devices/stm32/stm32f0xx/STM32F030C8T6';
import { STM32F030R8T6 } from '../devices/stm32/stm32f0xx/STM32F030R8T6';
import { STM32F031C6T6 } from '../devices/stm32/stm32f0xx/STM32F031C6T6';
import { STM32F051C8T6 } from '../devices/stm32/stm32f0xx/STM32F051C8T6';
import { STM32F072CBT6 } from '../devices/stm32/stm32f0xx/STM32F072CBT6';
import { STM32F072RBT6 } from '../devices/stm32/stm32f0xx/STM32F072RBT6';
import { STM32F091RCT6 } from '../devices/stm32/stm32f0xx/STM32F091RCT6';
import { stm32f0xxProfiles } from '../devices/stm32/stm32f0xx';
import { validateDeviceProfile } from '../devices/profileValidation';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';

const f0Expectations = [
  {
    profile: STM32F030C8T6,
    flash: 64 * 1024,
    ram: 8 * 1024,
    define: 'STM32F030x8',
    startup: 'startup_stm32f030x8.S',
    handlers: stm32f030x8InterruptHandlers
  },
  {
    profile: STM32F030R8T6,
    flash: 64 * 1024,
    ram: 8 * 1024,
    define: 'STM32F030x8',
    startup: 'startup_stm32f030x8.S',
    handlers: stm32f030x8InterruptHandlers
  },
  {
    profile: STM32F031C6T6,
    flash: 32 * 1024,
    ram: 4 * 1024,
    define: 'STM32F031x6',
    startup: 'startup_stm32f031x6.S',
    handlers: stm32f031x6InterruptHandlers
  },
  {
    profile: STM32F051C8T6,
    flash: 64 * 1024,
    ram: 8 * 1024,
    define: 'STM32F051x8',
    startup: 'startup_stm32f051x8.S',
    handlers: stm32f051x8InterruptHandlers
  },
  {
    profile: STM32F072CBT6,
    flash: 128 * 1024,
    ram: 16 * 1024,
    define: 'STM32F072xB',
    startup: 'startup_stm32f072xb.S',
    handlers: stm32f072xbInterruptHandlers
  },
  {
    profile: STM32F072RBT6,
    flash: 128 * 1024,
    ram: 16 * 1024,
    define: 'STM32F072xB',
    startup: 'startup_stm32f072xb.S',
    handlers: stm32f072xbInterruptHandlers
  },
  {
    profile: STM32F091RCT6,
    flash: 256 * 1024,
    ram: 32 * 1024,
    define: 'STM32F091xC',
    startup: 'startup_stm32f091xc.S',
    handlers: stm32f091xcInterruptHandlers
  }
];

test('exposes all seven STM32F0 parts with verified memory and defines', () => {
  assert.deepEqual(
    stm32f0xxProfiles.map((profile) => profile.part),
    [
      'STM32F030C8T6', 'STM32F030R8T6', 'STM32F031C6T6', 'STM32F051C8T6',
      'STM32F072CBT6', 'STM32F072RBT6', 'STM32F091RCT6'
    ]
  );

  for (const expected of f0Expectations) {
    const { profile } = expected;
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'F0x');
    assert.equal(profile.family, 'STM32F0xx');
    assert.equal(profile.core, 'cortex-m0');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.deepEqual(profile.defines, [expected.define]);
    assert.deepEqual(profile.compilerFlags, ['-mcpu=cortex-m0', '-mthumb']);
    assert.deepEqual(profile.flash, { origin: 0x08000000, length: expected.flash });
    assert.deepEqual(profile.ram, { origin: 0x20000000, length: expected.ram });
    assert.equal(profile.gnuStartupFileName, expected.startup);
    assert.equal(profile.toolchainFileName, 'stm32f0-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32f0x');
    assert.equal(profile.additionalMemory, undefined);
    assert.deepEqual(profile.interruptHandlers, expected.handlers);
    assert.ok(expected.handlers.length > 0);
    // The vector table is the 16 core entries plus the external IRQ slots.
    assert.equal(vectorEntries(generateGnuStartup(profile)).length, 16 + expected.handlers.length);
  }
});

test('passes profile validation for every STM32F0 part', () => {
  for (const expected of f0Expectations) {
    assert.doesNotThrow(() => validateDeviceProfile(expected.profile));
  }
});

test('generates the STM32F030 short vector table without reserved-slot weak aliases', () => {
  const startup = generateGnuStartup(STM32F030C8T6);

  assert.match(startup, /\.cpu cortex-m0/);
  assert.match(startup, /\.word EXTI4_15_IRQHandler/);
  assert.match(startup, /\.word TIM1_BRK_UP_TRG_COM_IRQHandler/);
  assert.match(startup, /\.word USART2_IRQHandler/);
  // The three trailing reserved slots stay literal zeros.
  assert.doesNotMatch(startup, /\.weak 0/);
  assert.match(startup, /\.word USART2_IRQHandler[\s\S]*?\.word 0[\s\S]*?\.word 0[\s\S]*?\.word 0\n\.size __Vectors/);
  assert.doesNotMatch(startup, /TIM2_IRQHandler|DMA1_Channel4_5_6_7_IRQHandler|LPTIM1_IRQHandler/);
});

test('generates the STM32F031 vector table with TIM2 and without F051-only peripherals', () => {
  const startup = generateGnuStartup(STM32F031C6T6);

  assert.match(startup, /\.cpu cortex-m0/);
  assert.match(startup, /\.word PVD_IRQHandler/);
  assert.match(startup, /\.word TIM2_IRQHandler/);
  assert.match(startup, /\.word TIM16_IRQHandler/);
  assert.doesNotMatch(startup, /I2C2_IRQHandler|SPI2_IRQHandler|USART2_IRQHandler|TSC_IRQHandler/);
});

test('generates the STM32F051 vector table with CRS, TSC, and CEC_CAN handlers', () => {
  const startup = generateGnuStartup(STM32F051C8T6);

  assert.match(startup, /\.cpu cortex-m0/);
  assert.match(startup, /\.word RCC_CRS_IRQHandler/);
  assert.match(startup, /\.word TSC_IRQHandler/);
  assert.match(startup, /\.word ADC1_COMP_IRQHandler/);
  assert.match(startup, /\.word TIM6_DAC_IRQHandler/);
  assert.match(startup, /\.word CEC_CAN_IRQHandler/);
  assert.doesNotMatch(startup, /TIM7_IRQHandler|USART3_4_IRQHandler/);
});

test('generates the STM32F072 vector table with merged DMA and USB handlers', () => {
  const startup = generateGnuStartup(STM32F072CBT6);

  assert.match(startup, /\.cpu cortex-m0/);
  assert.match(startup, /\.word DMA1_Channel4_5_6_7_IRQHandler/);
  assert.match(startup, /\.word PVD_VDDIO2_IRQHandler/);
  assert.match(startup, /\.word TIM7_IRQHandler/);
  assert.match(startup, /\.word USART3_4_IRQHandler/);
  assert.match(startup, /\.word USB_IRQHandler/);
  assert.doesNotMatch(startup, /DMA1_Ch4_7_DMA2_Ch3_5_IRQHandler|USART3_8_IRQHandler/);
});

test('generates the STM32F091 vector table with the F09x DMA naming', () => {
  const startup = generateGnuStartup(STM32F091RCT6);

  assert.match(startup, /\.cpu cortex-m0/);
  assert.match(startup, /\.word DMA1_Ch2_3_DMA2_Ch1_2_IRQHandler/);
  assert.match(startup, /\.word DMA1_Ch4_7_DMA2_Ch3_5_IRQHandler/);
  assert.match(startup, /\.word USART3_8_IRQHandler/);
  assert.match(startup, /\.word CEC_CAN_IRQHandler/);
  // The F091 table ends at IRQ 30 without USB.
  assert.doesNotMatch(startup, /USB_IRQHandler|USART3_4_IRQHandler|DMA1_Channel4_5_6_7_IRQHandler/);
});

test('keeps other-series and G0 handlers out of every F0 vector table', () => {
  for (const expected of f0Expectations) {
    const startup = generateGnuStartup(expected.profile);

    assert.doesNotMatch(
      startup,
      /TIM6_DAC_LPTIM1_IRQHandler|TIM7_LPTIM2_IRQHandler|USART3_4_5_6_LPUART1_IRQHandler|USB_UCPD1_2_IRQHandler/
    );
    assert.doesNotMatch(startup, /DMA1_Stream0_IRQHandler|OTG_FS_IRQHandler/);
    assert.doesNotMatch(startup, /PVD_PVM_IRQHandler|DFSDM1_FLT0_IRQHandler|LPUART1_IRQHandler/);
    assert.doesNotMatch(startup, /USB_HP_CAN1_TX_IRQHandler|USBWakeUp_IRQHandler/);
  }
});

test('keeps Cortex-M0 toolchain flags free of floating-point options', () => {
  const toolchain = generateToolchainFile(STM32F030C8T6);

  assert.match(toolchain, /set\(TARGET_FLAGS "-mcpu=cortex-m0 -mthumb"\)/);
  assert.match(toolchain, /STM32F030C8T6\.ld/);
  assert.match(toolchain, /CMAKE_SYSTEM_PROCESSOR arm/);
  assert.doesNotMatch(toolchain, /-mfpu=|-mfloat-abi=/);

  const f072Toolchain = generateToolchainFile(STM32F072CBT6);
  assert.match(f072Toolchain, /set\(TARGET_FLAGS "-mcpu=cortex-m0 -mthumb"\)/);
  assert.doesNotMatch(f072Toolchain, /-mfpu=|-mfloat-abi=/);
});

test('generates F0 linker memory maps for each density without extra RAM regions', () => {
  const f030 = generateLinkerScript(STM32F030C8T6);
  assert.match(f030, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 64K/s);
  assert.match(f030, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 8K/s);
  assert.doesNotMatch(f030, /CCMRAM|RAM2|RAM \(xrw\)/);

  const f031 = generateLinkerScript(STM32F031C6T6);
  assert.match(f031, /FLASH \(rx\).*LENGTH = 32K/s);
  assert.match(f031, /RAM \(rw\).*LENGTH = 4K/s);

  const f072 = generateLinkerScript(STM32F072CBT6);
  assert.match(f072, /FLASH \(rx\).*LENGTH = 128K/s);
  assert.match(f072, /RAM \(rw\).*LENGTH = 16K/s);

  const f091 = generateLinkerScript(STM32F091RCT6);
  assert.match(f091, /FLASH \(rx\).*LENGTH = 256K/s);
  assert.match(f091, /RAM \(rw\).*LENGTH = 32K/s);
  assert.doesNotMatch(f091, /CCMRAM|RAM2/);
});

/** Reads the vector table entries in declaration order. */
function vectorEntries(startup: string): string[] {
  const body = startup.match(/__Vectors:\n([\s\S]*?)\n\.size __Vectors/)?.[1] ?? '';
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('.word '))
    .map((line) => line.slice('.word '.length));
}
