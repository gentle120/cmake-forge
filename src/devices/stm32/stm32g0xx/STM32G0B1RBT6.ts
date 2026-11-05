import { createStm32G0Profile } from './g0Factory';

export const STM32G0B1RBT6 = createStm32G0Profile('STM32G0B1RBT6', 128 * 1024, 'STM32G0B1RBT6.ld', { ramLength: 144 * 1024 });
