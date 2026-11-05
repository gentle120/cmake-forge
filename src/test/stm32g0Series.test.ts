import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceProfile } from '../devices/deviceProfiles';
import { validateDeviceProfile } from '../devices/profileValidation';
import {
  stm32g030InterruptHandlers,
  stm32g041InterruptHandlers,
  stm32g071InterruptHandlers,
  stm32g0b1InterruptHandlers
} from '../devices/stm32/stm32g0xx/g0Factory';
import { stm32g0xxProfiles } from '../devices/stm32/stm32g0xx';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';

const expectedProfiles: Array<{
  part: string;
  flash: number;
  ram: number;
  define: string;
  gnuStartupFileName: string;
}> = [
  {
    part: 'STM32G030F6P6', flash: 32 * 1024, ram: 8 * 1024,
    define: 'STM32G030xx', gnuStartupFileName: 'startup_stm32g030xx.S'
  },
  {
    part: 'STM32G071R8T6', flash: 64 * 1024, ram: 36 * 1024,
    define: 'STM32G071xx', gnuStartupFileName: 'startup_stm32g071xx.S'
  },
  {
    part: 'STM32G071RBT6', flash: 128 * 1024, ram: 36 * 1024,
    define: 'STM32G071xx', gnuStartupFileName: 'startup_stm32g071xx.S'
  },
  {
    part: 'STM32G0B1RBT6', flash: 128 * 1024, ram: 144 * 1024,
    define: 'STM32G0B1xx', gnuStartupFileName: 'startup_stm32g0b1xx.S'
  },
  {
    part: 'STM32G041RBT6', flash: 128 * 1024, ram: 36 * 1024,
    define: 'STM32G041xx', gnuStartupFileName: 'startup_stm32g041xx.S'
  }
];

test('keeps the G0 profiles valid and on the G0 memory layout', () => {
  assert.equal(stm32g0xxProfiles.length, expectedProfiles.length);
  for (const expected of expectedProfiles) {
    const profile: DeviceProfile | undefined = stm32g0xxProfiles.find((item) => item.part === expected.part);
    assert.ok(profile, `missing profile ${expected.part}`);
    validateDeviceProfile(profile);
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'G0x');
    assert.equal(profile.family, 'STM32G0xx');
    assert.equal(profile.core, 'cortex-m0plus');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.deepEqual(profile.defines, [expected.define]);
    assert.deepEqual(profile.compilerFlags, ['-mcpu=cortex-m0plus', '-mthumb']);
    assert.deepEqual(profile.flash, { origin: 0x08000000, length: expected.flash });
    assert.deepEqual(profile.ram, { origin: 0x20000000, length: expected.ram });
    assert.equal(profile.additionalMemory, undefined);
    assert.equal(profile.linkerFileName, `${expected.part}.ld`);
    assert.equal(profile.gnuStartupFileName, expected.gnuStartupFileName);
    assert.equal(profile.toolchainFileName, 'stm32g0-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32g0x');
  }
});

test('transcribes the G0 vector tables from the ST startup files', () => {
  // Entry counts of the external IRQ sections in cmsis-device-g0
  // Source/Templates/gcc/startup_stm32g0{30,41,71,b1}xx.s.
  assert.equal(stm32g030InterruptHandlers.length, 30);
  assert.equal(stm32g041InterruptHandlers.length, 32);
  assert.equal(stm32g071InterruptHandlers.length, 31);
  assert.equal(stm32g0b1InterruptHandlers.length, 31);
  // Reserved slots stay literal '0' as in the upstream .word 0 entries.
  assert.equal(stm32g030InterruptHandlers.filter((handler) => handler === '0').length, 7);
  assert.equal(stm32g041InterruptHandlers.filter((handler) => handler === '0').length, 3);
  assert.ok(!stm32g071InterruptHandlers.includes('0'));
  assert.ok(!stm32g0b1InterruptHandlers.includes('0'));
});

test('generates M0+ startup files with the per-family G0 tables', () => {
  const g030 = generateGnuStartup(stm32g0xxProfiles.find((item) => item.part === 'STM32G030F6P6')!);
  assert.match(g030, /\.cpu cortex-m0plus/);
  assert.match(g030, /\.word RTC_TAMP_IRQHandler/);
  assert.match(g030, /\.word DMA1_Ch4_5_DMAMUX1_OVR_IRQHandler/);
  // The G030 short table keeps the reserved slot between WWDG and RTC_TAMP.
  assert.match(g030, /\.word WWDG_IRQHandler\n\s*\.word 0\n\s*\.word RTC_TAMP_IRQHandler/);
  assert.doesNotMatch(g030, /UCPD1_2_IRQHandler|TIM15_IRQHandler|AES_RNG_IRQHandler/);

  const g071 = generateGnuStartup(stm32g0xxProfiles.find((item) => item.part === 'STM32G071RBT6')!);
  assert.match(g071, /\.cpu cortex-m0plus/);
  assert.match(g071, /\.word UCPD1_2_IRQHandler/);
  assert.match(g071, /\.word TIM6_DAC_LPTIM1_IRQHandler/);
  assert.match(g071, /\.word USART3_4_LPUART1_IRQHandler/);
  assert.match(g071, /\.word CEC_IRQHandler/);
  assert.doesNotMatch(g071, /AES_RNG_IRQHandler|TIM16_FDCAN_IT0_IRQHandler/);

  const g0b1 = generateGnuStartup(stm32g0xxProfiles.find((item) => item.part === 'STM32G0B1RBT6')!);
  assert.match(g0b1, /\.cpu cortex-m0plus/);
  assert.match(g0b1, /\.word PVD_VDDIO2_IRQHandler/);
  assert.match(g0b1, /\.word RCC_CRS_IRQHandler/);
  assert.match(g0b1, /\.word TIM16_FDCAN_IT0_IRQHandler/);
  assert.match(g0b1, /\.word USART3_4_5_6_LPUART1_IRQHandler/);
  assert.doesNotMatch(g0b1, /\.word PVD_IRQHandler|\.word RCC_IRQHandler/);

  const g041 = generateGnuStartup(stm32g0xxProfiles.find((item) => item.part === 'STM32G041RBT6')!);
  assert.match(g041, /\.cpu cortex-m0plus/);
  assert.match(g041, /\.word LPTIM1_IRQHandler/);
  assert.match(g041, /\.word LPUART1_IRQHandler/);
  assert.match(g041, /\.word AES_RNG_IRQHandler/);
  assert.doesNotMatch(g041, /UCPD1_2_IRQHandler|CEC_IRQHandler/);

  // None of the G0 tables carries the shared F4/L4 handler names.
  for (const profile of stm32g0xxProfiles) {
    const startup = generateGnuStartup(profile);
    assert.doesNotMatch(startup, /TIM1_UP_TIM16_IRQHandler|CAN1_TX_IRQHandler|DMA1_Stream7_IRQHandler/);
  }
});

test('generates G0 toolchain files without floating-point flags', () => {
  for (const profile of stm32g0xxProfiles) {
    const toolchain = generateToolchainFile(profile);
    assert.match(toolchain, /set\(TARGET_FLAGS "-mcpu=cortex-m0plus -mthumb"\)/);
    assert.doesNotMatch(toolchain, /-mfpu=|-mfloat-abi=/);
    assert.match(toolchain, new RegExp(`-T\\$\\{CMAKE_SOURCE_DIR\\}/${profile.linkerFileName}`));
  }
});

test('generates the G0 linker memory maps', () => {
  for (const expected of expectedProfiles) {
    const profile = stm32g0xxProfiles.find((item) => item.part === expected.part)!;
    const linker = generateLinkerScript(profile);
    const flashK = `${expected.flash / 1024}K`;
    const ramK = `${expected.ram / 1024}K`;
    assert.match(linker, new RegExp(`FLASH \\(rx\\).*ORIGIN = 0x08000000, LENGTH = ${flashK}`, 's'));
    assert.match(linker, new RegExp(`RAM \\(rw\\).*ORIGIN = 0x20000000, LENGTH = ${ramK}`, 's'));
    assert.doesNotMatch(linker, /RAM \(xrw\)/);
    assert.doesNotMatch(linker, /CCMRAM|RAM2/);
  }
});
