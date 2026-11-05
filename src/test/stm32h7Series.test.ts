import assert from 'node:assert/strict';
import test from 'node:test';
import { stm32h7xxProfiles } from '../devices/stm32/stm32h7xx';
import {
  stm32h723InterruptHandlers,
  stm32h743InterruptHandlers,
  stm32h750InterruptHandlers
} from '../devices/stm32/stm32h7xx/h7Factory';
import { validateDeviceProfile } from '../devices/profileValidation';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';

const [, h743vi, h743zi, h750vb] = stm32h7xxProfiles;

test('provides valid H7 profiles that survive profile registry validation', () => {
  assert.deepEqual(
    stm32h7xxProfiles.map((profile) => profile.part),
    ['STM32H723ZGT6', 'STM32H743VIT6', 'STM32H743ZIT6', 'STM32H750VBT6']
  );

  for (const profile of stm32h7xxProfiles) {
    validateDeviceProfile(profile);
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'H7x');
    assert.equal(profile.family, 'STM32H7xx');
    assert.equal(profile.core, 'cortex-m7');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.equal(profile.flash.origin, 0x08000000);
    // DTCM is the main RAM on every H7 part.
    assert.equal(profile.ram.origin, 0x20000000);
    assert.equal(profile.ram.length, 128 * 1024);
    assert.equal(profile.toolchainFileName, 'stm32h7-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32h7x');
  }
});

test('uses the per-density ST defines, startup files, and flash sizes', () => {
  const [h723zg] = stm32h7xxProfiles;

  assert.deepEqual(h723zg.defines, ['STM32H723xx']);
  assert.deepEqual(h743vi.defines, ['STM32H743xx']);
  assert.deepEqual(h743zi.defines, ['STM32H743xx']);
  assert.deepEqual(h750vb.defines, ['STM32H750xx']);
  assert.equal(h723zg.gnuStartupFileName, 'startup_stm32h723xx.S');
  assert.equal(h743vi.gnuStartupFileName, 'startup_stm32h743xx.S');
  assert.equal(h743zi.gnuStartupFileName, 'startup_stm32h743xx.S');
  assert.equal(h750vb.gnuStartupFileName, 'startup_stm32h750xx.S');
  assert.equal(h723zg.flash.length, 1024 * 1024);
  assert.equal(h743vi.flash.length, 2048 * 1024);
  assert.equal(h743zi.flash.length, 2048 * 1024);
  assert.equal(h750vb.flash.length, 128 * 1024);
});

test('keeps the H743 D1/D2/D3 banks and ITCM as additional regions', () => {
  assert.deepEqual(h743zi.additionalMemory, [
    { name: 'RAM_D1', attributes: 'rw', origin: 0x24000000, length: 512 * 1024 },
    { name: 'RAM_D2', attributes: 'rw', origin: 0x30000000, length: 288 * 1024 },
    { name: 'RAM_D3', attributes: 'rw', origin: 0x38000000, length: 64 * 1024 },
    { name: 'ITCM', attributes: 'rwx', origin: 0x00000000, length: 64 * 1024 }
  ]);
  assert.deepEqual(h743vi.additionalMemory, h743zi.additionalMemory);
  assert.deepEqual(h750vb.additionalMemory, h743zi.additionalMemory);
});

test('shrinks the H723 domain banks to its die variant', () => {
  const [h723zg] = stm32h7xxProfiles;

  assert.deepEqual(h723zg.additionalMemory, [
    { name: 'RAM_D1', attributes: 'rw', origin: 0x24000000, length: 320 * 1024 },
    { name: 'RAM_D2', attributes: 'rw', origin: 0x30000000, length: 32 * 1024 },
    { name: 'RAM_D3', attributes: 'rw', origin: 0x38000000, length: 16 * 1024 },
    { name: 'ITCM', attributes: 'rwx', origin: 0x00000000, length: 64 * 1024 }
  ]);
});

test('transcribes the H743 vector table with reserved ST slots', () => {
  // IRQ n is entry n of the external section, which follows the 16 core slots.
  assert.equal(stm32h743InterruptHandlers.length, 150);
  assert.equal(stm32h743InterruptHandlers[0], 'WWDG_IRQHandler');
  assert.equal(stm32h743InterruptHandlers[23], 'EXTI9_5_IRQHandler');
  assert.equal(stm32h743InterruptHandlers[42], '0');
  assert.equal(stm32h743InterruptHandlers[43], 'TIM8_BRK_TIM12_IRQHandler');
  assert.equal(stm32h743InterruptHandlers[61], 'ETH_IRQHandler');
  assert.equal(stm32h743InterruptHandlers[63], 'FDCAN_CAL_IRQHandler');
  assert.deepEqual(stm32h743InterruptHandlers.slice(64, 68), ['0', '0', '0', '0']);
  assert.equal(stm32h743InterruptHandlers[68], 'DMA2_Stream5_IRQHandler');
  assert.equal(stm32h743InterruptHandlers[78], 'DCMI_IRQHandler');
  assert.equal(stm32h743InterruptHandlers[79], '0');
  assert.equal(stm32h743InterruptHandlers[80], 'RNG_IRQHandler');
  assert.equal(stm32h743InterruptHandlers[81], 'FPU_IRQHandler');
  assert.equal(stm32h743InterruptHandlers[103], 'HRTIM1_Master_IRQHandler');
  assert.equal(stm32h743InterruptHandlers[122], 'MDMA_IRQHandler');
  assert.equal(stm32h743InterruptHandlers[123], '0');
  assert.equal(stm32h743InterruptHandlers[125], 'HSEM1_IRQHandler');
  assert.equal(stm32h743InterruptHandlers[126], '0');
  assert.equal(stm32h743InterruptHandlers[149], 'WAKEUP_PIN_IRQHandler');
});

test('wires the H750 crypto slots where the H743 reserves', () => {
  assert.equal(stm32h750InterruptHandlers.length, 150);
  assert.equal(stm32h750InterruptHandlers[79], 'CRYP_IRQHandler');
  assert.equal(stm32h750InterruptHandlers[80], 'HASH_RNG_IRQHandler');

  const changed = stm32h743InterruptHandlers.filter(
    (handler, irq) => handler !== stm32h750InterruptHandlers[irq]
  );
  assert.deepEqual(changed, ['0', 'RNG_IRQHandler']);
});

test('transcribes the H723 vector table with its die-specific slots', () => {
  assert.equal(stm32h723InterruptHandlers.length, 163);
  assert.equal(stm32h723InterruptHandlers[77], 'OTG_HS_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[78], 'DCMI_PSSI_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[79], '0');
  assert.equal(stm32h723InterruptHandlers[80], 'RNG_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[91], '0');
  assert.equal(stm32h723InterruptHandlers[92], 'OCTOSPI1_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[102], 'DMAMUX1_OVR_IRQHandler');
  // IRQ 103-109 stay reserved where the H743 places HRTIM1.
  assert.deepEqual(stm32h723InterruptHandlers.slice(103, 110), [
    '0', '0', '0', '0', '0', '0', '0'
  ]);
  assert.equal(stm32h723InterruptHandlers[110], 'DFSDM1_FLT0_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[114], '0');
  assert.equal(stm32h723InterruptHandlers[115], 'SWPMI1_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[121], '0');
  assert.equal(stm32h723InterruptHandlers[122], 'MDMA_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[125], 'HSEM1_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[147], 'DTS_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[148], '0');
  assert.equal(stm32h723InterruptHandlers[149], 'WAKEUP_PIN_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[150], 'OCTOSPI2_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[153], 'FMAC_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[154], 'CORDIC_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[155], 'UART9_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[156], 'USART10_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[159], 'FDCAN3_IT0_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[161], 'TIM23_IRQHandler');
  assert.equal(stm32h723InterruptHandlers[162], 'TIM24_IRQHandler');
  // The H723 die has no SAI2, QUADSPI, JPEG, or HRTIM1 handlers.
  assert.ok(!stm32h723InterruptHandlers.includes('SAI2_IRQHandler'));
  assert.ok(!stm32h723InterruptHandlers.includes('QUADSPI_IRQHandler'));
  assert.ok(!stm32h723InterruptHandlers.includes('JPEG_IRQHandler'));
  assert.ok(!stm32h723InterruptHandlers.includes('HRTIM1_Master_IRQHandler'));
});

test('keeps named handlers unique inside each H7 table', () => {
  for (const table of [
    stm32h743InterruptHandlers,
    stm32h750InterruptHandlers,
    stm32h723InterruptHandlers
  ]) {
    const named = table.filter((handler) => handler !== '0');
    assert.equal(new Set(named).size, named.length);
  }
});

test('generates a Cortex-M7 H743 startup with the ST H7 handlers', () => {
  const startup = generateGnuStartup(h743zi);

  assert.match(startup, /\.cpu cortex-m7/);
  assert.match(startup, /\.thumb/);
  // H7-specific handlers stay reachable through weak aliases.
  assert.match(startup, /\.weak HSEM1_IRQHandler/);
  assert.match(startup, /\.thumb_set HSEM1_IRQHandler, Default_Handler/);
  assert.match(startup, /\.weak MDMA_IRQHandler/);
  assert.match(startup, /\.weak HRTIM1_Master_IRQHandler/);
  // The external section plus the 16 core slots fill the table.
  const entries = vectorEntries(startup);
  assert.equal(entries.length, 166);
  assert.equal(entries[16 + 125], 'HSEM1_IRQHandler');
  assert.equal(entries[16 + 149], 'WAKEUP_PIN_IRQHandler');
  // Reserved ST slots stay zero instead of pointing at handlers.
  assert.equal(entries[16 + 42], '0');
  assert.equal(entries[16 + 79], '0');
});

test('generates the H723 startup without the absent peripherals', () => {
  const [h723zg] = stm32h7xxProfiles;
  const startup = generateGnuStartup(h723zg);

  assert.match(startup, /\.weak DCMI_PSSI_IRQHandler/);
  assert.match(startup, /\.weak OCTOSPI2_IRQHandler/);
  assert.match(startup, /\.weak TIM24_IRQHandler/);
  assert.doesNotMatch(startup, /HRTIM1|JPEG_IRQHandler|SAI2_IRQHandler|QUADSPI_IRQHandler/);
  const entries = vectorEntries(startup);
  assert.equal(entries.length, 179);
  assert.equal(entries[16 + 92], 'OCTOSPI1_IRQHandler');
  assert.equal(entries[16 + 162], 'TIM24_IRQHandler');
});

test('generates double-precision hard-float flags in the H7 toolchain file', () => {
  const toolchain = generateToolchainFile(h743zi);

  assert.match(toolchain, /arm-none-eabi-gcc/);
  assert.match(
    toolchain,
    /set\(TARGET_FLAGS "-mcpu=cortex-m7 -mthumb -mfpu=fpv5-d16 -mfloat-abi=hard"\)/
  );
  // The H7 doubles are DP-FPU; the single-precision flag would be wrong.
  assert.doesNotMatch(toolchain, /fpv5-sp-d16|fpv4-sp-d16/);
  assert.match(toolchain, /STM32H743ZIT6\.ld/);
  assert.match(toolchain, /--specs=nano\.specs/);
});

test('generates the H743 memory map with the D1/D2/D3 banks and ITCM', () => {
  const linker = generateLinkerScript(h743zi);

  assert.match(linker, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 2048K/s);
  // RAM is DTCM.
  assert.match(linker, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 128K/s);
  assert.match(linker, /RAM_D1 \(rw\) : ORIGIN = 0x24000000, LENGTH = 512K/);
  assert.match(linker, /RAM_D2 \(rw\) : ORIGIN = 0x30000000, LENGTH = 288K/);
  assert.match(linker, /RAM_D3 \(rw\) : ORIGIN = 0x38000000, LENGTH = 64K/);
  assert.match(linker, /ITCM \(rwx\) : ORIGIN = 0x00000000, LENGTH = 64K/);
});

test('generates the H750 memory map with its 128K flash', () => {
  const linker = generateLinkerScript(h750vb);

  assert.match(linker, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 128K/s);
  assert.match(linker, /RAM_D1 \(rw\) : ORIGIN = 0x24000000, LENGTH = 512K/);
});

test('generates the H723 memory map with the reduced domain banks', () => {
  const [h723zg] = stm32h7xxProfiles;
  const linker = generateLinkerScript(h723zg);

  assert.match(linker, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 1024K/s);
  assert.match(linker, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 128K/s);
  assert.match(linker, /RAM_D1 \(rw\) : ORIGIN = 0x24000000, LENGTH = 320K/);
  assert.match(linker, /RAM_D2 \(rw\) : ORIGIN = 0x30000000, LENGTH = 32K/);
  assert.match(linker, /RAM_D3 \(rw\) : ORIGIN = 0x38000000, LENGTH = 16K/);
  assert.match(linker, /ITCM \(rwx\) : ORIGIN = 0x00000000, LENGTH = 64K/);
});

/** Reads the vector table entries in declaration order. */
function vectorEntries(startup: string): string[] {
  const body = startup.match(/__Vectors:\n([\s\S]*?)\n\.size __Vectors/)?.[1] ?? '';
  return body
    .split('\n')
    .map((line) => line.trim().replace(/^\.word\s+/, ''))
    .filter((entry) => entry.length > 0);
}
