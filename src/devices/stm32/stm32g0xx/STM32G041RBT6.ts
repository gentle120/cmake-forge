import { createStm32G0Profile, stm32g041InterruptHandlers } from './g0Factory';

// The G041 vector table is not the G071 default; see startup_stm32g041xx.s upstream.
export const STM32G041RBT6 = createStm32G0Profile('STM32G041RBT6', 128 * 1024, 'STM32G041RBT6.ld', {
  ramLength: 36 * 1024,
  gnuStartupFileName: 'startup_stm32g041xx.S',
  interruptHandlers: stm32g041InterruptHandlers
});
