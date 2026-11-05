import { createStm32U5Profile, stm32u585InterruptHandlers } from './common';

export const STM32U585RIT6 = createStm32U5Profile(
  'STM32U585RIT6',
  'STM32U585RIT6.ld',
  {
    define: 'STM32U585xx',
    flashLength: 2048 * 1024,
    gnuStartupFileName: 'startup_stm32u585xx.S',
    interruptHandlers: stm32u585InterruptHandlers
  }
);
