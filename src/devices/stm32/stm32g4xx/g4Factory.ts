import type { DeviceProfile } from '../../deviceProfiles';

// Vector table of the STM32G431xx, copied in IRQ order from
// cmsis-device-g4 Source/Templates/gcc/startup_stm32g431xx.s (g_pfnVectors
// after the 16 core vectors). '0' marks reserved slots; the G431 has no
// DMA1_Channel7 and no high-density G47x/G48x peripherals.
export const stm32g431InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_PVM_IRQHandler', 'RTC_TAMP_LSECSS_IRQHandler', 'RTC_WKUP_IRQHandler',
  'FLASH_IRQHandler', 'RCC_IRQHandler', 'EXTI0_IRQHandler', 'EXTI1_IRQHandler',
  'EXTI2_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler', 'DMA1_Channel1_IRQHandler',
  'DMA1_Channel2_IRQHandler', 'DMA1_Channel3_IRQHandler', 'DMA1_Channel4_IRQHandler',
  'DMA1_Channel5_IRQHandler', 'DMA1_Channel6_IRQHandler', '0',
  'ADC1_2_IRQHandler', 'USB_HP_IRQHandler', 'USB_LP_IRQHandler', 'FDCAN1_IT0_IRQHandler',
  'FDCAN1_IT1_IRQHandler', 'EXTI9_5_IRQHandler', 'TIM1_BRK_TIM15_IRQHandler',
  'TIM1_UP_TIM16_IRQHandler', 'TIM1_TRG_COM_TIM17_IRQHandler', 'TIM1_CC_IRQHandler',
  'TIM2_IRQHandler', 'TIM3_IRQHandler', 'TIM4_IRQHandler', 'I2C1_EV_IRQHandler',
  'I2C1_ER_IRQHandler', 'I2C2_EV_IRQHandler', 'I2C2_ER_IRQHandler', 'SPI1_IRQHandler',
  'SPI2_IRQHandler', 'USART1_IRQHandler', 'USART2_IRQHandler', 'USART3_IRQHandler',
  'EXTI15_10_IRQHandler', 'RTC_Alarm_IRQHandler', 'USBWakeUp_IRQHandler',
  'TIM8_BRK_IRQHandler', 'TIM8_UP_IRQHandler', 'TIM8_TRG_COM_IRQHandler', 'TIM8_CC_IRQHandler',
  '0', '0', 'LPTIM1_IRQHandler', '0', 'SPI3_IRQHandler', 'UART4_IRQHandler', '0',
  'TIM6_DAC_IRQHandler', 'TIM7_IRQHandler', 'DMA2_Channel1_IRQHandler',
  'DMA2_Channel2_IRQHandler', 'DMA2_Channel3_IRQHandler', 'DMA2_Channel4_IRQHandler',
  'DMA2_Channel5_IRQHandler', '0', '0', 'UCPD1_IRQHandler', 'COMP1_2_3_IRQHandler',
  'COMP4_IRQHandler',
  '0', '0', '0', '0', '0', '0', '0', '0', '0',
  'CRS_IRQHandler', 'SAI1_IRQHandler',
  '0', '0', '0', '0',
  'FPU_IRQHandler',
  '0', '0', '0', '0', '0', '0', '0', '0',
  'RNG_IRQHandler', 'LPUART1_IRQHandler', 'I2C3_EV_IRQHandler', 'I2C3_ER_IRQHandler',
  'DMAMUX_OVR_IRQHandler', '0', '0', 'DMA2_Channel6_IRQHandler', '0', '0',
  'CORDIC_IRQHandler', 'FMAC_IRQHandler'
];

// Vector table shared by the high-density G473/G474/G484, copied in IRQ order
// from cmsis-device-g4 Source/Templates/gcc/startup_stm32g474xx.s. Only IRQ 85
// is reserved (between SPI4 and FDCAN2_IT0).
export const stm32g474InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_PVM_IRQHandler', 'RTC_TAMP_LSECSS_IRQHandler', 'RTC_WKUP_IRQHandler',
  'FLASH_IRQHandler', 'RCC_IRQHandler', 'EXTI0_IRQHandler', 'EXTI1_IRQHandler',
  'EXTI2_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler', 'DMA1_Channel1_IRQHandler',
  'DMA1_Channel2_IRQHandler', 'DMA1_Channel3_IRQHandler', 'DMA1_Channel4_IRQHandler',
  'DMA1_Channel5_IRQHandler', 'DMA1_Channel6_IRQHandler', 'DMA1_Channel7_IRQHandler',
  'ADC1_2_IRQHandler', 'USB_HP_IRQHandler', 'USB_LP_IRQHandler', 'FDCAN1_IT0_IRQHandler',
  'FDCAN1_IT1_IRQHandler', 'EXTI9_5_IRQHandler', 'TIM1_BRK_TIM15_IRQHandler',
  'TIM1_UP_TIM16_IRQHandler', 'TIM1_TRG_COM_TIM17_IRQHandler', 'TIM1_CC_IRQHandler',
  'TIM2_IRQHandler', 'TIM3_IRQHandler', 'TIM4_IRQHandler', 'I2C1_EV_IRQHandler',
  'I2C1_ER_IRQHandler', 'I2C2_EV_IRQHandler', 'I2C2_ER_IRQHandler', 'SPI1_IRQHandler',
  'SPI2_IRQHandler', 'USART1_IRQHandler', 'USART2_IRQHandler', 'USART3_IRQHandler',
  'EXTI15_10_IRQHandler', 'RTC_Alarm_IRQHandler', 'USBWakeUp_IRQHandler',
  'TIM8_BRK_IRQHandler', 'TIM8_UP_IRQHandler', 'TIM8_TRG_COM_IRQHandler', 'TIM8_CC_IRQHandler',
  'ADC3_IRQHandler', 'FMC_IRQHandler', 'LPTIM1_IRQHandler', 'TIM5_IRQHandler',
  'SPI3_IRQHandler', 'UART4_IRQHandler', 'UART5_IRQHandler', 'TIM6_DAC_IRQHandler',
  'TIM7_DAC_IRQHandler', 'DMA2_Channel1_IRQHandler', 'DMA2_Channel2_IRQHandler',
  'DMA2_Channel3_IRQHandler', 'DMA2_Channel4_IRQHandler', 'DMA2_Channel5_IRQHandler',
  'ADC4_IRQHandler', 'ADC5_IRQHandler', 'UCPD1_IRQHandler', 'COMP1_2_3_IRQHandler',
  'COMP4_5_6_IRQHandler', 'COMP7_IRQHandler', 'HRTIM1_Master_IRQHandler',
  'HRTIM1_TIMA_IRQHandler', 'HRTIM1_TIMB_IRQHandler', 'HRTIM1_TIMC_IRQHandler',
  'HRTIM1_TIMD_IRQHandler', 'HRTIM1_TIME_IRQHandler', 'HRTIM1_FLT_IRQHandler',
  'HRTIM1_TIMF_IRQHandler', 'CRS_IRQHandler', 'SAI1_IRQHandler', 'TIM20_BRK_IRQHandler',
  'TIM20_UP_IRQHandler', 'TIM20_TRG_COM_IRQHandler', 'TIM20_CC_IRQHandler',
  'FPU_IRQHandler', 'I2C4_EV_IRQHandler', 'I2C4_ER_IRQHandler', 'SPI4_IRQHandler',
  '0', 'FDCAN2_IT0_IRQHandler', 'FDCAN2_IT1_IRQHandler', 'FDCAN3_IT0_IRQHandler',
  'FDCAN3_IT1_IRQHandler', 'RNG_IRQHandler', 'LPUART1_IRQHandler', 'I2C3_EV_IRQHandler',
  'I2C3_ER_IRQHandler', 'DMAMUX_OVR_IRQHandler', 'QUADSPI_IRQHandler',
  'DMA1_Channel8_IRQHandler', 'DMA2_Channel6_IRQHandler', 'DMA2_Channel7_IRQHandler',
  'DMA2_Channel8_IRQHandler', 'CORDIC_IRQHandler', 'FMAC_IRQHandler'
];

interface Stm32G4ProfileOptions {
  define?: string;
  ramLength?: number;
  additionalMemory?: DeviceProfile['additionalMemory'];
  gnuStartupFileName?: string;
  interruptHandlers?: string[];
}

// Defaults describe the 128KB-SRAM density (G473/G474/G484): SRAM1 80K plus
// SRAM2 16K form the 96KB contiguous application RAM at 0x20000000, while the
// 32KB CCMSRAM sits alone at 0x10000000. The 32KB parts (G431) override every
// memory-related option.
export function createStm32G4Profile(
  part: string,
  flashLength: number,
  linkerFileName: string,
  options: Stm32G4ProfileOptions = {}
): DeviceProfile {
  return {
    part,
    vendor: 'STM',
    series: 'G4x',
    family: 'STM32G4xx',
    core: 'cortex-m4',
    architecture: 'arm',
    toolchainPrefix: 'arm-none-eabi',
    defines: [options.define ?? 'STM32G474xx'],
    compilerFlags: ['-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard'],
    flash: { origin: 0x08000000, length: flashLength },
    ram: { origin: 0x20000000, length: options.ramLength ?? 96 * 1024 },
    additionalMemory: options.additionalMemory ?? [
      { name: 'CCMSRAM', attributes: 'rw', origin: 0x10000000, length: 32 * 1024 }
    ],
    linkerFileName,
    gnuStartupFileName: options.gnuStartupFileName ?? 'startup_stm32g474xx.S',
    toolchainFileName: 'stm32g4-toolchain.cmake',
    interruptHandlers: [...(options.interruptHandlers ?? stm32g474InterruptHandlers)],
    debugTarget: 'stm32g4x'
  };
}
