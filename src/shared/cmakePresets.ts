/**
 * Shared CMakePresets.json generation for the three directions.
 *
 * Every direction configures a `debug` and a `release` preset with Ninja under
 * `build/<preset>`; the MCU and Linux directions additionally point at a
 * generated toolchain file, while the desktop direction records the compile
 * database (its CMakeLists.txt does not enable it).
 */

export interface ConfigurePresetOptions {
  /** Toolchain file relative to `cmake/`, for cross-compiled directions. */
  toolchainFileName?: string;
}

function configurePreset(
  name: string,
  buildType: string,
  options: ConfigurePresetOptions
): Record<string, unknown> {
  const cacheVariables: Record<string, string> = { CMAKE_BUILD_TYPE: buildType };
  if (options.toolchainFileName) {
    cacheVariables.CMAKE_TOOLCHAIN_FILE = `\${sourceDir}/cmake/${options.toolchainFileName}`;
  } else {
    cacheVariables.CMAKE_EXPORT_COMPILE_COMMANDS = 'ON';
  }
  return {
    name,
    displayName: buildType,
    generator: 'Ninja',
    binaryDir: `\${sourceDir}/build/${name}`,
    cacheVariables
  };
}

export function generateCMakePresets(options: ConfigurePresetOptions = {}): string {
  return `${JSON.stringify({
    version: 3,
    configurePresets: [
      configurePreset('debug', 'Debug', options),
      configurePreset('release', 'Release', options)
    ],
    buildPresets: [
      { name: 'debug', configurePreset: 'debug' },
      { name: 'release', configurePreset: 'release' }
    ]
  }, null, 2)}\n`;
}
