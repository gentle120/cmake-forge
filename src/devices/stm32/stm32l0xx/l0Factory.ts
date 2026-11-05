import type { DeviceProfile } from '../../deviceProfiles';

// Vector table of the STM32L031/L053 core, copied in IRQ order from
// cmsis-device-l0 Source/Templates/gcc/startup_stm32l053xx.s (g_pfnVectors
// after the 16 core vectors). Reserved slots stay in place so the following
// handlers keep their hardware IRQ numbers.
export const stm32l0ShortInterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_IRQHandler', 'RTC_IRQHandler', 'FLASH_IRQHandler',
  'RCC_CRS_IRQHandler', 'EXTI0_1_IRQHandler', 'EXTI2_3_IRQHandler', 'EXTI4_15_IRQHandler',
  'TSC_IRQHandler', 'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_3_IRQHandler',
  'DMA1_Channel4_5_6_7_IRQHandler', 'ADC1_COMP_IRQHandler', 'LPTIM1_IRQHandler',
  '0', 'TIM2_IRQHandler', '0', 'TIM6_DAC_IRQHandler', '0', '0',
  'TIM21_IRQHandler', '0', 'TIM22_IRQHandler', 'I2C1_IRQHandler', 'I2C2_IRQHandler',
  'SPI1_IRQHandler', 'SPI2_IRQHandler', 'USART1_IRQHandler', 'USART2_IRQHandler',
  'RNG_LPUART1_IRQHandler', 'LCD_IRQHandler', 'USB_IRQHandler'
];

// Vector table of the STM32L071/L073 core from startup_stm32l073xx.s. It
// replaces the L053 reserved IRQ 14 slot with USART4_5 and adds TIM3, TIM7
// and I2C3 around the reserved IRQ 19 slot.
export const stm32l0ExtendedInterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_IRQHandler', 'RTC_IRQHandler', 'FLASH_IRQHandler',
  'RCC_CRS_IRQHandler', 'EXTI0_1_IRQHandler', 'EXTI2_3_IRQHandler', 'EXTI4_15_IRQHandler',
  'TSC_IRQHandler', 'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_3_IRQHandler',
  'DMA1_Channel4_5_6_7_IRQHandler', 'ADC1_COMP_IRQHandler', 'LPTIM1_IRQHandler',
  'USART4_5_IRQHandler', 'TIM2_IRQHandler', 'TIM3_IRQHandler', 'TIM6_DAC_IRQHandler',
  'TIM7_IRQHandler', '0', 'TIM21_IRQHandler', 'I2C3_IRQHandler', 'TIM22_IRQHandler',
  'I2C1_IRQHandler', 'I2C2_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler',
  'USART1_IRQHandler', 'USART2_IRQHandler', 'RNG_LPUART1_IRQHandler', 'LCD_IRQHandler',
  'USB_IRQHandler'
];

interface Stm32L0ProfileOptions {
  define: string;
  ramLength: number;
  gnuStartupFileName: string;
  interruptHandlers: string[];
}

export function createStm32L0Profile(
  part: string,
  flashLength: number,
  linkerFileName: string,
  options: Stm32L0ProfileOptions
): DeviceProfile {
  return {
    part,
    vendor: 'STM',
    series: 'L0x',
    family: 'STM32L0xx',
    core: 'cortex-m0plus',
    architecture: 'arm',
    toolchainPrefix: 'arm-none-eabi',
    defines: [options.define],
    compilerFlags: ['-mcpu=cortex-m0plus', '-mthumb'],
    flash: { origin: 0x08000000, length: flashLength },
    ram: { origin: 0x20000000, length: options.ramLength },
    linkerFileName,
    gnuStartupFileName: options.gnuStartupFileName,
    toolchainFileName: 'stm32l0-toolchain.cmake',
    interruptHandlers: [...options.interruptHandlers],
    debugTarget: 'stm32l0'
  };
}
