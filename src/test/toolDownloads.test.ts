import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ARM_GCC_EXPECTED_BYTES,
  ARM_GCC_URL,
  ARM_GCC_VERSION,
  OPENOCD_URL,
  OPENOCD_VERSION,
  findBelow,
  installArmGcc,
  installOpenOcd
} from '../env/toolDownloads';

function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'cmake-forge-tools-'));
  return run(dir).finally(() => rmSync(dir, { recursive: true, force: true }));
}

function archiveResponse(bytes = 4): Response {
  return new Response(new Uint8Array(bytes).fill(65), {
    status: 200,
    headers: { 'content-length': String(bytes) }
  });
}

test('download URLs pin releases that actually exist', () => {
  assert.match(ARM_GCC_URL, /gnu\/15\.2\.rel1\//);
  assert.match(ARM_GCC_URL, /arm-none-eabi\.zip$/);
  assert.match(OPENOCD_URL, /openocd-xpack\/releases\/download\/v0\.12\.0-7\//);
  assert.equal(ARM_GCC_EXPECTED_BYTES > 200 * 1024 * 1024, true);
});

test('findBelow locates a nested executable and rejects a missing one', async () => {
  await withTempDir(async (dir) => {
    const nested = join(dir, 'tool-1.0', 'bin');
    mkdirSync(nested, { recursive: true });
    writeFileSync(join(nested, 'openocd.exe'), '');
    assert.equal(findBelow(dir, join('bin', 'openocd.exe')), join(nested, 'openocd.exe'));
    assert.equal(findBelow(dir, join('bin', 'arm-none-eabi-gcc.exe')), undefined);
  });
});

test('installArmGcc unpacks, verifies the compiler and marks the directory ready', async () => {
  await withTempDir(async (dir) => {
    let extracted = 0;
    const installed = await installArmGcc({
      storageRoot: dir,
      fetchImpl: async () => archiveResponse(),
      extractImpl: async (_archive, destination) => {
        extracted += 1;
        const bin = join(destination, 'arm-gnu-toolchain-15.2.rel1-mingw-w64-x86_64-arm-none-eabi', 'bin');
        mkdirSync(bin, { recursive: true });
        writeFileSync(join(bin, 'arm-none-eabi-gcc.exe'), '');
        writeFileSync(join(bin, 'arm-none-eabi-g++.exe'), '');
      }
    });
    assert.equal(extracted, 1);
    assert.equal(installed.version, ARM_GCC_VERSION);
    assert.equal(existsSync(join(installed.binDir, 'arm-none-eabi-gcc.exe')), true);
    // The archive is not kept once extraction succeeded.
    assert.equal(existsSync(join(dir, 'downloads', `arm-gcc-${ARM_GCC_VERSION}.zip`)), false);
  });
});

test('installOpenOcd reports HTTP failures instead of leaving a half-installed tree', async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      installOpenOcd({
        storageRoot: dir,
        fetchImpl: async () => new Response('missing', { status: 404 }),
        extractImpl: async () => {
          throw new Error('should not extract');
        }
      }),
      /HTTP 404/
    );
    assert.equal(existsSync(join(dir, 'tools', `openocd-${OPENOCD_VERSION}`)), false);
  });
});

test('a failed verification removes the extracted directory', async () => {
  await withTempDir(async (dir) => {
    await assert.rejects(
      installOpenOcd({
        storageRoot: dir,
        fetchImpl: async () => archiveResponse(),
        extractImpl: async (_archive, destination) => {
          mkdirSync(destination, { recursive: true });
        }
      }),
      /没有找到 openocd\.exe/
    );
    assert.equal(existsSync(join(dir, 'tools', `openocd-${OPENOCD_VERSION}`)), false);
  });
});
