/**
 * Visual Studio Code integration for the desktop C/C++ direction.
 *
 * The host compiler is left to the C/C++ extension's own default detection, so
 * the generated entry only points at the compile database.
 */

import {
  baseWorkspaceSettings,
  compileCommandsWorkspacePath,
  normalizeCompilerArgs,
  rewriteCppProperties,
  type CppConfiguration
} from '../shared/cppPropertiesFile';

function configureEntry(entry: CppConfiguration): CppConfiguration {
  const configured = normalizeCompilerArgs({ ...entry });
  configured.name = 'Desktop C/C++';
  configured.compileCommands = compileCommandsWorkspacePath;
  configured.intelliSenseMode = '${default}';
  delete configured.compilerPath;
  delete configured.compilerArgs;
  delete configured.configurationProvider;
  return configured;
}

export function configureNativeCppProperties(content: string | undefined): string {
  return rewriteCppProperties(content, (entry) => configureEntry(entry), 'Desktop C/C++');
}

export function getNativeWorkspaceSettings(): Record<string, string | boolean> {
  // Desktop keeps CMake Tools in kit mode: the user selects the compiler from
  // the CMake extension, and the generated CMakePresets.json stays available
  // for command-line builds only.
  return baseWorkspaceSettings('never');
}
