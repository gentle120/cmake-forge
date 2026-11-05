import { createStm32WlProfile } from './wlFactory';

export const STM32WL55CEU6 = createStm32WlProfile('STM32WL55CEU6', 'STM32WL55CEU6.ld', { flashLength: 512 * 1024 });
