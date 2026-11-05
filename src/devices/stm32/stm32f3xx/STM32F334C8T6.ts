import { createStm32F3Profile, stm32f334InterruptHandlers } from './common';

export const STM32F334C8T6 = createStm32F3Profile(
  'STM32F334C8T6',
  'STM32F334C8T6.ld',
  {
    define: 'STM32F334x8',
    flashLength: 64 * 1024,
    ramLength: 12 * 1024,
    additionalMemory: [
      { name: 'CCMRAM', attributes: 'rw', origin: 0x10000000, length: 4 * 1024 }
    ],
    gnuStartupFileName: 'startup_stm32f334x8.S',
    interruptHandlers: stm32f334InterruptHandlers
  }
);
