/**
 * Shared .vscode/c_cpp_properties.json editing for all three directions.
 *
 * The MCU, Linux and desktop generators rewrite the same file and must agree on
 * how an existing document is validated and rewritten; only the per-entry
 * configuration differs, so that part is injected by the caller.
 */

export type CppConfiguration = Record<string, unknown>;

export interface CppProperties {
  configurations?: unknown;
  version?: unknown;
  [key: string]: unknown;
}

/** Compile database location relative to the workspace root. */
export const compileCommandsPath = 'build/debug/compile_commands.json';
export const compileCommandsWorkspacePath = `\${workspaceFolder}/${compileCommandsPath}`;

/**
 * Rewrites every configuration entry, creating one when the document has none.
 * Throws when the existing document is not a JSON object with an array of
 * objects, because silently replacing a broken file would hide the user's edits.
 */
export function rewriteCppProperties(
  content: string | undefined,
  rewriteEntry: (entry: CppConfiguration) => CppConfiguration,
  newEntryName: string
): string {
  const properties: CppProperties = content
    ? JSON.parse(content) as CppProperties
    : { version: 4 };

  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error('C/C++ properties must be a JSON object.');
  }

  const configurations = properties.configurations;
  if (configurations === undefined) {
    properties.configurations = [rewriteEntry({ name: newEntryName })];
  } else if (Array.isArray(configurations)) {
    properties.configurations = configurations.map((configuration) => {
      if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) {
        throw new Error('C/C++ configuration entries must be JSON objects.');
      }
      return rewriteEntry(configuration as CppConfiguration);
    });
  } else {
    throw new Error('C/C++ configurations must be a JSON array.');
  }

  properties.version = 4;
  return `${JSON.stringify(properties, null, 4)}\n`;
}

/** Drops empty compiler arguments, keeping a user-supplied non-empty list intact. */
export function normalizeCompilerArgs(entry: CppConfiguration): CppConfiguration {
  if (!Array.isArray(entry.compilerArgs)) {
    return entry;
  }
  const compilerArgs = entry.compilerArgs.filter(
    (argument): argument is string => typeof argument === 'string' && argument.length > 0
  );
  if (compilerArgs.length === 0) {
    delete entry.compilerArgs;
  } else {
    entry.compilerArgs = compilerArgs;
  }
  return entry;
}

/**
 * CMake Tools and C/C++ settings every generated project needs.
 *
 * `useCMakePresets: 'never'` lets the desktop direction keep using CMake Tools
 * kits (the user's compiler choice); with `'always'` CMake Tools ignores kits
 * and the compiler is only whatever the preset/cache happens to contain.
 */
export function baseWorkspaceSettings(
  useCMakePresets: 'always' | 'never' = 'always'
): Record<string, string | boolean> {
  return {
    // The generated CMakeLists.txt and CMakePresets.json always live in the
    // workspace root, so a stale source directory would hide the generated
    // presets from CMake Tools.
    'cmake.sourceDirectory': '${workspaceFolder}',
    'cmake.useCMakePresets': useCMakePresets,
    'cmake.configureOnOpen': true,
    'C_Cpp.intelliSenseEngine': 'default',
    'C_Cpp.default.compileCommands': compileCommandsWorkspacePath,
    'C_Cpp.dimInactiveRegions': true
  };
}

export interface WorkspaceIntegration {
  cmakeTools: {
    preset: string;
    configurePreset: string;
    buildPreset: string;
    settingsFile: string;
  };
  cppTools: {
    configurationSource: string;
    compileCommands: string;
    dimInactiveRegions: boolean;
  };
}

export function workspaceIntegration(): WorkspaceIntegration {
  return {
    cmakeTools: {
      preset: 'debug',
      configurePreset: 'debug',
      buildPreset: 'debug',
      settingsFile: '.vscode/settings.json'
    },
    cppTools: {
      configurationSource: 'CMake compile_commands.json',
      compileCommands: compileCommandsPath,
      dimInactiveRegions: true
    }
  };
}
