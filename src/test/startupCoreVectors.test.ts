import assert from 'node:assert/strict';
import test from 'node:test';
import { getDeviceProfile } from '../devices/deviceProfiles';
import { generateGnuStartup } from '../generator/startupGenerator';

function vectorWords(startup: string): string[] {
  return startup
    .split('\n')
    .filter((line) => line.startsWith('  .word '))
    .map((line) => line.slice('  .word '.length));
}

test('ARMv6-M cores keep words 4-10 reserved without MemManage or DebugMon', () => {
  const startup = generateGnuStartup(getDeviceProfile('STM32F030C8T6'));
  const words = vectorWords(startup);

  assert.deepEqual(words.slice(0, 16), [
    '_estack',
    'Reset_Handler',
    'NMI_Handler',
    'HardFault_Handler',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    '0',
    'SVC_Handler',
    '0',
    '0',
    'PendSV_Handler',
    'SysTick_Handler'
  ]);
  assert.doesNotMatch(startup, /MemManage_Handler|BusFault_Handler|UsageFault_Handler|DebugMon_Handler/);
});

test('ARMv7-M cores keep four reserved words after UsageFault', () => {
  const startup = generateGnuStartup(getDeviceProfile('STM32F103C8T6'));
  const words = vectorWords(startup);

  assert.deepEqual(words.slice(0, 16), [
    '_estack',
    'Reset_Handler',
    'NMI_Handler',
    'HardFault_Handler',
    'MemManage_Handler',
    'BusFault_Handler',
    'UsageFault_Handler',
    '0',
    '0',
    '0',
    '0',
    'SVC_Handler',
    'DebugMon_Handler',
    '0',
    'PendSV_Handler',
    'SysTick_Handler'
  ]);
});

test('ARMv8-M mainline cores expose SecureFault in the first reserved slot', () => {
  const startup = generateGnuStartup(getDeviceProfile('STM32L552RCT6'));
  const words = vectorWords(startup);

  assert.deepEqual(words.slice(0, 16), [
    '_estack',
    'Reset_Handler',
    'NMI_Handler',
    'HardFault_Handler',
    'MemManage_Handler',
    'BusFault_Handler',
    'UsageFault_Handler',
    'SecureFault_Handler',
    '0',
    '0',
    '0',
    'SVC_Handler',
    'DebugMon_Handler',
    '0',
    'PendSV_Handler',
    'SysTick_Handler'
  ]);
  assert.match(startup, /\.weak SecureFault_Handler/);
  assert.match(startup, /\.thumb_set SecureFault_Handler, Default_Handler/);
});
