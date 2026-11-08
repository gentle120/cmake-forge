/**
 * Small formatting helpers shared by the CMake, linker-script, and project-config
 * generators. They exist so the three generators cannot drift apart on how a path
 * is quoted or how a memory address is printed.
 */

/** Escape a value for use inside a CMake string and normalize Windows separators. */
export function cmakeString(value: string): string {
  return value.replace(/\\/g, '/').replace(/"/g, '\\"');
}

/** A path relative to the project root, expanded at configure time. */
export function projectPath(rootVariable: string, value: string): string {
  return `"\${${rootVariable}}/${cmakeString(value)}"`;
}

/** Indent one entry per line by four spaces, the house style of the generated blocks. */
export function indented(values: string[]): string {
  return values.map((value) => `    ${value}`).join('\n');
}

/** A fixed-width hexadecimal address, as used by linker scripts and project config. */
export function hexadecimal(value: number): string {
  return `0x${value.toString(16).toUpperCase().padStart(8, '0')}`;
}

/**
 * A linker-script size: integer KiB when it divides evenly, exact bytes
 * otherwise. GNU ld rejects fractional sizes (`0.25K`) that some PDSC memory
 * regions (SAMD21's USER_ROW is 256 bytes) would otherwise produce.
 */
export function kilobytes(bytes: number): string {
  return bytes % 1024 === 0 ? `${bytes / 1024}K` : `${bytes}`;
}
