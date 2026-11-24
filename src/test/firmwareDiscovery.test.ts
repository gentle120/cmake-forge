import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  discoverFirmware,
  findFirmwareCandidates,
  pickFirmware,
  type FirmwareCandidate
} from '../flash/firmwareDiscovery';

async function withRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cmake-forge-firmware-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeElf(root: string, relativePath: string, content = 'ELF'): Promise<string> {
  const target = join(root, relativePath);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  return target;
}

async function setMtime(target: string, isoTime: string): Promise<void> {
  const date = new Date(isoTime);
  await utimes(target, date, date);
}

test('explains that no build exists yet instead of returning a bare empty list', async () => {
  await withRoot(async (root) => {
    const result = await discoverFirmware(root);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.selected, undefined);
    assert.equal(result.reason, '还没有构建产物：先执行 cmake --build --preset debug。');
  });
});

test('asks for a project when root is empty', async () => {
  for (const root of ['', '   ']) {
    const result = await discoverFirmware(root);
    assert.deepEqual(result.candidates, []);
    assert.equal(result.selected, undefined);
    assert.equal(result.reason, '请先选择目标工程。');
  }
});

test('selects the only release image', async () => {
  await withRoot(async (root) => {
    const elf = await writeElf(root, 'build/release/app.elf');
    const result = await discoverFirmware(root);
    assert.equal(result.selected?.path, elf);
    assert.equal(result.selected?.preset, 'release');
    assert.equal(result.selected?.size, 3);
    assert.equal(result.reason, '');
  });
});

test('debug wins over a newer release build', async () => {
  await withRoot(async (root) => {
    const debugElf = await writeElf(root, 'build/debug/app.elf');
    const releaseElf = await writeElf(root, 'build/release/app.elf');
    await setMtime(debugElf, '2020-01-01T00:00:00Z');
    await setMtime(releaseElf, '2024-01-01T00:00:00Z');
    const result = await discoverFirmware(root);
    assert.equal(result.selected?.path, debugElf);
    assert.deepEqual(result.candidates.map((candidate) => candidate.preset), ['debug', 'release']);
  });
});

test('keeps only the newest ELF inside one preset directory', async () => {
  await withRoot(async (root) => {
    const oldElf = await writeElf(root, 'build/debug/old.elf');
    const newElf = await writeElf(root, 'build/debug/new.elf');
    await setMtime(oldElf, '2020-01-01T00:00:00Z');
    await setMtime(newElf, '2024-01-01T00:00:00Z');
    const candidates = await findFirmwareCandidates(root);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].path, newElf);
  });
});

test('skips CMake internals while walking a preset', async () => {
  await withRoot(async (root) => {
    const firmware = await writeElf(root, 'build/debug/app.elf');
    const internal = await writeElf(root, 'build/debug/CMakeFiles/app.dir/link.elf');
    await setMtime(internal, '2024-01-01T00:00:00Z');
    await setMtime(firmware, '2020-01-01T00:00:00Z');
    const candidates = await findFirmwareCandidates(root);
    assert.deepEqual(candidates.map((candidate) => candidate.path), [firmware]);
  });
});

test('ignores zero-byte ELF left behind by a failed link', async () => {
  await withRoot(async (root) => {
    await writeElf(root, 'build/debug/empty.elf', '');
    const releaseElf = await writeElf(root, 'build/release/app.elf');
    const result = await discoverFirmware(root);
    assert.equal(result.selected?.path, releaseElf);
    assert.deepEqual(result.candidates.map((candidate) => candidate.path), [releaseElf]);
  });
});

test('pickFirmware rejects side artefacts and an empty list', () => {
  const candidates: FirmwareCandidate[] = [
    { path: 'C:/project/build/debug/firmware.elf.map', preset: 'debug', size: 10, mtimeMs: 3 },
    { path: 'C:/project/build/debug/empty.elf', preset: 'debug', size: 0, mtimeMs: 2 },
    { path: 'C:/project/build/release/firmware.elf', preset: 'release', size: 10, mtimeMs: 1 }
  ];
  assert.equal(pickFirmware(candidates)?.path, 'C:/project/build/release/firmware.elf');
  assert.equal(pickFirmware([]), undefined);
});

test('stops descending after four directory levels', async () => {
  await withRoot(async (root) => {
    const kept = await writeElf(root, 'build/debug/a/b/c/d/kept.elf');
    const ignored = await writeElf(root, 'build/debug/a/b/c/d/e/ignored.elf');
    await setMtime(kept, '2020-01-01T00:00:00Z');
    await setMtime(ignored, '2024-01-01T00:00:00Z');
    const candidates = await findFirmwareCandidates(root);
    assert.deepEqual(candidates.map((candidate) => candidate.path), [kept]);
  });
});

test('reads CMAKE_BUILD_TYPE for a custom preset directory', async () => {
  await withRoot(async (root) => {
    const elf = await writeElf(root, 'build/staging/app.elf');
    await writeFile(
      join(root, 'build/staging/CMakeCache.txt'),
      'CMAKE_BUILD_TYPE:STRING=Debug\nCMAKE_GENERATOR:INTERNAL=Ninja\n'
    );
    const result = await discoverFirmware(root);
    assert.equal(result.selected?.path, elf);
    assert.equal(result.selected?.preset, 'debug');
  });
});
