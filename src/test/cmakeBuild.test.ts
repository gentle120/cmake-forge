import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { importPack } from '../devices/importedProfiles';
import { getDeviceProfile } from '../devices/deviceProfiles';
import { generateCMakeLists } from '../generator/cmakeGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateToolchainFile } from '../generator/toolchainGenerator';
import { generateSyscalls, generateSysmem } from '../generator/runtimeGenerator';
import { generateGnuStartup } from '../generator/startupGenerator';
import { fixturePackBuffer } from './support/fixtureDevice';

const execFileAsync = promisify(execFile);
const firmwareBuildsEnabled = process.env.CMAKE_EMBEDDED_SKIP_FIRMWARE_BUILDS !== '1';

const firmwareBuildOptions = {
  skip: !firmwareBuildsEnabled
};

let fixturePackRegistered: Promise<void> | undefined;

/** Imports the fixture Pack once so every firmware part resolves like a real install. */
async function ensureFixturePackRegistered(): Promise<void> {
  if (!fixturePackRegistered) {
    fixturePackRegistered = (async () => {
      const storageRoot = await mkdtemp(join(tmpdir(), 'mcu-cmake-fixture-store-'));
      try {
        await importPack(fixturePackBuffer(), 'Example.F1_DFP.1.0.0.pack', storageRoot);
      } finally {
        await rm(storageRoot, { recursive: true, force: true });
      }
    })();
  }
  await fixturePackRegistered;
}

async function buildMinimalFirmware(part: string, options: { deviceFiles?: boolean } = {}): Promise<void> {
  await ensureFixturePackRegistered();
  const root = await mkdtemp(join(tmpdir(), 'mcu-cmake-build-'));
  const profile = getDeviceProfile(part);
  try {
    // Device support files mirror what a Pack import copies into a project:
    // a device header, its system header, and the SystemInit source.
    if (options.deviceFiles) {
      await mkdir(join(root, 'CMSIS', 'Device', 'Include'), { recursive: true });
      await mkdir(join(root, 'CMSIS', 'Device', 'Source'), { recursive: true });
      await writeFile(join(root, 'CMSIS', 'Device', 'Include', 'Example.h'), '#define EXAMPLE_VALUE 7\n');
      await writeFile(join(root, 'CMSIS', 'Device', 'Include', 'system_example.h'), 'void SystemInit(void);\n');
      await writeFile(
        join(root, 'CMSIS', 'Device', 'Source', 'system_example.c'),
        '#include "Example.h"\nvoid SystemInit(void) { }\n'
      );
    }
    await writeFile(join(root, 'CMakeLists.txt'), generateCMakeLists('firmware', {
      sources: ['main.c', 'startup.s'],
      includeDirs: [],
      defines: []
    }, profile, undefined, options.deviceFiles
      ? {
          projectPaths: ['CMSIS/Device/Include'],
          generatedSources: ['CMSIS/Device/Source/system_example.c']
        }
      : {}));
    await mkdir(join(root, 'cmake'), { recursive: true });
    await mkdir(join(root, 'system'), { recursive: true });
    await writeFile(join(root, 'cmake', profile.toolchainFileName), generateToolchainFile(profile));
    await writeFile(join(root, profile.linkerFileName), generateLinkerScript(profile));
    await writeFile(join(root, profile.gnuStartupFileName), generateGnuStartup(profile));
    await writeFile(join(root, 'system', 'syscalls.c'), generateSyscalls());
    await writeFile(join(root, 'system', 'sysmem.c'), generateSysmem());
    // Without device files the startup's weak SystemInit must carry the link;
    // binutils 2.44+ otherwise reports "Unknown destination type (ARM/Thumb)".
    await writeFile(join(root, 'main.c'), options.deviceFiles
      ? '#include "Example.h"\nvolatile int initialized_data = EXAMPLE_VALUE;\nint main(void) { return initialized_data; }\n'
      : 'volatile int initialized_data = 1;\nint main(void) { return initialized_data; }\n');
    await writeFile(join(root, 'startup.s'), '');

    const buildDir = join(root, 'build');
    await execFileAsync('cmake', [
      '-S', root,
      '-B', buildDir,
      '-G', 'Ninja',
      `-DCMAKE_TOOLCHAIN_FILE=${join(root, 'cmake', profile.toolchainFileName)}`
    ]);
    const buildResult = await execFileAsync('cmake', ['--build', buildDir]);
    const buildOutput = `${buildResult.stdout}\n${buildResult.stderr}`;
    assert.doesNotMatch(buildOutput, /does not take linker garbage collection into account/);
    await access(`${buildDir}/firmware.elf`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('generated files configure and build a minimal GD32F103 firmware', firmwareBuildOptions, async () => {
  await buildMinimalFirmware('GD32F103C8T6');
});

test('a copied device header and system source compile into the firmware', firmwareBuildOptions, async () => {
  await buildMinimalFirmware('GD32F103C8T6', { deviceFiles: true });
});

test('generated files configure and build a minimal STM32F407 firmware', firmwareBuildOptions, async () => {
  await buildMinimalFirmware('STM32F407VGT6');
});

test('generated files configure and build a minimal GD32F450 firmware', firmwareBuildOptions, async () => {
  await buildMinimalFirmware('GD32F450VGT6');
});

test('generated files configure and build a minimal STM32F103 firmware', firmwareBuildOptions, async () => {
  await buildMinimalFirmware('STM32F103C8T6');
});

test('generated files build the fixture pack F1 and F4 package variants', firmwareBuildOptions, async () => {
  for (const part of [
    'STM32F103R8T6',
    'STM32F103RCT6',
    'GD32F103C8T6',
    'GD32F103RCT6'
  ]) {
    await buildMinimalFirmware(part);
  }
});

/**
 * Builds the generated startup, linker script and toolchain for one core.
 *
 * The fixture Pack is all Cortex-M3/M4, so the ARMv6-M and ARMv8-M baseline
 * encodings would otherwise never be assembled by the suite — and the reset
 * handler used to contain Thumb-2-only instructions that fail on those cores.
 */
async function buildCoreVariant(core: string): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'mcu-cmake-core-'));
  const profile = {
    part: `CORE_${core.replace(/-/g, '_').toUpperCase()}`,
    vendor: 'CORE',
    series: 'variant',
    family: 'variant',
    core,
    architecture: 'arm' as const,
    toolchainPrefix: 'arm-none-eabi',
    defines: [],
    compilerFlags: [`-mcpu=${core}`, '-mthumb'],
    flash: { origin: 0x08000000, length: 64 * 1024 },
    ram: { origin: 0x20000000, length: 8 * 1024 },
    linkerFileName: `${core}.ld`,
    gnuStartupFileName: `startup_${core}.S`,
    toolchainFileName: 'variant-toolchain.cmake',
    interruptHandlers: ['IRQ0_Handler', 'IRQ1_Handler']
  };
  try {
    await writeFile(join(root, profile.gnuStartupFileName), generateGnuStartup(profile));
    await writeFile(join(root, profile.linkerFileName), generateLinkerScript(profile));
    await mkdir(join(root, 'cmake'), { recursive: true });
    await writeFile(join(root, 'cmake', profile.toolchainFileName), generateToolchainFile(profile));
    await mkdir(join(root, 'system'), { recursive: true });
    await writeFile(join(root, 'system', 'syscalls.c'), generateSyscalls());
    await writeFile(join(root, 'system', 'sysmem.c'), generateSysmem());
    await writeFile(join(root, 'main.c'), 'void SystemInit(void) {}\nint main(void) { return 0; }\n');
    await writeFile(join(root, 'CMakeLists.txt'), generateCMakeLists('firmware', {
      sources: ['main.c', profile.gnuStartupFileName],
      includeDirs: [],
      defines: []
    }, profile));
    const buildDir = join(root, 'build');
    await execFileAsync('cmake', [
      '-S', root,
      '-B', buildDir,
      '-G', 'Ninja',
      `-DCMAKE_TOOLCHAIN_FILE=${join(root, 'cmake', profile.toolchainFileName)}`,
      '-DCMAKE_BUILD_TYPE=Debug'
    ]);
    await execFileAsync('cmake', ['--build', buildDir]);
    await access(`${buildDir}/firmware.elf`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('the generated startup assembles for an ARMv6-M core', firmwareBuildOptions, async () => {
  // Thumb-1 only: `ldr sp, =...` and writeback addressing are Thumb-2 encodings
  // and fail to assemble on Cortex-M0 with "cannot honor width suffix".
  await buildCoreVariant('cortex-m0');
});

test('the generated startup assembles for an ARMv8-M baseline core', firmwareBuildOptions, async () => {
  await buildCoreVariant('cortex-m23');
});

test('the generated startup assembles for an ARMv8-M mainline core', firmwareBuildOptions, async () => {
  await buildCoreVariant('cortex-m33');
});
