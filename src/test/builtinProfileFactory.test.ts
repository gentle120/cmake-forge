import assert from 'node:assert/strict';
import test from 'node:test';
import { createStm32F1Profile } from '../devices/stm32/common';

test('derives a built-in linker filename from the selected part', () => {
  const profile = createStm32F1Profile('STM32F103ZET6');

  assert.equal(profile.linkerFileName, 'STM32F103ZET6.ld');
});
