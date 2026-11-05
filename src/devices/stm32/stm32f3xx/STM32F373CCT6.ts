import { createStm32F3Profile, stm32f373InterruptHandlers } from './common';

export const STM32F373CCT6 = createStm32F3Profile(
  'STM32F373CCT6',
  'STM32F373CCT6.ld',
  {
    define: 'STM32F373xC',
    flashLength: 256 * 1024,
    ramLength: 32 * 1024,
    gnuStartupFileName: 'startup_stm32f373xc.S',
    interruptHandlers: stm32f373InterruptHandlers
  }
);
