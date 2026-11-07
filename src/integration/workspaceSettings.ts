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

export type WorkspaceSettingValue = string | boolean;

export { workspaceIntegration as getWorkspaceIntegration };

export function getWorkspaceSettings(): Record<string, WorkspaceSettingValue> {
  return baseWorkspaceSettings();
}

export type { WorkspaceIntegration };
