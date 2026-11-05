import { createStm32F0Profile, stm32f031x6InterruptHandlers } from './common';

export const STM32F031C6T6 = createStm32F0Profile(
  'STM32F031C6T6',
  32 * 1024,
  'STM32F031C6T6.ld',
  {
    define: 'STM32F031x6',
    ramLength: 4 * 1024,
    gnuStartupFileName: 'startup_stm32f031x6.S',
    interruptHandlers: stm32f031x6InterruptHandlers
  }
);
