import { createStm32L5Profile, stm32l552InterruptHandlers } from './l5Factory';

export const STM32L552RCT6 = createStm32L5Profile(
  'STM32L552RCT6',
  'STM32L552RCT6.ld',
  'STM32L552xx',
  { flashLength: 256 * 1024, interruptHandlers: stm32l552InterruptHandlers }
);
