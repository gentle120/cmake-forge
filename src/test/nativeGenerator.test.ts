import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { generateNativeCMakeLists } from '../native/cmakeGenerator';
import { generateNativeCMakePresets } from '../native/presetsGenerator';
import { describeNativeProject } from '../native/projectStructure';
import type { ProjectDescription } from '../scanner/projectScanner';

const execFileAsync = promisify(execFile);

test('describes a native executable with C and C++ sources', () => {
  const project: ProjectDescription = {
    sources: ['src/main.cpp', 'src/util.c'],
    includeDirs: ['include', 'src'],
    defines: ['USE_MY_LIBRARY']
  };

  const structure = describeNativeProject(project, 'my_tool');

  assert.equal(structure.targetName, 'my_tool');
  assert.equal(structure.targetType, 'executable');
  assert.deepEqual(structure.sources, project.sources);
  assert.deepEqual(structure.includeDirs, project.includeDirs);
  assert.deepEqual(structure.defines, project.defines);
  assert.equal(structure.cStandard, 11);
  assert.equal(structure.cxxStandard, 17);
});

test('generates a native CMake project that preserves the user code section', () => {
  const structure = describeNativeProject({
    sources: ['src/main.cpp'],
    includeDirs: ['include'],
    defines: []
  }, 'daily_tool');
  const existing = `
cmake_minimum_required(VERSION 3.22)
# CMAKE-EMBEDDED USER CODE BEGIN
target_link_libraries(\${CMAKE_PROJECT_NAME} PRIVATE fmt::fmt)
# CMAKE-EMBEDDED USER CODE END
`;

  const generated = generateNativeCMakeLists(structure, existing);

  assert.match(generated, /project\(\$\{CMAKE_PROJECT_NAME\} C CXX\)/);
  assert.match(generated, /add_executable\(daily_tool\)/);
  assert.match(generated, /fmt::fmt/);
  assert.doesNotMatch(generated, /arm-none-eabi|startup_|\.ld/);
});

test('pins the selected host compiler before project()', () => {
  const structure = describeNativeProject({
    sources: ['src/main.c'],
    includeDirs: [],
    defines: []
  }, 'clang_tool', {
    toolchain: { cCompiler: 'clang', cxxCompiler: 'clang++' }
  });

  const generated = generateNativeCMakeLists(structure);
  assert.match(generated, /set\(CMAKE_C_COMPILER clang\)/);
  assert.match(generated, /set\(CMAKE_CXX_COMPILER clang\+\+\)/);
  // Compilers must be chosen before the project() call enables languages.
  assert.ok(generated.indexOf('set(CMAKE_C_COMPILER') < generated.indexOf('project('));
});

test('desktop compiler pinning uses portable driver names, never absolute paths', () => {
  const structure = describeNativeProject({
    sources: ['src/main.c'],
    includeDirs: [],
    defines: []
  }, 'portable_tool', {
    toolchain: { cCompiler: 'gcc', cxxCompiler: 'g++' }
  });

  const generated = generateNativeCMakeLists(structure);
  assert.match(generated, /set\(CMAKE_C_COMPILER gcc\)/);
  assert.match(generated, /set\(CMAKE_CXX_COMPILER g\+\+\)/);
  // A machine-specific path in a generated desktop project would break every
  // other machine; only `gcc`/`g++` command names are allowed.
  assert.doesNotMatch(generated, /[A-Za-z]:[\\/]/);
  assert.doesNotMatch(generated, /\/usr\/|\/opt\//);
});

test('leaves compiler detection to CMake without a selection', () => {
  const structure = describeNativeProject({
    sources: ['src/main.c'],
    includeDirs: [],
    defines: []
  }, 'auto_tool');

  const generated = generateNativeCMakeLists(structure);
  assert.doesNotMatch(generated, /set\(CMAKE_C_COMPILER/);
});

test('generates native debug and release presets', () => {
  const presets = JSON.parse(generateNativeCMakePresets());

  assert.deepEqual(
    presets.configurePresets.map((preset: { name: string }) => preset.name),
    ['debug', 'release']
  );
  assert.deepEqual(
    presets.buildPresets.map((preset: { name: string }) => preset.name),
    ['debug', 'release']
  );
  assert.equal(presets.configurePresets[0].cacheVariables.CMAKE_EXPORT_COMPILE_COMMANDS, 'ON');
  assert.equal(
    presets.configurePresets[0].cacheVariables.CMAKE_TOOLCHAIN_FILE,
    undefined
  );
});

test('native generator works against a real workspace structure', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-cmake-'));
  await writeFile(join(root, 'main.cpp'), 'int main() { return 0; }\n');
  try {
    const structure = describeNativeProject({
      sources: ['main.cpp'],
      includeDirs: [],
      defines: []
    }, 'cmake_native_smoke');
    const cmake = generateNativeCMakeLists(structure);

    assert.match(cmake, /add_executable\(cmake_native_smoke\)/);
    assert.match(cmake, /CMAKE_CXX_STANDARD 17/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('generated ordinary C++ project configures and builds with CMake and Ninja', async () => {
  const root = await mkdtemp(join(tmpdir(), 'native-cmake-build-'));
  try {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src', 'main.cpp'),
      '#include <iostream>\nint main() { std::cout << "ok\\n"; return 0; }\n'
    );
    const structure = describeNativeProject({
      sources: ['src/main.cpp'],
      includeDirs: ['src'],
      defines: []
    }, 'native_smoke');
    await writeFile(join(root, 'CMakeLists.txt'), generateNativeCMakeLists(structure));

    const buildDir = join(root, 'build', 'debug');
    await execFileAsync('cmake', [
      '-S', root,
      '-B', buildDir,
      '-G', 'Ninja',
      '-DCMAKE_BUILD_TYPE=Debug'
    ]);
    await execFileAsync('cmake', ['--build', buildDir]);
    await access(join(buildDir, process.platform === 'win32' ? 'native_smoke.exe' : 'native_smoke'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
