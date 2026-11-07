/**
 * Generates CMakePresets.json for a Linux cross compilation project.
 */

import { generateCMakePresets as generateSharedPresets } from '../shared/cmakePresets';
import { linuxToolchainFileName } from './types';

export function generateLinuxCMakePresets(
  toolchainFileName: string = linuxToolchainFileName
): string {
  return generateSharedPresets({ toolchainFileName });
}
