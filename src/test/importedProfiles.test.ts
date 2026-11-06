import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getDeviceProfile } from '../devices/deviceProfiles';
import {
  importPack,
  importPackDirectory,
  listImportedPacks,
  loadImportedProfiles,
  removePack
} from '../devices/importedProfiles';
import { getVendorMetadata } from '../devices/vendorRegistry';

interface PackIdentityView {
  packId: string;
  vendorId: string;
  name: string;
  version: string;
}

const importPackWithMetadata = importPack as unknown as (
  buffer: Buffer,
  fileName: string,
  storageRoot: string,
  metadata: { name: string; version: string }
) => ReturnType<typeof importPack>;

const fixturePath = join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'ms32f031.pack');

function buildZip(entries: Array<{ name: string; data: string }>): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.from(entry.data, 'utf8');
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localChunks.push(local, nameBuffer, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuffer);
    offset += 30 + nameBuffer.length + data.length;
  }
  const localPart = Buffer.concat(localChunks);
  const centralPart = Buffer.concat(centralChunks);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  return Buffer.concat([localPart, centralPart, eocd]);
}

async function withStorageRoot(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cmake-embedded-pack-'));
  try {
    await run(root);
  } finally {
    for (const pack of await listImportedPacks(root)) {
      await removePack(root, pack.packFile);
    }
    await rm(root, { recursive: true, force: true });
  }
}

test('imports the fixture pack, restores profiles, overwrites, and removes the pack', async () => {
  const fixture = await readFile(fixturePath);
  await withStorageRoot(async (root) => {
    const result = await importPack(fixture, 'ms32f031.pack', root);
    assert.deepEqual(result, { imported: ['MS32F031A6A0ZW'], skipped: [] });

    const profile = getDeviceProfile('MS32F031A6A0ZW');
    assert.equal(profile.core, 'cortex-m0');
    assert.equal(profile.vendor, 'MS_Semi');
    assert.equal(profile.architecture, 'arm');
    assert.equal(profile.debugTarget, undefined);
    assert.deepEqual(profile.compilerFlags, ['-mcpu=cortex-m0', '-mthumb']);
    assert.deepEqual(profile.defines, ['MS32F031x6']);
    assert.equal(profile.linkerFileName, 'MS32F031A6A0ZW.ld');
    assert.equal(profile.gnuStartupFileName, 'startup_MS32F031A6A0ZW.S');
    assert.equal(profile.toolchainFileName, 'ms_semims32f031-toolchain.cmake');
    assert.equal(profile.flash.length, 0x8000);
    assert.equal(profile.ram.length, 0x2000);

    const vendor = getVendorMetadata('MS_Semi');
    assert.equal(vendor.label, 'MS Semi');
    assert.deepEqual(vendor.definePrefixes, ['MS32']);
    assert.equal(vendor.order, 100);

    const packs = await listImportedPacks(root);
    assert.equal(packs.length, 1);
    assert.equal(packs[0].packFile, 'packs/MS_Semi/ms32f031.pack');
    assert.equal(packs[0].source, 'archive');
    assert.equal(packs[0].archiveFile, join(root, 'packs', 'MS_Semi', 'ms32f031.pack'));
    assert.equal(packs[0].vendorName, 'MS Semi');
    const identity = packs[0] as unknown as PackIdentityView;
    assert.equal(identity.vendorId, 'MS_Semi');
    assert.equal(identity.packId, 'MS_Semi:ms32f031');
    assert.equal(identity.name, 'ms32f031');
    assert.equal(identity.version, 'unknown');
    assert.deepEqual(packs[0].parts, ['MS32F031A6A0ZW']);
    assert.match(packs[0].importedAt, /^\d{4}-\d{2}-\d{2}T/);

    const storedPack = await readFile(join(root, 'packs', 'MS_Semi', 'ms32f031.pack'));
    assert.equal(storedPack.equals(fixture), true);

    const loaded = await loadImportedProfiles(root);
    assert.deepEqual(
      loaded.map((stored) => stored.part),
      ['MS32F031A6A0ZW']
    );
    assert.equal(getDeviceProfile('MS32F031A6A0ZW').core, 'cortex-m0');

    const reimported = await importPack(fixture, 'ms32f031.pack', root);
    assert.deepEqual(reimported, { imported: ['MS32F031A6A0ZW'], skipped: [] });
    assert.equal((await listImportedPacks(root)).length, 1);

    await removePack(root, 'packs/MS_Semi/ms32f031.pack');
    assert.deepEqual(await listImportedPacks(root), []);
    assert.equal(existsSync(join(root, 'packs', 'MS_Semi', 'ms32f031.pack')), false);
    assert.throws(() => getDeviceProfile('MS32F031A6A0ZW'), /Unsupported MCU/);
  });
});

test('persists the selected Pack identity and version from catalog metadata', async () => {
  const fixture = await readFile(fixturePath);
  await withStorageRoot(async (root) => {
    await importPackWithMetadata(fixture, 'Sinomcu.MS32F0xx_DFP.1.1.1.pack', root, {
      name: 'MS32F0xx_DFP',
      version: '1.1.1'
    });

    const [pack] = await listImportedPacks(root);
    const identity = pack as unknown as PackIdentityView;
    assert.equal(identity.vendorId, 'MS_Semi');
    assert.equal(identity.name, 'MS32F0xx_DFP');
    assert.equal(identity.version, '1.1.1');
    assert.equal(identity.packId, 'MS_Semi:MS32F0xx_DFP');
  });
});

test('skips devices whose synthesized profile fails validation', async () => {
  const pdsc = `<?xml version="1.0" encoding="utf-8"?>
<package>
  <devices>
    <family Dvendor="MS Semi" Dfamily="MS32F031">
      <device Dname="MS32F031A6A0ZW" Dcore="CM0">
        <debug svd="MS32F031.svd"/>
      </device>
    </family>
  </devices>
</package>
`;
  const svd = `<?xml version="1.0" encoding="utf-8"?>
<device>
  <peripherals>
    <peripheral>
      <interrupt>
        <name>WWDG</name>
        <value>0</value>
      </interrupt>
    </peripheral>
  </peripherals>
</device>
`;
  await withStorageRoot(async (root) => {
    const result = await importPack(buildZip([{ name: 'MS32F031.pdsc', data: pdsc }, { name: 'MS32F031.svd', data: svd }]), 'broken.pack', root);
    assert.deepEqual(result.imported, []);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].part, 'MS32F031A6A0ZW');
    assert.match(result.skipped[0].reason, /flash memory region is invalid/);
    const packs = await listImportedPacks(root);
    assert.equal(packs.length, 1);
    assert.deepEqual(packs[0].parts, []);
  });
});

test('removing the latest pack restores an earlier profile for the same part', async () => {
  const fixture = await readFile(fixturePath);
  await withStorageRoot(async (root) => {
    await importPack(fixture, 'first.pack', root);
    await importPack(fixture, 'second.pack', root);

    assert.deepEqual(
      (await listImportedPacks(root)).map((pack) => pack.packFile),
      ['packs/MS_Semi/first.pack', 'packs/MS_Semi/second.pack']
    );

    await removePack(root, 'packs/MS_Semi/second.pack');

    assert.equal(getDeviceProfile('MS32F031A6A0ZW').part, 'MS32F031A6A0ZW');

    await removePack(root, 'packs/MS_Semi/first.pack');
    assert.throws(() => getDeviceProfile('MS32F031A6A0ZW'), /Unsupported MCU/);
  });
});

test('migrates version 1 pack metadata to a real archive path', async () => {
  const fixture = await readFile(fixturePath);
  await withStorageRoot(async (root) => {
    await mkdir(join(root, 'packs', 'MS_Semi'), { recursive: true });
    await writeFile(join(root, 'packs', 'MS_Semi', 'legacy.pack'), fixture);
    await writeFile(join(root, 'packs.json'), JSON.stringify({
      version: 1,
      packs: [{
        packFile: 'packs/MS_Semi/legacy.pack',
        vendorName: 'MS Semi',
        importedAt: new Date().toISOString(),
        parts: ['MS32F031A6A0ZW']
      }],
      vendors: [],
      profiles: []
    }), 'utf8');

    const packs = await listImportedPacks(root);
    assert.equal(packs[0].source, 'archive');
    assert.equal(packs[0].archiveFile, join(root, 'packs', 'MS_Semi', 'legacy.pack'));
    const identity = packs[0] as unknown as PackIdentityView;
    assert.equal(identity.vendorId, 'MS_Semi');
    assert.equal(identity.packId, 'MS_Semi:legacy');
    assert.equal(identity.name, 'legacy');
    assert.equal(identity.version, 'unknown');
    assert.equal(existsSync(packs[0].archiveFile!), true);
  });
});

test('a directory pack without a nearby archive has no pyOCD archive path', async () => {
  const pdsc = `<?xml version="1.0" encoding="utf-8"?>
<package><devices><family Dvendor="Sinomcu:985" Dfamily="MS32FXXX Series">
  <processor Dcore="Cortex-M0"/>
  <device Dname="MS32F031A6A0ZW">
    <memory id="IROM1" start="0x08000000" size="0x8000"/>
    <memory id="IRAM1" start="0x20000000" size="0x1000"/>
    <debug svd="MS32F031.svd"/>
  </device>
</family></devices></package>`;
  const svd = `<?xml version="1.0" encoding="utf-8"?>
<device><peripherals><peripheral><name>WWDG</name>
  <interrupt><name>WWDG</name><value>0</value></interrupt>
</peripheral></peripherals></device>`;
  const root = await mkdtemp(join(tmpdir(), 'cmake-embedded-dirpack-noarch-'));
  const packRoot = await mkdtemp(join(tmpdir(), 'cmake-embedded-keilpack-noarch-'));
  try {
    await writeFile(join(packRoot, 'Sinomcu.pdsc'), pdsc, 'utf8');
    await writeFile(join(packRoot, 'MS32F031.svd'), svd, 'utf8');
    await importPackDirectory(packRoot, join(packRoot, 'Sinomcu.pdsc'), root);

    const packs = await listImportedPacks(root);
    assert.equal(packs[0].source, 'directory');
    assert.equal(packs[0].archiveFile, undefined);
  } finally {
    for (const pack of await listImportedPacks(root)) {
      await removePack(root, pack.packFile);
    }
    await rm(root, { recursive: true, force: true });
    await rm(packRoot, { recursive: true, force: true });
  }
});

test('a failed reimport keeps the previously valid profiles registered', async () => {
  const fixture = await readFile(fixturePath);
  const broken = buildZip([{
    name: 'broken.pdsc',
    data: `<?xml version="1.0" encoding="utf-8"?>
<package><devices><family Dvendor="MS Semi" Dfamily="MS32F031">
  <device Dname="MS32F031A6A0ZW" Dcore="CM0"><debug svd="missing.svd"/></device>
</family></devices></package>`
  }]);
  await withStorageRoot(async (root) => {
    await importPack(fixture, 'valid.pack', root);
    assert.equal(getDeviceProfile('MS32F031A6A0ZW').part, 'MS32F031A6A0ZW');

    const result = await importPack(broken, 'valid.pack', root);
    assert.deepEqual(result.imported, []);
    assert.equal(existsSync(join(root, 'packs', 'MS_Semi', 'valid.pack')), true);
    assert.equal(getDeviceProfile('MS32F031A6A0ZW').part, 'MS32F031A6A0ZW');
    const packs = await listImportedPacks(root);
    assert.deepEqual(packs.map((pack) => pack.parts), [['MS32F031A6A0ZW']]);
    assert.deepEqual(
      (await loadImportedProfiles(root)).map((profile) => profile.part),
      ['MS32F031A6A0ZW']
    );
  });
});

test('same-named Packs from different vendors use PDSC identity for storage and profile ownership', async () => {
  const vendorAPdsc = `<?xml version="1.0" encoding="utf-8"?>
<package><devices><family Dvendor="Vendor A" Dfamily="A100 Family">
  <processor Dcore="Cortex-M0"/>
  <device Dname="A100">
    <memory id="IROM1" start="0x08000000" size="0x4000"/>
    <memory id="IRAM1" start="0x20000000" size="0x2000"/>
    <debug svd="A100.svd"/>
  </device>
</family></devices></package>`;
  const vendorBPdsc = vendorAPdsc
    .replaceAll('Vendor A', 'Vendor B')
    .replaceAll('A100 Family', 'B100 Family')
    .replaceAll('A100', 'B100');
  const svd = `<?xml version="1.0" encoding="utf-8"?>
<device><peripherals><peripheral><name>WWDG</name>
  <interrupt><name>WWDG</name><value>0</value></interrupt>
</peripheral></peripherals></device>`;
  const sharedName = 'Shared_DFP.1.0.0.pack';
  await withStorageRoot(async (root) => {
    await importPack(
      buildZip([{ name: 'VendorA.pdsc', data: vendorAPdsc }, { name: 'A100.svd', data: svd }]),
      sharedName,
      root,
      { name: 'Shared_DFP', version: '1.0.0' }
    );
    await importPack(
      buildZip([{ name: 'VendorB.pdsc', data: vendorBPdsc }, { name: 'B100.svd', data: svd }]),
      sharedName,
      root,
      { name: 'Shared_DFP', version: '1.0.0' }
    );

    const packs = await listImportedPacks(root);
    assert.deepEqual(
      packs.map((pack) => [pack.vendorId, pack.packId, pack.packFile]).sort(),
      [
        ['Vendor_A', 'Vendor_A:Shared_DFP', 'packs/Vendor_A/Shared_DFP.1.0.0.pack'],
        ['Vendor_B', 'Vendor_B:Shared_DFP', 'packs/Vendor_B/Shared_DFP.1.0.0.pack']
      ]
    );
    assert.deepEqual(
      (await loadImportedProfiles(root)).map((profile) => profile.part).sort(),
      ['A100', 'B100']
    );
  });
});

test('keeps multiple versions of one PDSC Pack as separate records and ownership', async () => {
  const pdsc = `<?xml version="1.0" encoding="utf-8"?>
<package><devices><family Dvendor="Vendor A" Dfamily="A100 Family">
  <processor Dcore="Cortex-M0"/>
  <device Dname="A100">
    <memory id="IROM1" start="0x08000000" size="0x4000"/>
    <memory id="IRAM1" start="0x20000000" size="0x2000"/>
    <debug svd="A100.svd"/>
  </device>
</family></devices></package>`;
  const svd = `<?xml version="1.0" encoding="utf-8"?>
<device><peripherals><peripheral><name>WWDG</name>
  <interrupt><name>WWDG</name><value>0</value></interrupt>
</peripheral></peripherals></device>`;
  await withStorageRoot(async (root) => {
    for (const version of ['1.0.0', '1.10.0']) {
      await importPack(
        buildZip([{ name: 'VendorA.pdsc', data: pdsc }, { name: 'A100.svd', data: svd }]),
        `Shared_DFP.${version}.pack`,
        root,
        { name: 'Shared_DFP', version }
      );
    }

    const packs = await listImportedPacks(root);
    assert.deepEqual(
      packs.map((pack) => [pack.version, pack.packFile]).sort(),
      [
        ['1.0.0', 'packs/Vendor_A/Shared_DFP.1.0.0.pack'],
        ['1.10.0', 'packs/Vendor_A/Shared_DFP.1.10.0.pack']
      ]
    );
    assert.deepEqual(
      packs.map((pack) => pack.parts),
      [['A100'], ['A100']]
    );
  });
});

test('imports an extracted pack directory in place with the vendor display name', async () => {
  const pdsc = `<?xml version="1.0" encoding="utf-8"?>
<package>
  <devices>
    <family Dvendor="Sinomcu:985" Dfamily="MS32FXXX Series">
      <processor Dcore="Cortex-M0" Dfpu="0"/>
      <subFamily DsubFamily="MS32F031">
        <compile header="Code/include/ms32f0xx.h" define="MS32F031"/>
        <device Dname="MS32F031A6A0ZW">
          <memory id="IROM1" start="0x08000000" size="0x8000"/>
          <memory id="IRAM1" start="0x20000000" size="0x1000"/>
          <debug svd="MS32F031.svd"/>
        </device>
      </subFamily>
    </family>
  </devices>
</package>
`;
  const svd = `<?xml version="1.0" encoding="utf-8"?>
<device>
  <peripherals>
    <peripheral>
      <name>WWDG</name>
      <interrupt>
        <name>WWDG</name>
        <value>0</value>
      </interrupt>
    </peripheral>
  </peripherals>
</device>
`;
  const root = await mkdtemp(join(tmpdir(), 'cmake-embedded-dirpack-'));
  const packRoot = await mkdtemp(join(tmpdir(), 'cmake-embedded-keilpack-'));
  try {
    await mkdir(join(packRoot, 'CMSIS', 'SVD'), { recursive: true });
    await writeFile(join(packRoot, 'Sinomcu.MS32F0xx_DFP.pdsc'), pdsc, 'utf8');
    await writeFile(join(packRoot, 'CMSIS', 'SVD', 'MS32F031.svd'), svd, 'utf8');
    await writeFile(join(packRoot, 'Sinomcu.MS32F0xx_DFP.1.1.1.pack'), 'archive', 'utf8');

    const result = await importPackDirectory(
      packRoot,
      join(packRoot, 'Sinomcu.MS32F0xx_DFP.pdsc'),
      root
    );
    assert.deepEqual(result, { imported: ['MS32F031A6A0ZW'], skipped: [] });

    const packs = await listImportedPacks(root);
    assert.equal(packs.length, 1);
    assert.equal(packs[0].vendorName, 'Sinomcu');
    assert.equal(packs[0].packFile, 'packs/Sinomcu_985/Sinomcu.MS32F0xx_DFP.pack');
    assert.equal(packs[0].source, 'directory');
    assert.equal(
      packs[0].archiveFile,
      join(packRoot, 'Sinomcu.MS32F0xx_DFP.1.1.1.pack')
    );

    const loaded = await loadImportedProfiles(root);
    assert.deepEqual(loaded.map((profile) => profile.part), ['MS32F031A6A0ZW']);
    assert.equal(loaded[0].core, 'cortex-m0');

    // Directory packs are referenced in place: nothing is copied into the storage root.
    assert.equal(existsSync(join(root, 'packs', 'Sinomcu_985', 'Sinomcu.MS32F0xx_DFP.pack')), false);

    await removePack(root, packs[0].packFile);
    assert.deepEqual(await listImportedPacks(root), []);
    assert.throws(() => getDeviceProfile('MS32F031A6A0ZW'), /Unsupported MCU/);
    // The referenced pack directory itself survives removal of the import record.
    assert.equal(existsSync(join(packRoot, 'Sinomcu.MS32F0xx_DFP.pdsc')), true);
  } finally {
    for (const pack of await listImportedPacks(root)) {
      await removePack(root, pack.packFile);
    }
    await rm(root, { recursive: true, force: true });
    await rm(packRoot, { recursive: true, force: true });
  }
});

test('serializes concurrent pack imports so neither record is lost', async () => {
  const fixture = await readFile(fixturePath);
  await withStorageRoot(async (root) => {
    await Promise.all([
      importPack(fixture, 'first.pack', root),
      importPack(fixture, 'second.pack', root)
    ]);

    assert.deepEqual(
      (await listImportedPacks(root)).map((pack) => pack.packFile).sort(),
      ['packs/MS_Semi/first.pack', 'packs/MS_Semi/second.pack']
    );
  });
});

test('replaces pack metadata atomically without leaving temporary files', async () => {
  const fixture = await readFile(fixturePath);
  await withStorageRoot(async (root) => {
    await importPack(fixture, 'atomic.pack', root);
    const before = await readFile(join(root, 'packs.json'), 'utf8');

    await importPack(fixture, 'atomic.pack', root);

    const after = await readFile(join(root, 'packs.json'), 'utf8');
    assert.notEqual(after, before);
    assert.deepEqual(
      (await listImportedPacks(root)).map((pack) => pack.packFile),
      ['packs/MS_Semi/atomic.pack']
    );
    assert.equal(
      (await readdir(root)).some((name) => name.endsWith('.tmp')),
      false
    );
  });
});

test('does not silently discard a corrupt pack store', async () => {
  const fixture = await readFile(fixturePath);
  const root = await mkdtemp(join(tmpdir(), 'cmake-embedded-corrupt-pack-'));
  try {
    const corrupt = '{"packs":[';
    await writeFile(join(root, 'packs.json'), corrupt, 'utf8');

    await assert.rejects(() => importPack(fixture, 'valid.pack', root), /packs\.json.*valid JSON/i);
    assert.equal(await readFile(join(root, 'packs.json'), 'utf8'), corrupt);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
