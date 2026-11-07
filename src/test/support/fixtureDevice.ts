import type { DeviceProfile } from '../../devices/deviceProfiles';
import { hasVendor, registerVendor } from '../../devices/vendorRegistry';
import { buildZip } from './zipFixture';

/**
 * Shared chip data for tests now that the registry holds no built-in profiles:
 * every test either registers a fixture profile literal or imports the fixture
 * pack through the real Pack pipeline.
 */

/** Metadata of the former built-in STM32F103C8T6, used verbatim by tests. */
export function fixtureDeviceProfile(overrides?: Partial<DeviceProfile>): DeviceProfile {
  return {
    part: 'STM32F103C8T6',
    vendor: 'STM',
    series: 'F1x',
    family: 'STM32F1xx',
    core: 'cortex-m3',
    architecture: 'arm',
    toolchainPrefix: 'arm-none-eabi',
    defines: ['STM32F103xB'],
    compilerFlags: ['-mcpu=cortex-m3', '-mthumb'],
    flash: { origin: 0x08000000, length: 65536 },
    ram: { origin: 0x20000000, length: 20480 },
    linkerFileName: 'STM32F103C8T6.ld',
    gnuStartupFileName: 'startup_stm32f103xb.S',
    toolchainFileName: 'stm32f1-toolchain.cmake',
    interruptHandlers: [
      'WWDG_IRQHandler', 'PVD_IRQHandler', 'TAMPER_IRQHandler', 'RTC_IRQHandler',
      'FLASH_IRQHandler', 'RCC_IRQHandler', 'EXTI0_IRQHandler', 'EXTI1_IRQHandler',
      'EXTI2_IRQHandler', 'EXTI3_IRQHandler', 'EXTI4_IRQHandler',
      'DMA1_Channel1_IRQHandler', 'DMA1_Channel2_IRQHandler', 'DMA1_Channel3_IRQHandler',
      'DMA1_Channel4_IRQHandler', 'DMA1_Channel5_IRQHandler', 'DMA1_Channel6_IRQHandler',
      'DMA1_Channel7_IRQHandler', 'ADC1_2_IRQHandler', 'USB_HP_CAN1_TX_IRQHandler',
      'USB_LP_CAN1_RX0_IRQHandler', 'CAN1_RX1_IRQHandler', 'CAN1_SCE_IRQHandler',
      'EXTI9_5_IRQHandler', 'TIM1_BRK_IRQHandler', 'TIM1_UP_IRQHandler',
      'TIM1_TRG_COM_IRQHandler', 'TIM1_CC_IRQHandler', 'TIM2_IRQHandler',
      'TIM3_IRQHandler', 'TIM4_IRQHandler', 'I2C1_EV_IRQHandler', 'I2C1_ER_IRQHandler',
      'I2C2_EV_IRQHandler', 'I2C2_ER_IRQHandler', 'SPI1_IRQHandler', 'SPI2_IRQHandler',
      'USART1_IRQHandler', 'USART2_IRQHandler', 'USART3_IRQHandler',
      'EXTI15_10_IRQHandler', 'RTCAlarm_IRQHandler', 'USBWakeUp_IRQHandler'
    ],
    debugTarget: 'stm32f1x',
    ...overrides
  };
}

/** Former built-in GD32F103C8T6 metadata, Pack-style derived names included. */
export function gd32F103Profile(overrides?: Partial<DeviceProfile>): DeviceProfile {
  return fixtureDeviceProfile({
    part: 'GD32F103C8T6',
    vendor: 'GD',
    family: 'GD32F10x',
    defines: ['GD32F10X_MD'],
    linkerFileName: 'GD32F103C8T6.ld',
    gnuStartupFileName: 'startup_gd32f10x_md.S',
    toolchainFileName: 'gd32f10x-toolchain.cmake',
    ...overrides
  });
}

/** Former built-in STM32F407VGT6 metadata, Pack-style derived names included. */
export function stm32F407Profile(overrides?: Partial<DeviceProfile>): DeviceProfile {
  return fixtureDeviceProfile({
    part: 'STM32F407VGT6',
    core: 'cortex-m4',
    series: 'F4x',
    family: 'STM32F4xx',
    defines: ['STM32F407xx'],
    compilerFlags: ['-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard'],
    flash: { origin: 0x08000000, length: 1024 * 1024 },
    ram: { origin: 0x20000000, length: 128 * 1024 },
    additionalMemory: [{ name: 'CCMRAM', attributes: 'rw', origin: 0x10000000, length: 64 * 1024 }],
    debugTarget: 'stm32f4x',
    linkerFileName: 'STM32F407VGT6.ld',
    gnuStartupFileName: 'startup_stm32f407xx.S',
    toolchainFileName: 'stm32f4-toolchain.cmake',
    ...overrides
  });
}

/** Registers the vendor metadata tests rely on; safe to call repeatedly. */
export function registerFixtureVendors(): void {
  const vendors = [
    { id: 'STM', label: 'STM32', definePrefixes: ['STM32'], order: 0 },
    { id: 'GD', label: 'GD32', definePrefixes: ['GD32'], order: 1 }
  ];
  for (const vendor of vendors) {
    if (!hasVendor(vendor.id)) {
      registerVendor(vendor);
    }
  }
}

/** The SVD of the fixture pack: the F103 medium-density interrupt table. */
const fixtureSvd = `<?xml version="1.0" encoding="utf-8"?>
<device>
  <peripherals>
${fixtureDeviceProfile().interruptHandlers.map((handler, value) =>
  `    <peripheral><name>P${value}</name><interrupt><name>${handler.replace(/_IRQHandler$/, '')}</name><value>${value}</value></interrupt></peripheral>`
).join('\n')}
  </peripherals>
</device>
`;

interface FixtureDevice {
  name: string;
  family: string;
  subFamily: string;
  core: string;
  fpu?: string;
  define: string;
  flash: number;
  ram: number;
  additional?: Array<{ id: string; access: string; origin: number; size: number }>;
}

const fixtureDevices: FixtureDevice[] = [
  {
    name: 'STM32F103C8T6', family: 'STM32F1xx', subFamily: 'F1x', core: 'Cortex-M3',
    define: 'STM32F103xB', flash: 0x10000, ram: 0x5000
  },
  {
    name: 'STM32F103R8T6', family: 'STM32F1xx', subFamily: 'F1x', core: 'Cortex-M3',
    define: 'STM32F103xB', flash: 0x10000, ram: 0x5000
  },
  {
    name: 'STM32F103RCT6', family: 'STM32F1xx', subFamily: 'F1x', core: 'Cortex-M3',
    define: 'STM32F10X_HD', flash: 0x40000, ram: 0xC000
  },
  {
    name: 'STM32F407VGT6', family: 'STM32F4xx', subFamily: 'F4x', core: 'Cortex-M4', fpu: 'SP_FPU',
    define: 'STM32F407xx', flash: 0x100000, ram: 0x20000,
    additional: [{ id: 'CCMRAM', access: 'rw', origin: 0x10000000, size: 0x10000 }]
  },
  {
    name: 'GD32F103C8T6', family: 'GD32F10x', subFamily: 'F1x', core: 'Cortex-M3',
    define: 'GD32F10X_MD', flash: 0x10000, ram: 0x5000
  },
  {
    name: 'GD32F103RCT6', family: 'GD32F10x', subFamily: 'F1x', core: 'Cortex-M3',
    define: 'GD32F10X_HD', flash: 0x40000, ram: 0xC000
  },
  {
    name: 'GD32F450VGT6', family: 'GD32F4xx', subFamily: 'F4x', core: 'Cortex-M4', fpu: 'SP_FPU',
    define: 'GD32F450', flash: 0x100000, ram: 0x40000,
    additional: [{ id: 'TCMSRAM', access: 'rwx', origin: 0x10000000, size: 0x10000 }]
  }
];

const fixturePdsc = `<?xml version="1.0" encoding="utf-8"?>
<package>
  <vendor>Example</vendor>
  <name>Example.F1_DFP</name>
  <release version="1.0.0"/>
  <devices>
${[...new Set(fixtureDevices.map((device) => device.family))].map((family) => {
  const familyDevices = fixtureDevices.filter((device) => device.family === family);
  const subFamilies = [...new Set(familyDevices.map((device) => device.subFamily))];
  return subFamilies.map((subFamily) => `    <family Dvendor="Example:4711" Dfamily="${family}">
      <subFamily DsubFamily="${subFamily}">
${familyDevices.filter((device) => device.subFamily === subFamily).map((device) => `        <compile define="${device.define}"/>
        <device Dname="${device.name}">
          <processor Dcore="${device.core}"${device.fpu ? ` Dfpu="${device.fpu}"` : ''}/>
          <memory id="IROM1" start="0x08000000" size="${device.flash}"/>
          <memory id="IRAM1" start="0x20000000" size="${device.ram}"/>
${(device.additional ?? []).map((region) =>
  `          <memory id="${region.id}" access="${region.access}" start="0x${region.origin.toString(16)}" size="0x${region.size.toString(16)}"/>`
).join('\n')}
          <debug svd="STM32F103.svd"/>
        </device>`).join('\n')}
      </subFamily>
    </family>`).join('\n');
}).join('\n')}
  </devices>
</package>
`;

/**
 * A minimal but real CMSIS Pack archive whose devices mirror the former
 * built-in F1/F4 entries, so the Pack pipeline is testable end to end.
 */
export function fixturePackBuffer(): Buffer {
  return buildZip([
    { name: 'Example.F1_DFP.pdsc', data: fixturePdsc },
    { name: 'STM32F103.svd', data: fixtureSvd }
  ]);
}
