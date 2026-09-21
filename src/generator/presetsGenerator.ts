export function generateCMakePresets(toolchainFileName = 'gd32-toolchain.cmake'): string {
  const configurePreset = (name: string, buildType: string, binaryDir: string): Record<string, unknown> => ({
    name,
    displayName: buildType,
    generator: 'Ninja',
    binaryDir,
    cacheVariables: {
      CMAKE_BUILD_TYPE: buildType,
      CMAKE_TOOLCHAIN_FILE: '${sourceDir}/cmake/' + toolchainFileName
    }
  });

  return `${JSON.stringify({
    version: 3,
    configurePresets: [
      configurePreset('debug', 'Debug', '${sourceDir}/build/debug'),
      configurePreset('release', 'Release', '${sourceDir}/build/release')
    ],
    buildPresets: [
      { name: 'debug', configurePreset: 'debug' },
      { name: 'release', configurePreset: 'release' }
    ]
  }, null, 2)}\n`;
}
