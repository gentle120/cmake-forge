import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fixtureDeviceProfile, gd32F103Profile, registerFixtureVendors } from './support/fixtureDevice';

registerFixtureVendors();
import {
  generateDebugWorkflow,
  generateLinuxWorkflow,
  generateMcuWorkflow,
  generateNativeWorkflow,
  type ProjectWorkflowHost
} from '../generation/workflow';
import { createLinuxToolchain } from '../linux/toolchainGenerator';
import type { NativeProjectStructure } from '../native/types';
import { scanProject } from '../scanner/projectScanner';
import { getFlashProbeProfile } from '../flash/probeProfiles';
import { getFlashTargetProfile } from '../flash/targets/targetProfiles';

async function withWorkspace(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cmake-embedded-workflow-'));
  await writeFile(join(root, 'main.c'), 'int main(void) { return 0; }\n');
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createHost(
  root: string,
  confirmOverwrite: (files: string[]) => Promise<boolean> = async () => true
): ProjectWorkflowHost {
  return {
    workspaceRoot: () => root,
    scanWorkspace: (workspaceRoot) => scanProject(workspaceRoot),
    confirmOverwrite,
    updateSettings: async () => {}
  };
}

test('MCU workflow honours the selected compiler toolchain prefix', async () => {
  await withWorkspace(async (root) => {
    const result = await generateMcuWorkflow(createHost(root), fixtureDeviceProfile(), {
      toolchain: { family: 'gcc', prefix: 'arm-zephyr-eabi' }
    });
    assert.equal(result.ok, true);
    const toolchainFile = result.files.find((file) => /-toolchain\.cmake$/.test(file));
    assert.ok(toolchainFile);
    const toolchain = await readFile(join(root, toolchainFile), 'utf8');
    assert.match(toolchain, /CMAKE_C_COMPILER "arm-zephyr-eabi-gcc"/);
    assert.match(toolchain, /CMAKE_ASM_COMPILER "arm-zephyr-eabi-gcc"/);
    // IntelliSense must point at the same compiler, not the device default.
    const cpp = await readFile(join(root, '.vscode', 'c_cpp_properties.json'), 'utf8');
    assert.match(cpp, /arm-zephyr-eabi-gcc/);
    assert.doesNotMatch(cpp, /arm-none-eabi-gcc/);
  });
});

test('MCU workflow switches between armgcc and armclang layouts', async () => {
  await withWorkspace(async (root) => {
    const profile = fixtureDeviceProfile();
    const gcc = await generateMcuWorkflow(createHost(root), profile, {});
    assert.equal(gcc.ok, true);
    assert.ok(existsSync(join(root, 'STM32F103C8T6.ld')));
    assert.ok(existsSync(join(root, 'system', 'syscalls.c')));

    const armclang = await generateMcuWorkflow(createHost(root), profile, {
      toolchain: {
        family: 'armclang',
        cCompiler: 'D:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe',
        cxxCompiler: 'D:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe',
        cCompilerPath: 'D:/Keil_v5/ARM/ARMCLANG/bin/armclang.exe',
        fromelf: 'D:/Keil_v5/ARM/ARMCLANG/bin/fromelf.exe'
      }
    });
    assert.equal(armclang.ok, true);
    assert.ok(existsSync(join(root, 'STM32F103C8T6.sct')));
    // The other family's linker input is stale and removed.
    assert.equal(existsSync(join(root, 'STM32F103C8T6.ld')), false);
    const armCmake = await readFile(join(root, 'CMakeLists.txt'), 'utf8');
    assert.match(armCmake, /CMAKE_FROMELF/);
    assert.doesNotMatch(armCmake, /system\/syscalls\.c/);
    const config = JSON.parse(await readFile(join(root, '.mcu-cmake.json'), 'utf8')) as {
      toolchain: { family: string; linker: string };
    };
    assert.equal(config.toolchain.family, 'armclang');
    assert.equal(config.toolchain.linker, 'STM32F103C8T6.sct');
    const cpp = await readFile(join(root, '.vscode', 'c_cpp_properties.json'), 'utf8');
    assert.match(cpp, /clang-arm|armclang/);

    const back = await generateMcuWorkflow(createHost(root), profile, {});
    assert.equal(back.ok, true);
    assert.ok(existsSync(join(root, 'STM32F103C8T6.ld')));
    assert.equal(existsSync(join(root, 'STM32F103C8T6.sct')), false);
    assert.match(await readFile(join(root, 'CMakeLists.txt'), 'utf8'), /CMAKE_OBJCOPY/);
  });
});

test('MCU workflow writes one startup, one linker, and a relative result list', async () => {
  await withWorkspace(async (root) => {
    const result = await generateMcuWorkflow(
      createHost(root),
      fixtureDeviceProfile(),
      {}
    );

    assert.equal(result.ok, true);
    assert.equal(result.kind, 'mcu');
    assert.equal(result.files.filter((file) => file.toLowerCase().endsWith('.s')).length, 1);
    assert.equal(result.files.filter((file) => file.toLowerCase().endsWith('.ld')).length, 1);
    assert.ok(result.files.includes('startup_stm32f103xb.S'));
    assert.ok(result.files.includes('STM32F103C8T6.ld'));
    assert.match(await readFile(join(root, 'CMakeLists.txt'), 'utf8'), /CMAKE-EMBEDDED USER CODE BEGIN/);
  });
});

test('MCU workflow preserves an existing user CMake section', async () => {
  await withWorkspace(async (root) => {
    const initial = await generateMcuWorkflow(
      createHost(root),
      fixtureDeviceProfile(),
      {}
    );
    assert.equal(initial.ok, true);
    const cmakePath = join(root, 'CMakeLists.txt');
    const cmake = (await readFile(cmakePath, 'utf8')).replace(
      '# This section is preserved when CMakeLists.txt is generated again.',
      '# This section is preserved when CMakeLists.txt is generated again.\nset(MY_CUSTOM_FLAG ON)'
    );
    await writeFile(cmakePath, cmake);

    const result = await generateMcuWorkflow(
      createHost(root),
      fixtureDeviceProfile(),
      {}
    );

    assert.equal(result.ok, true);
    assert.match(await readFile(cmakePath, 'utf8'), /set\(MY_CUSTOM_FLAG ON\)/);
  });
});

test('declining overwrite leaves generated files untouched', async () => {
  await withWorkspace(async (root) => {
    const first = await generateMcuWorkflow(
      createHost(root),
      fixtureDeviceProfile(),
      {}
    );
    assert.equal(first.ok, true);
    const cmakePath = join(root, 'CMakeLists.txt');
    const before = await readFile(cmakePath, 'utf8');
    // An unchanged regeneration is silent now; make the file differ so the
    // overwrite question is actually raised.
    const edited = `${before}\n# local edit\n`;
    await writeFile(cmakePath, edited);

    const result = await generateMcuWorkflow(
      createHost(root, async () => false),
      fixtureDeviceProfile(),
      {}
    );

    assert.equal(result.ok, false);
    assert.equal(result.cancelled, true);
    assert.equal(await readFile(cmakePath, 'utf8'), edited);
  });
});

test('Linux workflow writes the Linux toolchain and project config without MCU files', async () => {
  await withWorkspace(async (root) => {
    const result = await generateLinuxWorkflow(createHost(root), createLinuxToolchain('arm'));

    assert.equal(result.ok, true);
    assert.equal(result.kind, 'linux');
    assert.ok(result.files.includes('cmake/linux-toolchain.cmake'));
    assert.ok(result.files.includes('.linux-cmake.json'));
    assert.equal(result.files.some((file) => file.endsWith('.ld')), false);
    assert.equal(result.files.some((file) => /\.S$/i.test(file)), false);
  });
});

test('native workflow writes a CMake project for the host C/C++ toolchain', async () => {
  await withWorkspace(async (root) => {
    const structure: NativeProjectStructure = {
      sources: ['main.c'],
      includeDirs: [],
      defines: [],
      targetName: 'daily_tool',
      targetType: 'executable',
      cStandard: 11,
      cxxStandard: 17
    };
    const result = await generateNativeWorkflow(createHost(root), structure);

    assert.equal(result.ok, true);
    assert.equal(result.kind, 'native');
    assert.ok(result.files.includes('CMakeLists.txt'));
    assert.ok(result.files.includes('CMakePresets.json'));
    assert.ok(result.files.includes('.native-cmake.json'));
    assert.equal(result.files.some((file) => file.endsWith('.ld')), false);
    assert.equal(result.files.some((file) => /\.S$/i.test(file)), false);
  });
});

test('linux and native regeneration stay silent when nothing changed', async () => {  // One workspace per direction: switching direction legitimately rewrites the
  // shared CMakeLists.txt, so only a same-direction rerun must be silent.
  await withWorkspace(async (root) => {
    const prompts: number[] = [];
    const host = createHost(root, async (files) => {
      prompts.push(files.length);
      return true;
    });
    const toolchain = createLinuxToolchain('arm');

    await generateLinuxWorkflow(host, toolchain);
    await generateLinuxWorkflow(host, toolchain);
    assert.deepEqual(prompts, []);
  });

  await withWorkspace(async (root) => {
    const prompts: number[] = [];
    const host = createHost(root, async (files) => {
      prompts.push(files.length);
      return true;
    });
    const structure: NativeProjectStructure = {
      sources: ['main.c'],
      includeDirs: [],
      defines: [],
      targetName: 'daily_tool',
      targetType: 'static',
      cStandard: 11,
      cxxStandard: 17
    };
    await generateNativeWorkflow(host, structure);
    await generateNativeWorkflow(host, structure);
    assert.deepEqual(prompts, []);
  });
});

test('MCU workflow copies the installed core headers into the project', async () => {
  await withWorkspace(async (root) => {
    const includeDir = join(root, 'core-storage', 'CMSIS', 'Core', 'Include');
    await mkdir(includeDir, { recursive: true });
    await writeFile(join(includeDir, 'core_cm3.h'), '/* core */');
    await writeFile(join(includeDir, 'cmsis_version.h'), '#define __CM3 1');
    const confirmed: string[] = [];
    const host = createHost(root, async (files) => {
      confirmed.push(...files);
      return true;
    });

    const first = await generateMcuWorkflow(host, fixtureDeviceProfile(), {
      corePack: { includeDir, version: '6.4.0' }
    });
    assert.equal(first.ok, true);
    assert.equal(
      await readFile(join(root, 'CMSIS', 'Include', 'core_cm3.h'), 'utf8'),
      '/* core */'
    );
    assert.match(await readFile(join(root, 'CMakeLists.txt'), 'utf8'), /CMSIS\/Include/);
    assert.match(first.message, /6\.4\.0/);

    // The copies take part in the overwrite check, not just the generated files.
    await writeFile(join(root, 'CMSIS', 'Include', 'core_cm3.h'), '/* stale */');
    const second = await generateMcuWorkflow(host, fixtureDeviceProfile(), {
      corePack: { includeDir, version: '6.4.0' }
    });
    assert.equal(second.ok, true);
    assert.equal(
      confirmed.some((file) => file.replace(/\\/g, '/').endsWith('CMSIS/Include/core_cm3.h')),
      true
    );
    assert.equal(confirmed.length, 1);
  });
});

test('unchanged MCU regeneration does not ask for overwrite and lists core headers', async () => {
  await withWorkspace(async (root) => {
    const includeDir = join(root, 'core-storage', 'CMSIS', 'Core', 'Include');
    await mkdir(includeDir, { recursive: true });
    await writeFile(join(includeDir, 'core_cm3.h'), '/* core */');
    await writeFile(join(includeDir, 'cmsis_version.h'), '#define __CM3 1');
    const prompts: number[] = [];
    const host = createHost(root, async (files) => {
      prompts.push(files.length);
      return true;
    });

    const first = await generateMcuWorkflow(host, fixtureDeviceProfile(), {
      corePack: { includeDir, version: '6.4.0' }
    });
    assert.equal(first.ok, true);
    assert.ok(first.files.includes('CMSIS/Include/core_cm3.h'));
    assert.equal(first.files.some((file) => file.endsWith('.mcu-cmake.json')), true);
    const config = JSON.parse(await readFile(join(root, '.mcu-cmake.json'), 'utf8')) as {
      generatedFiles: string[];
    };
    assert.ok(config.generatedFiles.includes('CMSIS/Include/core_cm3.h'));

    const second = await generateMcuWorkflow(host, fixtureDeviceProfile(), {
      corePack: { includeDir, version: '6.4.0' }
    });
    assert.equal(second.ok, true);
    assert.deepEqual(prompts, []);
  });
});

test('copies the device header and system files and cleans them up on a pack switch', async () => {
  await withWorkspace(async (root) => {
    const prompts: number[] = [];
    const host = createHost(root, async (files) => {
      prompts.push(files.length);
      return true;
    });
    const deviceSupport = [
      { relative: 'CMSIS/Device/Include/Example.h', content: Buffer.from('#define DEVICE 1\n') },
      { relative: 'CMSIS/Device/Include/system_example.h', content: Buffer.from('void SystemInit(void);\n') },
      { relative: 'CMSIS/Device/Source/system_example.c', content: Buffer.from('#include "Example.h"\nvoid SystemInit(void) { }\n') }
    ];

    const first = await generateMcuWorkflow(host, fixtureDeviceProfile(), { deviceSupport });
    assert.equal(first.ok, true);
    for (const file of deviceSupport) {
      assert.ok(first.files.includes(file.relative));
    }
    const cmake = await readFile(join(root, 'CMakeLists.txt'), 'utf8');
    assert.match(cmake, /CMSIS\/Device\/Include/);
    assert.match(cmake, /CMSIS\/Device\/Source\/system_example\.c/);
    const config = JSON.parse(await readFile(join(root, '.mcu-cmake.json'), 'utf8')) as {
      generatedFiles: string[];
    };
    assert.ok(config.generatedFiles.includes('CMSIS/Device/Include/Example.h'));

    // Unchanged input stays silent, including the copied files themselves.
    const second = await generateMcuWorkflow(host, fixtureDeviceProfile(), { deviceSupport });
    assert.equal(second.ok, true);
    assert.deepEqual(prompts, []);

    // A different Pack snapshot replaces the previous device files.
    const replaced = [
      { relative: 'CMSIS/Device/Include/Other.h', content: Buffer.from('#define DEVICE 2\n') },
      { relative: 'CMSIS/Device/Source/system_other.c', content: Buffer.from('void SystemInit(void) { }\n') }
    ];
    const third = await generateMcuWorkflow(host, fixtureDeviceProfile(), { deviceSupport: replaced });
    assert.equal(third.ok, true);
    assert.equal(prompts.length, 1);
    assert.equal(existsSync(join(root, 'CMSIS', 'Device', 'Include', 'Example.h')), false);
    assert.equal(existsSync(join(root, 'CMSIS', 'Device', 'Include', 'Other.h')), true);
  });
});

test('reuses a device system source the project already builds instead of copying a second one', async () => {
  await withWorkspace(async (root) => {
    // A project migrated from a vendor firmware repository ships its own
    // system_*.c; copying the Pack copy would define SystemInit twice.
    await mkdir(join(root, 'gd32_driver', 'src'), { recursive: true });
    await writeFile(join(root, 'gd32_driver', 'src', 'system_example.c'), 'void SystemInit(void) { }\n');

    const deviceSupport = [
      { relative: 'CMSIS/Device/Include/Example.h', content: Buffer.from('#define DEVICE 1\n') },
      { relative: 'CMSIS/Device/Include/system_example.h', content: Buffer.from('void SystemInit(void);\n') },
      { relative: 'CMSIS/Device/Source/system_example.c', content: Buffer.from('void SystemInit(void) { }\n') }
    ];
    const result = await generateMcuWorkflow(createHost(root), fixtureDeviceProfile(), { deviceSupport });

    assert.equal(result.ok, true);
    // The header is reused when the project has it; the missing system source is
    // still copied so the vendor SystemInit does not silently stay weak.
    assert.equal(result.files.some((file) => file.startsWith('CMSIS/Device/Include')), true);
    assert.equal(result.files.some((file) => file.startsWith('CMSIS/Device/Source')), false);
    assert.equal(existsSync(join(root, 'CMSIS', 'Device', 'Source')), false);
    assert.ok(result.warnings?.some((warning) => /SystemInit/.test(warning)));
    const cmake = await readFile(join(root, 'CMakeLists.txt'), 'utf8');
    assert.doesNotMatch(cmake, /CMSIS\/Device\/Source/);
  });
});

test('debug generation warns about the two reasons F5 exits immediately', async () => {
  await withWorkspace(async (root) => {
    const target = getFlashTargetProfile('stm32f1xx');
    const probe = getFlashProbeProfile('stlink');

    const missing = await generateDebugWorkflow(
      createHost(root),
      target,
      probe,
      'openocd-does-not-exist-anywhere'
    );
    assert.equal(missing.ok, true);
    assert.ok(missing.warnings?.some((warning) => /OpenOCD/.test(warning)));
    assert.ok(missing.warnings?.some((warning) => /构建/.test(warning)));

    // A resolvable OpenOCD plus a built preset is the healthy state: no warning.
    const openocd = join(root, 'tools', 'openocd');
    await mkdir(join(root, 'build', 'debug'), { recursive: true });
    await mkdir(join(root, 'tools'), { recursive: true });
    await writeFile(openocd, '');
    await writeFile(join(root, 'build', 'debug', 'firmware.elf'), '');

    const healthy = await generateDebugWorkflow(createHost(root), target, probe, openocd);
    assert.equal(healthy.ok, true);
    assert.equal(healthy.warnings, undefined);
    const launch = JSON.parse(await readFile(join(root, '.vscode', 'launch.json'), 'utf8')) as {
      configurations: Array<{ executable: string; toolchainPrefix?: string }>;
    };
    // The generated preset layout decides the executable, not CMake Tools state.
    assert.match(launch.configurations[0].executable, /^\$\{workspaceFolder\}\/build\/debug\/.+\.elf$/);

    const selected = await generateDebugWorkflow(
      createHost(root),
      target,
      probe,
      openocd,
      'openocd',
      undefined,
      { toolchainPrefix: 'arm-zephyr-eabi-' }
    );
    assert.equal(selected.ok, true);
    const selectedLaunch = JSON.parse(
      await readFile(join(root, '.vscode', 'launch.json'), 'utf8')
    ) as { configurations: Array<{ toolchainPrefix?: string }> };
    assert.equal(selectedLaunch.configurations[0].toolchainPrefix, 'arm-zephyr-eabi-');
  });
});

test('still copies the device header when the project only ships driver headers', async () => {
  await withWorkspace(async (root) => {
    // A driver library usually carries RTE_Components.h and the RCU register
    // header; that must not be mistaken for the project owning the device
    // support files.
    await mkdir(join(root, 'gd32_driver', 'include'), { recursive: true });
    await writeFile(join(root, 'gd32_driver', 'include', 'RTE_Components.h'), '#define RTE 1\n');
    await writeFile(join(root, 'gd32_driver', 'include', 'gd32f10x_rcu.h'), '#define RCU_CTL 1\n');

    const deviceSupport = [
      { relative: 'CMSIS/Device/Include/gd32f10x.h', content: Buffer.from('#define DEVICE 1\n') },
      { relative: 'CMSIS/Device/Include/gd32f10x_libopt.h', content: Buffer.from('#include "RTE_Components.h"\n') },
      { relative: 'CMSIS/Device/Include/gd32f10x_rcu.h', content: Buffer.from('#define RCU_CTL 2\n') },
      { relative: 'CMSIS/Device/Include/RTE_Components.h', content: Buffer.from('#define RTE_DEVICE_STDPERIPHERALS_RCU 1\n') },
      { relative: 'CMSIS/Device/Include/system_gd32f10x.h', content: Buffer.from('void SystemInit(void);\n') },
      { relative: 'CMSIS/Device/Source/system_gd32f10x.c', content: Buffer.from('void SystemInit(void) { }\n') }
    ];
    const result = await generateMcuWorkflow(createHost(root), fixtureDeviceProfile(), { deviceSupport });

    assert.equal(result.ok, true);
    assert.ok(result.files.includes('CMSIS/Device/Include/gd32f10x.h'));
    assert.ok(result.files.includes('CMSIS/Device/Source/system_gd32f10x.c'));
    assert.equal(result.warnings?.some((warning) => /器件头/.test(warning)) ?? false, false);
  });
});

test('Linux workflow writes the configured sysroot and remembers it', async () => {
  await withWorkspace(async (root) => {
    const first = await generateLinuxWorkflow(createHost(root), createLinuxToolchain('arm'), {
      sysroot: '/opt/arm-sysroot'
    });
    assert.equal(first.ok, true);
    const toolchainPath = join(root, 'cmake', 'linux-toolchain.cmake');
    assert.match(await readFile(toolchainPath, 'utf8'), /set\(CMAKE_SYSROOT "\/opt\/arm-sysroot"\)/);

    const config = JSON.parse(await readFile(join(root, '.linux-cmake.json'), 'utf8')) as {
      structure: { sysroot?: string };
    };
    assert.equal(config.structure.sysroot, '/opt/arm-sysroot');

    // A regeneration without the option keeps the remembered sysroot.
    const second = await generateLinuxWorkflow(createHost(root), createLinuxToolchain('arm'));
    assert.equal(second.ok, true);
    assert.match(await readFile(toolchainPath, 'utf8'), /CMAKE_SYSROOT/);
  });
});

test('switching the device removes the previous startup, linker, and toolchain', async () => {
  await withWorkspace(async (root) => {
    await writeFile(join(root, 'main.c'), 'int main(void) { return 0; }\n');
    const first = await generateMcuWorkflow(createHost(root), gd32F103Profile(), {});
    assert.equal(first.ok, true);
    assert.ok(existsSync(join(root, 'GD32F103C8T6.ld')));
    assert.ok(existsSync(join(root, 'startup_gd32f10x_md.S')));

    const second = await generateMcuWorkflow(createHost(root), fixtureDeviceProfile(), {});
    assert.equal(second.ok, true);
    assert.ok(existsSync(join(root, 'STM32F103C8T6.ld')));
    assert.ok(existsSync(join(root, 'startup_stm32f103xb.S')));
    assert.equal(existsSync(join(root, 'GD32F103C8T6.ld')), false);
    assert.equal(existsSync(join(root, 'startup_gd32f10x_md.S')), false);
    assert.equal(existsSync(join(root, 'cmake', 'gd32f10x-toolchain.cmake')), false);
    assert.ok(existsSync(join(root, 'cmake', 'stm32f1-toolchain.cmake')));
    // Device-independent newlib stubs stay so the regenerated project keeps
    // its runtime sources.
    assert.ok(existsSync(join(root, 'system', 'syscalls.c')));
  });
});

test('LLVM clang workflow writes a GNU linker script and no C runtime', async () => {
  await withWorkspace(async (root) => {
    await writeFile(join(root, 'main.c'), 'int main(void) { return 0; }\n');
    const result = await generateMcuWorkflow(createHost(root), fixtureDeviceProfile(), {
      toolchain: {
        family: 'clang',
        cCompiler: 'clang',
        cxxCompiler: 'clang++',
        cCompilerPath: 'C:/LLVM/bin/clang.exe'
      }
    });
    assert.equal(result.ok, true);
    assert.ok(existsSync(join(root, 'STM32F103C8T6.ld')));
    assert.equal(existsSync(join(root, 'system', 'syscalls.c')), false);
    assert.ok(existsSync(join(root, 'system', 'clang_runtime.c')));
    const cmake = await readFile(join(root, 'CMakeLists.txt'), 'utf8');
    assert.match(cmake, /"-nostdlib"/);
    assert.match(cmake, /"-fuse-ld=lld"/);
    assert.match(cmake, /system\/clang_runtime\.c/);
    const startup = await readFile(join(root, 'startup_stm32f103xb.S'), 'utf8');
    assert.match(startup, /__libc_init_array/);
    const cpp = await readFile(join(root, '.vscode', 'c_cpp_properties.json'), 'utf8');
    assert.match(cpp, /LLVM clang|clang-arm/);
  });
});
