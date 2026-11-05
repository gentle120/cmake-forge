import { createStm32L1Profile, stm32l151xbInterruptHandlers } from './l1Factory';

export const STM32L151RBT6 = createStm32L1Profile(
  'STM32L151RBT6',
  'STM32L151RBT6.ld',
  'STM32L151xB',
  { flashLength: 128 * 1024, ramLength: 16 * 1024, interruptHandlers: stm32l151xbInterruptHandlers }
);
