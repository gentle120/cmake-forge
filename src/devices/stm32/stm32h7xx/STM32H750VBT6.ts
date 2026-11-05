import { createStm32H7Profile, stm32h750InterruptHandlers } from './h7Factory';

export const STM32H750VBT6 = createStm32H7Profile(
  'STM32H750VBT6',
  'STM32H750VBT6.ld',
  'STM32H750xx',
  {
    flashLength: 128 * 1024,
    interruptHandlers: stm32h750InterruptHandlers
  }
);
