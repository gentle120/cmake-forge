import type { DeviceProfile } from '../../deviceProfiles';
import { createStm32BuiltinProfile } from '../builtinProfileFactory';

// Vector tables transcribed from STMicroelectronics/cmsis-device-f3
// Source/Templates/gcc/startup_stm32f303xc.s, startup_stm32f334x8.s and
// startup_stm32f373xc.s (master, fetched 2026-10-28). All three tables span
// IRQ 0-81 and end with FPU_IRQHandler; '0' keeps the slots ST reserves.
export const stm32f303InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_IRQHandler', 'TAMP_STAMP_IRQHandler', 'RTC_WKUP_IRQHandler',
  'FLASH_IRQHandler', 'RCC_IRQHandler', 'EXTI0_IRQHandler', 'EXTI1_IRQHandler',
  'EXTI2_TSC_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler', 'DMA1_Channel1_IRQHandler',
  'DMA1_Channel2_IRQHandler', 'DMA1_Channel3_IRQHandler', 'DMA1_Channel4_IRQHandler', 'DMA1_Channel5_IRQHandler',
  'DMA1_Channel6_IRQHandler', 'DMA1_Channel7_IRQHandler', 'ADC1_2_IRQHandler', 'USB_HP_CAN_TX_IRQHandler',
  'USB_LP_CAN_RX0_IRQHandler', 'CAN_RX1_IRQHandler', 'CAN_SCE_IRQHandler', 'EXTI9_5_IRQHandler',
  'TIM1_BRK_TIM15_IRQHandler', 'TIM1_UP_TIM16_IRQHandler', 'TIM1_TRG_COM_TIM17_IRQHandler', 'TIM1_CC_IRQHandler',
  'TIM2_IRQHandler', 'TIM3_IRQHandler', 'TIM4_IRQHandler', 'I2C1_EV_IRQHandler',
  'I2C1_ER_IRQHandler', 'I2C2_EV_IRQHandler', 'I2C2_ER_IRQHandler', 'SPI1_IRQHandler',
  'SPI2_IRQHandler', 'USART1_IRQHandler', 'USART2_IRQHandler', 'USART3_IRQHandler',
  'EXTI15_10_IRQHandler', 'RTC_Alarm_IRQHandler', 'USBWakeUp_IRQHandler', 'TIM8_BRK_IRQHandler',
  'TIM8_UP_IRQHandler', 'TIM8_TRG_COM_IRQHandler', 'TIM8_CC_IRQHandler', 'ADC3_IRQHandler',
  '0', '0', '0', 'SPI3_IRQHandler',
  'UART4_IRQHandler', 'UART5_IRQHandler', 'TIM6_DAC_IRQHandler', 'TIM7_IRQHandler',
  'DMA2_Channel1_IRQHandler', 'DMA2_Channel2_IRQHandler', 'DMA2_Channel3_IRQHandler', 'DMA2_Channel4_IRQHandler',
  'DMA2_Channel5_IRQHandler', 'ADC4_IRQHandler', '0', '0',
  'COMP1_2_3_IRQHandler', 'COMP4_5_6_IRQHandler', 'COMP7_IRQHandler', '0',
  '0', '0', '0', '0',
  '0', '0', 'USB_HP_IRQHandler', 'USB_LP_IRQHandler',
  'USBWakeUp_RMP_IRQHandler', '0', '0', '0',
  '0', 'FPU_IRQHandler'
];

export const stm32f334InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_IRQHandler', 'TAMP_STAMP_IRQHandler', 'RTC_WKUP_IRQHandler',
  'FLASH_IRQHandler', 'RCC_IRQHandler', 'EXTI0_IRQHandler', 'EXTI1_IRQHandler',
  'EXTI2_TSC_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler', 'DMA1_Channel1_IRQHandler',
  'DMA1_Channel2_IRQHandler', 'DMA1_Channel3_IRQHandler', 'DMA1_Channel4_IRQHandler', 'DMA1_Channel5_IRQHandler',
  'DMA1_Channel6_IRQHandler', 'DMA1_Channel7_IRQHandler', 'ADC1_2_IRQHandler', 'CAN_TX_IRQHandler',
  'CAN_RX0_IRQHandler', 'CAN_RX1_IRQHandler', 'CAN_SCE_IRQHandler', 'EXTI9_5_IRQHandler',
  'TIM1_BRK_TIM15_IRQHandler', 'TIM1_UP_TIM16_IRQHandler', 'TIM1_TRG_COM_TIM17_IRQHandler', 'TIM1_CC_IRQHandler',
  'TIM2_IRQHandler', 'TIM3_IRQHandler', '0', 'I2C1_EV_IRQHandler',
  'I2C1_ER_IRQHandler', '0', '0', 'SPI1_IRQHandler',
  '0', 'USART1_IRQHandler', 'USART2_IRQHandler', 'USART3_IRQHandler',
  'EXTI15_10_IRQHandler', 'RTC_Alarm_IRQHandler', '0', '0',
  '0', '0', '0', '0',
  '0', '0', '0', '0',
  '0', '0', 'TIM6_DAC1_IRQHandler', 'TIM7_DAC2_IRQHandler',
  '0', '0', '0', '0',
  '0', '0', '0', '0',
  'COMP2_IRQHandler', 'COMP4_6_IRQHandler', '0', 'HRTIM1_Master_IRQHandler',
  'HRTIM1_TIMA_IRQHandler', 'HRTIM1_TIMB_IRQHandler', 'HRTIM1_TIMC_IRQHandler', 'HRTIM1_TIMD_IRQHandler',
  'HRTIM1_TIME_IRQHandler', 'HRTIM1_FLT_IRQHandler', '0', '0',
  '0', '0', '0', '0',
  '0', 'FPU_IRQHandler'
];

export const stm32f373InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_IRQHandler', 'TAMP_STAMP_IRQHandler', 'RTC_WKUP_IRQHandler',
  'FLASH_IRQHandler', 'RCC_IRQHandler', 'EXTI0_IRQHandler', 'EXTI1_IRQHandler',
  'EXTI2_TSC_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler', 'DMA1_Channel1_IRQHandler',
  'DMA1_Channel2_IRQHandler', 'DMA1_Channel3_IRQHandler', 'DMA1_Channel4_IRQHandler', 'DMA1_Channel5_IRQHandler',
  'DMA1_Channel6_IRQHandler', 'DMA1_Channel7_IRQHandler', 'ADC1_IRQHandler', 'CAN_TX_IRQHandler',
  'CAN_RX0_IRQHandler', 'CAN_RX1_IRQHandler', 'CAN_SCE_IRQHandler', 'EXTI9_5_IRQHandler',
  'TIM15_IRQHandler', 'TIM16_IRQHandler', 'TIM17_IRQHandler', 'TIM18_DAC2_IRQHandler',
  'TIM2_IRQHandler', 'TIM3_IRQHandler', 'TIM4_IRQHandler', 'I2C1_EV_IRQHandler',
  'I2C1_ER_IRQHandler', 'I2C2_EV_IRQHandler', 'I2C2_ER_IRQHandler', 'SPI1_IRQHandler',
  'SPI2_IRQHandler', 'USART1_IRQHandler', 'USART2_IRQHandler', 'USART3_IRQHandler',
  'EXTI15_10_IRQHandler', 'RTC_Alarm_IRQHandler', 'CEC_IRQHandler', 'TIM12_IRQHandler',
  'TIM13_IRQHandler', 'TIM14_IRQHandler', '0', '0',
  '0', '0', 'TIM5_IRQHandler', 'SPI3_IRQHandler',
  '0', '0', 'TIM6_DAC1_IRQHandler', 'TIM7_IRQHandler',
  'DMA2_Channel1_IRQHandler', 'DMA2_Channel2_IRQHandler', 'DMA2_Channel3_IRQHandler', 'DMA2_Channel4_IRQHandler',
  'DMA2_Channel5_IRQHandler', 'SDADC1_IRQHandler', 'SDADC2_IRQHandler', 'SDADC3_IRQHandler',
  'COMP_IRQHandler', '0', '0', '0',
  '0', '0', '0', '0',
  '0', '0', 'USB_HP_IRQHandler', 'USB_LP_IRQHandler',
  'USBWakeUp_IRQHandler', '0', 'TIM19_IRQHandler', '0',
  '0', 'FPU_IRQHandler'
];

export function createStm32F3Profile(part: string): DeviceProfile {
  return createStm32BuiltinProfile(part, 'F3x', {
    stm32f303InterruptHandlers,
    stm32f334InterruptHandlers,
    stm32f373InterruptHandlers
  });
}
