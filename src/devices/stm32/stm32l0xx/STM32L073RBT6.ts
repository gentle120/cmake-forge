import { createStm32L0Profile, stm32l0ExtendedInterruptHandlers } from './l0Factory';

export const STM32L073RBT6 = createStm32L0Profile(
  'STM32L073RBT6',
  128 * 1024,
  'STM32L073RBT6.ld',
  {
    define: 'STM32L073xx',
    ramLength: 20 * 1024,
    gnuStartupFileName: 'startup_stm32l073xx.S',
    interruptHandlers: stm32l0ExtendedInterruptHandlers
  }
);
