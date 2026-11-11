import assert from 'node:assert/strict';
import test from 'node:test';
import {
  discoverBuildToolchains,
  discoverMcuBuildToolchains,
  findBuildToolchain,
  type BuildToolchainFileSystem
} from '../env/buildToolchains';

function fileSystem(tree: Record<string, string[]>): BuildToolchainFileSystem {
  return {
    readDir: (path) => {
      const entries = tree[path.replace(/\\/g, '/')];
      if (!entries) {
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      }
      return entries;
    }
  };
}

test('finds ARM bare-metal GCC installations on PATH', () => {
  const discovered = discoverBuildToolchains(
    { PATH: 'C:/arm/bin;C:/zephyr/bin;C:/linux-cross/bin' },
    fileSystem({
      'C:/arm/bin': ['arm-none-eabi-gcc.exe', 'arm-none-eabi-g++.exe', 'arm-none-eabi-gdb.exe'],
      'C:/zephyr/bin': ['arm-zephyr-eabi-gcc', 'arm-zephyr-eabi-g++'],
      'C:/linux-cross/bin': ['arm-linux-gnueabihf-gcc', 'arm-linux-gnueabihf-g++']
    }),
    'win32'
  );

  assert.deepEqual(discovered.mcu.map((toolchain) => toolchain.id), [
    'mcu:arm-none-eabi',
    'mcu:arm-zephyr-eabi'
  ]);
  const arm = discovered.mcu[0];
  assert.equal(arm.prefix, 'arm-none-eabi');
  assert.equal(arm.cCompiler, 'arm-none-eabi-gcc');
  assert.equal(arm.cxxCompiler, 'arm-none-eabi-g++');
  assert.equal(arm.binDir, 'C:/arm/bin');
  assert.equal(arm.label, 'Arm GNU Toolchain (arm-none-eabi)');
  // A Linux cross compiler is not an MCU toolchain.
  assert.ok(!arm.id.includes('linux'));
});

test('reports an MCU GCC without a C++ driver and deduplicates PATH entries', () => {
  const discovered = discoverBuildToolchains(
    { PATH: 'C:/only-c;C:/arm;C:/arm' },
    fileSystem({
      'C:/only-c': ['arm-none-eabi-gcc'],
      'C:/arm': ['arm-none-eabi-gcc', 'arm-none-eabi-g++']
    }),
    'win32'
  );

  assert.equal(discovered.mcu.length, 1);
  assert.equal(discovered.mcu[0].cxxCompiler, undefined);
  // The first PATH hit wins, matching how the shell would resolve `gcc`.
  assert.equal(discovered.mcu[0].binDir, 'C:/only-c');
});

test('finds host compilers and MinGW prefixes for desktop projects', () => {
  const discovered = discoverBuildToolchains(
    { PATH: 'C:/usr/bin;C:/mingw/bin' },
    fileSystem({
      'C:/usr/bin': ['gcc', 'g++', 'clang', 'clang++', 'python3'],
      'C:/mingw/bin': ['x86_64-w64-mingw32-gcc.exe', 'x86_64-w64-mingw32-g++.exe']
    }),
    'win32'
  );

  assert.deepEqual(discovered.native.map((toolchain) => toolchain.id), [
    'native:gcc',
    'native:clang',
    'native:x86_64-w64-mingw32'
  ]);
  assert.equal(discovered.native[0].cCompiler, 'gcc');
  assert.equal(discovered.native[0].cxxCompiler, 'g++');
  assert.equal(discovered.native[2].cCompiler, 'x86_64-w64-mingw32-gcc');
  assert.equal(discovered.native[2].cxxCompiler, 'x86_64-w64-mingw32-g++');
});

test('keeps only the plain driver when MinGW ships both in one bin directory', () => {
  const discovered = discoverBuildToolchains(
    { PATH: 'C:/mingw/bin' },
    fileSystem({
      'C:/mingw/bin': ['gcc.exe', 'g++.exe', 'x86_64-w64-mingw32-gcc.exe', 'x86_64-w64-mingw32-g++.exe']
    }),
    'win32'
  );

  assert.deepEqual(discovered.native.map((toolchain) => toolchain.cCompiler), ['gcc']);
});

test('survives unreadable PATH entries and empty environments', () => {
  const discovered = discoverBuildToolchains(
    { PATH: 'C:/missing;C:/arm/bin' },
    fileSystem({ 'C:/arm/bin': [] }),
    'win32'
  );
  assert.deepEqual(discovered, { mcu: [], native: [] });
  assert.deepEqual(discoverBuildToolchains({}, fileSystem({})), { mcu: [], native: [] });
});

test('resolves a selection id back to its toolchain', () => {
  const discovered = discoverBuildToolchains(
    { PATH: '/arm/bin' },
    fileSystem({ '/arm/bin': ['arm-none-eabi-gcc', 'arm-none-eabi-g++'] }),
    'linux'
  );

  assert.equal(findBuildToolchain(discovered, 'mcu', '')?.id, undefined);
  assert.equal(findBuildToolchain(discovered, 'mcu', 'mcu:arm-none-eabi')?.prefix, 'arm-none-eabi');
  assert.equal(findBuildToolchain(discovered, 'mcu', 'mcu:unknown'), undefined);
});

test('finds armclang in Keil and GCC on PATH for the MCU families', () => {
  const discovered = discoverMcuBuildToolchains(
    { PATH: 'C:/arm/bin', SystemDrive: 'C:' },
    fileSystem({
      'C:/arm/bin': ['arm-none-eabi-gcc.exe', 'arm-none-eabi-g++.exe'],
      'C:/Keil_v5/ARM/ARMCLANG/bin': ['armclang.exe', 'armlink.exe', 'fromelf.exe']
    }),
    'win32'
  );

  assert.deepEqual(discovered.map((toolchain) => toolchain.id), ['mcu:gcc', 'mcu:armclang']);
  assert.equal(discovered[0].prefix, 'arm-none-eabi');
  assert.equal(discovered[0].onPath, true);
  // armclang lives in Keil, which is not on PATH: the absolute path is required.
  assert.equal(discovered[1].onPath, false);
  assert.match(discovered[1].cCompiler, /Keil_v5\/ARM\/ARMCLANG\/bin\/armclang(\.exe)?$/);
  assert.match(discovered[1].fromelf ?? '', /Keil_v5\/ARM\/ARMCLANG\/bin\/fromelf(\.exe)?$/);
});

test('omits a family that is not installed', () => {
  const gccOnly = discoverMcuBuildToolchains(
    { PATH: 'C:/arm/bin', SystemDrive: 'C:' },
    fileSystem({ 'C:/arm/bin': ['arm-none-eabi-gcc.exe'] }),
    'win32'
  );
  assert.deepEqual(gccOnly.map((toolchain) => toolchain.id), ['mcu:gcc']);

  const armclangOnly = discoverMcuBuildToolchains(
    { PATH: '', SystemDrive: 'C:' },
    fileSystem({ 'C:/Keil_v5/ARM/ARMCLANG/bin': ['armclang.exe', 'fromelf.exe'] }),
    'win32'
  );
  assert.deepEqual(armclangOnly.map((toolchain) => toolchain.id), ['mcu:armclang']);

  const none = discoverMcuBuildToolchains({ PATH: '', SystemDrive: 'C:' }, fileSystem({}), 'win32');
  assert.deepEqual(none, []);
});

test('finds toolchains in program-files and non-system drive roots', () => {
  const discovered = discoverMcuBuildToolchains(
    {
      PATH: '',
      SystemDrive: 'C:',
      ProgramFiles: 'C:/Program Files'
    },
    fileSystem({
      'C:/': ['Program Files', 'Windows'],
      'C:/Program Files': ['Arm GNU Toolchain arm-none-eabi'],
      'C:/Program Files/Arm GNU Toolchain arm-none-eabi': ['13.2.rel1'],
      'C:/Program Files/Arm GNU Toolchain arm-none-eabi/13.2.rel1': ['bin'],
      'C:/Program Files/Arm GNU Toolchain arm-none-eabi/13.2.rel1/bin': ['arm-none-eabi-gcc.exe'],
      'D:/': ['Keil_v5'],
      'D:/Keil_v5/ARM/ARMCLANG/bin': ['armclang.exe', 'fromelf.exe']
    }),
    'win32'
  );

  assert.deepEqual(discovered.map((toolchain) => toolchain.id), ['mcu:gcc', 'mcu:armclang']);
  assert.match(discovered[0].detail, /Arm GNU Toolchain/);
  assert.match(discovered[1].detail, /Keil_v5/);
});

test('finds a standalone Arm Compiler under Program Files', () => {
  const discovered = discoverMcuBuildToolchains(
    {
      PATH: '',
      SystemDrive: 'C:',
      ProgramFiles: 'C:/Program Files'
    },
    fileSystem({
      'C:/': ['Program Files'],
      'C:/Program Files': ['Arm Compiler for Embedded 6.24'],
      'C:/Program Files/Arm Compiler for Embedded 6.24': ['bin'],
      'C:/Program Files/Arm Compiler for Embedded 6.24/bin': ['armclang.exe', 'fromelf.exe']
    }),
    'win32'
  );

  assert.deepEqual(discovered.map((toolchain) => toolchain.id), ['mcu:armclang']);
  assert.match(discovered[0].binDir, /Arm Compiler for Embedded 6\.24\/bin$/);
});

test('honours toolchain environment variables and PlatformIO/xPack layouts', () => {
  const discovered = discoverMcuBuildToolchains(
    {
      PATH: '',
      SystemDrive: 'C:',
      USERPROFILE: 'C:/Users/dev',
      ARMCLANG_PATH: 'D:/tools/ac6'
    },
    fileSystem({
      'C:/': [],
      'C:/Users/dev/.platformio/packages': ['toolchain-gccarmnoneeabi'],
      'C:/Users/dev/.platformio/packages/toolchain-gccarmnoneeabi/bin': ['arm-none-eabi-gcc.exe'],
      'C:/Users/dev/.xpack': ['@xpack-dev-tools'],
      'C:/Users/dev/.xpack/@xpack-dev-tools': ['arm-none-eabi-gcc'],
      'C:/Users/dev/.xpack/@xpack-dev-tools/arm-none-eabi-gcc': ['13.2.1-1.1'],
      'C:/Users/dev/.xpack/@xpack-dev-tools/arm-none-eabi-gcc/13.2.1-1.1': ['.content'],
      'C:/Users/dev/.xpack/@xpack-dev-tools/arm-none-eabi-gcc/13.2.1-1.1/.content': ['bin'],
      'C:/Users/dev/.xpack/@xpack-dev-tools/arm-none-eabi-gcc/13.2.1-1.1/.content/bin': ['arm-none-eabi-gcc.exe'],
      'D:/tools/ac6/bin': ['armclang.exe', 'fromelf.exe']
    }),
    'win32'
  );

  assert.deepEqual(discovered.map((toolchain) => toolchain.id), ['mcu:gcc', 'mcu:armclang']);
  assert.match(discovered[0].detail, /platformio/);
  assert.match(discovered[1].detail, /tools\/ac6\/bin/);
});

test('off-PATH GCC keeps absolute objcopy/size for builds without PATH setup', () => {
  const discovered = discoverMcuBuildToolchains(
    { PATH: '', SystemDrive: 'C:', MY_TOOLS_DIR: 'C:/tools/arm-gcc' },
    fileSystem({
      'C:/': ['tools'],
      'C:/tools/arm-gcc/bin': [
        'arm-none-eabi-gcc.exe',
        'arm-none-eabi-g++.exe',
        'arm-none-eabi-objcopy.exe',
        'arm-none-eabi-size.exe'
      ]
    }),
    'win32'
  );

  assert.deepEqual(discovered.map((toolchain) => toolchain.id), ['mcu:gcc']);
  assert.equal(discovered[0].onPath, false);
  assert.match(discovered[0].cCompiler, /arm-none-eabi-gcc\.exe$/);
  assert.match(discovered[0].objcopy ?? '', /arm-none-eabi-objcopy\.exe$/);
  assert.match(discovered[0].size ?? '', /arm-none-eabi-size\.exe$/);
});
