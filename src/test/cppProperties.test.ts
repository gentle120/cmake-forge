import assert from 'node:assert/strict';
import test from 'node:test';
import { configureCppProperties } from '../integration/cppProperties';

test('configures C/C++ properties from the generated ARM compile database', () => {
  const result = JSON.parse(configureCppProperties(JSON.stringify({
    configurations: [{
      name: 'windows-gcc-x64',
      compilerPath: 'd:/tools/mingw/bin/gcc.exe',
      compilerArgs: [''],
      intelliSenseMode: 'windows-gcc-x64',
      configurationProvider: 'ms-vscode.cmake-tools'
    }],
    version: 4
  })));

  assert.deepEqual(result.configurations[0], {
    name: 'ARM GCC (arm-none-eabi)',
    compilerPath: 'arm-none-eabi-gcc',
    compileCommands: '${workspaceFolder}/build/debug/compile_commands.json',
    intelliSenseMode: 'gcc-arm'
  });
});

test('creates a usable C/C++ properties file when none exists', () => {
  const result = JSON.parse(configureCppProperties(undefined));

  assert.equal(result.version, 4);
  assert.deepEqual(result.configurations, [{
    name: 'ARM GCC (arm-none-eabi)',
    compilerPath: 'arm-none-eabi-gcc',
    compileCommands: '${workspaceFolder}/build/debug/compile_commands.json',
    intelliSenseMode: 'gcc-arm'
  }]);
});

test('keeps a portable ARM GCC command without removing user include directories or defines', () => {
  const result = JSON.parse(configureCppProperties(JSON.stringify({
    configurations: [{ name: 'MCU', includePath: ['${workspaceFolder}/include'], defines: ['APP_FEATURE=1'] }]
  })));
  assert.equal(result.configurations[0].compilerPath, 'arm-none-eabi-gcc');
  assert.deepEqual(result.configurations[0].includePath, ['${workspaceFolder}/include']);
  assert.deepEqual(result.configurations[0].defines, ['APP_FEATURE=1']);
});
