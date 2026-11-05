import type { DeviceProfile } from '../../deviceProfiles';

// External IRQ section transcribed from cmsis-device-l5
// Source/Templates/gcc/startup_stm32l552xx.s (IRQ 0-108); '0' marks the slots
// ST leaves reserved.
export const stm32l552InterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_PVM_IRQHandler', 'RTC_IRQHandler', 'RTC_S_IRQHandler',
  'TAMP_IRQHandler', 'TAMP_S_IRQHandler', 'FLASH_IRQHandler', 'FLASH_S_IRQHandler',
  'GTZC_IRQHandler', 'RCC_IRQHandler', 'RCC_S_IRQHandler', 'EXTI0_IRQHandler',
  'EXTI1_IRQHandler', 'EXTI2_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler',
  'EXTI5_IRQHandler', 'EXTI6_IRQHandler', 'EXTI7_IRQHandler', 'EXTI8_IRQHandler',
  'EXTI9_IRQHandler', 'EXTI10_IRQHandler', 'EXTI11_IRQHandler', 'EXTI12_IRQHandler',
  'EXTI13_IRQHandler', 'EXTI14_IRQHandler', 'EXTI15_IRQHandler', 'DMAMUX1_IRQHandler',
  'DMAMUX1_S_IRQHandler', 'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_IRQHandler',
  'DMA1_Channel3_IRQHandler', 'DMA1_Channel4_IRQHandler', 'DMA1_Channel5_IRQHandler',
  'DMA1_Channel6_IRQHandler', 'DMA1_Channel7_IRQHandler', 'DMA1_Channel8_IRQHandler',
  'ADC1_2_IRQHandler', 'DAC_IRQHandler', 'FDCAN1_IT0_IRQHandler', 'FDCAN1_IT1_IRQHandler',
  'TIM1_BRK_IRQHandler', 'TIM1_UP_IRQHandler', 'TIM1_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler',
  'TIM2_IRQHandler', 'TIM3_IRQHandler', 'TIM4_IRQHandler', 'TIM5_IRQHandler',
  'TIM6_IRQHandler', 'TIM7_IRQHandler', 'TIM8_BRK_IRQHandler', 'TIM8_UP_IRQHandler',
  'TIM8_TRG_COM_IRQHandler', 'TIM8_CC_IRQHandler', 'I2C1_EV_IRQHandler', 'I2C1_ER_IRQHandler',
  'I2C2_EV_IRQHandler', 'I2C2_ER_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler',
  'USART1_IRQHandler', 'USART2_IRQHandler', 'USART3_IRQHandler', 'UART4_IRQHandler',
  'UART5_IRQHandler', 'LPUART1_IRQHandler', 'LPTIM1_IRQHandler', 'LPTIM2_IRQHandler',
  'TIM15_IRQHandler', 'TIM16_IRQHandler', 'TIM17_IRQHandler', 'COMP_IRQHandler',
  'USB_FS_IRQHandler', 'CRS_IRQHandler', 'FMC_IRQHandler', 'OCTOSPI1_IRQHandler',
  '0', 'SDMMC1_IRQHandler', '0', 'DMA2_Channel1_IRQHandler',
  'DMA2_Channel2_IRQHandler', 'DMA2_Channel3_IRQHandler', 'DMA2_Channel4_IRQHandler',
  'DMA2_Channel5_IRQHandler', 'DMA2_Channel6_IRQHandler', 'DMA2_Channel7_IRQHandler',
  'DMA2_Channel8_IRQHandler', 'I2C3_EV_IRQHandler', 'I2C3_ER_IRQHandler', 'SAI1_IRQHandler',
  'SAI2_IRQHandler', 'TSC_IRQHandler', '0', 'RNG_IRQHandler',
  'FPU_IRQHandler', 'HASH_IRQHandler', '0', 'LPTIM3_IRQHandler',
  'SPI3_IRQHandler', 'I2C4_ER_IRQHandler', 'I2C4_EV_IRQHandler', 'DFSDM1_FLT0_IRQHandler',
  'DFSDM1_FLT1_IRQHandler', 'DFSDM1_FLT2_IRQHandler', 'DFSDM1_FLT3_IRQHandler', 'UCPD1_IRQHandler',
  'ICACHE_IRQHandler', '0'
];

// The L562 table only differs where the L552 reserves the AES, PKA, and
// OTFDEC1 slots (IRQ 93, 97, 108).
export const stm32l562InterruptHandlers = [
  ...stm32l552InterruptHandlers.slice(0, 93),
  'AES_IRQHandler',
  ...stm32l552InterruptHandlers.slice(94, 97),
  'PKA_IRQHandler',
  ...stm32l552InterruptHandlers.slice(98, 108),
  'OTFDEC1_IRQHandler'
];

interface Stm32L5ProfileOptions {
  flashLength?: number;
  interruptHandlers?: string[];
}

export function createStm32L5Profile(
  part: string,
  linkerFileName: string,
  define: string,
  options: Stm32L5ProfileOptions = {}
): DeviceProfile {
  return {
    part,
    vendor: 'STM',
    series: 'L5x',
    family: 'STM32L5xx',
    core: 'cortex-m33',
    architecture: 'arm',
    toolchainPrefix: 'arm-none-eabi',
    defines: [define],
    compilerFlags: ['-mcpu=cortex-m33', '-mthumb', '-mfpu=fpv5-sp-d16', '-mfloat-abi=hard'],
    flash: { origin: 0x08000000, length: options.flashLength ?? 256 * 1024 },
    // SRAM1 (192K) and SRAM2 (64K) form one contiguous 256K block (RM092).
    ram: { origin: 0x20000000, length: 256 * 1024 },
    linkerFileName,
    gnuStartupFileName: `startup_${define.toLowerCase()}.S`,
    toolchainFileName: 'stm32l5-toolchain.cmake',
    interruptHandlers: [...(options.interruptHandlers ?? stm32l552InterruptHandlers)],
    debugTarget: 'stm32l5x'
  };
}
