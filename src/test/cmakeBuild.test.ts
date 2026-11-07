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

async function buildMinimalFirmware(part: string): Promise<void> {
  await ensureFixturePackRegistered();
  const root = await mkdtemp(join(tmpdir(), 'mcu-cmake-build-'));
  const profile = getDeviceProfile(part);
  try {
    await writeFile(join(root, 'CMakeLists.txt'), generateCMakeLists('firmware', {
      sources: ['main.c', 'startup.s'],
      includeDirs: [],
      defines: []
    }, profile));
    await mkdir(join(root, 'cmake'), { recursive: true });
    await mkdir(join(root, 'system'), { recursive: true });
    await writeFile(join(root, 'cmake', profile.toolchainFileName), generateToolchainFile(profile));
    await writeFile(join(root, profile.linkerFileName), generateLinkerScript(profile));
    await writeFile(join(root, profile.gnuStartupFileName), generateGnuStartup(profile));
    await writeFile(join(root, 'system', 'syscalls.c'), generateSyscalls());
    await writeFile(join(root, 'system', 'sysmem.c'), generateSysmem());
    await writeFile(join(root, 'main.c'), 'void SystemInit(void) {}\nvolatile int initialized_data = 1;\nint main(void) { return initialized_data; }\n');
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
