import type { DeviceProfile } from '../../deviceProfiles';
import { createStm32BuiltinProfile } from '../builtinProfileFactory';

// Vector table of the STM32WB55xx Cortex-M4 core, copied in IRQ order from
// cmsis-device-wb Source/Templates/gcc/startup_stm32wb55xx_cm4.s (g_pfnVectors
// after the 16 core vectors). The WB55 M4 table has no reserved slots.
export const stm32wbInterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_PVM_IRQHandler', 'TAMP_STAMP_LSECSS_IRQHandler', 'RTC_WKUP_IRQHandler',
  'FLASH_IRQHandler', 'RCC_IRQHandler', 'EXTI0_IRQHandler', 'EXTI1_IRQHandler',
  'EXTI2_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler', 'DMA1_Channel1_IRQHandler',
  'DMA1_Channel2_IRQHandler', 'DMA1_Channel3_IRQHandler', 'DMA1_Channel4_IRQHandler',
  'DMA1_Channel5_IRQHandler', 'DMA1_Channel6_IRQHandler', 'DMA1_Channel7_IRQHandler',
  'ADC1_IRQHandler', 'USB_HP_IRQHandler', 'USB_LP_IRQHandler', 'C2SEV_PWR_C2H_IRQHandler',
  'COMP_IRQHandler', 'EXTI9_5_IRQHandler', 'TIM1_BRK_IRQHandler', 'TIM1_UP_TIM16_IRQHandler',
  'TIM1_TRG_COM_TIM17_IRQHandler', 'TIM1_CC_IRQHandler', 'TIM2_IRQHandler', 'PKA_IRQHandler',
  'I2C1_EV_IRQHandler', 'I2C1_ER_IRQHandler', 'I2C3_EV_IRQHandler', 'I2C3_ER_IRQHandler',
  'SPI1_IRQHandler', 'SPI2_IRQHandler', 'USART1_IRQHandler', 'LPUART1_IRQHandler',
  'SAI1_IRQHandler', 'TSC_IRQHandler', 'EXTI15_10_IRQHandler', 'RTC_Alarm_IRQHandler',
  'CRS_IRQHandler', 'PWR_SOTF_BLEACT_802ACT_RFPHASE_IRQHandler', 'IPCC_C1_RX_IRQHandler',
  'IPCC_C1_TX_IRQHandler', 'HSEM_IRQHandler', 'LPTIM1_IRQHandler', 'LPTIM2_IRQHandler',
  'LCD_IRQHandler', 'QUADSPI_IRQHandler', 'AES1_IRQHandler', 'AES2_IRQHandler',
  'RNG_IRQHandler', 'FPU_IRQHandler', 'DMA2_Channel1_IRQHandler', 'DMA2_Channel2_IRQHandler',
  'DMA2_Channel3_IRQHandler', 'DMA2_Channel4_IRQHandler', 'DMA2_Channel5_IRQHandler',
  'DMA2_Channel6_IRQHandler', 'DMA2_Channel7_IRQHandler', 'DMAMUX1_OVR_IRQHandler'
];

export function createStm32WbProfile(part: string): DeviceProfile {
  return createStm32BuiltinProfile(part, 'WBx', {
    stm32wbInterruptHandlers
  });
}
