/**
 * Generates CMakePresets.json for a desktop C/C++ project.
 *
 * The shared presets own the Debug/Release Ninja configuration and the compile
 * database; the desktop CMakeLists.txt also enables it so a plain
 * `cmake --preset debug` produces it either way.
 */

import { generateCMakePresets as generateSharedPresets } from '../shared/cmakePresets';

export function generateNativeCMakePresets(): string {
  return generateSharedPresets();
}
