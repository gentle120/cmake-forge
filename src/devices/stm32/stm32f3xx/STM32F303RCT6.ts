import { createStm32F3Profile, stm32f303InterruptHandlers } from './common';

export const STM32F303RCT6 = createStm32F3Profile(
  'STM32F303RCT6',
  'STM32F303RCT6.ld',
  {
    define: 'STM32F303xC',
    flashLength: 256 * 1024,
    ramLength: 40 * 1024,
    additionalMemory: [
      { name: 'CCMRAM', attributes: 'rw', origin: 0x10000000, length: 8 * 1024 }
    ],
    gnuStartupFileName: 'startup_stm32f303xc.S',
    interruptHandlers: stm32f303InterruptHandlers
  }
);
