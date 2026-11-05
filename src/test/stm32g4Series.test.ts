import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceProfile } from '../devices/deviceProfiles';
import { validateDeviceProfile } from '../devices/profileValidation';
import { stm32g4xxProfiles } from '../devices/stm32/stm32g4xx';
import {
  stm32g431InterruptHandlers,
  stm32g474InterruptHandlers
} from '../devices/stm32/stm32g4xx/g4Factory';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';

const g4Profiles: Record<string, DeviceProfile> = Object.fromEntries(
  stm32g4xxProfiles.map((profile) => [profile.part, profile])
);
const g4Parts = ['STM32G431CBT6', 'STM32G431RBT6', 'STM32G473RET6', 'STM32G474RET6', 'STM32G484RET6'];
const g4Defines: Record<string, string> = {
  STM32G431CBT6: 'STM32G431xx',
  STM32G431RBT6: 'STM32G431xx',
  STM32G473RET6: 'STM32G473xx',
  STM32G474RET6: 'STM32G474xx',
  STM32G484RET6: 'STM32G484xx'
};
const g4CompilerFlags = ['-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard'];

test('creates the STM32G4 Cortex-M4 profiles for both densities', () => {
  assert.deepEqual(Object.keys(g4Profiles).sort(), g4Parts);
  // B = 128K and E = 512K in the ST part numbering.
  const flashKilobytes: Record<string, number> = {
    STM32G431CBT6: 128,
    STM32G431RBT6: 128,
    STM32G473RET6: 512,
    STM32G474RET6: 512,
    STM32G484RET6: 512
  };

  for (const part of g4Parts) {
    const profile = g4Profiles[part];
    assert.ok(profile, `missing G4 profile ${part}`);
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'G4x');
    assert.equal(profile.family, 'STM32G4xx');
    assert.equal(profile.core, 'cortex-m4');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.deepEqual(profile.defines, [g4Defines[part]]);
    assert.deepEqual(profile.compilerFlags, g4CompilerFlags);
    assert.deepEqual(profile.flash, { origin: 0x08000000, length: flashKilobytes[part] * 1024 });
    assert.equal(profile.linkerFileName, `${part}.ld`);
    assert.equal(profile.toolchainFileName, 'stm32g4-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32g4x');
    assert.doesNotThrow(() => validateDeviceProfile(profile));
  }
});

test('splits the G4 RAM into contiguous SRAM1+SRAM2 and a separate CCMSRAM', () => {
  // G431: SRAM1 16K + SRAM2 6K contiguous, CCMSRAM1 8K + CCMSRAM2 2K.
  const g431 = g4Profiles['STM32G431RBT6'];
  assert.deepEqual(g431.ram, { origin: 0x20000000, length: 22 * 1024 });
  assert.deepEqual(g431.additionalMemory, [
    { name: 'CCMSRAM', attributes: 'rw', origin: 0x10000000, length: 10 * 1024 }
  ]);
  // G473/G474/G484: SRAM1 80K + SRAM2 16K contiguous, CCMSRAM 24K + 8K.
  const g474 = g4Profiles['STM32G474RET6'];
  assert.deepEqual(g474.ram, { origin: 0x20000000, length: 96 * 1024 });
  assert.deepEqual(g474.additionalMemory, [
    { name: 'CCMSRAM', attributes: 'rw', origin: 0x10000000, length: 32 * 1024 }
  ]);
});

test('uses the G431 startup for the 32KB-SRAM parts and the G474 table otherwise', () => {
  assert.equal(g4Profiles['STM32G431RBT6'].gnuStartupFileName, 'startup_stm32g431xx.S');
  assert.equal(g4Profiles['STM32G431CBT6'].gnuStartupFileName, 'startup_stm32g431xx.S');
  for (const part of ['STM32G473RET6', 'STM32G474RET6', 'STM32G484RET6']) {
    assert.equal(g4Profiles[part].gnuStartupFileName, 'startup_stm32g474xx.S');
  }
});

test('generates the G431 startup with G431-only handlers', () => {
  const startup = generateGnuStartup(g4Profiles['STM32G431RBT6']);

  assert.match(startup, /\.cpu cortex-m4/);
  assert.match(startup, /\.word CORDIC_IRQHandler/);
  assert.match(startup, /\.weak FDCAN1_IT0_IRQHandler/);
  assert.match(startup, /\.weak UCPD1_IRQHandler/);
  assert.match(startup, /\.weak COMP4_IRQHandler/);
  // The high-density G47x/G48x peripherals are absent from the G431 table.
  assert.doesNotMatch(
    startup,
    /HRTIM1_Master_IRQHandler|TIM20_UP_IRQHandler|ADC3_IRQHandler|COMP4_5_6_IRQHandler|DMA1_Channel8_IRQHandler/
  );
});

test('generates the G474 startup with high-density G4 handlers', () => {
  const startup = generateGnuStartup(g4Profiles['STM32G474RET6']);

  assert.match(startup, /\.word CORDIC_IRQHandler/);
  assert.match(startup, /\.weak FDCAN1_IT0_IRQHandler/);
  assert.match(startup, /\.weak HRTIM1_Master_IRQHandler/);
  assert.match(startup, /\.weak TIM20_CC_IRQHandler/);
  assert.match(startup, /\.weak ADC5_IRQHandler/);
  assert.match(startup, /\.weak FDCAN3_IT0_IRQHandler/);
  // The G474 table has COMP4_5_6 instead of the G431 single COMP4 slot.
  assert.doesNotMatch(startup, /COMP4_IRQHandler/);
});

/** Reads the vector table entries in declaration order. */
function vectorEntries(startup: string): string[] {
  const body = startup.match(/__Vectors:\n([\s\S]*?)\n\.size __Vectors/)?.[1] ?? '';
  return body
    .split('\n')
    .map((line) => line.trim().replace(/^\.word\s+/, ''))
    .filter((entry) => entry.length > 0);
}

test('places the G4 external handlers at their hardware IRQ numbers', () => {
  // IRQ n is the (16 + n)-th entry, after the stack pointer and the reset vector.
  const slot = (entries: string[], irq: number): string => entries[16 + irq];

  // 16 core vectors + IRQ0..IRQ101 with the G431 reserved holes.
  const g431Entries = vectorEntries(generateGnuStartup(g4Profiles['STM32G431RBT6']));
  assert.equal(g431Entries.length, 118);
  assert.equal(slot(g431Entries, 17), '0');
  assert.equal(slot(g431Entries, 21), 'FDCAN1_IT0_IRQHandler');
  assert.equal(slot(g431Entries, 63), 'UCPD1_IRQHandler');
  assert.equal(slot(g431Entries, 75), 'CRS_IRQHandler');
  assert.equal(slot(g431Entries, 100), 'CORDIC_IRQHandler');
  assert.equal(slot(g431Entries, 101), 'FMAC_IRQHandler');
  assert.equal(stm32g431InterruptHandlers.filter((handler) => handler === '0').length, 32);

  // The G474 table fills IRQ0..IRQ101 except the single reserved slot 85.
  const g474Entries = vectorEntries(generateGnuStartup(g4Profiles['STM32G474RET6']));
  assert.equal(g474Entries.length, 118);
  assert.equal(slot(g474Entries, 17), 'DMA1_Channel7_IRQHandler');
  assert.equal(slot(g474Entries, 67), 'HRTIM1_Master_IRQHandler');
  assert.equal(slot(g474Entries, 81), 'FPU_IRQHandler');
  assert.equal(slot(g474Entries, 96), 'DMA1_Channel8_IRQHandler');
  assert.equal(slot(g474Entries, 101), 'FMAC_IRQHandler');
  assert.equal(stm32g474InterruptHandlers.filter((handler) => handler === '0').length, 1);
});

test('uses the same vector table for every part of a density', () => {
  const small = vectorEntries(generateGnuStartup(g4Profiles['STM32G431CBT6']));
  const large = vectorEntries(generateGnuStartup(g4Profiles['STM32G484RET6']));
  const mid = vectorEntries(generateGnuStartup(g4Profiles['STM32G473RET6']));

  assert.deepEqual(small, vectorEntries(generateGnuStartup(g4Profiles['STM32G431RBT6'])));
  assert.deepEqual(mid, large);
});

test('generates the G4 linker memory regions for both densities', () => {
  const g431 = generateLinkerScript(g4Profiles['STM32G431CBT6']);

  assert.match(g431, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 128K/s);
  assert.match(g431, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 22K/s);
  assert.match(g431, /CCMSRAM \(rw\) : ORIGIN = 0x10000000, LENGTH = 10K/);

  const g484 = generateLinkerScript(g4Profiles['STM32G484RET6']);

  assert.match(g484, /FLASH \(rx\).*LENGTH = 512K/s);
  assert.match(g484, /RAM \(rw\).*LENGTH = 96K/s);
  assert.match(g484, /CCMSRAM \(rw\) : ORIGIN = 0x10000000, LENGTH = 32K/);
});

test('generates the stm32g4 toolchain file with hard-float M4 flags', () => {
  const toolchain = generateToolchainFile(g4Profiles['STM32G484RET6']);

  assert.match(toolchain, /set\(TARGET_FLAGS "-mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard"\)/);
  assert.match(toolchain, /CMAKE_C_FLAGS_INIT.*TARGET_FLAGS/);
  assert.match(toolchain, /STM32G484RET6\.ld/);
});
