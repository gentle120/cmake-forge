import { createStm32G4Profile } from './g4Factory';

export const STM32G474RET6 = createStm32G4Profile('STM32G474RET6', 512 * 1024, 'STM32G474RET6.ld', {
  define: 'STM32G474xx'
});
