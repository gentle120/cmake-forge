/**
 * Visual Studio Code integration for the MCU direction.
 *
 * The `.vscode` document editing itself is shared with the Linux and desktop
 * directions (`../shared/cppPropertiesFile`); this module only decides what an
 * MCU entry must contain.
 */

import {
  normalizeCompilerArgs,
  rewriteCppProperties,
  type CppConfiguration
} from '../shared/cppPropertiesFile';

function configureEntry(entry: CppConfiguration, compilerPath: string): CppConfiguration {
  const configured = normalizeCompilerArgs({ ...entry });
  configured.name = 'ARM GCC (arm-none-eabi)';
  configured.compilerPath = compilerPath;
  configured.compileCommands = '${workspaceFolder}/build/debug/compile_commands.json';
  configured.intelliSenseMode = 'gcc-arm';
  delete configured.configurationProvider;
  return configured;
}

export function configureCppProperties(
  content: string | undefined,
  compilerPath = 'arm-none-eabi-gcc'
): string {
  return rewriteCppProperties(content, (entry) => configureEntry(entry, compilerPath), 'MCU');
}
