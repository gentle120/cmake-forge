/**
 * Visual Studio Code settings written by every generated project.
 *
 * CMake Tools and the C/C++ extension are pointed at the generated presets and
 * compile database; the shared values live in `../shared/cppPropertiesFile` so
 * all three directions cannot drift apart.
 */

import {
  baseWorkspaceSettings,
  workspaceIntegration,
  type WorkspaceIntegration
} from '../shared/cppPropertiesFile';

export type WorkspaceSettingValue = string | boolean | Record<string, string>;

export { workspaceIntegration as getWorkspaceIntegration };

export function getWorkspaceSettings(
  environment?: Record<string, string>
): Record<string, WorkspaceSettingValue> {
  const settings: Record<string, WorkspaceSettingValue> = baseWorkspaceSettings();
  if (environment && Object.keys(environment).length > 0) {
    // CMake Tools expands ${env:PATH}; this prepends the selected toolchain's
    // bin directory without baking an absolute path into CMAKE_C_COMPILER.
    settings['cmake.environment'] = environment;
  }
  return settings;
}

export type { WorkspaceIntegration };
