import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  backendSupportsProbe,
  defaultBackendFor,
  getFlashBackendProfile,
  jlinkDeviceName,
  jlinkGenericDeviceName,
  listFlashBackendProfiles,
  pyocdTargetName
} from '../flash/backendProfiles';
import { getFlashProbeProfile } from '../flash/probeProfiles';
import { getFlashTargetProfile } from '../flash/targets/targetProfiles';
import {
  generateFlashScript,
  type FlashDeviceContext
} from '../generator/flashScriptGenerator';
import { generateCortexDebugLaunchJson } from '../generator/debugConfigGenerator';

function assertPythonSyntax(script: string): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const child = spawn('python', ['-c', 'import sys; compile(sys.stdin.read(), "<flash.py>", "exec")'], {
    stdio: ['pipe', 'ignore', 'pipe']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  child.on('error', reject);
  child.on('close', (code) => {
    if (code === 0) {
      resolve();
    } else {
      reject(new Error(stderr || `python exited with code ${code}`));
    }
  });
  child.stdin.end(script);
  return promise;
}

const importedDevice: FlashDeviceContext = {
  part: 'MS32F031A6A0ZW',
  core: 'cortex-m0',
};

async function withPackFile(run: (packFile: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cmake-embedded-flash-'));
  const packFile = join(root, 'MS32F031_DFP.1.0.0.pack');
  await writeFile(packFile, 'pack');
  try {
    await run(packFile);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('exposes the three backend profiles with their probe matrices', () => {
  const backends = listFlashBackendProfiles();
  assert.deepEqual(backends.map((backend) => backend.id), ['openocd', 'jlink', 'pyocd']);
  assert.deepEqual(backends.find((backend) => backend.id === 'pyocd')?.probes, ['stlink', 'daplink']);
  assert.equal(getFlashBackendProfile('JLINK').id, 'jlink');
  assert.throws(() => getFlashBackendProfile('stflash'), /Unsupported flash backend/);
});

test('pyOCD never claims J-Link probes', () => {
  assert.equal(backendSupportsProbe('openocd', 'stlink'), true);
  assert.equal(backendSupportsProbe('jlink', 'jlink-ob'), true);
  assert.equal(backendSupportsProbe('pyocd', 'stlink'), true);
  assert.equal(backendSupportsProbe('pyocd', 'daplink'), true);
  assert.equal(backendSupportsProbe('pyocd', 'jlink'), false);
  assert.equal(backendSupportsProbe('jlink', 'stlink'), false);
});

test('defaults to OpenOCD only when the device has a target mapping', () => {
  assert.equal(defaultBackendFor({ debugTarget: 'stm32f1x' }, 'stlink'), 'openocd');
  assert.equal(defaultBackendFor({}, 'jlink'), 'jlink');
  assert.equal(defaultBackendFor({}, 'jlink-ob'), 'jlink');
  assert.equal(defaultBackendFor({}, 'stlink'), 'pyocd');
  assert.equal(defaultBackendFor({}, 'daplink'), 'pyocd');
});

test('maps part numbers to J-Link device names and pyOCD targets', () => {
  assert.equal(jlinkDeviceName('STM32F103C8T6', 'cortex-m3'), 'STM32F103C8');
  assert.equal(jlinkDeviceName('GD32F407VGT6', 'cortex-m4'), 'GD32F407VG');
  assert.equal(jlinkDeviceName(importedDevice.part, importedDevice.core), 'Cortex-M0');
  assert.equal(jlinkGenericDeviceName('cortex-m33'), 'Cortex-M33');
  assert.equal(pyocdTargetName('STM32F407VGT6'), 'stm32f407vg');
  assert.equal(pyocdTargetName(importedDevice.part), 'ms32f031a6a0zw');
});

test('generates a J-Link flash script for an imported part', async () => {
  const script = generateFlashScript(
    'demo',
    getFlashTargetProfile('stm32f1xx'),
    getFlashProbeProfile('jlink'),
    'openocd',
    'jlink',
    importedDevice,
    { jlink: 'C:/SEGGER/JLink.exe' }
  );

  assert.match(script, /J-Link Commander/);
  assert.match(script, /JLINK_DEFAULT = "C:\/SEGGER\/JLink.exe"/);
  assert.match(script, /JLINK_DEVICE = "Cortex-M0"/);
  assert.match(script, /"-device", args.device/);
  assert.match(script, /"-if", "SWD"/);
  assert.match(script, /"loadfile " \+ firmware/);
  await assertPythonSyntax(script);
});

test('generates a pyOCD flash script with the imported CMSIS pack', async () => {
  await withPackFile(async (packFile) => {
    const script = generateFlashScript(
      'demo',
      getFlashTargetProfile('stm32f1xx'),
      getFlashProbeProfile('stlink'),
      'openocd',
      'pyocd',
      { ...importedDevice, packFile },
      { pyocd: 'pyocd' }
    );

    assert.match(script, /with pyOCD/);
    assert.match(script, /PYOCD_TARGET = "ms32f031a6a0zw"/);
    assert.equal(script.includes(`PYOCD_PACK = ${JSON.stringify(packFile)}`), true);
    assert.match(script, /"--target", args.target/);
    assert.match(script, /"--pack", args.pack/);
    assert.match(script, /"--probe", PYOCD_PROBES\[args.probe\]/);
    assert.match(script, /"stlink": "stlink"/);
    assert.match(script, /"daplink": "cmsis-dap"/);
    await assertPythonSyntax(script);
  });
});

test('rejects pyOCD pack paths that are not real existing files', () => {
  assert.throws(
    () => generateFlashScript(
      'demo',
      getFlashTargetProfile('stm32f1xx'),
      getFlashProbeProfile('stlink'),
      'openocd',
      'pyocd',
      { ...importedDevice, packFile: 'C:/missing/does-not-exist.pack' },
      { pyocd: 'pyocd' }
    ),
    /pyOCD pack file.*does not exist/
  );
});

test('rejects backend and probe combinations that cannot work', () => {
  assert.throws(
    () => generateFlashScript(
      'demo',
      getFlashTargetProfile('stm32f1xx'),
      getFlashProbeProfile('jlink'),
      'openocd',
      'pyocd'
    ),
    /Unsupported backend\/probe pair: pyocd\/jlink/
  );
});

test('generates Cortex-Debug configurations for the J-Link and pyOCD backends', () => {
  return withPackFile(async (packFile) => {
    const jlink = generateCortexDebugLaunchJson(undefined, {
      openocdPath: 'openocd',
      target: getFlashTargetProfile('stm32f1xx'),
      probe: getFlashProbeProfile('jlink'),
      backend: 'jlink',
      device: { ...importedDevice, packFile }
    });
    const jlinkConfig = JSON.parse(jlink).configurations[0];
    assert.equal(jlinkConfig.servertype, 'jlink');
    assert.equal(jlinkConfig.device, 'Cortex-M0');
    assert.equal(jlinkConfig.interface, 'swd');
    assert.equal(jlinkConfig.configFiles, undefined);
    assert.equal(jlinkConfig.executable, '${command:cmake.launchTargetPath}');

    const pyocd = generateCortexDebugLaunchJson(undefined, {
      openocdPath: 'openocd',
      target: getFlashTargetProfile('stm32f1xx'),
      probe: getFlashProbeProfile('stlink'),
      backend: 'pyocd',
      device: { ...importedDevice, packFile }
    });
    const pyocdConfig = JSON.parse(pyocd).configurations[0];
    assert.equal(pyocdConfig.servertype, 'pyocd');
    assert.equal(pyocdConfig.target, 'ms32f031a6a0zw');
    assert.deepEqual(pyocdConfig.serverArgs, ['--pack', packFile]);
    assert.equal(pyocdConfig.configFiles, undefined);
    assert.throws(
      () => generateCortexDebugLaunchJson(undefined, {
        openocdPath: 'openocd',
        target: getFlashTargetProfile('stm32f1xx'),
        probe: getFlashProbeProfile('stlink'),
        backend: 'pyocd',
        device: { ...importedDevice, packFile: 'C:/missing/does-not-exist.pack' }
      }),
      /pyOCD pack file.*does not exist/
    );

    const openocd = generateCortexDebugLaunchJson(undefined, {
      openocdPath: 'openocd',
      target: getFlashTargetProfile('stm32f1xx'),
      probe: getFlashProbeProfile('stlink'),
      backend: 'openocd'
    });
    const openocdConfig = JSON.parse(openocd).configurations[0];
    assert.equal(openocdConfig.servertype, 'openocd');
    assert.deepEqual(openocdConfig.configFiles, ['interface/stlink.cfg', 'target/stm32f1x.cfg']);
  });
});

test('keeps builtin parts recognizable for J-Link and pyOCD without packs', () => {
  assert.equal(jlinkDeviceName('STM32H743ZIT6', 'cortex-m7'), 'STM32H743ZI');
  assert.equal(pyocdTargetName('STM32H743ZIT6'), 'stm32h743zi');
  const withoutPack = generateCortexDebugLaunchJson(undefined, {
    openocdPath: 'openocd',
    target: getFlashTargetProfile('stm32f1xx'),
    probe: getFlashProbeProfile('stlink'),
    backend: 'pyocd',
    device: { part: 'STM32F103C8T6', core: 'cortex-m3' }
  });
  const config = JSON.parse(withoutPack).configurations[0];
  assert.equal(config.serverArgs, undefined);
});
