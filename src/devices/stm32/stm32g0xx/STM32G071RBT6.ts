import { createStm32G0Profile } from './g0Factory';

export const STM32G071RBT6 = createStm32G0Profile('STM32G071RBT6', 128 * 1024, 'STM32G071RBT6.ld', { ramLength: 36 * 1024 });
