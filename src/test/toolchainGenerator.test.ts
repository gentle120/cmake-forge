import assert from 'node:assert/strict';
import test from 'node:test';
import { generateToolchainFile } from '../generator/toolchainGenerator';
import { fixtureDeviceProfile, registerFixtureVendors } from './support/fixtureDevice';

registerFixtureVendors();

test('generates an arm-none-eabi toolchain file', () => {
  const toolchain = generateToolchainFile(fixtureDeviceProfile());

  assert.match(toolchain, /CMAKE_SYSTEM_PROCESSOR arm/);
  assert.match(toolchain, /arm-none-eabi-gcc/);
  assert.match(toolchain, /arm-none-eabi-g\+\+/);
  assert.match(toolchain, /CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY/);
  assert.match(toolchain, /set\(TARGET_FLAGS "-mcpu=cortex-m3 -mthumb"\)/);
  assert.match(toolchain, /CMAKE_C_FLAGS_INIT.*TARGET_FLAGS/);
  assert.match(toolchain, /CMAKE_ASM_FLAGS_INIT.*assembler-with-cpp.*MMD.*MP/);
  assert.match(toolchain, /-Wall.*-fdata-sections.*-ffunction-sections.*-fstack-usage/);
  assert.match(toolchain, /CMAKE_C_FLAGS_DEBUG "-Og -g3"/);
  assert.match(toolchain, /CMAKE_C_FLAGS_RELEASE "-Os -g0"/);
  assert.match(toolchain, /CMAKE_CXX_FLAGS_INIT.*fno-rtti.*fno-exceptions.*fno-threadsafe-statics/);
  assert.match(toolchain, /CMAKE_EXE_LINKER_FLAGS_INIT.*TARGET_FLAGS/);
  // Link flags live in CMakeLists.txt (target_link_options) so CMake quotes
  // paths with spaces; the toolchain keeps only architecture flags.
  assert.doesNotMatch(toolchain, /-T\$\{CMAKE_SOURCE_DIR\}/);
  assert.match(toolchain, /CMAKE_EXE_LINKER_FLAGS_INIT/);
  assert.doesNotMatch(toolchain, /--specs=nosys\.specs/);
  assert.doesNotMatch(toolchain, /STM32F103C8T6\.ld/);
  assert.doesNotMatch(toolchain, /-Wl,-Map=/);
});

test('generates hard-float Cortex-M4 compiler and linker flags', () => {
  const toolchain = generateToolchainFile(fixtureDeviceProfile({
    part: 'STM32F407VGT6',
    core: 'cortex-m4',
    linkerFileName: 'STM32F407VGT6.ld',
    compilerFlags: ['-mcpu=cortex-m4', '-mthumb', '-mfpu=fpv4-sp-d16', '-mfloat-abi=hard']
  }));

  assert.match(toolchain, /set\(TARGET_FLAGS "-mcpu=cortex-m4 -mthumb -mfpu=fpv4-sp-d16 -mfloat-abi=hard"\)/);
  assert.match(toolchain, /CMAKE_C_FLAGS_INIT.*TARGET_FLAGS/);
  assert.match(toolchain, /CMAKE_ASM_FLAGS_INIT.*TARGET_FLAGS/);
  assert.match(toolchain, /CMAKE_EXE_LINKER_FLAGS_INIT.*TARGET_FLAGS/);
  assert.doesNotMatch(toolchain, /-mcpu=cortex-m3/);
});

test('keeps Cortex-M3 profiles free of floating-point ABI flags', () => {
  const toolchain = generateToolchainFile(fixtureDeviceProfile());

  assert.doesNotMatch(toolchain, /-mfpu=|-mfloat-abi=/);
});

test('quotes compiler and artifact paths so spaces survive CMake', () => {
  const toolchain = generateToolchainFile(fixtureDeviceProfile({
    mcuCompiler: 'C:/Program Files (x86)/Arm GNU Toolchain arm-none-eabi/13.2/bin/arm-none-eabi-gcc.exe',
    mcuCxxCompiler: 'C:/Program Files (x86)/Arm GNU Toolchain arm-none-eabi/13.2/bin/arm-none-eabi-g++.exe',
    mcuObjcopy: 'C:/Program Files (x86)/Arm GNU Toolchain arm-none-eabi/13.2/bin/arm-none-eabi-objcopy.exe',
    mcuSize: 'C:/Program Files (x86)/Arm GNU Toolchain arm-none-eabi/13.2/bin/arm-none-eabi-size.exe'
  }));

  assert.match(toolchain, /set\(CMAKE_C_COMPILER "C:\/Program Files \(x86\)\/Arm GNU Toolchain/);
  assert.match(toolchain, /set\(CMAKE_CXX_COMPILER "C:\/Program Files/);
  assert.match(toolchain, /set\(CMAKE_OBJCOPY "C:\/Program Files/);
});

test('armclang toolchain sets the C++ target and quotes the compiler', () => {
  const toolchain = generateToolchainFile(fixtureDeviceProfile({
    toolchainFamily: 'armclang',
    linkerFileName: 'STM32F103C8T6.sct',
    mcuCompiler: 'D:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe',
    mcuCxxCompiler: 'D:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe',
    mcuFromelf: 'D:/Keil_v5/ARM/ARMCLANG/bin/fromelf.exe'
  }));
  assert.match(toolchain, /set\(CMAKE_C_COMPILER "D:\/Keil_v5/);
  assert.match(toolchain, /set\(CMAKE_CXX_COMPILER_TARGET arm-arm-none-eabi\)/);
  assert.match(toolchain, /set\(CMAKE_FROMELF "D:\/Keil_v5/);
  assert.doesNotMatch(toolchain, /--scatter=/);
});

test('LLVM clang toolchain targets arm-none-eabi without a C runtime', () => {
  const toolchain = generateToolchainFile(fixtureDeviceProfile({
    toolchainFamily: 'clang',
    mcuCompiler: 'D:/LLVM/bin/clang.exe',
    mcuCxxCompiler: 'D:/LLVM/bin/clang++.exe',
    mcuObjcopy: 'D:/LLVM/bin/llvm-objcopy.exe',
    mcuSize: 'D:/LLVM/bin/llvm-size.exe'
  }));
  assert.match(toolchain, /set\(CMAKE_C_COMPILER "D:\/LLVM\/bin\/clang\.exe"\)/);
  assert.match(toolchain, /set\(CMAKE_CXX_COMPILER_TARGET arm-none-eabi\)/);
  assert.match(toolchain, /set\(MCU_TOOLCHAIN_FAMILY clang/);
  assert.match(toolchain, /-nostdlib -fuse-ld=lld/);
  assert.match(toolchain, /llvm-objcopy/);
  assert.doesNotMatch(toolchain, /--specs=nano/);
  // `-ffreestanding` makes clang mangle C++ `main` on an ARM target; keep it
  // out of the C++ flags so startup's `bl main` resolves.
  assert.doesNotMatch(toolchain, /CMAKE_CXX_FLAGS_INIT[^\n]*-ffreestanding/);
});
