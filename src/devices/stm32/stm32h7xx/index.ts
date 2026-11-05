import type { DeviceProfile } from '../../deviceProfiles';
import { STM32H723ZGT6 } from './STM32H723ZGT6';
import { STM32H743VIT6 } from './STM32H743VIT6';
import { STM32H743ZIT6 } from './STM32H743ZIT6';
import { STM32H750VBT6 } from './STM32H750VBT6';

export const stm32h7xxProfiles: DeviceProfile[] = [
  STM32H723ZGT6, STM32H743VIT6, STM32H743ZIT6, STM32H750VBT6
];
