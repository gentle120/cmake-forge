/**
 * Generates CMakePresets.json for a desktop C/C++ project.
 *
 * The desktop CMakeLists.txt does not enable the compile database, so the preset
 * is the only place that turns it on for IntelliSense.
 */

import { generateCMakePresets as generateSharedPresets } from '../shared/cmakePresets';

export function generateNativeCMakePresets(): string {
  return generateSharedPresets();
}
