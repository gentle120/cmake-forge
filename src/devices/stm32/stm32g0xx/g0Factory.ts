import type { DeviceProfile } from '../../deviceProfiles';

// External IRQ sections transcribed from the GCC startup files in
// STMicroelectronics/cmsis-device-g0, Source/Templates/gcc/. Reserved slots
// stay literal '0' as in the upstream .word 0 entries; the startup generator
// emits them verbatim and skips their weak aliases.

// startup_stm32g030xx.s (30 entries, 7 reserved)
export const stm32g030InterruptHandlers = [
  'WWDG_IRQHandler', '0', 'RTC_TAMP_IRQHandler', 'FLASH_IRQHandler', 'RCC_IRQHandler',
  'EXTI0_1_IRQHandler', 'EXTI2_3_IRQHandler', 'EXTI4_15_IRQHandler', '0',
  'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_3_IRQHandler', 'DMA1_Ch4_5_DMAMUX1_OVR_IRQHandler',
  'ADC1_IRQHandler', 'TIM1_BRK_UP_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler', '0',
  'TIM3_IRQHandler', '0', '0', 'TIM14_IRQHandler', '0', 'TIM16_IRQHandler', 'TIM17_IRQHandler',
  'I2C1_IRQHandler', 'I2C2_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler',
  'USART1_IRQHandler', 'USART2_IRQHandler', '0'
];

// startup_stm32g041xx.s (32 entries, 3 reserved). The G041 table is not the
// G071 table: it keeps LPTIM1/LPTIM2 standalone, reserves the UCPD and TIM15
// slots, and ends with LPUART1 and AES_RNG.
export const stm32g041InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_IRQHandler', 'RTC_TAMP_IRQHandler', 'FLASH_IRQHandler', 'RCC_IRQHandler',
  'EXTI0_1_IRQHandler', 'EXTI2_3_IRQHandler', 'EXTI4_15_IRQHandler', '0',
  'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_3_IRQHandler', 'DMA1_Ch4_5_DMAMUX1_OVR_IRQHandler',
  'ADC1_IRQHandler', 'TIM1_BRK_UP_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler',
  'TIM2_IRQHandler', 'TIM3_IRQHandler', 'LPTIM1_IRQHandler', 'LPTIM2_IRQHandler',
  'TIM14_IRQHandler', '0', 'TIM16_IRQHandler', 'TIM17_IRQHandler',
  'I2C1_IRQHandler', 'I2C2_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler',
  'USART1_IRQHandler', 'USART2_IRQHandler', 'LPUART1_IRQHandler', '0', 'AES_RNG_IRQHandler'
];

// startup_stm32g071xx.s (31 entries, no reserved slots)
export const stm32g071InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_IRQHandler', 'RTC_TAMP_IRQHandler', 'FLASH_IRQHandler', 'RCC_IRQHandler',
  'EXTI0_1_IRQHandler', 'EXTI2_3_IRQHandler', 'EXTI4_15_IRQHandler', 'UCPD1_2_IRQHandler',
  'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_3_IRQHandler', 'DMA1_Ch4_7_DMAMUX1_OVR_IRQHandler',
  'ADC1_COMP_IRQHandler', 'TIM1_BRK_UP_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler',
  'TIM2_IRQHandler', 'TIM3_IRQHandler', 'TIM6_DAC_LPTIM1_IRQHandler', 'TIM7_LPTIM2_IRQHandler',
  'TIM14_IRQHandler', 'TIM15_IRQHandler', 'TIM16_IRQHandler', 'TIM17_IRQHandler',
  'I2C1_IRQHandler', 'I2C2_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler',
  'USART1_IRQHandler', 'USART2_IRQHandler', 'USART3_4_LPUART1_IRQHandler', 'CEC_IRQHandler'
];

// startup_stm32g0b1xx.s (31 entries, no reserved slots)
export const stm32g0b1InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_VDDIO2_IRQHandler', 'RTC_TAMP_IRQHandler', 'FLASH_IRQHandler', 'RCC_CRS_IRQHandler',
  'EXTI0_1_IRQHandler', 'EXTI2_3_IRQHandler', 'EXTI4_15_IRQHandler', 'USB_UCPD1_2_IRQHandler',
  'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_3_IRQHandler', 'DMA1_Ch4_7_DMA2_Ch1_5_DMAMUX1_OVR_IRQHandler',
  'ADC1_COMP_IRQHandler', 'TIM1_BRK_UP_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler',
  'TIM2_IRQHandler', 'TIM3_TIM4_IRQHandler', 'TIM6_DAC_LPTIM1_IRQHandler', 'TIM7_LPTIM2_IRQHandler',
  'TIM14_IRQHandler', 'TIM15_IRQHandler', 'TIM16_FDCAN_IT0_IRQHandler', 'TIM17_FDCAN_IT1_IRQHandler',
  'I2C1_IRQHandler', 'I2C2_3_IRQHandler', 'SPI1_IRQHandler', 'SPI2_3_IRQHandler',
  'USART1_IRQHandler', 'USART2_LPUART2_IRQHandler', 'USART3_4_5_6_LPUART1_IRQHandler', 'CEC_IRQHandler'
];

const familyTables: Record<string, { gnuStartupFileName: string; interruptHandlers: string[] }> = {
  STM32G030: { gnuStartupFileName: 'startup_stm32g030xx.S', interruptHandlers: stm32g030InterruptHandlers },
  STM32G071: { gnuStartupFileName: 'startup_stm32g071xx.S', interruptHandlers: stm32g071InterruptHandlers },
  STM32G0B1: { gnuStartupFileName: 'startup_stm32g0b1xx.S', interruptHandlers: stm32g0b1InterruptHandlers }
};

interface Stm32G0ProfileOptions {
  define?: string;
  ramLength?: number;
  gnuStartupFileName?: string;
  interruptHandlers?: string[];
}

export function createStm32G0Profile(
  part: string,
  flashLength: number,
  linkerFileName: string,
  options: Stm32G0ProfileOptions = {}
): DeviceProfile {
  const family = part.match(/^STM32G[0-9A-Z]{3}/)?.[0] ?? 'STM32G071';
  const table = familyTables[family] ?? {
    gnuStartupFileName: 'startup_stm32g071xx.S',
    interruptHandlers: stm32g071InterruptHandlers
  };
  return {
    part,
    vendor: 'STM',
    series: 'G0x',
    family: 'STM32G0xx',
    core: 'cortex-m0plus',
    architecture: 'arm',
    toolchainPrefix: 'arm-none-eabi',
    defines: [options.define ?? `${family}xx`],
    compilerFlags: ['-mcpu=cortex-m0plus', '-mthumb'],
    flash: { origin: 0x08000000, length: flashLength },
    ram: { origin: 0x20000000, length: options.ramLength ?? 8 * 1024 },
    linkerFileName,
    gnuStartupFileName: options.gnuStartupFileName ?? table.gnuStartupFileName,
    toolchainFileName: 'stm32g0-toolchain.cmake',
    interruptHandlers: [...(options.interruptHandlers ?? table.interruptHandlers)],
    debugTarget: 'stm32g0x'
  };
}
