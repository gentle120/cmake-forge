import type { DeviceProfile } from '../../deviceProfiles';
import { STM32G030F6P6 } from './STM32G030F6P6';
import { STM32G041RBT6 } from './STM32G041RBT6';
import { STM32G071R8T6 } from './STM32G071R8T6';
import { STM32G071RBT6 } from './STM32G071RBT6';
import { STM32G0B1RBT6 } from './STM32G0B1RBT6';

export const stm32g0xxProfiles: DeviceProfile[] = [
  STM32G030F6P6, STM32G041RBT6, STM32G071R8T6, STM32G071RBT6, STM32G0B1RBT6
];
