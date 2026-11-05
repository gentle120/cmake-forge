import { createStm32F0Profile, stm32f091xcInterruptHandlers } from './common';

export const STM32F091RCT6 = createStm32F0Profile(
  'STM32F091RCT6',
  256 * 1024,
  'STM32F091RCT6.ld',
  {
    define: 'STM32F091xC',
    ramLength: 32 * 1024,
    gnuStartupFileName: 'startup_stm32f091xc.S',
    interruptHandlers: stm32f091xcInterruptHandlers
  }
);
