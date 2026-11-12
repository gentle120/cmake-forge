import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  annotateDeviceHeaders,
  deviceIncludeDir,
  deviceSourceDir,
  deviceSnapshotDir,
  isDeviceSupportEntry,
  loadDeviceSupportFiles,
  removeDeviceSupportSnapshot,
  writeDeviceSupportSnapshot
} from '../packs/deviceSupport';

function entries(): Array<{ name: string; data: Buffer }> {
  return [
    { name: 'Example.F1_DFP.pdsc', data: Buffer.from('<package/>') },
    { name: 'Device/Include/gd32f10x.h', data: Buffer.from('/* device header */') },
    { name: 'Device/Include/system_gd32f10x.h', data: Buffer.from('/* system header */') },
    { name: 'Device/Source/system_gd32f10x.c', data: Buffer.from('/* system source */') },
    { name: 'Examples/UART/main.c', data: Buffer.from('int main(void) { return 0; }') },
    { name: 'CMSIS/Driver/Include/Driver_GPIO.h', data: Buffer.from('/* component driver */') }
  ];
}

test('selects device headers and system sources but not examples or CMSIS components', () => {
  assert.equal(isDeviceSupportEntry('Device/Include/gd32f10x.h'), true);
  assert.equal(isDeviceSupportEntry('Device/Source/system_gd32f10x.c'), true);
  assert.equal(isDeviceSupportEntry('devices/MK64F12/system_MK64F12.c'), true);
  assert.equal(isDeviceSupportEntry('Examples/UART/main.c'), false);
  assert.equal(isDeviceSupportEntry('CMSIS/Driver/Include/Driver_GPIO.h'), false);
  assert.equal(isDeviceSupportEntry('Device/StdPeriph_Driver/inc/stm32f10x_gpio.h'), false);
  assert.equal(isDeviceSupportEntry('Device/Source/startup_gd32f10x.s'), false);
});

test('loads the device header and its system files from the import snapshot', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'device-support-'));
  const packFile = 'packs/GigaDevice/Example.F1_DFP.1.0.0.pack';
  try {
    await writeDeviceSupportSnapshot(storageRoot, packFile, entries());
    const files = await loadDeviceSupportFiles(storageRoot, packFile, 'gd32f10x.h');

    assert.deepEqual(files.map((file) => file.relative), [
      `${deviceIncludeDir}/gd32f10x.h`,
      `${deviceIncludeDir}/system_gd32f10x.h`,
      `${deviceSourceDir}/system_gd32f10x.c`
    ]);
    assert.equal(files[2].content.toString('utf8'), '/* system source */');

    // The example tree never reaches the snapshot.
    const snapshot = await readdir(deviceSnapshotDir(storageRoot, packFile), { recursive: true });
    assert.equal(snapshot.some((name) => name.includes('Examples')), false);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('a Pack without a declared header, or a missing snapshot, yields no files', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'device-support-empty-'));
  try {
    assert.deepEqual(await loadDeviceSupportFiles(storageRoot, 'packs/none.pack', undefined), []);
    assert.deepEqual(await loadDeviceSupportFiles(storageRoot, 'packs/none.pack', 'missing.h'), []);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('removing a Pack also removes its device snapshot', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'device-support-remove-'));
  const packFile = 'packs/Example/Example.pack';
  try {
    await writeDeviceSupportSnapshot(storageRoot, packFile, entries());
    const snapshotDir = deviceSnapshotDir(storageRoot, packFile);
    await removeDeviceSupportSnapshot(storageRoot, packFile);
    await assert.rejects(readdir(snapshotDir));
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('derives a missing device header from the family name when the Pack has it', async () => {
  const devices: Array<{ family: string; series: string; header?: string }> = [
    { family: 'GD32F10x', series: 'GD32F10x' },
    { family: 'Unknown', series: 'Unknown' }
  ];
  annotateDeviceHeaders(devices, entries());
  assert.equal(devices[0].header, 'gd32f10x.h');
  assert.equal(devices[1].header, undefined);
});

test('the snapshot preserves the file bytes exactly', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'device-support-bytes-'));
  const packFile = 'packs/Example/Bytes.pack';
  try {
    await writeDeviceSupportSnapshot(storageRoot, packFile, entries());
    const header = await readFile(join(deviceSnapshotDir(storageRoot, packFile), 'Device/Include/gd32f10x.h'), 'utf8');
    assert.equal(header, '/* device header */');
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('guesses the device header when a Pack was imported before the header was recorded', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'device-support-guess-'));
  const packFile = 'packs/Example/Guessed.pack';
  try {
    // The vendor's StdPeriph library must not be mistaken for device headers.
    await writeDeviceSupportSnapshot(storageRoot, packFile, [
      ...entries(),
      { name: 'Device/StdPeriph_Driver/inc/stm32f10x_gpio.h', data: Buffer.from('/* driver */') }
    ]);
    const files = await loadDeviceSupportFiles(storageRoot, packFile, undefined, {
      familyHints: ['GD32F10x Series', 'GD32F10x']
    });
    assert.deepEqual(files.map((file) => file.relative), [
      `${deviceIncludeDir}/gd32f10x.h`,
      `${deviceIncludeDir}/system_gd32f10x.h`,
      `${deviceSourceDir}/system_gd32f10x.c`
    ]);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('rebuilds the snapshot from the installed Pack directory when the archive is gone', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'device-support-dir-'));
  const installed = await mkdtemp(join(tmpdir(), 'device-support-installed-'));
  const packFile = 'packs/Example/Directory.pack';
  try {
    await mkdir(join(installed, 'Device', 'Include'), { recursive: true });
    await mkdir(join(installed, 'Device', 'Source'), { recursive: true });
    await writeFile(join(installed, 'Device', 'Include', 'chip.h'), '#define CHIP 1\n');
    await writeFile(join(installed, 'Device', 'Include', 'system_chip.h'), 'void SystemInit(void);\n');
    await writeFile(join(installed, 'Device', 'Source', 'system_chip.c'), 'void SystemInit(void) { }\n');

    // No snapshot and no archive: only the installed directory can be read.
    const files = await loadDeviceSupportFiles(storageRoot, packFile, 'chip.h', {
      sourceRoot: installed
    });
    assert.deepEqual(files.map((file) => file.relative), [
      `${deviceIncludeDir}/chip.h`,
      `${deviceIncludeDir}/system_chip.h`,
      `${deviceSourceDir}/system_chip.c`
    ]);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
    await rm(installed, { recursive: true, force: true });
  }
});

test('copies the device header include closure such as the vendor umbrella header', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'device-support-closure-'));
  const packFile = 'packs/GigaDevice/Closure.pack';
  try {
    await writeDeviceSupportSnapshot(storageRoot, packFile, [
      {
        name: 'Device/Include/chip.h',
        data: Buffer.from('#include "core_cm3.h"\n#include "system_chip.h"\n#ifdef USE_STDPERIPH_DRIVER\n#include "chip_libopt.h"\n#endif\n')
      },
      { name: 'Device/Include/chip_libopt.h', data: Buffer.from('#include "chip_gpio.h"\n') },
      { name: 'Device/Include/system_chip.h', data: Buffer.from('void SystemInit(void);\n') },
      { name: 'Device/Source/system_chip.c', data: Buffer.from('#include "chip.h"\nvoid SystemInit(void) { }\n') },
      { name: 'Device/Firmware/Peripherals/inc/chip_gpio.h', data: Buffer.from('#include "chip.h"\n') }
    ]);

    const files = await loadDeviceSupportFiles(storageRoot, packFile, 'chip.h');
    // chip.h、它包含的 system 头、厂商 umbrella 头；umbrella 列出的驱动头不复制。
    assert.deepEqual(files.map((file) => file.relative), [
      `${deviceIncludeDir}/chip.h`,
      `${deviceIncludeDir}/system_chip.h`,
      `${deviceIncludeDir}/chip_libopt.h`,
      `${deviceSourceDir}/system_chip.c`
    ]);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('enables only the clock component the system source needs', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'device-support-rcu-'));
  const packFile = 'packs/GigaDevice/Rcu.pack';
  try {
    await writeDeviceSupportSnapshot(storageRoot, packFile, [
      {
        name: 'Device/Include/chip.h',
        data: Buffer.from('#include "system_chip.h"\n#include "chip_libopt.h"\n')
      },
      {
        name: 'Device/Include/chip_libopt.h',
        data: Buffer.from('#include "RTE_Components.h"\n#ifdef RTE_DEVICE_STDPERIPHERALS_RCU\n#include "chip_rcu.h"\n#endif\n')
      },
      { name: 'Device/Include/system_chip.h', data: Buffer.from('void SystemInit(void);\n') },
      { name: 'Device/Source/system_chip.c', data: Buffer.from('#include "chip.h"\nvoid SystemInit(void) { RCU_CTL = 0; }\n') },
      { name: 'Device/Firmware/Peripherals/inc/chip_rcu.h', data: Buffer.from('#define RCU_CTL 0x40021000UL\n') },
      { name: 'Device/Firmware/Peripherals/inc/chip_gpio.h', data: Buffer.from('#define GPIO 1\n') }
    ]);

    const files = await loadDeviceSupportFiles(storageRoot, packFile, 'chip.h');
    const byName = new Map(files.map((file) => [file.relative.split('/').pop(), file.content.toString('utf8')]));

    // 设备头、system 头、umbrella、system 启动源码，加上 RCU 寄存器头与 RTE 补丁
    assert.deepEqual(files.map((file) => file.relative), [
      `${deviceIncludeDir}/chip.h`,
      `${deviceIncludeDir}/system_chip.h`,
      `${deviceIncludeDir}/chip_libopt.h`,
      `${deviceIncludeDir}/chip_rcu.h`,
      `${deviceIncludeDir}/RTE_Components.h`,
      `${deviceSourceDir}/system_chip.c`
    ]);
    assert.match(byName.get('RTE_Components.h') ?? '', /RTE_DEVICE_STDPERIPHERALS_RCU/);
    assert.equal(byName.has('chip_gpio.h'), false);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('does not enable the RCU component when the Pack has no such header', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'device-support-no-rcu-'));
  const packFile = 'packs/GigaDevice/NoRcu.pack';
  try {
    await writeDeviceSupportSnapshot(storageRoot, packFile, [
      { name: 'Device/Include/chip.h', data: Buffer.from('#include "chip_libopt.h"\n') },
      {
        name: 'Device/Include/chip_libopt.h',
        data: Buffer.from('#include "RTE_Components.h"\n#ifdef RTE_DEVICE_STDPERIPHERALS_RCU\n#include "chip_rcu.h"\n#endif\n')
      },
      { name: 'Device/Include/system_chip.h', data: Buffer.from('void SystemInit(void);\n') },
      { name: 'Device/Source/system_chip.c', data: Buffer.from('#include "chip.h"\nvoid SystemInit(void) { }\n') }
    ]);

    const files = await loadDeviceSupportFiles(storageRoot, packFile, 'chip.h');
    const rte = files.find((file) => file.relative.endsWith('RTE_Components.h'));
    assert.ok(rte, 'RTE stub should still be generated');
    // Enabling a component whose header is missing would break the build.
    assert.doesNotMatch(rte!.content.toString('utf8'), /RTE_DEVICE_STDPERIPHERALS_RCU/);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});

test('never writes an archive entry outside the snapshot directory', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'cmake-embedded-slip-'));
  try {
    const packFile = 'packs/evil/evil.pack';
    assert.equal(isDeviceSupportEntry('Device/../../escaped.h'), false);
    await writeDeviceSupportSnapshot(storageRoot, packFile, [
      { name: 'Device/Include/ok.h', data: Buffer.from('#define OK 1\n') },
      { name: 'Device/../../escaped.h', data: Buffer.from('pwned') }
    ]);
    const snapshot = deviceSnapshotDir(storageRoot, packFile);
    assert.equal(existsSync(join(snapshot, '..', '..', 'escaped.h')), false);
    assert.equal(existsSync(join(storageRoot, 'escaped.h')), false);
    const names = await readdir(snapshot, { recursive: true });
    assert.ok(names.some((name) => name.endsWith('ok.h')));
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});
