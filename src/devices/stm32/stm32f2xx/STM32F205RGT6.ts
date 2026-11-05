import { createStm32F2Profile, stm32f205InterruptHandlers } from './common';

export const STM32F205RGT6 = createStm32F2Profile(
  'STM32F205RGT6',
  'STM32F205RGT6.ld',
  {
    define: 'STM32F205xx',
    gnuStartupFileName: 'startup_stm32f205xx.S',
    interruptHandlers: stm32f205InterruptHandlers
  }
);
