import { createStm32L0Profile, stm32l0ShortInterruptHandlers } from './l0Factory';

export const STM32L031C6T6 = createStm32L0Profile(
  'STM32L031C6T6',
  32 * 1024,
  'STM32L031C6T6.ld',
  {
    define: 'STM32L031xx',
    ramLength: 8 * 1024,
    gnuStartupFileName: 'startup_stm32l031xx.S',
    interruptHandlers: stm32l0ShortInterruptHandlers
  }
);
