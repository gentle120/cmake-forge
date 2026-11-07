/**
 * Visual Studio Code integration for the Linux direction.
 *
 * Mirrors the MCU integration: the `.vscode` document editing is shared, while
 * the C/C++ entry names the selected cross compiler. The build directory comes
 * from the generated presets: build/debug.
 */

import {
  baseWorkspaceSettings,
  compileCommandsPath,
  compileCommandsWorkspacePath,
  normalizeCompilerArgs,
  rewriteCppProperties,
  workspaceIntegration,
  type CppConfiguration,
  type WorkspaceIntegration
} from '../shared/cppPropertiesFile';
import type { LinuxToolchain } from './types';
import { getLinuxToolchainDefaults } from './types';

export type LinuxWorkspaceIntegration = WorkspaceIntegration;

/** Compile database location relative to the workspace root. */
export const linuxCompileCommandsPath = compileCommandsPath;

export function getLinuxWorkspaceIntegration(): LinuxWorkspaceIntegration {
  return workspaceIntegration();
}

export function getLinuxWorkspaceSettings(): Record<string, string | boolean> {
  return baseWorkspaceSettings();
}

function configureEntry(entry: CppConfiguration, toolchain: LinuxToolchain): CppConfiguration {
  const configured = normalizeCompilerArgs({ ...entry });
  const compiler = `${toolchain.compilerPrefix}gcc`;
  configured.name = `Linux GCC (${compiler})`;
  configured.compilerPath = compiler;
  configured.compileCommands = compileCommandsWorkspacePath;
  configured.intelliSenseMode = getLinuxToolchainDefaults(toolchain.family).intelliSenseMode;
  delete configured.configurationProvider;
  return configured;
}

export function configureLinuxCppProperties(
  content: string | undefined,
  toolchain: LinuxToolchain
): string {
  return rewriteCppProperties(content, (entry) => configureEntry(entry, toolchain), 'Linux');
}
