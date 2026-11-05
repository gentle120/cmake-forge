import { createStm32L5Profile, stm32l562InterruptHandlers } from './l5Factory';

export const STM32L562ZET6 = createStm32L5Profile(
  'STM32L562ZET6',
  'STM32L562ZET6.ld',
  'STM32L562xx',
  { flashLength: 512 * 1024, interruptHandlers: stm32l562InterruptHandlers }
);
