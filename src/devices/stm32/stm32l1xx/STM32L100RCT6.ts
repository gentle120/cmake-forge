import { createStm32L1Profile, stm32l100xcInterruptHandlers } from './l1Factory';

export const STM32L100RCT6 = createStm32L1Profile(
  'STM32L100RCT6',
  'STM32L100RCT6.ld',
  'STM32L100xC',
  { flashLength: 256 * 1024, ramLength: 32 * 1024, interruptHandlers: stm32l100xcInterruptHandlers }
);
