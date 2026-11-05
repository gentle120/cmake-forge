import { createStm32G4Profile } from './g4Factory';

// The G473 has no G flash density in the ST part numbering (the G4 tops out at
// E = 512K), so the requested G473RGT6 maps onto the G473RET6.
export const STM32G473RET6 = createStm32G4Profile('STM32G473RET6', 512 * 1024, 'STM32G473RET6.ld', {
  define: 'STM32G473xx'
});
