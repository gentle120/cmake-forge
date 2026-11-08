import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import test from 'node:test';
import { missingOpenOcdNotice, resolveOpenOcdExecutable } from '../flash/openocd';

test('resolves an absolute OpenOCD path only when the file exists', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openocd-'));
  try {
    const executable = join(root, 'openocd.exe');
    await writeFile(executable, '');
    assert.equal(resolveOpenOcdExecutable(executable), executable);
    assert.equal(resolveOpenOcdExecutable(join(root, 'missing.exe')), undefined);
    // A directory is not a runnable command.
    await mkdir(join(root, 'bin'), { recursive: true });
    assert.equal(resolveOpenOcdExecutable(join(root, 'bin')), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('finds a bare command name on PATH and honours the platform suffix', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openocd-path-'));
  try {
    const executable = join(root, process.platform === 'win32' ? 'openocd.exe' : 'openocd');
    await writeFile(executable, '');
    const environment = { PATH: [join(root, 'nope'), root].join(delimiter) };
    assert.equal(resolveOpenOcdExecutable('openocd', environment), executable);
    assert.equal(resolveOpenOcdExecutable('openocd-not-here', environment), undefined);
    assert.equal(resolveOpenOcdExecutable('', environment), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('names the missing executable and the setting to fix in the warning', () => {
  const notice = missingOpenOcdNotice('D:/Tools/OpenOCD/bin/openocd.exe');
  assert.match(notice, /D:\/Tools\/OpenOCD\/bin\/openocd\.exe/);
  assert.match(notice, /cmakeForge\.openocdPath/);
  assert.match(missingOpenOcdNotice('  '), /openocd/);
});
