import type { DeviceProfile } from '../../deviceProfiles';
import { createStm32BuiltinProfile } from '../builtinProfileFactory';

// External IRQ section transcribed from cmsis-device-h7
// Source/Templates/gcc/startup_stm32h743xx.s (IRQ 0-149); '0' marks the slots
// ST leaves reserved.
export const stm32h743InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_AVD_IRQHandler', 'TAMP_STAMP_IRQHandler', 'RTC_WKUP_IRQHandler',
  'FLASH_IRQHandler', 'RCC_IRQHandler', 'EXTI0_IRQHandler', 'EXTI1_IRQHandler',
  'EXTI2_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler', 'DMA1_Stream0_IRQHandler',
  'DMA1_Stream1_IRQHandler', 'DMA1_Stream2_IRQHandler', 'DMA1_Stream3_IRQHandler',
  'DMA1_Stream4_IRQHandler', 'DMA1_Stream5_IRQHandler', 'DMA1_Stream6_IRQHandler',
  'ADC_IRQHandler', 'FDCAN1_IT0_IRQHandler', 'FDCAN2_IT0_IRQHandler', 'FDCAN1_IT1_IRQHandler',
  'FDCAN2_IT1_IRQHandler', 'EXTI9_5_IRQHandler', 'TIM1_BRK_IRQHandler', 'TIM1_UP_IRQHandler',
  'TIM1_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler', 'TIM2_IRQHandler', 'TIM3_IRQHandler',
  'TIM4_IRQHandler', 'I2C1_EV_IRQHandler', 'I2C1_ER_IRQHandler', 'I2C2_EV_IRQHandler',
  'I2C2_ER_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler', 'USART1_IRQHandler',
  'USART2_IRQHandler', 'USART3_IRQHandler', 'EXTI15_10_IRQHandler', 'RTC_Alarm_IRQHandler',
  // IRQ 42 reserved.
  '0', 'TIM8_BRK_TIM12_IRQHandler', 'TIM8_UP_TIM13_IRQHandler', 'TIM8_TRG_COM_TIM14_IRQHandler',
  'TIM8_CC_IRQHandler', 'DMA1_Stream7_IRQHandler', 'FMC_IRQHandler', 'SDMMC1_IRQHandler',
  'TIM5_IRQHandler', 'SPI3_IRQHandler', 'UART4_IRQHandler', 'UART5_IRQHandler',
  'TIM6_DAC_IRQHandler', 'TIM7_IRQHandler', 'DMA2_Stream0_IRQHandler', 'DMA2_Stream1_IRQHandler',
  'DMA2_Stream2_IRQHandler', 'DMA2_Stream3_IRQHandler', 'DMA2_Stream4_IRQHandler',
  'ETH_IRQHandler', 'ETH_WKUP_IRQHandler', 'FDCAN_CAL_IRQHandler',
  // IRQ 64-67 reserved between FDCAN_CAL and DMA2.
  '0', '0', '0', '0',
  'DMA2_Stream5_IRQHandler', 'DMA2_Stream6_IRQHandler', 'DMA2_Stream7_IRQHandler',
  'USART6_IRQHandler', 'I2C3_EV_IRQHandler', 'I2C3_ER_IRQHandler',
  'OTG_HS_EP1_OUT_IRQHandler', 'OTG_HS_EP1_IN_IRQHandler', 'OTG_HS_WKUP_IRQHandler',
  'OTG_HS_IRQHandler', 'DCMI_IRQHandler',
  // IRQ 79 reserved between DCMI and RNG.
  '0', 'RNG_IRQHandler', 'FPU_IRQHandler',
  'UART7_IRQHandler', 'UART8_IRQHandler', 'SPI4_IRQHandler', 'SPI5_IRQHandler',
  'SPI6_IRQHandler', 'SAI1_IRQHandler', 'LTDC_IRQHandler', 'LTDC_ER_IRQHandler',
  'DMA2D_IRQHandler', 'SAI2_IRQHandler', 'QUADSPI_IRQHandler', 'LPTIM1_IRQHandler',
  'CEC_IRQHandler', 'I2C4_EV_IRQHandler', 'I2C4_ER_IRQHandler', 'SPDIF_RX_IRQHandler',
  'OTG_FS_EP1_OUT_IRQHandler', 'OTG_FS_EP1_IN_IRQHandler', 'OTG_FS_WKUP_IRQHandler',
  'OTG_FS_IRQHandler', 'DMAMUX1_OVR_IRQHandler', 'HRTIM1_Master_IRQHandler',
  'HRTIM1_TIMA_IRQHandler', 'HRTIM1_TIMB_IRQHandler', 'HRTIM1_TIMC_IRQHandler',
  'HRTIM1_TIMD_IRQHandler', 'HRTIM1_TIME_IRQHandler', 'HRTIM1_FLT_IRQHandler',
  'DFSDM1_FLT0_IRQHandler', 'DFSDM1_FLT1_IRQHandler', 'DFSDM1_FLT2_IRQHandler',
  'DFSDM1_FLT3_IRQHandler', 'SAI3_IRQHandler', 'SWPMI1_IRQHandler', 'TIM15_IRQHandler',
  'TIM16_IRQHandler', 'TIM17_IRQHandler', 'MDIOS_WKUP_IRQHandler', 'MDIOS_IRQHandler',
  'JPEG_IRQHandler', 'MDMA_IRQHandler',
  // IRQ 123 reserved before SDMMC2, IRQ 126 between HSEM1 and ADC3.
  '0', 'SDMMC2_IRQHandler', 'HSEM1_IRQHandler', '0', 'ADC3_IRQHandler', 'DMAMUX2_OVR_IRQHandler',
  'BDMA_Channel0_IRQHandler', 'BDMA_Channel1_IRQHandler', 'BDMA_Channel2_IRQHandler',
  'BDMA_Channel3_IRQHandler', 'BDMA_Channel4_IRQHandler', 'BDMA_Channel5_IRQHandler',
  'BDMA_Channel6_IRQHandler', 'BDMA_Channel7_IRQHandler', 'COMP1_IRQHandler',
  'LPTIM2_IRQHandler', 'LPTIM3_IRQHandler', 'LPTIM4_IRQHandler', 'LPTIM5_IRQHandler',
  'LPUART1_IRQHandler',
  // IRQ 143 reserved after LPUART1; IRQ 147-148 after SAI4.
  '0', 'CRS_IRQHandler', 'ECC_IRQHandler', 'SAI4_IRQHandler', '0', '0', 'WAKEUP_PIN_IRQHandler'
];

// The H750 value line wires the crypto peripherals into the slots the H743
// leaves reserved (IRQ 79 CRYP, IRQ 80 HASH_RNG); every other slot matches.
export const stm32h750InterruptHandlers = [
  ...stm32h743InterruptHandlers.slice(0, 79),
  'CRYP_IRQHandler', 'HASH_RNG_IRQHandler',
  ...stm32h743InterruptHandlers.slice(81)
];

// External IRQ section transcribed from cmsis-device-h7
// Source/Templates/gcc/startup_stm32h723xx.s (IRQ 0-162). The H723 reserves
// the H743's HRTIM1, SAI2/QUADSPI, and JPEG slots and adds OCTOSPI, DTS,
// FMAC, CORDIC, I2C5, FDCAN3, and TIM23/24 peripherals.
export const stm32h723InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_AVD_IRQHandler', 'TAMP_STAMP_IRQHandler', 'RTC_WKUP_IRQHandler',
  'FLASH_IRQHandler', 'RCC_IRQHandler', 'EXTI0_IRQHandler', 'EXTI1_IRQHandler',
  'EXTI2_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler', 'DMA1_Stream0_IRQHandler',
  'DMA1_Stream1_IRQHandler', 'DMA1_Stream2_IRQHandler', 'DMA1_Stream3_IRQHandler',
  'DMA1_Stream4_IRQHandler', 'DMA1_Stream5_IRQHandler', 'DMA1_Stream6_IRQHandler',
  'ADC_IRQHandler', 'FDCAN1_IT0_IRQHandler', 'FDCAN2_IT0_IRQHandler', 'FDCAN1_IT1_IRQHandler',
  'FDCAN2_IT1_IRQHandler', 'EXTI9_5_IRQHandler', 'TIM1_BRK_IRQHandler', 'TIM1_UP_IRQHandler',
  'TIM1_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler', 'TIM2_IRQHandler', 'TIM3_IRQHandler',
  'TIM4_IRQHandler', 'I2C1_EV_IRQHandler', 'I2C1_ER_IRQHandler', 'I2C2_EV_IRQHandler',
  'I2C2_ER_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler', 'USART1_IRQHandler',
  'USART2_IRQHandler', 'USART3_IRQHandler', 'EXTI15_10_IRQHandler', 'RTC_Alarm_IRQHandler',
  // IRQ 42 reserved.
  '0', 'TIM8_BRK_TIM12_IRQHandler', 'TIM8_UP_TIM13_IRQHandler', 'TIM8_TRG_COM_TIM14_IRQHandler',
  'TIM8_CC_IRQHandler', 'DMA1_Stream7_IRQHandler', 'FMC_IRQHandler', 'SDMMC1_IRQHandler',
  'TIM5_IRQHandler', 'SPI3_IRQHandler', 'UART4_IRQHandler', 'UART5_IRQHandler',
  'TIM6_DAC_IRQHandler', 'TIM7_IRQHandler', 'DMA2_Stream0_IRQHandler', 'DMA2_Stream1_IRQHandler',
  'DMA2_Stream2_IRQHandler', 'DMA2_Stream3_IRQHandler', 'DMA2_Stream4_IRQHandler',
  'ETH_IRQHandler', 'ETH_WKUP_IRQHandler', 'FDCAN_CAL_IRQHandler',
  // IRQ 64-67 reserved.
  '0', '0', '0', '0',
  'DMA2_Stream5_IRQHandler', 'DMA2_Stream6_IRQHandler', 'DMA2_Stream7_IRQHandler',
  'USART6_IRQHandler', 'I2C3_EV_IRQHandler', 'I2C3_ER_IRQHandler',
  'OTG_HS_EP1_OUT_IRQHandler', 'OTG_HS_EP1_IN_IRQHandler', 'OTG_HS_WKUP_IRQHandler',
  'OTG_HS_IRQHandler', 'DCMI_PSSI_IRQHandler',
  // IRQ 79 reserved between DCMI/PSSI and RNG.
  '0', 'RNG_IRQHandler', 'FPU_IRQHandler',
  'UART7_IRQHandler', 'UART8_IRQHandler', 'SPI4_IRQHandler', 'SPI5_IRQHandler',
  'SPI6_IRQHandler', 'SAI1_IRQHandler', 'LTDC_IRQHandler', 'LTDC_ER_IRQHandler',
  'DMA2D_IRQHandler',
  // IRQ 91 reserved; the H723 swaps SAI2/QUADSPI for OCTOSPI1.
  '0', 'OCTOSPI1_IRQHandler', 'LPTIM1_IRQHandler', 'CEC_IRQHandler',
  'I2C4_EV_IRQHandler', 'I2C4_ER_IRQHandler', 'SPDIF_RX_IRQHandler',
  // IRQ 97-100 reserved, then DMAMUX1_OVR with IRQ 103-109 reserved
  // (the H723 has no HRTIM1 block).
  '0', '0', '0', '0', 'DMAMUX1_OVR_IRQHandler',
  '0', '0', '0', '0', '0', '0', '0',
  'DFSDM1_FLT0_IRQHandler', 'DFSDM1_FLT1_IRQHandler', 'DFSDM1_FLT2_IRQHandler',
  'DFSDM1_FLT3_IRQHandler',
  // IRQ 114 reserved (no SAI3).
  '0', 'SWPMI1_IRQHandler', 'TIM15_IRQHandler', 'TIM16_IRQHandler',
  'TIM17_IRQHandler', 'MDIOS_WKUP_IRQHandler', 'MDIOS_IRQHandler',
  // IRQ 121 reserved (no JPEG).
  '0', 'MDMA_IRQHandler',
  // IRQ 123 reserved before SDMMC2, IRQ 126 between HSEM1 and ADC3.
  '0', 'SDMMC2_IRQHandler', 'HSEM1_IRQHandler', '0', 'ADC3_IRQHandler', 'DMAMUX2_OVR_IRQHandler',
  'BDMA_Channel0_IRQHandler', 'BDMA_Channel1_IRQHandler', 'BDMA_Channel2_IRQHandler',
  'BDMA_Channel3_IRQHandler', 'BDMA_Channel4_IRQHandler', 'BDMA_Channel5_IRQHandler',
  'BDMA_Channel6_IRQHandler', 'BDMA_Channel7_IRQHandler', 'COMP1_IRQHandler',
  'LPTIM2_IRQHandler', 'LPTIM3_IRQHandler', 'LPTIM4_IRQHandler', 'LPTIM5_IRQHandler',
  'LPUART1_IRQHandler',
  // IRQ 143 reserved after LPUART1; IRQ 148 between DTS and WAKEUP_PIN;
  // IRQ 151-152 after OCTOSPI2.
  '0', 'CRS_IRQHandler', 'ECC_IRQHandler', 'SAI4_IRQHandler', 'DTS_IRQHandler', '0',
  'WAKEUP_PIN_IRQHandler', 'OCTOSPI2_IRQHandler', '0', '0', 'FMAC_IRQHandler',
  'CORDIC_IRQHandler', 'UART9_IRQHandler', 'USART10_IRQHandler', 'I2C5_EV_IRQHandler',
  'I2C5_ER_IRQHandler', 'FDCAN3_IT0_IRQHandler', 'FDCAN3_IT1_IRQHandler',
  'TIM23_IRQHandler', 'TIM24_IRQHandler'
];

export function createStm32H7Profile(part: string): DeviceProfile {
  return createStm32BuiltinProfile(part, 'H7x', {
    stm32h743InterruptHandlers,
    stm32h750InterruptHandlers,
    stm32h723InterruptHandlers
  });
}
