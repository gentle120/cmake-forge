import assert from 'node:assert/strict';
import test from 'node:test';
import {
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

test('finds the Arm GNU Toolchain on PATH for MCU projects', () => {
  const discovered = discoverMcuBuildToolchains(
    { PATH: 'C:/arm/bin;C:/zephyr/bin;C:/linux-cross/bin', SystemDrive: 'C:' },
    fileSystem({
      'C:/arm/bin': ['arm-none-eabi-gcc.exe', 'arm-none-eabi-g++.exe', 'arm-none-eabi-gdb.exe'],
      'C:/zephyr/bin': ['arm-zephyr-eabi-gcc', 'arm-zephyr-eabi-g++'],
      'C:/linux-cross/bin': ['arm-linux-gnueabihf-gcc', 'arm-linux-gnueabihf-g++']
    }),
    'win32'
  );

  assert.deepEqual(discovered.map((toolchain) => toolchain.id), ['mcu:gcc']);
  const arm = discovered[0];
  assert.equal(arm.prefix, 'arm-none-eabi');
  assert.equal(arm.cCompiler, 'arm-none-eabi-gcc');
  assert.equal(arm.cxxCompiler, 'arm-none-eabi-g++');
  assert.equal(arm.binDir, 'C:/arm/bin');
  // Zephyr/Linux cross compilers are not offered as the MCU family.
  assert.ok(!arm.id.includes('linux'));
});

test('reports the first PATH hit and deduplicates the MCU family', () => {
  const discovered = discoverMcuBuildToolchains(
    { PATH: 'C:/only-c;C:/arm;C:/arm', SystemDrive: 'C:' },
    fileSystem({
      'C:/only-c': ['arm-none-eabi-gcc'],
      'C:/arm': ['arm-none-eabi-gcc', 'arm-none-eabi-g++']
    }),
    'win32'
  );

  assert.equal(discovered.length, 1);
  assert.equal(discovered[0].cxxCompiler, undefined);
  // The first PATH hit wins, matching how the shell would resolve the driver.
  assert.equal(discovered[0].binDir, 'C:/only-c');
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

test('resolves an MCU selection id back to its toolchain', () => {
  const discovered = discoverMcuBuildToolchains(
    { PATH: '/arm/bin' },
    fileSystem({ '/arm/bin': ['arm-none-eabi-gcc'] }),
    'linux'
  );
  assert.equal(findBuildToolchain(discovered, '')?.id, undefined);
  assert.equal(findBuildToolchain(discovered, 'mcu:gcc')?.prefix, 'arm-none-eabi');
  assert.equal(findBuildToolchain(discovered, 'mcu:unknown'), undefined);
});
