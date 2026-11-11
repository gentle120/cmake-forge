import assert from 'node:assert/strict';
import test from 'node:test';
import { fixtureDeviceProfile, gd32F103Profile, stm32F407Profile } from './support/fixtureDevice';
import { generateCMakeLists } from '../generator/cmakeGenerator';
import type { ProjectDescription } from '../scanner/projectScanner';

test('generates a CMake project for GD32F103C8T6', () => {
  const project: ProjectDescription = {
    sources: ['Core/Src/main.c', 'Core/Src/startup_gd32f103.s'],
    includeDirs: ['Core/Inc'],
    defines: ['GD32F10X_MD', 'VECT_TAB_OFFSET']
  };

  const cmake = generateCMakeLists('firmware', project, gd32F103Profile());

  assert.match(cmake, /project\(\$\{CMAKE_PROJECT_NAME\} C ASM\)/);
  assert.match(cmake, /set\(CMAKE_C_STANDARD 11\)[\s\S]*project\(\$\{CMAKE_PROJECT_NAME\} C ASM\)/);
  assert.match(cmake, /set\(MCU_SOURCES[\s\S]*Core\/Src\/main\.c[\s\S]*\)/);
  assert.doesNotMatch(cmake, /startup_gd32f103\.s/);
  assert.match(cmake, /MCU_PROJECT_ROOT.*startup_gd32f10x_md\.S/s);
  assert.match(cmake, /MCU_SOURCES[\s\S]*system\/syscalls\.c[\s\S]*system\/sysmem\.c/);
  assert.match(cmake, /target_sources\(firmware PRIVATE \$\{MCU_SOURCES\}\)/);
  assert.match(cmake, /GD32F10X_MD/);
  assert.doesNotMatch(cmake, /^\s+VECT_TAB_OFFSET\s*$/m);
  assert.match(cmake, /MCU_PROJECT_ROOT/);
  assert.doesNotMatch(cmake, /target_compile_options/);
  assert.doesNotMatch(cmake, /target_link_options/);
  assert.doesNotMatch(cmake, /gd32-gcc-compat|COMPILE_LANGUAGE:C,CXX.*-include/);
  assert.match(cmake, /CMAKE_OBJCOPY.*-O ihex/s);
});

test('adds the external CMSIS core include directory outside the project root', () => {
  const project: ProjectDescription = {
    sources: ['Core/Src/main.c'],
    includeDirs: ['Core/Inc'],
    defines: []
  };
  const coreDir = 'C:/Users/dev/AppData/Roaming/Code/User/globalStorage/vendor.ext/cores/ARM.CMSIS.6.4.0/CMSIS/Core/Include';

  const cmake = generateCMakeLists('firmware', project, gd32F103Profile(), undefined, {
    paths: [coreDir]
  });

  // The core pack lives in extension storage, so it cannot be resolved against
  // MCU_PROJECT_ROOT and must be absolute, with forward slashes for CMake.
  assert.match(cmake, /target_include_directories\([\s\S]*Core\/Inc/);
  assert.match(cmake, /"C:\/Users\/dev\/AppData\/Roaming[^"]*CMSIS\/Core\/Include"/);
  assert.doesNotMatch(cmake, /\$\{MCU_PROJECT_ROOT\}\/C:\//);
});

test('generates the same include block when no external directories exist', () => {
  const project: ProjectDescription = {
    sources: ['Core/Src/main.c'],
    includeDirs: ['Core/Inc'],
    defines: []
  };

  const withEmpty = generateCMakeLists('firmware', project, gd32F103Profile(), undefined, { paths: [] });
  const withoutArgument = generateCMakeLists('firmware', project, gd32F103Profile());

  assert.equal(withEmpty, withoutArgument);
});

test('enables CXX when the project contains C++ sources', () => {
  const project: ProjectDescription = {
    sources: ['Core/Src/main.cpp'],
    includeDirs: [],
    defines: []
  };

  const cmake = generateCMakeLists('firmware', project, gd32F103Profile());

  assert.match(cmake, /project\(\$\{CMAKE_PROJECT_NAME\} C CXX ASM\)/);
});

test('replaces legacy startup sources with the generated GNU startup file', () => {
  const project: ProjectDescription = {
    sources: ['main.c', 'startup_gd32f10x_md.s'],
    includeDirs: [],
    defines: []
  };

  const cmake = generateCMakeLists('firmware', project, gd32F103Profile());

  assert.doesNotMatch(cmake, /startup_gd32f10x_md\.s/);
  assert.match(cmake, /MCU_PROJECT_ROOT.*startup_gd32f10x_md\.S/s);
});

test('uses the selected STM32 startup, linker, and definitions in CMake', () => {
  const project: ProjectDescription = {
    sources: ['Core/Src/main.c', 'startup_stm32f407xx.s'],
    includeDirs: ['Core/Inc'],
    defines: []
  };

  const cmake = generateCMakeLists('firmware', project, stm32F407Profile());

  assert.match(cmake, /startup_stm32f407xx\.S/);
  assert.doesNotMatch(cmake, /startup_stm32f407xx\.s/);
  assert.match(cmake, /STM32F407xx/);
  assert.doesNotMatch(cmake, /GD32F10X_MD|gd32-gcc-compat|VECT_TAB_OFFSET/);
});

test('does not generate the STM32 HAL legacy or clock macros', () => {
  const project: ProjectDescription = {
    sources: ['Core/Src/main.c'],
    includeDirs: ['Drivers/STM32F4xx_HAL_Driver/Inc/Legacy'],
    defines: [
      'STM32_HAL_LEGACY',
      'HSE_VALUE=((uint32_t)25000000)',
      'LSE_VALUE=32768U',
      'USE_HAL_DRIVER'
    ]
  };

  const cmake = generateCMakeLists('firmware', project, stm32F407Profile());

  assert.match(cmake, /^\s+USE_HAL_DRIVER\s*$/m);
  assert.doesNotMatch(cmake, /^\s+STM32_HAL_LEGACY\s*$/m);
  assert.doesNotMatch(cmake, /^\s+HSE_VALUE=.*$/m);
  assert.doesNotMatch(cmake, /^\s+LSE_VALUE=.*$/m);
});

test('generates an English documented user code section for custom CMake settings', () => {
  const project: ProjectDescription = {
    sources: ['main.c'],
    includeDirs: [],
    defines: []
  };

  const cmake = generateCMakeLists('firmware', project, fixtureDeviceProfile({ part: 'STM32L496VET6' }));

  assert.match(cmake, /# CMAKE-EMBEDDED USER CODE BEGIN/);
  assert.match(cmake, /# Add user-defined library search paths[\s\S]*target_link_directories\(\$\{CMAKE_PROJECT_NAME\} PRIVATE[\s\S]*\)/);
  assert.match(cmake, /# Add user source and assembly files[\s\S]*target_sources\(\$\{CMAKE_PROJECT_NAME\} PRIVATE[\s\S]*\)/);
  assert.match(cmake, /# Add user-defined include paths[\s\S]*target_include_directories\(\$\{CMAKE_PROJECT_NAME\} PRIVATE[\s\S]*\)/);
  assert.match(cmake, /# Add user-defined compiler definitions[\s\S]*target_compile_definitions\(\$\{CMAKE_PROJECT_NAME\} PRIVATE[\s\S]*\)/);
  assert.match(cmake, /# Add user-defined libraries or library files[\s\S]*target_link_libraries\(\$\{CMAKE_PROJECT_NAME\} PRIVATE[\s\S]*\)/);
  assert.match(cmake, /# This section is preserved when CMakeLists\.txt is generated again\./);
  assert.match(cmake, /# CMAKE-EMBEDDED USER CODE END/);
  const userSection = cmake.match(
    /# CMAKE-EMBEDDED USER CODE BEGIN[\s\S]*?# CMAKE-EMBEDDED USER CODE END/
  )?.[0];
  assert.ok(userSection);
  assert.doesNotMatch(userSection, /(?:MCU_PROJECT_ROOT|USER_FEATURE|custom\.c|custom\.S|libcustom\.a|custom_math)/);
});

test('preserves the user code section when regenerating CMakeLists.txt', () => {
  const project: ProjectDescription = {
    sources: ['main.c'],
    includeDirs: [],
    defines: []
  };
  const profile = fixtureDeviceProfile({ part: 'STM32L496VET6' });
  const initial = generateCMakeLists('firmware', project, profile);
  const userSection = `# CMAKE-EMBEDDED USER CODE BEGIN
target_compile_definitions(firmware PRIVATE USER_FEATURE=1)
target_sources(firmware PRIVATE \${MCU_PROJECT_ROOT}/User/custom.S \${MCU_PROJECT_ROOT}/User/custom.c)
target_link_libraries(firmware PRIVATE \${MCU_PROJECT_ROOT}/libs/libcustom.a custom_math)
# Keep this comment and formatting.
# CMAKE-EMBEDDED USER CODE END`;
  const edited = initial.replace(
    /# CMAKE-EMBEDDED USER CODE BEGIN[\s\S]*?# CMAKE-EMBEDDED USER CODE END/,
    userSection
  );

  const regenerated = generateCMakeLists('firmware', project, profile, edited);

  assert.match(regenerated, /USER_FEATURE=1/);
  assert.match(regenerated, /User\/custom\.S/);
  assert.match(regenerated, /User\/custom\.c/);
  assert.match(regenerated, /libs\/libcustom\.a/);
  assert.match(regenerated, /custom_math/);
  assert.match(regenerated, /# Keep this comment and formatting\./);
  assert.equal(
    regenerated.match(/# CMAKE-EMBEDDED USER CODE BEGIN[\s\S]*?# CMAKE-EMBEDDED USER CODE END/)?.[0],
    userSection
  );
});

test('upgrades the previous empty user code section to active CMake blocks', () => {
  const project: ProjectDescription = {
    sources: ['main.c'],
    includeDirs: [],
    defines: []
  };
  const profile = gd32F103Profile();
  const initial = generateCMakeLists('firmware', project, profile);
  const previousEmptySection = `# CMAKE-EMBEDDED USER CODE BEGIN
# Add custom compiler definitions, include directories, source files,
# assembly files, library search paths, static library files, and libraries here.
# This section is preserved when CMakeLists.txt is generated again.

# CMAKE-EMBEDDED USER CODE END`;
  const edited = initial.replace(
    /# CMAKE-EMBEDDED USER CODE BEGIN[\s\S]*?# CMAKE-EMBEDDED USER CODE END/,
    previousEmptySection
  );

  const regenerated = generateCMakeLists('firmware', project, profile, edited);

  assert.match(regenerated, /target_link_directories\(\$\{CMAKE_PROJECT_NAME\} PRIVATE/);
  assert.match(regenerated, /target_sources\(\$\{CMAKE_PROJECT_NAME\} PRIVATE/);
  assert.match(regenerated, /target_include_directories\(\$\{CMAKE_PROJECT_NAME\} PRIVATE/);
  assert.match(regenerated, /target_compile_definitions\(\$\{CMAKE_PROJECT_NAME\} PRIVATE/);
  assert.match(regenerated, /target_link_libraries\(\$\{CMAKE_PROJECT_NAME\} PRIVATE/);
});

test('adds a project-relative include directory for copied CMSIS headers', () => {
  const project: ProjectDescription = {
    sources: ['Core/Src/main.c'],
    includeDirs: ['Core/Inc'],
    defines: []
  };

  const cmake = generateCMakeLists('firmware', project, gd32F103Profile(), undefined, {
    projectPaths: ['CMSIS/Core/Include']
  });

  assert.match(cmake, /"\$\{MCU_PROJECT_ROOT\}\/CMSIS\/Core\/Include"/);
  // A copied header directory is project-relative, never an absolute path.
  assert.doesNotMatch(cmake, /target_include_directories\([\s\S]*[A-Z]:\//);
});

test('keeps hand-written assembly and drops only legacy startup sources', () => {
  const project: ProjectDescription = {
    sources: [
      'Core/Src/main.c',
      'Core/Src/dsp_filter.S',
      'Core/Src/startup_gd32f10x_md.s',
      'startup_gd32f10x_md.S'
    ],
    includeDirs: [],
    defines: []
  };

  const cmake = generateCMakeLists('firmware', project, gd32F103Profile());

  assert.match(cmake, /MCU_PROJECT_ROOT.*Core\/Src\/dsp_filter\.S/s);
  assert.doesNotMatch(cmake, /startup_gd32f10x_md\.s/);
  // The generated startup is listed exactly once even though the project had it.
  assert.equal((cmake.match(/startup_gd32f10x_md\.S/g) ?? []).length, 1);
});

test('emits armclang artifact commands and no objcopy for an armclang profile', () => {
  const profile = {
    ...fixtureDeviceProfile(),
    toolchainFamily: 'armclang' as const,
    linkerFileName: 'STM32F103C8T6.sct',
    mcuCompiler: 'D:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe',
    mcuCompilerPath: 'D:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe',
    mcuFromelf: 'D:/Keil_v5/ARM/ARMCLANG/bin/fromelf.exe'
  };
  const cmake = generateCMakeLists('ac6_tool', {
    sources: ['main.c'],
    includeDirs: [],
    defines: []
  }, profile);

  assert.match(cmake, /CMAKE_FROMELF/);
  assert.match(cmake, /--i32/);
  assert.doesNotMatch(cmake, /CMAKE_OBJCOPY/);
  // Arm Compiler 6 has its own C library retargeting; no newlib syscalls.
  assert.doesNotMatch(cmake, /system\/syscalls\.c/);
  assert.match(cmake, /startup_stm32f103xb\.S/i);
});

test('gcc profiles keep the newlib runtime sources and objcopy commands', () => {
  const cmake = generateCMakeLists('gcc_tool', {
    sources: ['main.c'],
    includeDirs: [],
    defines: []
  }, fixtureDeviceProfile());

  assert.match(cmake, /CMAKE_OBJCOPY/);
  assert.doesNotMatch(cmake, /CMAKE_FROMELF/);
  assert.match(cmake, /system\/syscalls\.c/);
});
