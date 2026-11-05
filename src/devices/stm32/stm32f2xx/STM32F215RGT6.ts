import { createStm32F2Profile, stm32f215InterruptHandlers } from './common';

export const STM32F215RGT6 = createStm32F2Profile(
  'STM32F215RGT6',
  'STM32F215RGT6.ld',
  {
    define: 'STM32F215xx',
    gnuStartupFileName: 'startup_stm32f215xx.S',
    interruptHandlers: stm32f215InterruptHandlers
  }
);
