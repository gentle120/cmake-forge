import type { DeviceProfile } from '../devices/deviceProfiles';

// ARMv6-M (M0/M0+): words 4-10 are reserved and there is no DebugMonitor.
const armv6mCoreVectors = [
  'NMI_Handler',
  'HardFault_Handler',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  '0',
  'SVC_Handler',
  '0',
  '0',
  'PendSV_Handler',
  'SysTick_Handler'
];

// ARMv7-M (M3/M4/M7): four reserved words between UsageFault and SVC.
const armv7mCoreVectors = [
  'NMI_Handler',
  'HardFault_Handler',
  'MemManage_Handler',
  'BusFault_Handler',
  'UsageFault_Handler',
  '0',
  '0',
  '0',
  '0',
  'SVC_Handler',
  'DebugMon_Handler',
  '0',
  'PendSV_Handler',
  'SysTick_Handler'
];

// ARMv8-M mainline (M33/M55): SecureFault replaces the first reserved word.
const armv8mCoreVectors = [
  'NMI_Handler',
  'HardFault_Handler',
  'MemManage_Handler',
  'BusFault_Handler',
  'UsageFault_Handler',
  'SecureFault_Handler',
  '0',
  '0',
  '0',
  'SVC_Handler',
  'DebugMon_Handler',
  '0',
  'PendSV_Handler',
  'SysTick_Handler'
];

function coreVectorsFor(core: string): string[] {
  if (core === 'cortex-m0' || core === 'cortex-m0plus') {
    return armv6mCoreVectors;
  }
  if (core === 'cortex-m33' || core === 'cortex-m55') {
    return armv8mCoreVectors;
  }
  return armv7mCoreVectors;
}

export function generateGnuStartup(profile: DeviceProfile): string {
  const coreVectors = coreVectorsFor(profile.core);
  const vectors = [
    '_estack',
    'Reset_Handler',
    ...coreVectors,
    ...profile.interruptHandlers
  ];
  const vectorLines = vectors.map((handler) => `  .word ${handler}`).join('\n');
  const aliases = [...coreVectors, ...profile.interruptHandlers]
    .filter((handler) => handler !== '0')
    .map((handler) => `.weak ${handler}\n.thumb_set ${handler}, Default_Handler`)
    .join('\n');

  return `/* GNU startup generated for ${profile.part}. */
.syntax unified
.cpu ${profile.core}
.thumb

.section .isr_vector,"a",%progbits
.align 2
.global __Vectors
.type __Vectors, %object
__Vectors:
${vectorLines}
.size __Vectors, . - __Vectors

.section .text.Reset_Handler,"ax",%progbits
.thumb_func
.global Reset_Handler
.type Reset_Handler, %function
Reset_Handler:
  ldr sp, =_estack

  ldr r0, =_sidata
  ldr r1, =_sdata
  ldr r2, =_edata
  cmp r1, r2
  bcs 2f
1:
  ldr r3, [r0], #4
  str r3, [r1], #4
  cmp r1, r2
  bcc 1b
2:
  ldr r1, =_sbss
  ldr r2, =_ebss
  movs r3, #0
  cmp r1, r2
  bcs 4f
3:
  str r3, [r1], #4
  cmp r1, r2
  bcc 3b
4:
  /* SystemInit runs after the data copy and the BSS clear, as in the ST startup files. */
  bl SystemInit
  bl __libc_init_array
  bl main
5:
  b 5b
.size Reset_Handler, . - Reset_Handler

.section .text.Default_Handler,"ax",%progbits
.thumb_func
.global Default_Handler
.type Default_Handler, %function
Default_Handler:
  b .
.size Default_Handler, . - Default_Handler

${aliases}

.end
`;
}
