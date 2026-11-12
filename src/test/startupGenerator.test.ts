import assert from 'node:assert/strict';
import test from 'node:test';
import { generateArmclangStartup, generateGnuStartup, generateStartupFile } from '../generator/startupGenerator';
import {
  fixtureDeviceProfile,
  gd32F103Profile,
  registerFixtureVendors,
  stm32F407Profile
} from './support/fixtureDevice';

registerFixtureVendors();

test('generates a GNU assembler startup file for a Pack-derived profile', () => {
  const startup = generateGnuStartup(gd32F103Profile());

  assert.match(startup, /\.section \.isr_vector/);
  assert.match(startup, /\.word _estack/);
  assert.match(startup, /\.global Reset_Handler/);
  assert.match(startup, /bl SystemInit/);
  assert.match(startup, /bl __libc_init_array/);
  // The data copy and the BSS clear run before SystemInit, as in the ST startup files.
  assert.match(startup, /ldr r0, =_sidata[\s\S]*ldr r1, =_sbss[\s\S]*bl SystemInit[\s\S]*bl __libc_init_array[\s\S]*bl main/);
  // The BSS clear cursor must advance exactly once per word.
  assert.doesNotMatch(startup, /str r3, \[r1\], #4\s*\n\s*adds r1, r1, #4/);
  assert.match(startup, /\.weak USART1_IRQHandler/);
});

test('ships a weak, typed SystemInit so a project without the vendor system file links', () => {
  const startup = generateGnuStartup(fixtureDeviceProfile());

  // binutils 2.44+ reports "Unknown destination type (ARM/Thumb)" for a call to
  // an untyped or undefined symbol, so the weak default is both defined and
  // tagged as a function; the project's own SystemInit still overrides it.
  assert.match(startup, /\.weak SystemInit/);
  assert.match(startup, /\.thumb_func\s*\n\.type SystemInit, %function/);
  assert.match(startup, /SystemInit:\s*\n\s*bx lr/);
});

test('emits Cortex-M3 assembly settings and the profile vector table', () => {
  const startup = generateGnuStartup(fixtureDeviceProfile());

  assert.match(startup, /\.cpu cortex-m3/);
  assert.match(startup, /\.word USBWakeUp_IRQHandler/);
  assert.match(startup, /\.weak USART3_IRQHandler/);
  assert.doesNotMatch(startup, /DMA1_Stream7_IRQHandler/);
});

test('emits Cortex-M4 assembly settings for Cortex-M4 profiles', () => {
  const startup = generateGnuStartup(stm32F407Profile({
    interruptHandlers: [
      'WWDG_IRQHandler', 'DMA1_Stream7_IRQHandler', 'FPU_IRQHandler'
    ]
  }));

  assert.match(startup, /\.cpu cortex-m4/);
  assert.match(startup, /\.word DMA1_Stream7_IRQHandler/);
  assert.match(startup, /\.weak FPU_IRQHandler/);
  assert.doesNotMatch(startup, /USBWakeUp_IRQHandler/);
});

test('keeps reserved vector slots as literal zeros without weak handlers', () => {
  const startup = generateGnuStartup(fixtureDeviceProfile({
    interruptHandlers: ['WWDG_IRQHandler', '0', 'RTC_IRQHandler']
  }));

  const lines = startup.split('\n').map((line) => line.trim());
  const vectorIndex = lines.findIndex((line) => line === '.word WWDG_IRQHandler');
  assert.notEqual(vectorIndex, -1);
  assert.equal(lines[vectorIndex + 1], '.word 0');
  assert.doesNotMatch(startup, /\.weak 0/);
  assert.match(startup, /\.word RTC_IRQHandler/);
});

test('uses the whole profile table for variant parts of the same series', () => {
  const startup = generateGnuStartup(fixtureDeviceProfile({
    part: 'STM32F103VBT6',
    defines: ['STM32F10X_MD'],
    linkerFileName: 'STM32F103VBT6.ld',
    gnuStartupFileName: 'startup_stm32f10x_md.S'
  }));

  assert.match(startup, /\.cpu cortex-m3/);
  assert.match(startup, /\.word DMA1_Channel7_IRQHandler/);
  assert.match(startup, /\.word USBWakeUp_IRQHandler/);
});

test('places external handlers at their table positions and keeps reserved slots empty', () => {
  // IRQ n is the (16 + n)-th entry, after the stack pointer and the reset
  // vector; a reserved slot must stay empty or every later handler would be
  // installed one interrupt too early.
  const startup = generateGnuStartup(stm32F407Profile({
    interruptHandlers: [
      'WWDG_IRQHandler', 'PVD_IRQHandler', '0', 'HASH_RNG_IRQHandler', 'FPU_IRQHandler'
    ]
  }));

  const slot = (externalIrq: number): string => vectorEntries(startup)[16 + externalIrq];
  assert.equal(slot(0), 'WWDG_IRQHandler');
  assert.equal(slot(1), 'PVD_IRQHandler');
  assert.equal(slot(2), '0');
  assert.equal(slot(3), 'HASH_RNG_IRQHandler');
  assert.equal(slot(4), 'FPU_IRQHandler');
});

/** Reads the vector table entries in declaration order. */
function vectorEntries(startup: string): string[] {
  const body = startup.match(/__Vectors:\n([\s\S]*?)\n\.size __Vectors/)?.[1] ?? '';
  return body
    .split('\n')
    .map((line) => line.trim().replace(/^\.word\s+/, ''))
    .filter((entry) => entry.length > 0);
}

test('armclang startup starts with __initial_sp and hands control to __main', () => {
  const profile = { ...fixtureDeviceProfile(), toolchainFamily: 'armclang' as const };
  const startup = generateArmclangStartup(profile);

  assert.match(startup, /\.word __initial_sp/);
  assert.match(startup, /ldr r0, =__main/);
  assert.doesNotMatch(startup, /_estack|_sidata|__libc_init_array/);
  assert.match(startup, /\.weak SystemInit/);
  assert.match(startup, /__initial_sp:/);
  // GNU startup keeps the manual data copy; the Arm C library does that instead.
  assert.doesNotMatch(startup, /_sdata|_sbss/);
});

test('LLVM clang startup keeps main but skips newlib initialization', () => {
  const profile = { ...fixtureDeviceProfile(), toolchainFamily: 'clang' as const };
  const startup = generateStartupFile(profile);
  assert.match(startup, /\.word _estack/);
  assert.match(startup, /bl SystemInit/);
  assert.match(startup, /bl main/);
  assert.doesNotMatch(startup, /__libc_init_array/);
  assert.doesNotMatch(startup, /__main/);
});
