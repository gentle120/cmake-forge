import type { DeviceProfile } from '../../deviceProfiles';

// Vector tables transcribed from STMicroelectronics/cmsis-device-u5
// Source/Templates/gcc/startup_stm32u575xx.s and startup_stm32u585xx.s
// (master, fetched 2026-10-28). The two tables differ only in the slots the
// U575 leaves reserved: SAES (29), AES (94), PKA (98), OTFDEC1/OTFDEC2 (109/110).
export const stm32u575InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_PVM_IRQHandler', 'RTC_IRQHandler', 'RTC_S_IRQHandler',
  'TAMP_IRQHandler', 'RAMCFG_IRQHandler', 'FLASH_IRQHandler', 'FLASH_S_IRQHandler',
  'GTZC_IRQHandler', 'RCC_IRQHandler', 'RCC_S_IRQHandler',
  'EXTI0_IRQHandler', 'EXTI1_IRQHandler', 'EXTI2_IRQHandler', 'EXTI3_IRQHandler',
  'EXTI4_IRQHandler', 'EXTI5_IRQHandler', 'EXTI6_IRQHandler', 'EXTI7_IRQHandler',
  'EXTI8_IRQHandler', 'EXTI9_IRQHandler', 'EXTI10_IRQHandler', 'EXTI11_IRQHandler',
  'EXTI12_IRQHandler', 'EXTI13_IRQHandler', 'EXTI14_IRQHandler', 'EXTI15_IRQHandler',
  'IWDG_IRQHandler',
  // ST reserves IRQ 28 (SAES), 93 (AES), 97 (PKA) and 108/109 (OTFDEC) on the
  // U575, so the following entries keep their IRQ numbers instead of shifting.
  '0',
  'GPDMA1_Channel0_IRQHandler', 'GPDMA1_Channel1_IRQHandler', 'GPDMA1_Channel2_IRQHandler',
  'GPDMA1_Channel3_IRQHandler', 'GPDMA1_Channel4_IRQHandler', 'GPDMA1_Channel5_IRQHandler',
  'GPDMA1_Channel6_IRQHandler', 'GPDMA1_Channel7_IRQHandler',
  'ADC1_IRQHandler', 'DAC1_IRQHandler', 'FDCAN1_IT0_IRQHandler', 'FDCAN1_IT1_IRQHandler',
  'TIM1_BRK_IRQHandler', 'TIM1_UP_IRQHandler', 'TIM1_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler',
  'TIM2_IRQHandler', 'TIM3_IRQHandler', 'TIM4_IRQHandler', 'TIM5_IRQHandler',
  'TIM6_IRQHandler', 'TIM7_IRQHandler',
  'TIM8_BRK_IRQHandler', 'TIM8_UP_IRQHandler', 'TIM8_TRG_COM_IRQHandler', 'TIM8_CC_IRQHandler',
  'I2C1_EV_IRQHandler', 'I2C1_ER_IRQHandler', 'I2C2_EV_IRQHandler', 'I2C2_ER_IRQHandler',
  'SPI1_IRQHandler', 'SPI2_IRQHandler',
  'USART1_IRQHandler', 'USART2_IRQHandler', 'USART3_IRQHandler', 'UART4_IRQHandler', 'UART5_IRQHandler',
  'LPUART1_IRQHandler', 'LPTIM1_IRQHandler', 'LPTIM2_IRQHandler',
  'TIM15_IRQHandler', 'TIM16_IRQHandler', 'TIM17_IRQHandler',
  'COMP_IRQHandler', 'OTG_FS_IRQHandler', 'CRS_IRQHandler', 'FMC_IRQHandler', 'OCTOSPI1_IRQHandler',
  'PWR_S3WU_IRQHandler', 'SDMMC1_IRQHandler', 'SDMMC2_IRQHandler',
  'GPDMA1_Channel8_IRQHandler', 'GPDMA1_Channel9_IRQHandler', 'GPDMA1_Channel10_IRQHandler',
  'GPDMA1_Channel11_IRQHandler', 'GPDMA1_Channel12_IRQHandler', 'GPDMA1_Channel13_IRQHandler',
  'GPDMA1_Channel14_IRQHandler', 'GPDMA1_Channel15_IRQHandler',
  'I2C3_EV_IRQHandler', 'I2C3_ER_IRQHandler', 'SAI1_IRQHandler', 'SAI2_IRQHandler', 'TSC_IRQHandler',
  '0',
  'RNG_IRQHandler', 'FPU_IRQHandler', 'HASH_IRQHandler',
  '0',
  'LPTIM3_IRQHandler', 'SPI3_IRQHandler', 'I2C4_ER_IRQHandler', 'I2C4_EV_IRQHandler',
  'MDF1_FLT0_IRQHandler', 'MDF1_FLT1_IRQHandler', 'MDF1_FLT2_IRQHandler', 'MDF1_FLT3_IRQHandler',
  'UCPD1_IRQHandler', 'ICACHE_IRQHandler',
  '0', '0',
  'LPTIM4_IRQHandler', 'DCACHE1_IRQHandler', 'ADF1_IRQHandler', 'ADC4_IRQHandler',
  'LPDMA1_Channel0_IRQHandler', 'LPDMA1_Channel1_IRQHandler', 'LPDMA1_Channel2_IRQHandler',
  'LPDMA1_Channel3_IRQHandler',
  'DMA2D_IRQHandler', 'DCMI_PSSI_IRQHandler', 'OCTOSPI2_IRQHandler',
  'MDF1_FLT4_IRQHandler', 'MDF1_FLT5_IRQHandler',
  'CORDIC_IRQHandler', 'FMAC_IRQHandler', 'LSECSSD_IRQHandler'
];

export const stm32u585InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_PVM_IRQHandler', 'RTC_IRQHandler', 'RTC_S_IRQHandler',
  'TAMP_IRQHandler', 'RAMCFG_IRQHandler', 'FLASH_IRQHandler', 'FLASH_S_IRQHandler',
  'GTZC_IRQHandler', 'RCC_IRQHandler', 'RCC_S_IRQHandler',
  'EXTI0_IRQHandler', 'EXTI1_IRQHandler', 'EXTI2_IRQHandler', 'EXTI3_IRQHandler',
  'EXTI4_IRQHandler', 'EXTI5_IRQHandler', 'EXTI6_IRQHandler', 'EXTI7_IRQHandler',
  'EXTI8_IRQHandler', 'EXTI9_IRQHandler', 'EXTI10_IRQHandler', 'EXTI11_IRQHandler',
  'EXTI12_IRQHandler', 'EXTI13_IRQHandler', 'EXTI14_IRQHandler', 'EXTI15_IRQHandler',
  'IWDG_IRQHandler', 'SAES_IRQHandler',
  'GPDMA1_Channel0_IRQHandler', 'GPDMA1_Channel1_IRQHandler', 'GPDMA1_Channel2_IRQHandler',
  'GPDMA1_Channel3_IRQHandler', 'GPDMA1_Channel4_IRQHandler', 'GPDMA1_Channel5_IRQHandler',
  'GPDMA1_Channel6_IRQHandler', 'GPDMA1_Channel7_IRQHandler',
  'ADC1_IRQHandler', 'DAC1_IRQHandler', 'FDCAN1_IT0_IRQHandler', 'FDCAN1_IT1_IRQHandler',
  'TIM1_BRK_IRQHandler', 'TIM1_UP_IRQHandler', 'TIM1_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler',
  'TIM2_IRQHandler', 'TIM3_IRQHandler', 'TIM4_IRQHandler', 'TIM5_IRQHandler',
  'TIM6_IRQHandler', 'TIM7_IRQHandler',
  'TIM8_BRK_IRQHandler', 'TIM8_UP_IRQHandler', 'TIM8_TRG_COM_IRQHandler', 'TIM8_CC_IRQHandler',
  'I2C1_EV_IRQHandler', 'I2C1_ER_IRQHandler', 'I2C2_EV_IRQHandler', 'I2C2_ER_IRQHandler',
  'SPI1_IRQHandler', 'SPI2_IRQHandler',
  'USART1_IRQHandler', 'USART2_IRQHandler', 'USART3_IRQHandler', 'UART4_IRQHandler', 'UART5_IRQHandler',
  'LPUART1_IRQHandler', 'LPTIM1_IRQHandler', 'LPTIM2_IRQHandler',
  'TIM15_IRQHandler', 'TIM16_IRQHandler', 'TIM17_IRQHandler',
  'COMP_IRQHandler', 'OTG_FS_IRQHandler', 'CRS_IRQHandler', 'FMC_IRQHandler', 'OCTOSPI1_IRQHandler',
  'PWR_S3WU_IRQHandler', 'SDMMC1_IRQHandler', 'SDMMC2_IRQHandler',
  'GPDMA1_Channel8_IRQHandler', 'GPDMA1_Channel9_IRQHandler', 'GPDMA1_Channel10_IRQHandler',
  'GPDMA1_Channel11_IRQHandler', 'GPDMA1_Channel12_IRQHandler', 'GPDMA1_Channel13_IRQHandler',
  'GPDMA1_Channel14_IRQHandler', 'GPDMA1_Channel15_IRQHandler',
  'I2C3_EV_IRQHandler', 'I2C3_ER_IRQHandler', 'SAI1_IRQHandler', 'SAI2_IRQHandler', 'TSC_IRQHandler',
  'AES_IRQHandler', 'RNG_IRQHandler', 'FPU_IRQHandler', 'HASH_IRQHandler', 'PKA_IRQHandler',
  'LPTIM3_IRQHandler', 'SPI3_IRQHandler', 'I2C4_ER_IRQHandler', 'I2C4_EV_IRQHandler',
  'MDF1_FLT0_IRQHandler', 'MDF1_FLT1_IRQHandler', 'MDF1_FLT2_IRQHandler', 'MDF1_FLT3_IRQHandler',
  'UCPD1_IRQHandler', 'ICACHE_IRQHandler', 'OTFDEC1_IRQHandler', 'OTFDEC2_IRQHandler',
  'LPTIM4_IRQHandler', 'DCACHE1_IRQHandler', 'ADF1_IRQHandler', 'ADC4_IRQHandler',
  'LPDMA1_Channel0_IRQHandler', 'LPDMA1_Channel1_IRQHandler', 'LPDMA1_Channel2_IRQHandler',
  'LPDMA1_Channel3_IRQHandler',
  'DMA2D_IRQHandler', 'DCMI_PSSI_IRQHandler', 'OCTOSPI2_IRQHandler',
  'MDF1_FLT4_IRQHandler', 'MDF1_FLT5_IRQHandler',
  'CORDIC_IRQHandler', 'FMAC_IRQHandler', 'LSECSSD_IRQHandler'
];

interface Stm32U5ProfileOptions {
  define: string;
  flashLength: number;
  gnuStartupFileName: string;
  interruptHandlers: string[];
}

export function createStm32U5Profile(
  part: string,
  linkerFileName: string,
  options: Stm32U5ProfileOptions
): DeviceProfile {
  return {
    part,
    vendor: 'STM',
    series: 'U5x',
    family: 'STM32U5xx',
    core: 'cortex-m33',
    architecture: 'arm',
    toolchainPrefix: 'arm-none-eabi',
    defines: [options.define],
    compilerFlags: ['-mcpu=cortex-m33', '-mthumb', '-mfpu=fpv5-sp-d16', '-mfloat-abi=hard'],
    // SRAM1 (192K @ 0x20000000) and SRAM2 (64K @ 0x20030000) are contiguous,
    // so one 256K RAM region covers both.
    flash: { origin: 0x08000000, length: options.flashLength },
    ram: { origin: 0x20000000, length: 256 * 1024 },
    linkerFileName,
    gnuStartupFileName: options.gnuStartupFileName,
    toolchainFileName: 'stm32u5-toolchain.cmake',
    interruptHandlers: [...options.interruptHandlers],
    debugTarget: 'stm32u5x'
  };
}
