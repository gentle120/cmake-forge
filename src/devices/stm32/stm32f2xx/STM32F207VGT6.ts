import { createStm32F2Profile, stm32f207InterruptHandlers } from './common';

export const STM32F207VGT6 = createStm32F2Profile(
  'STM32F207VGT6',
  'STM32F207VGT6.ld',
  {
    define: 'STM32F207xx',
    gnuStartupFileName: 'startup_stm32f207xx.S',
    interruptHandlers: stm32f207InterruptHandlers
  }
);
