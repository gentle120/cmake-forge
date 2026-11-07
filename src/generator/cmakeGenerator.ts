import type { DeviceProfile } from '../devices/deviceProfiles';
import { runtimeSourceNames } from './runtimeGenerator';
import type { ProjectDescription } from '../scanner/projectScanner';
import { cmakeString, projectPath } from '../shared/cmakeText';
import { preserveUserCodeSection, userCodeSection } from '../shared/userCodeSection';

/**
 * Extra include directories beyond the scanned ones.
 *
 * `paths` are absolute directories outside the project and are emitted verbatim;
 * `projectPaths` are relative to the project root and go through
 * `MCU_PROJECT_ROOT` like the scanned include directories do.
 */
export interface AdditionalIncludeDirs {
  paths?: string[];
  projectPaths?: string[];
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
  const sources = project.sources.filter((source) => {
    const name = (source.split('/').pop() ?? '').toLowerCase();
    if (name === generatedStartup) return false;
    return !(name.startsWith('startup') && /\.s$/.test(name));
  });
  sources.push(profile.gnuStartupFileName);
  for (const runtimeSourceName of runtimeSourceNames) {
    const runtimeBasename = runtimeSourceName.split('/').pop()?.toLowerCase();
    if (!sources.some((source) => source.split('/').pop()?.toLowerCase() === runtimeBasename)) {
      sources.push(runtimeSourceName);
    }
  }
  const hasCxx = sources.some((source) => /\.(cc|cpp|cxx)$/i.test(source));
  const languages = hasCxx ? 'C CXX ASM' : 'C ASM';
  const defines = [...new Set([...profile.defines, ...project.defines])]
    .filter((define) => !['VECT_TAB_OFFSET', 'STM32_HAL_LEGACY', 'HSE_VALUE', 'LSE_VALUE'].includes(define.split('=', 1)[0]))
    .sort();
  const defineBlock = defines.map((define) => `    ${define}`).join('\n');
  const sourceBlock = sources
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

${userCodeSection()}

set_target_properties(${projectName} PROPERTIES
    ADDITIONAL_CLEAN_FILES "\${CMAKE_BINARY_DIR}/${projectName}.map"
)

if(CMAKE_OBJCOPY AND CMAKE_SIZE)
    add_custom_command(TARGET ${projectName} POST_BUILD
        COMMAND \${CMAKE_OBJCOPY} -O ihex \$<TARGET_FILE:${projectName}> \${CMAKE_BINARY_DIR}/${projectName}.hex
        COMMAND \${CMAKE_OBJCOPY} -O binary \$<TARGET_FILE:${projectName}> \${CMAKE_BINARY_DIR}/${projectName}.bin
        COMMAND \${CMAKE_SIZE} \$<TARGET_FILE:${projectName}>
    )
endif()
`;

  return preserveUserCodeSection(existingContent, generated);
}
