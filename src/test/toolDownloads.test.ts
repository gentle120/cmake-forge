import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  ARM_GCC_EXPECTED_BYTES,
  ARM_GCC_OFFICIAL_URL,
  ARM_GCC_URL,
  ARM_GCC_VERSION,
  CMAKE_URL,
  CMAKE_VERSION,
  NINJA_URL,
  NINJA_VERSION,
  OPENOCD_URL,
  OPENOCD_VERSION,
  findBelow,
  installArmGcc,
  installCMake,
  installNinja,
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

test('download URLs go through the GitHub proxy and keep the official fallback', () => {
  assert.match(ARM_GCC_URL, /^https:\/\/gh-proxy\.com\/https:\/\/github\.com\//);
  assert.match(ARM_GCC_URL, /xpack-arm-none-eabi-gcc-15\.2\.1-1\.1-win32-x64\.zip$/);
  assert.match(ARM_GCC_OFFICIAL_URL, /developer\.arm\.com\/.*gnu\/15\.2\.rel1\//);
  assert.match(OPENOCD_URL, /^https:\/\/gh-proxy\.com\//);
  assert.match(OPENOCD_URL, /openocd-xpack\/releases\/download\/v0\.12\.0-7\//);
  assert.equal(ARM_GCC_EXPECTED_BYTES > 200 * 1024 * 1024, true);
});

test('a ranged download fetches chunks in parallel and rebuilds the archive', async () => {
  const total = 8 * 1024 * 1024 + 1024;
  let chunkCalls = 0;
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    if (range === 'bytes=0-0') {
      return new Response(null, {
        status: 206,
        headers: { 'content-range': `bytes 0-0/${total}` }
      });
    }
    chunkCalls += 1;
    const match = /bytes=(\d+)-(\d+)/.exec(range ?? '');
    const start = Number(match?.[1]);
    const end = Number(match?.[2]);
    return new Response(new Uint8Array(end - start + 1), { status: 206 });
  }) as typeof fetch;
  await withTempDir(async (dir) => {
    let extractedBytes = 0;
    await installOpenOcd({
      storageRoot: dir,
      fetchImpl,
      extractImpl: async (archive, destination) => {
        extractedBytes = statSync(archive).size;
        const bin = join(destination, 'bin');
        mkdirSync(bin, { recursive: true });
        writeFileSync(join(bin, 'openocd.exe'), '');
      }
    });
    assert.equal(chunkCalls >= 3, true);
    assert.equal(extractedBytes, total);
  });
});

test('an unreachable mirror falls through to the next source', async () => {
  await withTempDir(async (dir) => {
    let calls = 0;
    const installed = await installOpenOcd({
      storageRoot: dir,
      fetchImpl: (async () => {
        calls += 1;
        if (calls <= 1) {
          return new Response('blocked', { status: 403 });
        }
        return archiveResponse();
      }) as typeof fetch,
      extractImpl: async (_archive, destination) => {
        const bin = join(destination, 'bin');
        mkdirSync(bin, { recursive: true });
        writeFileSync(join(bin, 'openocd.exe'), '');
      }
    });
    assert.equal(existsSync(installed.executable), true);
  });
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

test('the build tools come from the same proxy and pin a known version', () => {
  assert.match(CMAKE_URL, /^https:\/\/gh-proxy\.com\/https:\/\/github\.com\/Kitware\/CMake\//);
  assert.match(CMAKE_URL, new RegExp(`cmake-${CMAKE_VERSION.replace(/\./g, '\\.')}-windows-x86_64\\.zip$`));
  assert.match(NINJA_URL, /^https:\/\/gh-proxy\.com\/https:\/\/github\.com\/ninja-build\/ninja\//);
  assert.match(NINJA_URL, new RegExp(`/v${NINJA_VERSION.replace(/\./g, '\\.')}/ninja-win\\.zip$`));
});

test('installCMake unpacks cmake.exe and later finds it again without downloading', async () => {
  await withTempDir(async (dir) => {
    let downloads = 0;
    const installed = await installCMake({
      storageRoot: dir,
      fetchImpl: async () => {
        downloads += 1;
        return archiveResponse();
      },
      extractImpl: async (_archive, destination) => {
        const bin = join(destination, 'cmake-4.2.3-windows-x86_64', 'bin');
        mkdirSync(bin, { recursive: true });
        writeFileSync(join(bin, 'cmake.exe'), '');
      }
    });
    assert.equal(installed.version, CMAKE_VERSION);
    assert.equal(existsSync(join(installed.binDir, 'cmake.exe')), true);
    // One probe request plus the actual body; a second install must reuse it.
    const firstDownloads = downloads;
    const again = await installCMake({
      storageRoot: dir,
      fetchImpl: async () => {
        downloads += 1;
        return archiveResponse();
      },
      extractImpl: async () => {
        throw new Error('should reuse the installed copy');
      }
    });
    assert.equal(again.cmakePath, installed.cmakePath);
    assert.equal(downloads, firstDownloads);
  });
});

test('installNinja unpacks the single executable', async () => {
  await withTempDir(async (dir) => {
    const installed = await installNinja({
      storageRoot: dir,
      fetchImpl: async () => archiveResponse(),
      extractImpl: async (_archive, destination) => {
        mkdirSync(destination, { recursive: true });
        writeFileSync(join(destination, 'ninja.exe'), '');
      }
    });
    assert.equal(installed.version, NINJA_VERSION);
    assert.equal(existsSync(installed.ninjaPath), true);
    assert.equal(existsSync(join(dir, 'tools', `ninja-${NINJA_VERSION}`, '.ready')), true);
  });
});

function rangedFetcher(total: number, mutate: (index: number, start: number, end: number) => Response): typeof fetch {
  return (async (_input: string | URL | Request, init?: RequestInit) => {
    const range = new Headers(init?.headers).get('range');
    if (range === 'bytes=0-0') {
      return new Response(null, {
        status: 206,
        headers: { 'content-range': `bytes 0-0/${total}` }
      });
    }
    const match = /bytes=(\d+)-(\d+)/.exec(range ?? '');
    const start = Number(match?.[1]);
    const end = Number(match?.[2]);
    return mutate(Math.floor(start / (1024 * 1024)), start, end);
  }) as typeof fetch;
}

test('a truncated chunk is retried before the archive is assembled', async () => {
  const total = 3 * 1024 * 1024;
  let truncatedOnce = false;
  const fetchImpl = rangedFetcher(total, (index, start, end) => {
    if (index === 1 && !truncatedOnce) {
      truncatedOnce = true;
      return new Response(new Uint8Array(10), { status: 206 });
    }
    return new Response(new Uint8Array(end - start + 1), { status: 206 });
  });
  await withTempDir(async (dir) => {
    let extracted = 0;
    await installOpenOcd({
      storageRoot: dir,
      fetchImpl,
      extractImpl: async (archive, destination) => {
        extracted = statSync(archive).size;
        const bin = join(destination, 'bin');
        mkdirSync(bin, { recursive: true });
        writeFileSync(join(bin, 'openocd.exe'), '');
      }
    });
    assert.equal(truncatedOnce, true);
    assert.equal(extracted, total);
  });
});

test('a chunk that stays short fails the download and leaves no parts behind', async () => {
  const total = 2 * 1024 * 1024;
  const fetchImpl = rangedFetcher(total, (_index, _start, end) => (
    new Response(new Uint8Array(5), { status: 206 })
  ));
  await withTempDir(async (dir) => {
    await assert.rejects(
      installOpenOcd({
        storageRoot: dir,
        fetchImpl,
        extractImpl: async () => {
          throw new Error('should not extract');
        }
      }),
      /只收到/
    );
    const leftovers = (await import('node:fs')).readdirSync(join(dir, 'downloads'));
    assert.deepEqual(leftovers.filter((name) => name.includes('.part')), []);
  });
});
