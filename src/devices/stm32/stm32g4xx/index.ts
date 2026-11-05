import type { DeviceProfile } from '../../deviceProfiles';
import { STM32G431CBT6 } from './STM32G431CBT6';
import { STM32G431RBT6 } from './STM32G431RBT6';
import { STM32G473RET6 } from './STM32G473RET6';
import { STM32G474RET6 } from './STM32G474RET6';
import { STM32G484RET6 } from './STM32G484RET6';

export const stm32g4xxProfiles: DeviceProfile[] = [
  STM32G431CBT6, STM32G431RBT6, STM32G473RET6, STM32G474RET6, STM32G484RET6
];
