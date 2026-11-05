import assert from 'node:assert/strict';
import test from 'node:test';
import { validateDeviceProfile } from '../devices/profileValidation';
import { stm32l0xxProfiles } from '../devices/stm32/stm32l0xx';
import {
  stm32l0ExtendedInterruptHandlers,
  stm32l0ShortInterruptHandlers
} from '../devices/stm32/stm32l0xx/l0Factory';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';
import { getFlashTargetProfileForDevice } from '../flash/targets/targetProfiles';
import type { DeviceProfile } from '../devices/deviceProfiles';

const l0Profiles: Record<string, DeviceProfile> = Object.fromEntries(
  stm32l0xxProfiles.map((profile) => [profile.part, profile])
);
const l0Parts = [
  'STM32L031C6T6', 'STM32L053C8T6', 'STM32L053R8T6',
  'STM32L071RBT6', 'STM32L073RBT6', 'STM32L073VBT6'
];
// The Cortex-M0+ has no FPU, so only the core instruction-set flags apply.
const l0CompilerFlags = ['-mcpu=cortex-m0plus', '-mthumb'];
const defines: Record<string, string> = {
  STM32L031C6T6: 'STM32L031xx',
  STM32L053C8T6: 'STM32L053xx',
  STM32L053R8T6: 'STM32L053xx',
  STM32L071RBT6: 'STM32L071xx',
  STM32L073RBT6: 'STM32L073xx',
  STM32L073VBT6: 'STM32L073xx'
};
const startups: Record<string, string> = {
  STM32L031C6T6: 'startup_stm32l031xx.S',
  STM32L053C8T6: 'startup_stm32l053xx.S',
  STM32L053R8T6: 'startup_stm32l053xx.S',
  STM32L071RBT6: 'startup_stm32l071xx.S',
  STM32L073RBT6: 'startup_stm32l073xx.S',
  STM32L073VBT6: 'startup_stm32l073xx.S'
};

test('creates the STM32L0 Cortex-M0+ profiles for every flash density', () => {
  assert.deepEqual(Object.keys(l0Profiles).sort(), l0Parts);
  // 6 = 32K, 8 = 64K, B = 128K in the ST part numbering; category 1/2 parts
  // carry 8K RAM while category 3/5 parts carry 20K.
  const kilobytes: Record<string, { flash: number; ram: number }> = {
    STM32L031C6T6: { flash: 32, ram: 8 },
    STM32L053C8T6: { flash: 64, ram: 8 },
    STM32L053R8T6: { flash: 64, ram: 8 },
    STM32L071RBT6: { flash: 128, ram: 20 },
    STM32L073RBT6: { flash: 128, ram: 20 },
    STM32L073VBT6: { flash: 128, ram: 20 }
  };

  for (const part of l0Parts) {
    const profile = l0Profiles[part];
    assert.ok(profile, `missing L0 profile ${part}`);
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'L0x');
    assert.equal(profile.family, 'STM32L0xx');
    assert.equal(profile.core, 'cortex-m0plus');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.deepEqual(profile.defines, [defines[part]]);
    assert.deepEqual(profile.compilerFlags, l0CompilerFlags);
    assert.deepEqual(profile.flash, { origin: 0x08000000, length: kilobytes[part].flash * 1024 });
    assert.deepEqual(profile.ram, { origin: 0x20000000, length: kilobytes[part].ram * 1024 });
    assert.equal('additionalMemory' in profile, false);
    assert.equal(profile.linkerFileName, `${part}.ld`);
    assert.equal(profile.gnuStartupFileName, startups[part]);
    assert.equal(profile.toolchainFileName, 'stm32l0-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32l0');
    assert.doesNotThrow(() => validateDeviceProfile(profile));
  }
});

test('generates the L0 startup with L0-only handlers', () => {
  const startup = generateGnuStartup(l0Profiles['STM32L031C6T6']);

  assert.match(startup, /\.cpu cortex-m0plus/);
  assert.match(startup, /\.word RCC_CRS_IRQHandler/);
  assert.match(startup, /\.weak RCC_CRS_IRQHandler/);
  assert.match(startup, /\.weak EXTI4_15_IRQHandler/);
  assert.match(startup, /\.weak ADC1_COMP_IRQHandler/);
  assert.match(startup, /\.weak DMA1_Channel4_5_6_7_IRQHandler/);
  assert.match(startup, /\.weak RNG_LPUART1_IRQHandler/);
  assert.doesNotMatch(startup, /DMA1_Stream7_IRQHandler|DFSDM1_FLT0_IRQHandler|HSEM_IRQHandler|USB_HP_CAN1_TX_IRQHandler/);
});

/** Reads the vector table entries in declaration order. */
function vectorEntries(startup: string): string[] {
  const body = startup.match(/__Vectors:\n([\s\S]*?)\n\.size __Vectors/)?.[1] ?? '';
  return body
    .split('\n')
    .map((line) => line.trim().replace(/^\.word\s+/, ''))
    .filter((entry) => entry.length > 0);
}

test('places the L053 external handlers at their hardware IRQ numbers', () => {
  // IRQ n is the (16 + n)-th entry, after the stack pointer and the reset vector.
  const entries = vectorEntries(generateGnuStartup(l0Profiles['STM32L053R8T6']));
  const slot = (irq: number): string => entries[16 + irq];

  // 16 core vectors + 32 external interrupts.
  assert.equal(entries.length, 48);
  assert.equal(slot(0), 'WWDG_IRQHandler');
  assert.equal(slot(4), 'RCC_CRS_IRQHandler');
  assert.equal(slot(8), 'TSC_IRQHandler');
  assert.equal(slot(12), 'ADC1_COMP_IRQHandler');
  // IRQ 14 is reserved on the L053 table before TIM2.
  assert.equal(slot(14), '0');
  assert.equal(slot(15), 'TIM2_IRQHandler');
  assert.equal(slot(17), 'TIM6_DAC_IRQHandler');
  assert.equal(slot(29), 'RNG_LPUART1_IRQHandler');
  assert.equal(slot(31), 'USB_IRQHandler');
  assert.equal(stm32l0ShortInterruptHandlers.filter((handler) => handler === '0').length, 5);
});

test('places the L073 external handlers at their hardware IRQ numbers', () => {
  const entries = vectorEntries(generateGnuStartup(l0Profiles['STM32L073RBT6']));
  const slot = (irq: number): string => entries[16 + irq];

  assert.equal(entries.length, 48);
  assert.equal(slot(4), 'RCC_CRS_IRQHandler');
  assert.equal(slot(14), 'USART4_5_IRQHandler');
  assert.equal(slot(16), 'TIM3_IRQHandler');
  assert.equal(slot(18), 'TIM7_IRQHandler');
  // IRQ 19 is the only reserved slot on the L073 table.
  assert.equal(slot(19), '0');
  assert.equal(slot(21), 'I2C3_IRQHandler');
  assert.equal(slot(22), 'TIM22_IRQHandler');
  assert.equal(slot(29), 'RNG_LPUART1_IRQHandler');
  assert.equal(slot(31), 'USB_IRQHandler');
  assert.equal(stm32l0ExtendedInterruptHandlers.filter((handler) => handler === '0').length, 1);
});

test('uses the L053 short table for L031/L053 and the L073 table for L071/L073', () => {
  const l031 = vectorEntries(generateGnuStartup(l0Profiles['STM32L031C6T6']));
  const l053 = vectorEntries(generateGnuStartup(l0Profiles['STM32L053C8T6']));
  const l071 = vectorEntries(generateGnuStartup(l0Profiles['STM32L071RBT6']));
  const l073 = vectorEntries(generateGnuStartup(l0Profiles['STM32L073VBT6']));

  assert.deepEqual(l031, l053);
  assert.deepEqual(l071, l073);
  assert.notDeepEqual(l031.slice(16, 32), l073.slice(16, 32));
});

test('generates the six L0 linker flash densities', () => {
  const expectedFlash: Record<string, string> = {
    STM32L031C6T6: '32K',
    STM32L053C8T6: '64K',
    STM32L053R8T6: '64K',
    STM32L071RBT6: '128K',
    STM32L073RBT6: '128K',
    STM32L073VBT6: '128K'
  };
  const expectedRam: Record<string, string> = {
    STM32L031C6T6: '8K',
    STM32L053C8T6: '8K',
    STM32L053R8T6: '8K',
    STM32L071RBT6: '20K',
    STM32L073RBT6: '20K',
    STM32L073VBT6: '20K'
  };

  for (const part of l0Parts) {
    const linker = generateLinkerScript(l0Profiles[part]);

    assert.match(linker, new RegExp(`FLASH \\(rx\\).*ORIGIN = 0x08000000, LENGTH = ${expectedFlash[part]}`, 's'));
    assert.match(linker, new RegExp(`RAM \\(rw\\).*ORIGIN = 0x20000000.*LENGTH = ${expectedRam[part]}`, 's'));
    assert.doesNotMatch(linker, /CCMRAM|RAM2 \(rw\)/);
  }
});

test('generates the stm32l0 toolchain file without FPU flags', () => {
  const toolchain = generateToolchainFile(l0Profiles['STM32L071RBT6']);

  assert.match(toolchain, /set\(CMAKE_C_COMPILER arm-none-eabi-gcc\)/);
  assert.match(toolchain, /-mcpu=cortex-m0plus -mthumb/);
  assert.doesNotMatch(toolchain, /-mfpu=|-mfloat-abi=/);
  assert.match(toolchain, /-T\$\{CMAKE_SOURCE_DIR\}\/STM32L071RBT6\.ld/);
});

test('maps the stm32l0 OpenOCD target for L0 devices', () => {
  const target = getFlashTargetProfileForDevice({ vendor: 'STM', debugTarget: 'stm32l0' });

  assert.equal(target.targetConfig, 'target/stm32l0.cfg');
});
