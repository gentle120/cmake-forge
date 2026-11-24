/**
 * 把探针读到的 DBGMCU DEV_ID 翻译成 OpenOCD target。
 *
 * 芯片型号是"读出来的事实"，target cfg 是"烧录参数"；让用户手选 target 等于
 * 让人去猜一件探针已经知道的事。DEV_ID 相同的系列共用一份 cfg，因此这里只
 * 映射到系列级，未知 ID 返回 undefined 由调用方保留用户当前的目标。
 */

import type { ChipIdentity } from './openocdDirect';
import { listFlashTargetProfiles, type FlashTargetProfile } from './targets/targetProfiles';

/** STM32 DBGMCU_IDCODE 低 12 位 → flash target id（与 src/flash/targets 一致）。 */
const STM32_DEVICE_TARGETS: Record<number, string> = {
  0x410: 'stm32f1xx',
  0x411: 'stm32f2xx',
  0x412: 'stm32f1xx',
  0x413: 'stm32f4xx',
  0x414: 'stm32f1xx',
  0x415: 'stm32l4xx',
  0x416: 'stm32l1xx',
  0x417: 'stm32l0xx',
  0x418: 'stm32f1xx',
  0x419: 'stm32f4xx',
  0x420: 'stm32f1xx',
  0x421: 'stm32f4xx',
  0x422: 'stm32f3xx',
  0x423: 'stm32f4xx',
  0x427: 'stm32l1xx',
  0x428: 'stm32f1xx',
  0x429: 'stm32l1xx',
  0x430: 'stm32f1xx',
  0x431: 'stm32f4xx',
  0x432: 'stm32f3xx',
  0x433: 'stm32f4xx',
  0x434: 'stm32f4xx',
  0x435: 'stm32l4xx',
  0x436: 'stm32l1xx',
  0x437: 'stm32l1xx',
  0x438: 'stm32f3xx',
  0x439: 'stm32f3xx',
  0x440: 'stm32f0xx',
  0x441: 'stm32f4xx',
  0x442: 'stm32f0xx',
  0x444: 'stm32f0xx',
  0x445: 'stm32f0xx',
  0x446: 'stm32f3xx',
  0x447: 'stm32l0xx',
  0x448: 'stm32f0xx',
  0x449: 'stm32f7xx',
  0x450: 'stm32h7xx',
  0x451: 'stm32f7xx',
  0x452: 'stm32f7xx',
  0x456: 'stm32g0xx',
  0x458: 'stm32f4xx',
  0x460: 'stm32g0xx',
  0x461: 'stm32l4xx',
  0x462: 'stm32l4xx',
  0x463: 'stm32f4xx',
  0x464: 'stm32l4xx',
  0x466: 'stm32g0xx',
  0x467: 'stm32g0xx',
  0x468: 'stm32g4xx',
  0x469: 'stm32g4xx',
  0x470: 'stm32l4xx',
  0x472: 'stm32l5xx',
  0x479: 'stm32g4xx',
  0x480: 'stm32h7xx',
  0x482: 'stm32u5xx',
  0x483: 'stm32h7xx',
  0x484: 'stm32h7xx',
  0x495: 'stm32wbxx',
  0x496: 'stm32wlxx',
  0x497: 'stm32wlxx'
};

/**
 * Returns the flash target that owns `deviceId`, or undefined when the chip is
 * not in the table (other vendors, unlisted parts). Callers must keep their
 * current target in that case instead of guessing from the core.
 */
export function suggestTargetForChip(identity: ChipIdentity): FlashTargetProfile | undefined {
  if (identity.deviceId === undefined) {
    return undefined;
  }
  const targetId = STM32_DEVICE_TARGETS[identity.deviceId & 0xfff];
  if (!targetId) {
    return undefined;
  }
  return listFlashTargetProfiles().find((target) => target.id === targetId);
}
