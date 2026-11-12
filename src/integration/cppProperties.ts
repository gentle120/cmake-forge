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

export interface McuCppPropertiesOptions {
  family?: 'gcc' | 'armclang' | 'clang';
  compilerPath?: string;
}

function configureEntry(
  entry: CppConfiguration,
  options: McuCppPropertiesOptions
): CppConfiguration {
  const configured = normalizeCompilerArgs({ ...entry });
  const armclang = options.family === 'armclang';
  const clang = options.family === 'clang';
  configured.name = armclang
    ? 'ARM Compiler 6 (armclang)'
    : clang ? 'LLVM clang (arm-none-eabi)' : 'ARM GCC (arm-none-eabi)';
  configured.compilerPath = options.compilerPath
    ?? (armclang ? 'armclang' : clang ? 'clang' : 'arm-none-eabi-gcc');
  configured.compileCommands = '${workspaceFolder}/build/debug/compile_commands.json';
  configured.intelliSenseMode = armclang || clang ? 'clang-arm' : 'gcc-arm';
  delete configured.configurationProvider;
  return configured;
}

export function configureCppProperties(
  content: string | undefined,
  options: McuCppPropertiesOptions | string = {}
): string {
  const resolved = typeof options === 'string' ? { compilerPath: options } : options;
  return rewriteCppProperties(content, (entry) => configureEntry(entry, resolved), 'MCU');
}
