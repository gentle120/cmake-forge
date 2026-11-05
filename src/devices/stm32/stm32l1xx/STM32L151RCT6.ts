import { createStm32L1Profile, stm32l151xcInterruptHandlers } from './l1Factory';

export const STM32L151RCT6 = createStm32L1Profile(
  'STM32L151RCT6',
  'STM32L151RCT6.ld',
  'STM32L151xC',
  { flashLength: 256 * 1024, ramLength: 32 * 1024, interruptHandlers: stm32l151xcInterruptHandlers }
);
