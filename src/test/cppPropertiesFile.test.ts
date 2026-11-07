import assert from 'node:assert/strict';
import test from 'node:test';
import {
  baseWorkspaceSettings,
  compileCommandsPath,
  normalizeCompilerArgs,
  rewriteCppProperties,
  workspaceIntegration,
  type CppConfiguration
} from '../shared/cppPropertiesFile';

test('rewriteCppProperties creates a configuration when the file has none', () => {
  const result = JSON.parse(rewriteCppProperties(undefined, (entry) => ({ ...entry, marker: 1 }), 'New'));
  assert.equal(result.version, 4);
  assert.deepEqual(result.configurations, [{ name: 'New', marker: 1 }]);
});

test('rewriteCppProperties keeps user keys while rewriting every entry', () => {
  const content = JSON.stringify({
    version: 4,
    configurations: [{ name: 'Custom', includePath: ['${workspaceFolder}/inc'], defines: ['A=1'] }]
  });
  const result = JSON.parse(rewriteCppProperties(content, (entry) => ({ ...entry, name: 'Rewritten' }), 'New'));

  assert.deepEqual(result.configurations, [{
    name: 'Rewritten',
    includePath: ['${workspaceFolder}/inc'],
    defines: ['A=1']
  }]);
});

test('rewriteCppProperties rejects documents that are not a configuration object', () => {
  assert.throws(() => rewriteCppProperties('[]', (entry) => entry, 'New'), /must be a JSON object/);
  assert.throws(
    () => rewriteCppProperties('{"configurations":{}}', (entry) => entry, 'New'),
    /must be a JSON array/
  );
  assert.throws(
    () => rewriteCppProperties('{"configurations":[1]}', (entry) => entry, 'New'),
    /must be JSON objects/
  );
});

test('normalizeCompilerArgs drops empty arguments but keeps real ones', () => {
  assert.deepEqual(
    normalizeCompilerArgs({ compilerArgs: ['', '-O2'] } as CppConfiguration).compilerArgs,
    ['-O2']
  );
  const cleared = normalizeCompilerArgs({ compilerArgs: [''] } as CppConfiguration);
  assert.equal('compilerArgs' in cleared, false);
  const untouched = normalizeCompilerArgs({ name: 'x' } as CppConfiguration);
  assert.equal('compilerArgs' in untouched, false);
});

test('every direction shares one settings and integration description', () => {
  assert.deepEqual(baseWorkspaceSettings(), {
    'cmake.sourceDirectory': '${workspaceFolder}',
    'cmake.useCMakePresets': 'always',
    'cmake.configureOnOpen': true,
    'C_Cpp.intelliSenseEngine': 'default',
    'C_Cpp.default.compileCommands': '${workspaceFolder}/build/debug/compile_commands.json',
    'C_Cpp.dimInactiveRegions': true
  });
  assert.equal(compileCommandsPath, 'build/debug/compile_commands.json');
  assert.deepEqual(workspaceIntegration(), {
    cmakeTools: {
      preset: 'debug',
      configurePreset: 'debug',
      buildPreset: 'debug',
      settingsFile: '.vscode/settings.json'
    },
    cppTools: {
      configurationSource: 'CMake compile_commands.json',
      compileCommands: 'build/debug/compile_commands.json',
      dimInactiveRegions: true
    }
  });
});
