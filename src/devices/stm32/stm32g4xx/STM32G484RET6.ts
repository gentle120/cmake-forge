import { createStm32G4Profile } from './g4Factory';

export const STM32G484RET6 = createStm32G4Profile('STM32G484RET6', 512 * 1024, 'STM32G484RET6.ld', {
  define: 'STM32G484xx'
});
