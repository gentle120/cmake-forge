import { createStm32F7Profile, stm32f746InterruptHandlers } from './common';

// RM0385: DTCM 64K @ 0x20000000, SRAM1 240K @ 0x20010000 plus SRAM2 16K
// contiguous, ITCM 16K @ 0x00000000.
export const STM32F746VET6 = createStm32F7Profile(
  'STM32F746VET6',
  'STM32F746VET6.ld',
  {
    define: 'STM32F746xx',
    flashLength: 512 * 1024,
    ramLength: 64 * 1024,
    additionalMemory: [
      { name: 'SRAM', attributes: 'rw', origin: 0x20010000, length: 256 * 1024 },
      { name: 'ITCM', attributes: 'rwx', origin: 0x00000000, length: 16 * 1024 }
    ],
    gnuStartupFileName: 'startup_stm32f746xx.S',
    interruptHandlers: stm32f746InterruptHandlers
  }
);
