import assert from 'node:assert/strict';
import test from 'node:test';
import { createGd32F1Profile } from '../devices/gd32/common';

test('derives the GD32 linker filename from the part number', () => {
  const profile = createGd32F1Profile('GD32F103C8T6');

  assert.equal(profile.linkerFileName, 'GD32F103C8T6.ld');
});
