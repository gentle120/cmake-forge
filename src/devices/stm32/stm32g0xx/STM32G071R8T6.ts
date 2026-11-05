import { createStm32G0Profile } from './g0Factory';

export const STM32G071R8T6 = createStm32G0Profile('STM32G071R8T6', 64 * 1024, 'STM32G071R8T6.ld', { ramLength: 36 * 1024 });
