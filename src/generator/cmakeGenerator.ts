import type { DeviceProfile } from '../devices/deviceProfiles';
import { runtimeSourceNames } from './runtimeGenerator';
import type { ProjectDescription } from '../scanner/projectScanner';
import { cmakeString, projectPath } from '../shared/cmakeText';
import { preserveUserCodeSection, userCodeSection } from '../shared/userCodeSection';

/**
 * Absolute include directories outside the project, e.g. the ARM CMSIS core pack
 * installed in extension storage. They are emitted verbatim because a relative
 * path would be resolved against the workspace root.
 */
export interface ExternalIncludeDirs {
  paths?: string[];
}

export function generateCMakeLists(
  projectName: string,
  project: ProjectDescription,
  profile: DeviceProfile,
  existingContent?: string,
  externalDirs: ExternalIncludeDirs = {}
): string {
  const sources = project.sources.filter((source) => !/\.s$/i.test(source));
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
  // The CMSIS core pack lives in extension storage, outside the workspace, so it
  // is quoted verbatim instead of being resolved against MCU_PROJECT_ROOT.
  const externalIncludes = (externalDirs.paths ?? [])
    .filter((path) => path.length > 0)
    .map((path) => `    "${cmakeString(path)}"`);
  const includeBlock = [...projectIncludes, ...externalIncludes].join('\n');

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
