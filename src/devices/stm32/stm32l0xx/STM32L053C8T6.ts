import { createStm32L0Profile, stm32l0ShortInterruptHandlers } from './l0Factory';

export const STM32L053C8T6 = createStm32L0Profile(
  'STM32L053C8T6',
  64 * 1024,
  'STM32L053C8T6.ld',
  {
    define: 'STM32L053xx',
    ramLength: 8 * 1024,
    gnuStartupFileName: 'startup_stm32l053xx.S',
    interruptHandlers: stm32l0ShortInterruptHandlers
  }
);
