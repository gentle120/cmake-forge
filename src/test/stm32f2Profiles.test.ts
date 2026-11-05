import assert from 'node:assert/strict';
import test from 'node:test';
import {
  stm32f205InterruptHandlers,
  stm32f207InterruptHandlers,
  stm32f215InterruptHandlers,
  stm32f217InterruptHandlers
} from '../devices/stm32/stm32f2xx/common';
import { stm32f2xxProfiles } from '../devices/stm32/stm32f2xx';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';

test('STM32F2 profiles keep the Cortex-M3 series shape', () => {
  for (const profile of stm32f2xxProfiles) {
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'F2x');
    assert.equal(profile.family, 'STM32F2xx');
    assert.equal(profile.core, 'cortex-m3');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.deepEqual(profile.compilerFlags, ['-mcpu=cortex-m3', '-mthumb']);
    assert.deepEqual(profile.flash, { origin: 0x08000000, length: 1024 * 1024 });
    assert.deepEqual(profile.ram, { origin: 0x20000000, length: 128 * 1024 });
    assert.deepEqual(profile.additionalMemory, [
      { name: 'CCM', attributes: 'rw', origin: 0x10000000, length: 64 * 1024 }
    ]);
    assert.equal(profile.toolchainFileName, 'stm32f2-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32f2x');
  }
  assert.deepEqual(stm32f2xxProfiles.map((profile) => profile.part), [
    'STM32F205RGT6', 'STM32F207VGT6', 'STM32F207ZGT6', 'STM32F215RGT6', 'STM32F217VGT6'
  ]);
  assert.deepEqual(stm32f2xxProfiles.map((profile) => profile.defines[0]), [
    'STM32F205xx', 'STM32F207xx', 'STM32F207xx', 'STM32F215xx', 'STM32F217xx'
  ]);
});

test('the four F2 startup tables keep the densities ST ships separately', () => {
  // startup_stm32f205xx.s / f207xx.s / f215xx.s / f217xx.s external vectors.
  assert.equal(stm32f205InterruptHandlers.length, 71);
  assert.equal(stm32f207InterruptHandlers.length, 74);
  assert.equal(stm32f215InterruptHandlers.length, 72);
  assert.equal(stm32f217InterruptHandlers.length, 75);
  assert.equal(new Set(stm32f205InterruptHandlers).size, 71);

  // Connectivity line only: ETH/ETH_WKUP shift CAN2 onwards, DCMI lands at 72.
  assert.ok(stm32f207InterruptHandlers.includes('ETH_IRQHandler'));
  assert.ok(stm32f207InterruptHandlers.includes('ETH_WKUP_IRQHandler'));
  assert.ok(stm32f207InterruptHandlers.includes('DCMI_IRQHandler'));
  assert.ok(!stm32f205InterruptHandlers.includes('ETH_IRQHandler'));
  assert.ok(!stm32f215InterruptHandlers.includes('ETH_IRQHandler'));
  // Crypto line only: CRYP ahead of HASH_RNG.
  assert.ok(stm32f215InterruptHandlers.includes('CRYP_IRQHandler'));
  assert.ok(!stm32f205InterruptHandlers.includes('CRYP_IRQHandler'));
  assert.ok(stm32f217InterruptHandlers.includes('ETH_IRQHandler'));
  assert.ok(stm32f217InterruptHandlers.includes('CRYP_IRQHandler'));
  // Shared series markers stay in place across densities.
  assert.ok(stm32f205InterruptHandlers.includes('TIM1_BRK_TIM9_IRQHandler'));
  assert.ok(stm32f207InterruptHandlers.includes('CAN2_TX_IRQHandler'));
  assert.ok(stm32f215InterruptHandlers.includes('HASH_RNG_IRQHandler'));
});

test('generates the STM32F2 Cortex-M3 startup without FPU settings', () => {
  const startup = generateGnuStartup(stm32f2xxProfiles[0]);

  assert.match(startup, /\.cpu cortex-m3/);
  assert.match(startup, /\.thumb/);
  assert.doesNotMatch(startup, /mfpu|float-abi/);
  // F2-specific combined handlers appear; F1/GD32-only handlers must not.
  assert.match(startup, /\.word TIM1_BRK_TIM9_IRQHandler/);
  assert.match(startup, /\.word HASH_RNG_IRQHandler/);
  assert.match(startup, /\.weak HASH_RNG_IRQHandler/);
  assert.doesNotMatch(startup, /USBWakeUp_IRQHandler|RCU_IRQHandler|DMA1_Channel1_IRQHandler/);
});

test('the connectivity startup uses the F207 table, not the F205 one', () => {
  const startup = generateGnuStartup(stm32f2xxProfiles[1]);

  assert.match(startup, /\.cpu cortex-m3/);
  assert.match(startup, /\.word ETH_IRQHandler/);
  assert.match(startup, /\.word DCMI_IRQHandler/);
  // ETH sits between DMA2_Stream4 and CAN2_TX in the vector table.
  assert.match(startup, /\.word DMA2_Stream4_IRQHandler[\s\S]*\.word ETH_IRQHandler[\s\S]*\.word CAN2_TX_IRQHandler/);
});

test('links the 64K CCM region beside 1M flash and 128K SRAM', () => {
  const linker = generateLinkerScript(stm32f2xxProfiles[0]);

  assert.match(linker, /FLASH \(rx\)\s*: ORIGIN = 0x08000000, LENGTH = 1024K/);
  assert.match(linker, /RAM \(rw\)\s*: ORIGIN = 0x20000000, LENGTH = 128K/);
  assert.match(linker, /CCM \(rw\)\s*: ORIGIN = 0x10000000, LENGTH = 64K/);
});

test('the F2 toolchain file targets Cortex-M3 without FPU flags', () => {
  const toolchain = generateToolchainFile(stm32f2xxProfiles[0]);

  assert.match(toolchain, /set\(TARGET_FLAGS "-mcpu=cortex-m3 -mthumb"\)/);
  assert.doesNotMatch(toolchain, /-mfpu=|-mfloat-abi=/);
});
