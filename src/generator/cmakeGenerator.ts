import type { DeviceProfile } from '../devices/deviceProfiles';
import { clangRuntimeFileName, runtimeSourceNames } from './runtimeGenerator';
import type { ProjectDescription } from '../scanner/projectScanner';
import { cmakeString, projectPath } from '../shared/cmakeText';
import { preserveUserCodeSection, userCodeSection } from '../shared/userCodeSection';

/**
 * Extra include directories and sources beyond the scanned ones.
 *
 * `paths` are absolute directories outside the project and are emitted verbatim;
 * `projectPaths` are relative to the project root and go through
 * `MCU_PROJECT_ROOT` like the scanned include directories do. `generatedSources`
 * are generated project-relative sources (the copied `system_*.c`) that the
 * workspace scan cannot know about.
 */
export interface AdditionalIncludeDirs {
  paths?: string[];
  projectPaths?: string[];
  generatedSources?: string[];
}

export function generateCMakeLists(
  projectName: string,
  project: ProjectDescription,
  profile: DeviceProfile,
  existingContent?: string,
  externalDirs: AdditionalIncludeDirs = {}
): string {
  const generatedStartup = (profile.gnuStartupFileName.split('/').pop() ?? '').toLowerCase();
  // A legacy startup source is replaced by the generated GNU startup, but other
  // hand-written assembly must stay in the build instead of being dropped.
  const runtimeBasenames = new Set(
    runtimeSourceNames.map((name) => (name.split('/').pop() ?? '').toLowerCase())
  );
  const gccFamily = profile.toolchainFamily !== 'armclang' && profile.toolchainFamily !== 'clang';
  const clangFamily = profile.toolchainFamily === 'clang';
  const clangRuntimeBasename = clangRuntimeFileName.split('/').pop()?.toLowerCase();
  const sources = project.sources.filter((source) => {
    const name = (source.split('/').pop() ?? '').toLowerCase();
    // A file left over from the other compiler family must not join the build.
    if (name === clangRuntimeBasename) return false;
    if (name === generatedStartup) return false;
    // A regenerated armclang project may still contain the newlib stubs from an
    // earlier GCC generation; they must not be compiled into an Arm C library
    // image.
    if (!gccFamily && runtimeBasenames.has(name)) return false;
    return !(name.startsWith('startup') && /\.s$/.test(name));
  });
  sources.push(profile.gnuStartupFileName);
  // Arm Compiler 6 uses its own C library retargeting and does not need the
  // newlib syscall stubs; adding them would fail on <sys/stat.h>.
  if (gccFamily) {
    for (const runtimeSourceName of runtimeSourceNames) {
      const runtimeBasename = runtimeSourceName.split('/').pop()?.toLowerCase();
      if (!sources.some((source) => source.split('/').pop()?.toLowerCase() === runtimeBasename)) {
        sources.push(runtimeSourceName);
      }
    }
  }
  if (clangFamily && !sources.some((source) => source.split('/').pop()?.toLowerCase() === clangRuntimeBasename)) {
    sources.push(clangRuntimeFileName);
  }
  // The copied device system source is generated, so it is not in the scan.
  for (const generatedSource of externalDirs.generatedSources ?? []) {
    if (!sources.some((source) => source.toLowerCase() === generatedSource.toLowerCase())) {
      sources.push(generatedSource);
    }
  }
  const hasCxx = sources.some((source) => /\.(cc|cpp|cxx)$/i.test(source));
  const languages = hasCxx ? 'C CXX ASM' : 'C ASM';
  const defines = [...new Set([...profile.defines, ...project.defines])]
    .filter((define) => !['VECT_TAB_OFFSET', 'STM32_HAL_LEGACY', 'HSE_VALUE', 'LSE_VALUE'].includes(define.split('=', 1)[0]))
    .sort();
  const defineBlock = defines.map((define) => `    ${define}`).join('\n');
  // A regenerated project scans its own generated runtime sources, so the raw
  // source list order changes between the first and second generation. Order and
  // de-duplicate deterministically or CMakeLists.txt would differ on every run
  // and ask the user to overwrite identical output.
  const orderedSources = [...new Map(
    sources.map((source) => [source.toLowerCase(), source])
  ).values()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()));
  const sourceBlock = orderedSources
    .map((source) => `    ${projectPath('MCU_PROJECT_ROOT', source)}`)
    .join('\n');
  const projectIncludes = project.includeDirs.length === 0
    ? [`    ${projectPath('MCU_PROJECT_ROOT', '.')}`]
    : project.includeDirs.map((directory) => `    ${projectPath('MCU_PROJECT_ROOT', directory)}`);
  // An absolute directory outside the project cannot be resolved against
  // MCU_PROJECT_ROOT, so it is quoted verbatim.
  const externalIncludes = (externalDirs.paths ?? [])
    .filter((path) => path.length > 0)
    .map((path) => `    "${cmakeString(path)}"`);
  const projectExtraIncludes = (externalDirs.projectPaths ?? [])
    .filter((path) => path.length > 0)
    .map((path) => `    ${projectPath('MCU_PROJECT_ROOT', path)}`);
  const includeBlock = [
    ...projectIncludes,
    ...projectExtraIncludes,
    ...externalIncludes
  ].join('\n');

  const armclang = profile.toolchainFamily === 'armclang';
  const linkOptionBlock = armclang
    ? [
        `    "--scatter=\${CMAKE_SOURCE_DIR}/${profile.linkerFileName}"`,
        '    "--map"',
        '    "--entry=Reset_Handler"'
      ].join('\n')
    : clangFamily
      ? [
          '    "-nostdlib"',
          '    "-fuse-ld=lld"',
          `    "-T\${CMAKE_SOURCE_DIR}/${profile.linkerFileName}"`,
          `    "-Wl,-Map=\${CMAKE_BINARY_DIR}/${projectName}.map"`,
          '    "-Wl,--gc-sections"',
          '    "-Wl,--print-memory-usage"'
        ].join('\n')
      : [
          `    "-T\${CMAKE_SOURCE_DIR}/${profile.linkerFileName}"`,
          '    "--specs=nano.specs"',
          `    "-Wl,-Map=\${CMAKE_BINARY_DIR}/${projectName}.map"`,
          '    "-Wl,--gc-sections"',
          '    "-Wl,--print-memory-usage"'
        ].join('\n');

  // Artifact generation differs per compiler family: armclang ships `fromelf`
  // while GCC uses objcopy/size. Emitting only the selected family's block keeps
  // the generated CMakeLists free of dead toolchain names.
  const artifactCommands = profile.toolchainFamily === 'armclang'
    ? `set_target_properties(${projectName} PROPERTIES
    ADDITIONAL_CLEAN_FILES "\${CMAKE_BINARY_DIR}/${projectName}.hex;\${CMAKE_BINARY_DIR}/${projectName}.bin"
)
if(CMAKE_FROMELF)
    add_custom_command(TARGET ${projectName} POST_BUILD
        COMMAND \${CMAKE_FROMELF} --i32 --output=\${CMAKE_BINARY_DIR}/${projectName}.hex \$<TARGET_FILE:${projectName}>
        COMMAND \${CMAKE_FROMELF} --bin --output=\${CMAKE_BINARY_DIR}/${projectName}.bin \$<TARGET_FILE:${projectName}>
        COMMAND \${CMAKE_FROMELF} --text -c -z \$<TARGET_FILE:${projectName}>
    )
endif()`
    : `set_target_properties(${projectName} PROPERTIES
    ADDITIONAL_CLEAN_FILES "\${CMAKE_BINARY_DIR}/${projectName}.map"
)
if(CMAKE_OBJCOPY AND CMAKE_SIZE)
    add_custom_command(TARGET ${projectName} POST_BUILD
        COMMAND \${CMAKE_OBJCOPY} -O ihex \$<TARGET_FILE:${projectName}> \${CMAKE_BINARY_DIR}/${projectName}.hex
        COMMAND \${CMAKE_OBJCOPY} -O binary \$<TARGET_FILE:${projectName}> \${CMAKE_BINARY_DIR}/${projectName}.bin
        COMMAND \${CMAKE_SIZE} \$<TARGET_FILE:${projectName}>
    )
endif()`;

const generated = `cmake_minimum_required(VERSION 3.22)

set(CMAKE_C_STANDARD 11)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS ON)
${hasCxx ? `set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS ON)
` : ''}if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE "Debug")
endif()

set(CMAKE_PROJECT_NAME ${projectName})
set(CMAKE_EXPORT_COMPILE_COMMANDS TRUE)

project(\${CMAKE_PROJECT_NAME} ${languages})
message("Build type: " \${CMAKE_BUILD_TYPE})

set(MCU_PROJECT_ROOT "\${CMAKE_CURRENT_SOURCE_DIR}")
set(CMAKE_EXECUTABLE_SUFFIX ".elf")

set(MCU_SOURCES
${sourceBlock}
)

add_executable(${projectName})
target_sources(${projectName} PRIVATE \${MCU_SOURCES})

target_include_directories(${projectName} PRIVATE
${includeBlock}
)

target_compile_definitions(${projectName} PRIVATE
${defineBlock}
)

# Linker flags live here, not in the toolchain: CMake quotes each option when
# the project path contains spaces, which a raw CMAKE_EXE_LINKER_FLAGS_INIT
# string cannot do.
target_link_options(${projectName} PRIVATE
${linkOptionBlock}
)

${userCodeSection()}

${artifactCommands}
`;

  return preserveUserCodeSection(existingContent, generated);
}
