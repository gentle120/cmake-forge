import { createStm32F2Profile, stm32f217InterruptHandlers } from './common';

export const STM32F217VGT6 = createStm32F2Profile(
  'STM32F217VGT6',
  'STM32F217VGT6.ld',
  {
    define: 'STM32F217xx',
    gnuStartupFileName: 'startup_stm32f217xx.S',
    interruptHandlers: stm32f217InterruptHandlers
  }
);
