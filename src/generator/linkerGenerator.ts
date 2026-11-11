import type { DeviceProfile } from '../devices/deviceProfiles';
import { hexadecimal, kilobytes } from '../shared/cmakeText';

export function generateLinkerScript(profile: DeviceProfile): string {
  const flashOrigin = hexadecimal(profile.flash.origin);
  const ramOrigin = hexadecimal(profile.ram.origin);
  const flashLength = kilobytes(profile.flash.length);
  const ramLength = kilobytes(profile.ram.length);
  const additionalMemory = (profile.additionalMemory ?? [])
    .map((region) => `  ${region.name} (${region.attributes}) : ORIGIN = ${hexadecimal(region.origin)}, LENGTH = ${kilobytes(region.length)}`)
    .join('\n');
  const memoryLines = [
    `  FLASH (rx)  : ORIGIN = ${flashOrigin}, LENGTH = ${flashLength}`,
    `  RAM (rw)    : ORIGIN = ${ramOrigin}, LENGTH = ${ramLength}`,
    additionalMemory
  ].filter(Boolean).join('\n');

  return `/* Generated for ${profile.part}. Review custom memory reservations before flashing. */
ENTRY(Reset_Handler)

/* Highest address of the stack. */
_estack = ORIGIN(RAM) + LENGTH(RAM);
_Min_Heap_Size = 0x200;
_Min_Stack_Size = 0x400;

MEMORY
{
${memoryLines}
}

SECTIONS
{
  .isr_vector :
  {
    . = ALIGN(4);
    KEEP(*(.isr_vector))
    . = ALIGN(4);
  } >FLASH

  .text :
  {
    . = ALIGN(4);
    *(.text)
    *(.text*)
    *(.glue_7)
    *(.glue_7t)
    *(.eh_frame)

    KEEP(*(.init))
    KEEP(*(.fini))

    . = ALIGN(4);
    _etext = .;
  } >FLASH

  .rodata :
  {
    . = ALIGN(4);
    *(.rodata)
    *(.rodata*)
    . = ALIGN(4);
  } >FLASH

  .ARM.extab (READONLY) :
  {
    . = ALIGN(4);
    *(.ARM.extab* .gnu.linkonce.armextab.*)
    . = ALIGN(4);
  } >FLASH

  .ARM (READONLY) :
  {
    . = ALIGN(4);
    __exidx_start = .;
    *(.ARM.exidx*)
    __exidx_end = .;
    . = ALIGN(4);
  } >FLASH

  .preinit_array (READONLY) :
  {
    . = ALIGN(4);
    PROVIDE_HIDDEN(__preinit_array_start = .);
    KEEP(*(.preinit_array*))
    PROVIDE_HIDDEN(__preinit_array_end = .);
    . = ALIGN(4);
  } >FLASH

  .init_array (READONLY) :
  {
    . = ALIGN(4);
    PROVIDE_HIDDEN(__init_array_start = .);
    KEEP(*(SORT(.init_array.*)))
    KEEP(*(.init_array*))
    PROVIDE_HIDDEN(__init_array_end = .);
    . = ALIGN(4);
  } >FLASH

  .fini_array (READONLY) :
  {
    . = ALIGN(4);
    PROVIDE_HIDDEN(__fini_array_start = .);
    KEEP(*(SORT(.fini_array.*)))
    KEEP(*(.fini_array*))
    PROVIDE_HIDDEN(__fini_array_end = .);
    . = ALIGN(4);
  } >FLASH

  _sidata = LOADADDR(.data);

  .data :
  {
    . = ALIGN(4);
    _sdata = .;
    *(.data)
    *(.data*)
    *(.RamFunc)
    *(.RamFunc*)
    . = ALIGN(4);
    _edata = .;
  } >RAM AT> FLASH

  . = ALIGN(4);
  .bss (NOLOAD) :
  {
    _sbss = .;
    __bss_start__ = _sbss;
    *(.bss)
    *(.bss*)
    *(COMMON)
    . = ALIGN(4);
    _ebss = .;
    __bss_end__ = _ebss;
  } >RAM

  ._user_heap_stack :
  {
    . = ALIGN(8);
    PROVIDE(end = .);
    PROVIDE(_end = .);
    . = . + _Min_Heap_Size;
    . = . + _Min_Stack_Size;
    . = ALIGN(8);
  } >RAM

  /* Fail the link when static data, heap, or stack exceed RAM. */
  ASSERT(_ebss + _Min_Heap_Size + _Min_Stack_Size <= ORIGIN(RAM) + LENGTH(RAM), "RAM overflow")

  .ARM.attributes 0 : { *(.ARM.attributes) }
}
`;
}

/**
 * armclang scatter file.
 *
 * `armlink` places the vector table first (`.isr_vector`), then read-only data,
 * and puts the read-write/zero-init sections (including the startup's `.stack`)
 * in RAM. GNU-only symbols such as `_estack` do not exist here: the Arm C
 * library's `__main` runs the scatter-load and the hardware loads MSP from the
 * `__initial_sp` vector.
 */
export function generateScatterFile(profile: DeviceProfile): string {
  const flashOrigin = hexadecimal(profile.flash.origin);
  const flashLength = hexadecimal(profile.flash.length);
  const ramOrigin = hexadecimal(profile.ram.origin);
  const ramLength = hexadecimal(profile.ram.length);
  return `; Scatter file generated for ${profile.part}.
LR_IROM1 ${flashOrigin} ${flashLength} {
  ER_IROM1 ${flashOrigin} ${flashLength} {
    *(.isr_vector, +First)
    *(InRoot$$Sections)
    .ANY (+RO)
  }
  RW_IRAM1 ${ramOrigin} ${ramLength} {
    .ANY (+RW +ZI)
  }
}
`;
}

/** Linker input for the profile's compiler family. */
export function generateLinkerFile(profile: DeviceProfile): string {
  return profile.toolchainFamily === 'armclang'
    ? generateScatterFile(profile)
    : generateLinkerScript(profile);
}
