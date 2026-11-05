import type { DeviceProfile } from '../../deviceProfiles';
import { STM32L031C6T6 } from './STM32L031C6T6';
import { STM32L053C8T6 } from './STM32L053C8T6';
import { STM32L053R8T6 } from './STM32L053R8T6';
import { STM32L071RBT6 } from './STM32L071RBT6';
import { STM32L073RBT6 } from './STM32L073RBT6';
import { STM32L073VBT6 } from './STM32L073VBT6';

export const stm32l0xxProfiles: DeviceProfile[] = [
  STM32L031C6T6, STM32L053C8T6, STM32L053R8T6, STM32L071RBT6, STM32L073RBT6, STM32L073VBT6
];
