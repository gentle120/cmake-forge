import type { DeviceProfile } from '../../deviceProfiles';
import { createStm32BuiltinProfile } from '../builtinProfileFactory';

// External IRQ sections transcribed from cmsis-device-l1
// Source/Templates/gcc startup files (IRQ 0-56 depending on density); '0'
// marks the slots ST leaves reserved. The medium-density (xB) table stops
// after TIM7 (IRQ 44); the high-density tables continue through COMP_ACQ
// (IRQ 56).
export const stm32l1BaseInterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_IRQHandler', 'TAMPER_STAMP_IRQHandler', 'RTC_WKUP_IRQHandler',
  'FLASH_IRQHandler', 'RCC_IRQHandler', 'EXTI0_IRQHandler', 'EXTI1_IRQHandler',
  'EXTI2_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler', 'DMA1_Channel1_IRQHandler',
  'DMA1_Channel2_IRQHandler', 'DMA1_Channel3_IRQHandler', 'DMA1_Channel4_IRQHandler',
  'DMA1_Channel5_IRQHandler', 'DMA1_Channel6_IRQHandler', 'DMA1_Channel7_IRQHandler',
  'ADC1_IRQHandler', 'USB_HP_IRQHandler', 'USB_LP_IRQHandler', 'DAC_IRQHandler',
  'COMP_IRQHandler', 'EXTI9_5_IRQHandler', '0', 'TIM9_IRQHandler', 'TIM10_IRQHandler',
  'TIM11_IRQHandler', 'TIM2_IRQHandler', 'TIM3_IRQHandler', 'TIM4_IRQHandler',
  'I2C1_EV_IRQHandler', 'I2C1_ER_IRQHandler', 'I2C2_EV_IRQHandler', 'I2C2_ER_IRQHandler',
  'SPI1_IRQHandler', 'SPI2_IRQHandler', 'USART1_IRQHandler', 'USART2_IRQHandler',
  'USART3_IRQHandler', 'EXTI15_10_IRQHandler', 'RTC_Alarm_IRQHandler',
  'USB_FS_WKUP_IRQHandler', 'TIM6_IRQHandler', 'TIM7_IRQHandler'
];

// The L100 value line has the LCD at IRQ 24 and no TIM5, so IRQ 45/46 stay
// reserved where the L151 exposes TIM5.
export const stm32l100xcInterruptHandlers = [
  ...stm32l1BaseInterruptHandlers.slice(0, 24),
  'LCD_IRQHandler',
  ...stm32l1BaseInterruptHandlers.slice(25),
  '0', '0', 'SPI3_IRQHandler', '0', '0',
  'DMA2_Channel1_IRQHandler', 'DMA2_Channel2_IRQHandler', 'DMA2_Channel3_IRQHandler',
  'DMA2_Channel4_IRQHandler', 'DMA2_Channel5_IRQHandler',
  '0', 'COMP_ACQ_IRQHandler'
];

export const stm32l151xbInterruptHandlers = [...stm32l1BaseInterruptHandlers];

export const stm32l151xcInterruptHandlers = [
  ...stm32l1BaseInterruptHandlers,
  '0', 'TIM5_IRQHandler', 'SPI3_IRQHandler', '0', '0',
  'DMA2_Channel1_IRQHandler', 'DMA2_Channel2_IRQHandler', 'DMA2_Channel3_IRQHandler',
  'DMA2_Channel4_IRQHandler', 'DMA2_Channel5_IRQHandler',
  '0', 'COMP_ACQ_IRQHandler'
];

// The L152 adds the LCD, UART4, and UART5 on top of the L151 high-density
// table while keeping the L151 TIM5 slot.
export const stm32l152xeInterruptHandlers = [
  ...stm32l1BaseInterruptHandlers.slice(0, 24),
  'LCD_IRQHandler',
  ...stm32l1BaseInterruptHandlers.slice(25),
  '0', 'TIM5_IRQHandler', 'SPI3_IRQHandler', 'UART4_IRQHandler', 'UART5_IRQHandler',
  'DMA2_Channel1_IRQHandler', 'DMA2_Channel2_IRQHandler', 'DMA2_Channel3_IRQHandler',
  'DMA2_Channel4_IRQHandler', 'DMA2_Channel5_IRQHandler',
  '0', 'COMP_ACQ_IRQHandler'
];

export function createStm32L1Profile(part: string): DeviceProfile {
  return createStm32BuiltinProfile(part, 'L1x', {
    stm32l100xcInterruptHandlers,
    stm32l151xbInterruptHandlers,
    stm32l151xcInterruptHandlers,
    stm32l152xeInterruptHandlers
  });
}
