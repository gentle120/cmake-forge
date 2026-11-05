import assert from 'node:assert/strict';
import test from 'node:test';
import { STM32WL55CCU6 } from '../devices/stm32/stm32wlxx/STM32WL55CCU6';
import { STM32WL55CEU6 } from '../devices/stm32/stm32wlxx/STM32WL55CEU6';
import { stm32wlxxProfiles } from '../devices/stm32/stm32wlxx';
import { stm32wlInterruptHandlers } from '../devices/stm32/stm32wlxx/wlFactory';
import { validateDeviceProfile } from '../devices/profileValidation';
import { generateGnuStartup } from '../generator/startupGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';

test('describes the STM32WL55 profiles for the M4 application core', () => {
  assert.equal(STM32WL55CCU6.vendor, 'STM');
  assert.equal(STM32WL55CCU6.series, 'WLx');
  assert.equal(STM32WL55CCU6.family, 'STM32WLxx');
  assert.equal(STM32WL55CCU6.core, 'cortex-m4');
  assert.deepEqual(STM32WL55CCU6.compilerFlags, ['-mcpu=cortex-m4', '-mthumb']);
  assert.deepEqual(STM32WL55CCU6.defines, ['STM32WL55xx']);
  assert.equal(STM32WL55CCU6.flash.origin, 0x08000000);
  assert.equal(STM32WL55CCU6.flash.length, 256 * 1024);
  assert.equal(STM32WL55CCU6.ram.origin, 0x20000000);
  assert.equal(STM32WL55CCU6.ram.length, 64 * 1024);
  assert.equal(STM32WL55CCU6.gnuStartupFileName, 'startup_stm32wl55xx.S');
  assert.equal(STM32WL55CCU6.toolchainFileName, 'stm32wl-toolchain.cmake');
  assert.equal(STM32WL55CCU6.debugTarget, 'stm32wlx');
  assert.equal(STM32WL55CEU6.flash.length, 512 * 1024);
  assert.equal(STM32WL55CEU6.ram.length, 64 * 1024);
  assert.deepEqual(STM32WL55CEU6.defines, ['STM32WL55xx']);
  assert.deepEqual(
    stm32wlxxProfiles.map((profile) => profile.part),
    ['STM32WL55CCU6', 'STM32WL55CEU6']
  );
});

test('keeps the WL55 vector table at the 62 dual-core external interrupts', () => {
  assert.equal(stm32wlInterruptHandlers.length, 62);
  assert.equal(stm32wlInterruptHandlers[0], 'WWDG_IRQHandler');
  assert.equal(stm32wlInterruptHandlers[stm32wlInterruptHandlers.length - 1], 'DMAMUX1_OVR_IRQHandler');
});

test('validates both WL55 profiles for registry exposure', () => {
  for (const profile of stm32wlxxProfiles) {
    assert.doesNotThrow(() => validateDeviceProfile(profile));
  }
});

test('generates the WL55 startup table with the radio and IPCC handlers', () => {
  const startup = generateGnuStartup(STM32WL55CCU6);

  assert.match(startup, /\.cpu cortex-m4/);
  assert.match(startup, /\.word SUBGHZ_Radio_IRQHandler/);
  assert.match(startup, /\.weak SUBGHZ_Radio_IRQHandler/);
  assert.match(startup, /\.word TAMP_STAMP_LSECSS_SSRU_IRQHandler/);
  assert.match(startup, /\.word C2SEV_PWR_C2H_IRQHandler/);
  assert.match(startup, /\.word IPCC_C1_RX_IRQHandler/);
  assert.match(startup, /\.weak DMAMUX1_OVR_IRQHandler/);
  // The single-core vector table of other series must not leak into WL.
  assert.doesNotMatch(startup, /FPU_IRQHandler|ETH_IRQHandler|OTG_FS_IRQHandler|QUADSPI_IRQHandler|USBWakeUp_IRQHandler|CAN2_TX_IRQHandler/);
});

test('keeps the Cortex-M4 WL toolchain flags free of floating-point ABI flags', () => {
  const toolchain = generateToolchainFile(STM32WL55CCU6);

  assert.match(toolchain, /set\(TARGET_FLAGS "-mcpu=cortex-m4 -mthumb"\)/);
  assert.doesNotMatch(toolchain, /-mfpu=|-mfloat-abi=/);
  assert.match(toolchain, /STM32WL55CCU6\.ld/);
});

test('generates the two WL55 flash densities over the shared 64K RAM', () => {
  const ccu6 = generateLinkerScript(STM32WL55CCU6);
  const ceu6 = generateLinkerScript(STM32WL55CEU6);

  assert.match(ccu6, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 256K/s);
  assert.match(ccu6, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 64K/s);
  assert.match(ceu6, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 512K/s);
  assert.match(ceu6, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 64K/s);
  // SRAM1/SRAM2 are contiguous on the WL55, so no extra memory region is emitted.
  assert.doesNotMatch(ccu6, /RAM2|CCMRAM|SRAM2/);
});
