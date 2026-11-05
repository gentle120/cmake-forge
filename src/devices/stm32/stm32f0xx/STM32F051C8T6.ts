import { createStm32F0Profile, stm32f051x8InterruptHandlers } from './common';

export const STM32F051C8T6 = createStm32F0Profile(
  'STM32F051C8T6',
  64 * 1024,
  'STM32F051C8T6.ld',
  {
    define: 'STM32F051x8',
    gnuStartupFileName: 'startup_stm32f051x8.S',
    interruptHandlers: stm32f051x8InterruptHandlers
  }
);
