import { createStm32U5Profile, stm32u575InterruptHandlers } from './common';

export const STM32U575VGT6 = createStm32U5Profile(
  'STM32U575VGT6',
  'STM32U575VGT6.ld',
  {
    define: 'STM32U575xx',
    flashLength: 1024 * 1024,
    gnuStartupFileName: 'startup_stm32u575xx.S',
    interruptHandlers: stm32u575InterruptHandlers
  }
);
