/**
 * Visual Studio Code integration for the desktop C/C++ direction.
 *
 * In kit mode CMake Tools owns the build directory and the compiler, so the
 * C/C++ extension asks CMake Tools for the configuration instead of pinning a
 * compile_commands.json path that only exists for the preset build.
 */

import {
  baseWorkspaceSettings,
  normalizeCompilerArgs,
  rewriteCppProperties,
  type CppConfiguration
} from '../shared/cppPropertiesFile';

function configureEntry(entry: CppConfiguration): CppConfiguration {
  const configured = normalizeCompilerArgs({ ...entry });
  configured.name = 'Desktop C/C++';
  configured.configurationProvider = 'ms-vscode.cmake-tools';
  configured.intelliSenseMode = '${default}';
  delete configured.compileCommands;
  delete configured.compilerPath;
  delete configured.compilerArgs;
  return configured;
}

export function configureNativeCppProperties(content: string | undefined): string {
  return rewriteCppProperties(content, (entry) => configureEntry(entry), 'Desktop C/C++');
}

export function getNativeWorkspaceSettings(): Record<string, string | boolean> {
  // Desktop keeps CMake Tools in kit mode: the user selects the compiler from
  // the CMake extension, and the generated CMakePresets.json stays available
  // for command-line builds only. CMake Tools supplies the compile database to
  // cpptools, so a hard-coded build/debug path would go stale in kit mode.
  const settings = baseWorkspaceSettings('never');
  delete settings['C_Cpp.default.compileCommands'];
  return settings;
}
