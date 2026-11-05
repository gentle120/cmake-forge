import { createStm32F7Profile, stm32f767InterruptHandlers } from './common';

// RM0410: DTCM 128K @ 0x20000000, SRAM1 368K @ 0x20020000 plus SRAM2 16K
// contiguous, ITCM 16K @ 0x00000000.
export const STM32F767ZGT6 = createStm32F7Profile(
  'STM32F767ZGT6',
  'STM32F767ZGT6.ld',
  {
    define: 'STM32F767xx',
    flashLength: 1024 * 1024,
    ramLength: 128 * 1024,
    additionalMemory: [
      { name: 'SRAM', attributes: 'rw', origin: 0x20020000, length: 384 * 1024 },
      { name: 'ITCM', attributes: 'rwx', origin: 0x00000000, length: 16 * 1024 }
    ],
    gnuStartupFileName: 'startup_stm32f767xx.S',
    interruptHandlers: stm32f767InterruptHandlers
  }
);
