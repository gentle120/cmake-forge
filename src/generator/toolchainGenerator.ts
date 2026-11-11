import type { DeviceProfile } from '../devices/deviceProfiles';

/** Compiler command of the selected toolchain, falling back to the GCC prefix. */
function gccCompiler(profile: DeviceProfile, tool: 'gcc' | 'g++'): string {
  const configured = tool === 'gcc' ? profile.mcuCompiler : profile.mcuCxxCompiler;
  if (configured && configured.trim() !== '') {
    return configured.trim();
  }
  return `${profile.toolchainPrefix}-${tool}`;
}

function gccToolchainFile(profile: DeviceProfile): string {
  const prefix = profile.toolchainPrefix;
  const targetFlags = profile.compilerFlags.join(' ');
  const objcopy = profile.mcuObjcopy ?? `${prefix}-objcopy`;
  const size = profile.mcuSize ?? `${prefix}-size`;
  return `set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

set(CMAKE_C_COMPILER ${gccCompiler(profile, 'gcc')})
set(CMAKE_CXX_COMPILER ${gccCompiler(profile, 'g++')})
set(CMAKE_ASM_COMPILER ${gccCompiler(profile, 'gcc')})
set(CMAKE_OBJCOPY "${objcopy}" CACHE FILEPATH "objcopy executable")
set(CMAKE_SIZE "${size}" CACHE FILEPATH "size executable")
set(MCU_TOOLCHAIN_FAMILY gcc CACHE STRING "Compiler family")

set(TARGET_FLAGS "${targetFlags}")

# MCU-specific compiler and assembler flags.
set(CMAKE_C_FLAGS_INIT "\${TARGET_FLAGS} -Wall -fdata-sections -ffunction-sections -fstack-usage")
set(CMAKE_ASM_FLAGS_INIT "\${TARGET_FLAGS} -x assembler-with-cpp -MMD -MP")

# Keep the optimization settings in the toolchain, as CubeMX does.
set(CMAKE_C_FLAGS_DEBUG "-Og -g3")
set(CMAKE_C_FLAGS_RELEASE "-Os -g0")
set(CMAKE_C_FLAGS_MINSIZEREL "-Os -g0")
set(CMAKE_C_FLAGS_RELWITHDEBINFO "-Og -g3")

set(CMAKE_CXX_FLAGS_DEBUG "-Og -g3")
set(CMAKE_CXX_FLAGS_RELEASE "-Os -g0")
set(CMAKE_CXX_FLAGS_MINSIZEREL "-Os -g0")
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "-Og -g3")
set(CMAKE_CXX_FLAGS_INIT "\${TARGET_FLAGS} -Wall -fdata-sections -ffunction-sections -fstack-usage -fno-rtti -fno-exceptions -fno-threadsafe-statics")

# Link with the same architecture and the generated MCU memory layout.
set(CMAKE_EXE_LINKER_FLAGS_INIT "\${TARGET_FLAGS} -T\${CMAKE_SOURCE_DIR}/${profile.linkerFileName} --specs=nano.specs -Wl,-Map=\${CMAKE_BINARY_DIR}/\${CMAKE_PROJECT_NAME}.map -Wl,--gc-sections -Wl,--print-memory-usage")

set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
`;
}

/**
 * Arm Compiler 6 (armclang) toolchain.
 *
 * CMake links ARMClang projects with `armlink`, so the link options are armlink
 * options (`--scatter`, not `-T`). Armclang needs the absolute compiler path
 * when Keil is not on `PATH`; the sidebar passes it through the profile.
 */
function armclangToolchainFile(profile: DeviceProfile): string {
  const cCompiler = profile.mcuCompiler?.trim() || 'armclang';
  const cxxCompiler = profile.mcuCxxCompiler?.trim() || cCompiler;
  const targetFlags = profile.compilerFlags.join(' ');
  const fromelf = profile.mcuFromelf?.trim() || 'fromelf';
  return `set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
cmake_policy(SET CMP0123 NEW)

set(CMAKE_C_COMPILER "${cCompiler}")
set(CMAKE_CXX_COMPILER "${cxxCompiler}")
set(CMAKE_ASM_COMPILER "${cCompiler}")
set(CMAKE_C_COMPILER_TARGET arm-arm-none-eabi)
set(CMAKE_ASM_COMPILER_TARGET arm-arm-none-eabi)
set(CMAKE_FROMELF "${fromelf}" CACHE FILEPATH "fromelf executable")
set(MCU_TOOLCHAIN_FAMILY armclang CACHE STRING "Compiler family")
set(CMAKE_EXECUTABLE_SUFFIX ".elf")

set(TARGET_FLAGS "${targetFlags}")

# armclang compiles with the GCC-compatible target flags; the assembler needs
# the explicit target and preprocessed GNU syntax.
set(CMAKE_C_FLAGS_INIT "\${TARGET_FLAGS} -Wall -fdata-sections -ffunction-sections")
set(CMAKE_ASM_FLAGS_INIT "--target=arm-arm-none-eabi \${TARGET_FLAGS} -x assembler-with-cpp")

set(CMAKE_C_FLAGS_DEBUG "-O1 -g")
set(CMAKE_C_FLAGS_RELEASE "-O2 -g0")
set(CMAKE_C_FLAGS_MINSIZEREL "-Oz -g0")
set(CMAKE_C_FLAGS_RELWITHDEBINFO "-O1 -g")

set(CMAKE_CXX_FLAGS_DEBUG "-O1 -g")
set(CMAKE_CXX_FLAGS_RELEASE "-O2 -g0")
set(CMAKE_CXX_FLAGS_MINSIZEREL "-Oz -g0")
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "-O1 -g")
set(CMAKE_CXX_FLAGS_INIT "\${TARGET_FLAGS} -Wall -fdata-sections -ffunction-sections -fno-rtti -fno-exceptions")

# armlink options: scatter file, map, entry point. Unused sections are removed
# by default, so no --gc-sections equivalent is needed.
set(CMAKE_EXE_LINKER_FLAGS_INIT "--scatter=\${CMAKE_SOURCE_DIR}/${profile.linkerFileName} --map --entry=Reset_Handler")

set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
`;
}

export function generateToolchainFile(profile: DeviceProfile): string {
  return profile.toolchainFamily === 'armclang'
    ? armclangToolchainFile(profile)
    : gccToolchainFile(profile);
}
