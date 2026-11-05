import { createStm32H7Profile, stm32h723InterruptHandlers } from './h7Factory';

export const STM32H723ZGT6 = createStm32H7Profile(
  'STM32H723ZGT6',
  'STM32H723ZGT6.ld',
  'STM32H723xx',
  {
    flashLength: 1024 * 1024,
    interruptHandlers: stm32h723InterruptHandlers,
    additionalMemory: [
      { name: 'RAM_D1', attributes: 'rw', origin: 0x24000000, length: 320 * 1024 },
      { name: 'RAM_D2', attributes: 'rw', origin: 0x30000000, length: 32 * 1024 },
      { name: 'RAM_D3', attributes: 'rw', origin: 0x38000000, length: 16 * 1024 },
      { name: 'ITCM', attributes: 'rwx', origin: 0x00000000, length: 64 * 1024 }
    ]
  }
);
