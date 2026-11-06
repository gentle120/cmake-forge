import type { DeviceProfile } from '../../deviceProfiles';
import { createStm32BuiltinProfile } from '../builtinProfileFactory';

// Vector tables transcribed from STMicroelectronics/cmsis-device-f2
// Source/Templates/gcc/startup_stm32f205xx.s, startup_stm32f207xx.s,
// startup_stm32f215xx.s and startup_stm32f217xx.s (master, fetched 2026-10-28).
// The four tables differ, so each density keeps its own: the connectivity
// line (F207/F217) inserts ETH (61) and ETH_WKUP (62) plus DCMI (72), and the
// crypto line (F215/F217) inserts CRYP ahead of HASH_RNG.
const stm32f2SharedInterruptHandlers = [
  // IRQ 0-54, identical across the series
  'EXTI0_IRQHandler', 'EXTI1_IRQHandler', 'EXTI2_IRQHandler', 'EXTI3_IRQHandler',
  'EXTI4_IRQHandler', 'DMA1_Stream0_IRQHandler', 'DMA1_Stream1_IRQHandler', 'DMA1_Stream2_IRQHandler',
  'DMA1_Stream3_IRQHandler', 'DMA1_Stream4_IRQHandler', 'DMA1_Stream5_IRQHandler', 'DMA1_Stream6_IRQHandler',
  'ADC_IRQHandler', 'CAN1_TX_IRQHandler', 'CAN1_RX0_IRQHandler', 'CAN1_RX1_IRQHandler',
  'CAN1_SCE_IRQHandler', 'EXTI9_5_IRQHandler', 'TIM1_BRK_TIM9_IRQHandler', 'TIM1_UP_TIM10_IRQHandler',
  'TIM1_TRG_COM_TIM11_IRQHandler', 'TIM1_CC_IRQHandler', 'TIM2_IRQHandler', 'TIM3_IRQHandler',
  'TIM4_IRQHandler', 'I2C1_EV_IRQHandler', 'I2C1_ER_IRQHandler', 'I2C2_EV_IRQHandler',
  'I2C2_ER_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler', 'USART1_IRQHandler',
  'USART2_IRQHandler', 'USART3_IRQHandler', 'EXTI15_10_IRQHandler', 'RTC_Alarm_IRQHandler',
  'OTG_FS_WKUP_IRQHandler', 'TIM8_BRK_TIM12_IRQHandler', 'TIM8_UP_TIM13_IRQHandler',
  'TIM8_TRG_COM_TIM14_IRQHandler', 'TIM8_CC_IRQHandler', 'DMA1_Stream7_IRQHandler',
  'FSMC_IRQHandler', 'SDIO_IRQHandler', 'TIM5_IRQHandler', 'SPI3_IRQHandler',
  'UART4_IRQHandler', 'UART5_IRQHandler', 'TIM6_DAC_IRQHandler', 'TIM7_IRQHandler',
  'DMA2_Stream0_IRQHandler', 'DMA2_Stream1_IRQHandler', 'DMA2_Stream2_IRQHandler',
  'DMA2_Stream3_IRQHandler', 'DMA2_Stream4_IRQHandler'
];

export const stm32f205InterruptHandlers = [
  ...stm32f2SharedInterruptHandlers,
  // IRQ 55-70 (startup_stm32f205xx.s)
  'CAN2_TX_IRQHandler', 'CAN2_RX0_IRQHandler', 'CAN2_RX1_IRQHandler', 'CAN2_SCE_IRQHandler',
  'OTG_FS_IRQHandler', 'DMA2_Stream5_IRQHandler', 'DMA2_Stream6_IRQHandler', 'DMA2_Stream7_IRQHandler',
  'USART6_IRQHandler', 'I2C3_EV_IRQHandler', 'I2C3_ER_IRQHandler', 'OTG_HS_EP1_OUT_IRQHandler',
  'OTG_HS_EP1_IN_IRQHandler', 'OTG_HS_WKUP_IRQHandler', 'OTG_HS_IRQHandler', 'HASH_RNG_IRQHandler'
];

export const stm32f207InterruptHandlers = [
  ...stm32f2SharedInterruptHandlers,
  // IRQ 55-73 (startup_stm32f207xx.s): ETH and ETH_WKUP shift CAN2 onwards
  'ETH_IRQHandler', 'ETH_WKUP_IRQHandler',
  'CAN2_TX_IRQHandler', 'CAN2_RX0_IRQHandler', 'CAN2_RX1_IRQHandler', 'CAN2_SCE_IRQHandler',
  'OTG_FS_IRQHandler', 'DMA2_Stream5_IRQHandler', 'DMA2_Stream6_IRQHandler', 'DMA2_Stream7_IRQHandler',
  'USART6_IRQHandler', 'I2C3_EV_IRQHandler', 'I2C3_ER_IRQHandler', 'OTG_HS_EP1_OUT_IRQHandler',
  'OTG_HS_EP1_IN_IRQHandler', 'OTG_HS_WKUP_IRQHandler', 'OTG_HS_IRQHandler', 'DCMI_IRQHandler',
  'HASH_RNG_IRQHandler'
];

export const stm32f215InterruptHandlers = [
  ...stm32f205InterruptHandlers.slice(0, 70),
  // The crypto line adds CRYP (IRQ 70) and moves HASH_RNG to IRQ 71.
  'CRYP_IRQHandler', 'HASH_RNG_IRQHandler'
];

export const stm32f217InterruptHandlers = [
  ...stm32f207InterruptHandlers.slice(0, 73),
  // The F217 combines the connectivity and crypto tables.
  'CRYP_IRQHandler', 'HASH_RNG_IRQHandler'
];

export function createStm32F2Profile(part: string): DeviceProfile {
  return createStm32BuiltinProfile(part, 'F2x', {
    stm32f205InterruptHandlers,
    stm32f207InterruptHandlers,
    stm32f215InterruptHandlers,
    stm32f217InterruptHandlers
  });
}
