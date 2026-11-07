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
  return baseWorkspaceSettings();
}
