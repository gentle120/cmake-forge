import type { DeviceProfile } from '../../deviceProfiles';

// External interrupts of the STM32WL55xx Cortex-M4 vector table in hardware
// order, transcribed from the ST cmsis-device-wl GCC startup
// (startup_stm32wl55xx_cm4.s); the dual-core table has no reserved slots
// between WWDG (IRQ 0) and DMAMUX1_OVR (IRQ 61).
export const stm32wlInterruptHandlers = [
  'WWDG_IRQHandler', 'PVD_PVM_IRQHandler', 'TAMP_STAMP_LSECSS_SSRU_IRQHandler', 'RTC_WKUP_IRQHandler',
  'FLASH_IRQHandler', 'RCC_IRQHandler', 'EXTI0_IRQHandler', 'EXTI1_IRQHandler',
  'EXTI2_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler', 'DMA1_Channel1_IRQHandler',
  'DMA1_Channel2_IRQHandler', 'DMA1_Channel3_IRQHandler', 'DMA1_Channel4_IRQHandler',
  'DMA1_Channel5_IRQHandler', 'DMA1_Channel6_IRQHandler', 'DMA1_Channel7_IRQHandler',
  'ADC_IRQHandler', 'DAC_IRQHandler', 'C2SEV_PWR_C2H_IRQHandler', 'COMP_IRQHandler',
  'EXTI9_5_IRQHandler', 'TIM1_BRK_IRQHandler', 'TIM1_UP_IRQHandler', 'TIM1_TRG_COM_IRQHandler',
  'TIM1_CC_IRQHandler', 'TIM2_IRQHandler', 'TIM16_IRQHandler', 'TIM17_IRQHandler',
  'I2C1_EV_IRQHandler', 'I2C1_ER_IRQHandler', 'I2C2_EV_IRQHandler', 'I2C2_ER_IRQHandler',
  'SPI1_IRQHandler', 'SPI2_IRQHandler', 'USART1_IRQHandler', 'USART2_IRQHandler',
  'LPUART1_IRQHandler', 'LPTIM1_IRQHandler', 'LPTIM2_IRQHandler', 'EXTI15_10_IRQHandler',
  'RTC_Alarm_IRQHandler', 'LPTIM3_IRQHandler', 'SUBGHZSPI_IRQHandler', 'IPCC_C1_RX_IRQHandler',
  'IPCC_C1_TX_IRQHandler', 'HSEM_IRQHandler', 'I2C3_EV_IRQHandler', 'I2C3_ER_IRQHandler',
  'SUBGHZ_Radio_IRQHandler', 'AES_IRQHandler', 'RNG_IRQHandler', 'PKA_IRQHandler',
  'DMA2_Channel1_IRQHandler', 'DMA2_Channel2_IRQHandler', 'DMA2_Channel3_IRQHandler',
  'DMA2_Channel4_IRQHandler', 'DMA2_Channel5_IRQHandler', 'DMA2_Channel6_IRQHandler',
  'DMA2_Channel7_IRQHandler', 'DMAMUX1_OVR_IRQHandler'
];

interface Stm32WlProfileOptions {
  define?: string;
  flashLength?: number;
  ramLength?: number;
  gnuStartupFileName?: string;
  interruptHandlers?: string[];
}

export function createStm32WlProfile(
  part: string,
  linkerFileName: string,
  options: Stm32WlProfileOptions = {}
): DeviceProfile {
  return {
    part,
    vendor: 'STM',
    series: 'WLx',
    family: 'STM32WLxx',
    core: 'cortex-m4',
    architecture: 'arm',
    toolchainPrefix: 'arm-none-eabi',
    defines: [options.define ?? 'STM32WL55xx'],
    // The WL55 application core is a Cortex-M4 without FPU, so unlike the
    // F4/L4 profiles these flags carry no -mfpu/-mfloat-abi pair.
    compilerFlags: ['-mcpu=cortex-m4', '-mthumb'],
    flash: { origin: 0x08000000, length: options.flashLength ?? 512 * 1024 },
    ram: { origin: 0x20000000, length: options.ramLength ?? 64 * 1024 },
    linkerFileName,
    gnuStartupFileName: options.gnuStartupFileName ?? 'startup_stm32wl55xx.S',
    toolchainFileName: 'stm32wl-toolchain.cmake',
    interruptHandlers: [...(options.interruptHandlers ?? stm32wlInterruptHandlers)],
    debugTarget: 'stm32wlx'
  };
}
