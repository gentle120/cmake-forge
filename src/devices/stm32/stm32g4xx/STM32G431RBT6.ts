import { createStm32G4Profile, stm32g431InterruptHandlers } from './g4Factory';

export const STM32G431RBT6 = createStm32G4Profile('STM32G431RBT6', 128 * 1024, 'STM32G431RBT6.ld', {
  define: 'STM32G431xx',
  ramLength: 22 * 1024,
  additionalMemory: [
    { name: 'CCMSRAM', attributes: 'rw', origin: 0x10000000, length: 10 * 1024 }
  ],
  gnuStartupFileName: 'startup_stm32g431xx.S',
  interruptHandlers: stm32g431InterruptHandlers
});
