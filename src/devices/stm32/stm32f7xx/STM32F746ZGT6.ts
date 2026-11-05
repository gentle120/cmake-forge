import { createStm32F7Profile, stm32f746InterruptHandlers } from './common';

export const STM32F746ZGT6 = createStm32F7Profile(
  'STM32F746ZGT6',
  'STM32F746ZGT6.ld',
  {
    define: 'STM32F746xx',
    flashLength: 1024 * 1024,
    ramLength: 64 * 1024,
    additionalMemory: [
      { name: 'SRAM', attributes: 'rw', origin: 0x20010000, length: 256 * 1024 },
      { name: 'ITCM', attributes: 'rwx', origin: 0x00000000, length: 16 * 1024 }
    ],
    gnuStartupFileName: 'startup_stm32f746xx.S',
    interruptHandlers: stm32f746InterruptHandlers
  }
);
