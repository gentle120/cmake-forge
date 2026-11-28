import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { listImportedPacks } from '../devices/importedProfiles';
import { prepareDataRoot, resolveDataRoot } from '../devices/packStorage';

async function withTempDirectory(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cmake-embedded-data-root-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('resolves the data root outside the extension storage directory', () => {
  assert.equal(
    resolveDataRoot({ platform: 'win32', env: { APPDATA: 'C:\\Users\\me\\AppData\\Roaming' }, home: 'C:\\Users\\me' }),
    join('C:\\Users\\me\\AppData\\Roaming', 'cmake-forge')
  );
  assert.equal(
    resolveDataRoot({ platform: 'win32', env: {}, home: 'C:\\Users\\me' }),
    join('C:\\Users\\me', 'AppData', 'Roaming', 'cmake-forge')
  );
  assert.equal(
    resolveDataRoot({ platform: 'linux', env: { XDG_DATA_HOME: '/home/me/.data' }, home: '/home/me' }),
    join('/home/me/.data', 'cmake-forge')
  );
  assert.equal(
    resolveDataRoot({ platform: 'linux', env: {}, home: '/home/me' }),
    join('/home/me', '.local', 'share', 'cmake-forge')
  );
});

test('moves Packs from the extension storage directory on first use', async () => {
  await withTempDirectory(async (root) => {
    const legacy = join(root, 'globalStorage');
    const target = join(root, 'data');
    await mkdir(join(legacy, 'packs', 'TestVendor'), { recursive: true });
    await mkdir(join(legacy, 'tools', 'openocd-0.12.0-7', 'bin'), { recursive: true });
    await writeFile(
      join(legacy, 'packs.json'),
      `${JSON.stringify({ version: 2, packs: [], vendors: [], profiles: [] }, null, 2)}\n`,
      'utf8'
    );
    await writeFile(join(legacy, 'packs', 'TestVendor', 'TEST_DFP.pack'), 'archive', 'utf8');
    await writeFile(join(legacy, 'tools', 'openocd-0.12.0-7', 'bin', 'openocd.exe'), 'binary', 'utf8');

    const prepared = await prepareDataRoot(legacy, target);

    assert.deepEqual(prepared, { root: target, migrated: true });
    assert.deepEqual(
      JSON.parse(await readFile(join(target, 'packs.json'), 'utf8')),
      { version: 2, packs: [], vendors: [], profiles: [] }
    );
    assert.equal(await readFile(join(target, 'packs', 'TestVendor', 'TEST_DFP.pack'), 'utf8'), 'archive');
    assert.equal(await readFile(join(target, 'tools', 'openocd-0.12.0-7', 'bin', 'openocd.exe'), 'utf8'), 'binary');
  });
});

test('keeps an existing data root instead of importing the legacy store again', async () => {
  await withTempDirectory(async (root) => {
    const legacy = join(root, 'globalStorage');
    const target = join(root, 'data');
    await mkdir(target, { recursive: true });
    await mkdir(legacy, { recursive: true });
    await writeFile(join(target, 'packs.json'), '{"version":2,"packs":[],"vendors":[],"profiles":[]}', 'utf8');
    await writeFile(join(legacy, 'packs.json'), '{"version":2,"packs":[],"vendors":[],"profiles":[]}', 'utf8');

    assert.deepEqual(await prepareDataRoot(legacy, target), { root: target, migrated: false });
  });
});

test('falls back to the legacy directory when the data root cannot be created', async () => {
  await withTempDirectory(async (root) => {
    const legacy = join(root, 'globalStorage');
    const blocked = join(root, 'blocked');
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, 'packs.json'), '{"version":2,"packs":[],"vendors":[],"profiles":[]}', 'utf8');
    // A file where the directory should be makes mkdir fail with ENOTDIR.
    await writeFile(blocked, 'not a directory', 'utf8');

    assert.deepEqual(await prepareDataRoot(legacy, blocked), { root: legacy, migrated: false });
  });
});

test('recovers the newest store backup when packs.json is missing', async () => {
  await withTempDirectory(async (root) => {
    const packDirectory = join(root, 'packs', 'TestVendor', 'TEST_DFP');
    await mkdir(packDirectory, { recursive: true });
    const backup = {
      version: 2,
      packs: [{
        packFile: packDirectory.replace(/\\/g, '/'),
        vendorId: 'TestVendor',
        vendorName: 'TestVendor',
        name: 'TEST_DFP',
        version: '1.0.0',
        packId: 'TestVendor.TEST_DFP',
        source: 'directory',
        parts: []
      }],
      vendors: [],
      profiles: []
    };
    await writeFile(join(root, 'packs.json.4242.1.bak'), JSON.stringify(backup), 'utf8');
    await writeFile(join(root, 'packs.json.4242.2.bak'), JSON.stringify(backup), 'utf8');

    const packs = await listImportedPacks(root);

    assert.equal(packs.length, 1);
    assert.equal(packs[0].name, 'TEST_DFP');
    // The recovered store becomes the primary file so the next read is normal.
    assert.equal(JSON.parse(await readFile(join(root, 'packs.json'), 'utf8')).version, 2);
  });
});
