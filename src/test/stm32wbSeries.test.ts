import assert from 'node:assert/strict';
import test from 'node:test';
import type { DeviceProfile } from '../devices/deviceProfiles';
import { validateDeviceProfile } from '../devices/profileValidation';
import { stm32wbxxProfiles } from '../devices/stm32/stm32wbxx';
import { stm32wbInterruptHandlers } from '../devices/stm32/stm32wbxx/wbFactory';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';

const wbProfiles: Record<string, DeviceProfile> = Object.fromEntries(
  stm32wbxxProfiles.map((profile) => [profile.part, profile])
);
const wbParts = ['STM32WB55CEU6', 'STM32WB55CGU6', 'STM32WB55RGV6', 'STM32WB55VCT6'];
const wbCompilerFlags = ['-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard'];

test('creates the STM32WB55 Cortex-M4 profiles for every flash density', () => {
  assert.deepEqual(Object.keys(wbProfiles).sort(), wbParts);
  // C = 256K, E = 512K, G = 1M in the ST part numbering.
  const flashKilobytes: Record<string, number> = {
    STM32WB55CEU6: 512,
    STM32WB55CGU6: 1024,
    STM32WB55RGV6: 1024,
    STM32WB55VCT6: 256
  };

  for (const part of wbParts) {
    const profile = wbProfiles[part];
    assert.ok(profile, `missing WB profile ${part}`);
    assert.equal(profile.vendor, 'STM');
    assert.equal(profile.series, 'WBx');
    assert.equal(profile.family, 'STM32WBxx');
    assert.equal(profile.core, 'cortex-m4');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.deepEqual(profile.defines, ['STM32WB55xx']);
    assert.deepEqual(profile.compilerFlags, wbCompilerFlags);
    assert.deepEqual(profile.flash, { origin: 0x08000000, length: flashKilobytes[part] * 1024 });
    // SRAM1 is the application RAM; SRAM2 is shared with the BLE core and is
    // therefore not part of the linker map.
    assert.deepEqual(profile.ram, { origin: 0x20000000, length: 192 * 1024 });
    assert.equal('additionalMemory' in profile, false);
    assert.equal(profile.linkerFileName, `${part}.ld`);
    assert.equal(profile.gnuStartupFileName, 'startup_stm32wb55xx.S');
    assert.equal(profile.toolchainFileName, 'stm32wb-toolchain.cmake');
    assert.equal(profile.debugTarget, 'stm32wbx');
    assert.doesNotThrow(() => validateDeviceProfile(profile));
  }
});

test('generates the WB55 startup with WB-only handlers', () => {
  const startup = generateGnuStartup(wbProfiles['STM32WB55CEU6']);

  assert.match(startup, /\.cpu cortex-m4/);
  assert.match(startup, /\.word IPCC_C1_RX_IRQHandler/);
  assert.match(startup, /\.weak IPCC_C1_TX_IRQHandler/);
  assert.match(startup, /\.weak C2SEV_PWR_C2H_IRQHandler/);
  assert.match(startup, /\.weak PWR_SOTF_BLEACT_802ACT_RFPHASE_IRQHandler/);
  assert.match(startup, /\.weak HSEM_IRQHandler/);
  assert.match(startup, /\.weak AES2_IRQHandler/);
  assert.match(startup, /\.weak DMAMUX1_OVR_IRQHandler/);
  assert.doesNotMatch(startup, /DMA1_Stream7_IRQHandler|USB_HP_CAN1_TX_IRQHandler|DFSDM1_FLT0_IRQHandler/);
});

/** Reads the vector table entries in declaration order. */
function vectorEntries(startup: string): string[] {
  const body = startup.match(/__Vectors:\n([\s\S]*?)\n\.size __Vectors/)?.[1] ?? '';
  return body
    .split('\n')
    .map((line) => line.trim().replace(/^\.word\s+/, ''))
    .filter((entry) => entry.length > 0);
}

test('places the WB55 external handlers at their hardware IRQ numbers', () => {
  // IRQ n is the (16 + n)-th entry, after the stack pointer and the reset vector.
  const entries = vectorEntries(generateGnuStartup(wbProfiles['STM32WB55CEU6']));
  const slot = (irq: number): string => entries[16 + irq];

  // 16 core vectors + 63 WB55 external interrupts.
  assert.equal(entries.length, 79);
  assert.equal(slot(0), 'WWDG_IRQHandler');
  assert.equal(slot(21), 'C2SEV_PWR_C2H_IRQHandler');
  assert.equal(slot(43), 'PWR_SOTF_BLEACT_802ACT_RFPHASE_IRQHandler');
  assert.equal(slot(44), 'IPCC_C1_RX_IRQHandler');
  assert.equal(slot(45), 'IPCC_C1_TX_IRQHandler');
  assert.equal(slot(62), 'DMAMUX1_OVR_IRQHandler');
  // The WB55 M4 table has no reserved slots between WWDG and DMAMUX1_OVR.
  assert.equal(stm32wbInterruptHandlers.filter((handler) => handler === '0').length, 0);
});

test('uses the same verified WB55 vector table for every density', () => {
  const small = vectorEntries(generateGnuStartup(wbProfiles['STM32WB55VCT6']));
  const large = vectorEntries(generateGnuStartup(wbProfiles['STM32WB55RGV6']));

  assert.deepEqual(small, large);
});

test('generates the four WB55 linker flash densities', () => {
  const expectedFlash: Record<string, string> = {
    STM32WB55CEU6: '512K',
    STM32WB55CGU6: '1024K',
    STM32WB55RGV6: '1024K',
    STM32WB55VCT6: '256K'
  };

  for (const part of wbParts) {
    const linker = generateLinkerScript(wbProfiles[part]);

    assert.match(linker, new RegExp(`FLASH \\(rx\\).*ORIGIN = 0x08000000, LENGTH = ${expectedFlash[part]}`, 's'));
    assert.match(linker, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 192K/s);
    // SRAM2 is reserved for the BLE core, so no additional region exists.
    assert.doesNotMatch(linker, /CCMRAM|RAM2 \(rw\)/);
  }
});

test('generates the stm32wb toolchain file with hard-float M4 flags', () => {
  const toolchain = generateToolchainFile(wbProfiles['STM32WB55VCT6']);

  assert.match(toolchain, /set\(CMAKE_C_COMPILER arm-none-eabi-gcc\)/);
  assert.match(toolchain, /-mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard/);
  assert.match(toolchain, /-T\$\{CMAKE_SOURCE_DIR\}\/STM32WB55VCT6\.ld/);
});
