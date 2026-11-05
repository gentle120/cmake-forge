import type { DeviceProfile } from '../../deviceProfiles';

export const stm32f030x8InterruptHandlers = [
  'WWDG_IRQHandler', '0', 'RTC_IRQHandler', 'FLASH_IRQHandler',
  'RCC_IRQHandler', 'EXTI0_1_IRQHandler', 'EXTI2_3_IRQHandler', 'EXTI4_15_IRQHandler',
  '0', 'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_3_IRQHandler', 'DMA1_Channel4_5_IRQHandler',
  'ADC1_IRQHandler', 'TIM1_BRK_UP_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler', '0',
  'TIM3_IRQHandler', 'TIM6_IRQHandler', '0', 'TIM14_IRQHandler',
  'TIM15_IRQHandler', 'TIM16_IRQHandler', 'TIM17_IRQHandler', 'I2C1_IRQHandler',
  'I2C2_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler', 'USART1_IRQHandler',
  'USART2_IRQHandler', '0', '0', '0'
];

export const stm32f031x6InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_IRQHandler', 'RTC_IRQHandler', 'FLASH_IRQHandler',
  'RCC_IRQHandler', 'EXTI0_1_IRQHandler', 'EXTI2_3_IRQHandler', 'EXTI4_15_IRQHandler',
  '0', 'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_3_IRQHandler', 'DMA1_Channel4_5_IRQHandler',
  'ADC1_IRQHandler', 'TIM1_BRK_UP_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler', 'TIM2_IRQHandler',
  'TIM3_IRQHandler', '0', '0', 'TIM14_IRQHandler',
  '0', 'TIM16_IRQHandler', 'TIM17_IRQHandler', 'I2C1_IRQHandler',
  '0', 'SPI1_IRQHandler', '0', 'USART1_IRQHandler',
  '0', '0', '0', '0'
];

export const stm32f051x8InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_IRQHandler', 'RTC_IRQHandler', 'FLASH_IRQHandler',
  'RCC_CRS_IRQHandler', 'EXTI0_1_IRQHandler', 'EXTI2_3_IRQHandler', 'EXTI4_15_IRQHandler',
  'TSC_IRQHandler', 'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_3_IRQHandler', 'DMA1_Channel4_5_IRQHandler',
  'ADC1_COMP_IRQHandler', 'TIM1_BRK_UP_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler', 'TIM2_IRQHandler',
  'TIM3_IRQHandler', 'TIM6_DAC_IRQHandler', '0', 'TIM14_IRQHandler',
  'TIM15_IRQHandler', 'TIM16_IRQHandler', 'TIM17_IRQHandler', 'I2C1_IRQHandler',
  'I2C2_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler', 'USART1_IRQHandler',
  'USART2_IRQHandler', '0', 'CEC_CAN_IRQHandler', '0'
];

export const stm32f072xbInterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_VDDIO2_IRQHandler', 'RTC_IRQHandler', 'FLASH_IRQHandler',
  'RCC_CRS_IRQHandler', 'EXTI0_1_IRQHandler', 'EXTI2_3_IRQHandler', 'EXTI4_15_IRQHandler',
  'TSC_IRQHandler', 'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_3_IRQHandler', 'DMA1_Channel4_5_6_7_IRQHandler',
  'ADC1_COMP_IRQHandler', 'TIM1_BRK_UP_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler', 'TIM2_IRQHandler',
  'TIM3_IRQHandler', 'TIM6_DAC_IRQHandler', 'TIM7_IRQHandler', 'TIM14_IRQHandler',
  'TIM15_IRQHandler', 'TIM16_IRQHandler', 'TIM17_IRQHandler', 'I2C1_IRQHandler',
  'I2C2_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler', 'USART1_IRQHandler',
  'USART2_IRQHandler', 'USART3_4_IRQHandler', 'CEC_CAN_IRQHandler', 'USB_IRQHandler'
];

export const stm32f091xcInterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_VDDIO2_IRQHandler', 'RTC_IRQHandler', 'FLASH_IRQHandler',
  'RCC_CRS_IRQHandler', 'EXTI0_1_IRQHandler', 'EXTI2_3_IRQHandler', 'EXTI4_15_IRQHandler',
  'TSC_IRQHandler', 'DMA1_Ch1_IRQHandler', 'DMA1_Ch2_3_DMA2_Ch1_2_IRQHandler', 'DMA1_Ch4_7_DMA2_Ch3_5_IRQHandler',
  'ADC1_COMP_IRQHandler', 'TIM1_BRK_UP_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler', 'TIM2_IRQHandler',
  'TIM3_IRQHandler', 'TIM6_DAC_IRQHandler', 'TIM7_IRQHandler', 'TIM14_IRQHandler',
  'TIM15_IRQHandler', 'TIM16_IRQHandler', 'TIM17_IRQHandler', 'I2C1_IRQHandler',
  'I2C2_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler', 'USART1_IRQHandler',
  'USART2_IRQHandler', 'USART3_8_IRQHandler', 'CEC_CAN_IRQHandler'
];

interface Stm32F0ProfileOptions {
  define?: string;
  ramLength?: number;
  gnuStartupFileName?: string;
  interruptHandlers?: string[];
}

export function createStm32F0Profile(
  part: string,
  flashLength: number,
  linkerFileName: string,
  options: Stm32F0ProfileOptions = {}
): DeviceProfile {
  return {
    part,
    vendor: 'STM',
    series: 'F0x',
    family: 'STM32F0xx',
    core: 'cortex-m0',
    architecture: 'arm',
    toolchainPrefix: 'arm-none-eabi',
    defines: [options.define ?? 'STM32F030x8'],
    compilerFlags: ['-mcpu=cortex-m0', '-mthumb'],
    flash: { origin: 0x08000000, length: flashLength },
    ram: { origin: 0x20000000, length: options.ramLength ?? 8 * 1024 },
    linkerFileName,
    gnuStartupFileName: options.gnuStartupFileName ?? 'startup_stm32f030x8.S',
    toolchainFileName: 'stm32f0-toolchain.cmake',
    interruptHandlers: [...(options.interruptHandlers ?? stm32f030x8InterruptHandlers)],
    debugTarget: 'stm32f0x'
  };
}
