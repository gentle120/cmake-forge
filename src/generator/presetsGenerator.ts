import { generateCMakePresets as generateSharedPresets } from '../shared/cmakePresets';

/** Generates CMakePresets.json for an MCU project built with the generated toolchain file. */
export function generateCMakePresets(toolchainFileName: string): string {
  return generateSharedPresets({ toolchainFileName });
}
