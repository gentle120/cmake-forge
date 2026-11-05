import { createStm32F0Profile, stm32f072xbInterruptHandlers } from './common';

export const STM32F072CBT6 = createStm32F0Profile(
  'STM32F072CBT6',
  128 * 1024,
  'STM32F072CBT6.ld',
  {
    define: 'STM32F072xB',
    ramLength: 16 * 1024,
    gnuStartupFileName: 'startup_stm32f072xb.S',
    interruptHandlers: stm32f072xbInterruptHandlers
  }
);
