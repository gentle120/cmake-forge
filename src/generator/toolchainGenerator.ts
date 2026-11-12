import type { DeviceProfile } from '../devices/deviceProfiles';

/** Compiler command of the selected toolchain, falling back to the GCC prefix. */
function gccCompiler(profile: DeviceProfile, tool: 'gcc' | 'g++'): string {
  const configured = tool === 'gcc' ? profile.mcuCompiler : profile.mcuCxxCompiler;
  if (configured && configured.trim() !== '') {
    return configured.trim();
  }
  return `${profile.toolchainPrefix}-${tool}`;
}

/** Quotes a compiler command/path for `set(...)`; paths with spaces must stay one value. */
function cmakeQuoted(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

function gccToolchainFile(profile: DeviceProfile): string {
  const prefix = profile.toolchainPrefix;
  const targetFlags = profile.compilerFlags.join(' ');
  const objcopy = profile.mcuObjcopy ?? `${prefix}-objcopy`;
  const size = profile.mcuSize ?? `${prefix}-size`;
  return `set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

set(CMAKE_C_COMPILER ${cmakeQuoted(gccCompiler(profile, 'gcc'))})
set(CMAKE_CXX_COMPILER ${cmakeQuoted(gccCompiler(profile, 'g++'))})
set(CMAKE_ASM_COMPILER ${cmakeQuoted(gccCompiler(profile, 'gcc'))})
set(CMAKE_OBJCOPY ${cmakeQuoted(objcopy)} CACHE FILEPATH "objcopy executable")
set(CMAKE_SIZE ${cmakeQuoted(size)} CACHE FILEPATH "size executable")
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

# Link flags are declared with target_link_options in CMakeLists.txt so CMake
# quotes paths containing spaces; only the architecture flags stay here.
set(CMAKE_EXE_LINKER_FLAGS_INIT "\${TARGET_FLAGS}")

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
  const fromelf = profile.mcuFromelf?.trim();
  return `set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)
cmake_policy(SET CMP0123 NEW)

set(CMAKE_C_COMPILER "${cCompiler}")
set(CMAKE_CXX_COMPILER "${cxxCompiler}")
set(CMAKE_ASM_COMPILER "${cCompiler}")
set(CMAKE_C_COMPILER_TARGET arm-arm-none-eabi)
set(CMAKE_CXX_COMPILER_TARGET arm-arm-none-eabi)
set(CMAKE_ASM_COMPILER_TARGET arm-arm-none-eabi)
${fromelf === undefined ? '' : `set(CMAKE_FROMELF "${fromelf}" CACHE FILEPATH "fromelf executable")`}
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

# The scatter/map/entry flags are declared with target_link_options in
# CMakeLists.txt so CMake quotes a project path containing spaces.

set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
`;
}

/**
 * LLVM clang bare-metal toolchain.
 *
 * Clang's driver selects the ARM backend through `--target=arm-none-eabi`;
 * linking uses LLD (GNU linker scripts and the generated startup are accepted)
 * and `-nostdlib` because a standalone LLVM install ships no ARM C library.
 */
function clangToolchainFile(profile: DeviceProfile): string {
  const cCompiler = profile.mcuCompiler?.trim() || 'clang';
  const cxxCompiler = profile.mcuCxxCompiler?.trim() || 'clang++';
  const targetFlags = profile.compilerFlags.join(' ');
  const objcopy = profile.mcuObjcopy;
  const size = profile.mcuSize;
  return `set(CMAKE_SYSTEM_NAME Generic)
set(CMAKE_SYSTEM_PROCESSOR arm)

set(CMAKE_C_COMPILER "${cCompiler}")
set(CMAKE_CXX_COMPILER "${cxxCompiler}")
set(CMAKE_ASM_COMPILER "${cCompiler}")
set(CMAKE_C_COMPILER_TARGET arm-none-eabi)
set(CMAKE_CXX_COMPILER_TARGET arm-none-eabi)
set(CMAKE_ASM_COMPILER_TARGET arm-none-eabi)
set(MCU_TOOLCHAIN_FAMILY clang CACHE STRING "Compiler family")
set(CMAKE_EXECUTABLE_SUFFIX ".elf")
${objcopy === undefined ? '' : `set(CMAKE_OBJCOPY "${objcopy}" CACHE FILEPATH "objcopy executable")`}
${size === undefined ? '' : `set(CMAKE_SIZE "${size}" CACHE FILEPATH "size executable")`}

set(TARGET_FLAGS "--target=arm-none-eabi ${targetFlags}")

set(CMAKE_C_FLAGS_INIT "\${TARGET_FLAGS} -Wall -fdata-sections -ffunction-sections -ffreestanding")
set(CMAKE_ASM_FLAGS_INIT "\${TARGET_FLAGS} -x assembler-with-cpp")

set(CMAKE_C_FLAGS_DEBUG "-Og -g3")
set(CMAKE_C_FLAGS_RELEASE "-Os -g0")
set(CMAKE_C_FLAGS_MINSIZEREL "-Os -g0")
set(CMAKE_C_FLAGS_RELWITHDEBINFO "-Og -g3")

set(CMAKE_CXX_FLAGS_DEBUG "-Og -g3")
set(CMAKE_CXX_FLAGS_RELEASE "-Os -g0")
set(CMAKE_CXX_FLAGS_MINSIZEREL "-Os -g0")
set(CMAKE_CXX_FLAGS_RELWITHDEBINFO "-Og -g3")
set(CMAKE_CXX_FLAGS_INIT "\${TARGET_FLAGS} -Wall -fdata-sections -ffunction-sections -fno-rtti -fno-exceptions -fno-threadsafe-statics")

# LLD understands the generated GNU linker script; no C runtime is linked.
set(CMAKE_EXE_LINKER_FLAGS_INIT "\${TARGET_FLAGS} -nostdlib -fuse-ld=lld")

set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)
`;
}

export function generateToolchainFile(profile: DeviceProfile): string {
  if (profile.toolchainFamily === 'armclang') {
    return armclangToolchainFile(profile);
  }
  if (profile.toolchainFamily === 'clang') {
    return clangToolchainFile(profile);
  }
  return gccToolchainFile(profile);
}
