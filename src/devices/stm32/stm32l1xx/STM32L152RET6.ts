import { createStm32L1Profile, stm32l152xeInterruptHandlers } from './l1Factory';

export const STM32L152RET6 = createStm32L1Profile(
  'STM32L152RET6',
  'STM32L152RET6.ld',
  'STM32L152xE',
  { flashLength: 512 * 1024, ramLength: 80 * 1024, interruptHandlers: stm32l152xeInterruptHandlers }
);
