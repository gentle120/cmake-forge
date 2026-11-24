import assert from 'node:assert/strict';
import test from 'node:test';
import { suggestTargetForChip } from '../flash/chipTargets';
import type { ChipIdentity } from '../flash/openocdDirect';

function identity(overrides: ChipIdentity): ChipIdentity {
  return { cpuid: 0x410fc241, core: 'Cortex-M4', ...overrides };
}

test('maps an STM32L4 DEV_ID to the L4 target', () => {
  const target = suggestTargetForChip(identity({ deviceId: 0x461, family: 'STM32L4x' }));
  assert.equal(target?.id, 'stm32l4xx');
  assert.equal(target?.targetConfig, 'target/stm32l4x.cfg');
});

test('maps the common STM32 families', () => {
  const cases: Array<[number, string]> = [
    [0x410, 'stm32f1xx'],
    [0x411, 'stm32f2xx'],
    [0x413, 'stm32f4xx'],
    [0x440, 'stm32f0xx'],
    [0x449, 'stm32f7xx'],
    [0x450, 'stm32h7xx'],
    [0x456, 'stm32g0xx'],
    [0x468, 'stm32g4xx'],
    [0x472, 'stm32l5xx'],
    [0x495, 'stm32wbxx']
  ];
  for (const [deviceId, id] of cases) {
    assert.equal(suggestTargetForChip(identity({ deviceId }))?.id, id, `DEV_ID 0x${deviceId.toString(16)}`);
  }
});

test('keeps the caller target when the DEV_ID is unknown or absent', () => {
  assert.equal(suggestTargetForChip(identity({ deviceId: 0x777 })), undefined);
  assert.equal(suggestTargetForChip(identity({})), undefined);
});

test('ignores the revision bits above the 12-bit device id', () => {
  const target = suggestTargetForChip(identity({ deviceId: 0x461 }));
  assert.equal(target?.id, 'stm32l4xx');
});
