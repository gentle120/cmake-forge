import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { KeilPackEntry } from '../env/toolchainScanner';
import {
  listInstalledPackIdentities,
  resolveInstalledPackIdentity
} from '../packs/installedPacks';
import { buildZip } from './support/zipFixture';

const pdsc = (vendor: string, name: string, version: string): string => `<?xml version="1.0" encoding="utf-8"?>
<package>
  <vendor>${vendor}</vendor>
  <name>${name}</name>
  <release version="${version}"/>
  <devices><family Dvendor="${vendor}" Dfamily="${name} Family">
    <processor Dcore="Cortex-M0"/>
    <device Dname="${name}_DEV">
      <memory id="IROM1" start="0x08000000" size="0x4000"/>
      <memory id="IRAM1" start="0x20000000" size="0x2000"/>
    </device>
  </family></devices>
</package>`;

async function withTempDirectory(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cmake-embedded-installed-identity-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('resolves an extracted Pack identity from its PDSC, not the Keil folder name', async () => {
  await withTempDirectory(async (root) => {
    const versionDirectory = join(root, 'Keil', 'MS32F0xx_DFP', '1.1.1');
    await mkdir(versionDirectory, { recursive: true });
    await writeFile(
      join(versionDirectory, 'Sinomcu.MS32F0xx_DFP.pdsc'),
      pdsc('Sinomcu:985', 'MS32F0xx_DFP', '1.1.1'),
      'utf8'
    );
    const entry: KeilPackEntry = {
      packFile: versionDirectory.replace(/\\/g, '/'),
      vendor: 'Keil',
      name: 'MS32F0xx_DFP',
      version: '1.1.1',
      source: 'directory'
    };

    assert.deepEqual(await resolveInstalledPackIdentity(entry), {
      packFile: versionDirectory.replace(/\\/g, '/'),
      source: 'directory',
      vendorId: 'Sinomcu',
      vendorName: 'Sinomcu',
      name: 'MS32F0xx_DFP',
      version: '1.1.1',
      hasDevices: false
    });
  });
});

test('merges suffixed Dvendor variants and reports importable devices', async () => {
  await withTempDirectory(async (root) => {
    const versionDirectory = join(root, 'ARM', 'Cortex_DFP', '1.1.0');
    await mkdir(join(versionDirectory, 'SVD'), { recursive: true });
    await writeFile(
      join(versionDirectory, 'ARM.Cortex_DFP.pdsc'),
      `<?xml version="1.0" encoding="utf-8"?>
<package><vendor>Arm</vendor><name>Cortex_DFP</name><release version="1.1.0"/>
<devices><family Dvendor="ARM:82" Dfamily="Cortex M0">
  <device Dname="ARMCM0">
    <processor Dcore="Cortex-M0"/>
    <memory id="ROM" start="0x00000000" size="0x40000"/>
    <memory id="RAM" start="0x20000000" size="0x20000"/>
  </device>
</family></devices></package>`,
      'utf8'
    );
    await writeFile(
      join(versionDirectory, 'SVD', 'ARMCM0.svd'),
      `<?xml version="1.0" encoding="utf-8"?>
<device><peripherals><peripheral>
  <name>NVIC</name>
  <interrupt><name>WWDG</name><value>0</value></interrupt>
</peripheral></peripherals></device>`,
      'utf8'
    );
    const entry: KeilPackEntry = {
      packFile: versionDirectory.replace(/\\/g, '/'),
      vendor: 'ARM',
      name: 'Cortex_DFP',
      version: '1.1.0',
      source: 'directory'
    };

    // 'ARM:82' and a plain 'ARM' PDSC must resolve to one vendor identity.
    const identity = await resolveInstalledPackIdentity(entry);
    assert.equal(identity?.vendorId, 'ARM');
    assert.equal(identity?.vendorName, 'ARM');
    assert.equal(identity?.hasDevices, true);
  });
});

test('resolves an installed archive identity from its PDSC instead of the archive name', async () => {
  await withTempDirectory(async (root) => {
    const versionDirectory = join(root, 'Keil', 'STM32F1xx_DFP', '2.4.1');
    await mkdir(versionDirectory, { recursive: true });
    const packFile = join(versionDirectory, 'Keil.STM32F1xx_DFP.2.4.1.pack');
    await writeFile(packFile, buildZip([
      { name: 'Keil.STM32F1xx_DFP.pdsc', data: pdsc('STMicroelectronics', 'STM32F1xx_DFP', '2.4.1') }
    ]));
    const entry: KeilPackEntry = {
      packFile: packFile.replace(/\\/g, '/'),
      vendor: 'Keil',
      name: 'STM32F1xx_DFP',
      version: '2.4.1',
      source: 'file'
    };

    assert.deepEqual(await resolveInstalledPackIdentity(entry), {
      packFile: packFile.replace(/\\/g, '/'),
      source: 'file',
      vendorId: 'STMicroelectronics',
      vendorName: 'STMicroelectronics',
      name: 'STM32F1xx_DFP',
      version: '2.4.1',
      hasDevices: false
    });
  });
});

test('skips installed Packs whose PDSC cannot be read', async () => {
  await withTempDirectory(async (root) => {
    const brokenDirectory = join(root, 'Keil', 'Broken_DFP', '1.0.0');
    await mkdir(brokenDirectory, { recursive: true });
    await writeFile(join(brokenDirectory, 'notes.md'), 'no pdsc here', 'utf8');
    const readable = join(root, 'Keil', 'Good_DFP', '1.0.0');
    await mkdir(readable, { recursive: true });
    await writeFile(join(readable, 'Good.pdsc'), pdsc('Good Vendor', 'Good_DFP', '1.0.0'), 'utf8');

    const identities = await listInstalledPackIdentities([
      {
        packFile: brokenDirectory.replace(/\\/g, '/'),
        vendor: 'Keil',
        name: 'Broken_DFP',
        version: '1.0.0',
        source: 'directory'
      },
      {
        packFile: readable.replace(/\\/g, '/'),
        vendor: 'Keil',
        name: 'Good_DFP',
        version: '1.0.0',
        source: 'directory'
      }
    ]);

    assert.deepEqual(identities.map((identity) => identity.vendorId), ['Good_Vendor']);
  });
});

test('keeps the folder version when the PDSC carries no release version', async () => {
  await withTempDirectory(async (root) => {
    const versionDirectory = join(root, 'Sinomcu', 'MS32F0xx_DFP', '1.2.3');
    await mkdir(versionDirectory, { recursive: true });
    await writeFile(
      join(versionDirectory, 'Sinomcu.MS32F0xx_DFP.pdsc'),
      `<?xml version="1.0" encoding="utf-8"?>
<package><vendor>Sinomcu</vendor><name>MS32F0xx_DFP</name>
<devices><family Dvendor="Sinomcu:985" Dfamily="MS32F0xx">
  <processor Dcore="Cortex-M0"/>
  <device Dname="MS32F031A6A0ZW">
    <memory id="IROM1" start="0x08000000" size="0x4000"/>
    <memory id="IRAM1" start="0x20000000" size="0x2000"/>
  </device>
</family></devices></package>`,
      'utf8'
    );

    const identity = await resolveInstalledPackIdentity({
      packFile: versionDirectory.replace(/\\/g, '/'),
      vendor: 'Sinomcu',
      name: 'MS32F0xx_DFP',
      version: '1.2.3',
      source: 'directory'
    });

    assert.equal(identity?.version, '1.2.3');
    assert.equal(identity?.name, 'MS32F0xx_DFP');
  });
});

test('follows a linked pack directory instead of dropping it as neither file nor directory', async () => {
  // Keeping a pack (or one of its directories) on another drive and linking it in
  // is normal, and a dirent only reports "link" for it. A walk that trusts the
  // dirent type alone sees neither a file nor a directory and silently drops the
  // pack, so the target type has to be resolved.
  const storageRoot = await mkdtemp(join(tmpdir(), 'cmake-embedded-link-pack-'));
  try {
    const packRoot = join(storageRoot, 'LINK_DFP');
    const sharedRoot = join(storageRoot, 'shared');
    await mkdir(packRoot, { recursive: true });
    await mkdir(sharedRoot, { recursive: true });
    await writeFile(join(sharedRoot, 'LINK.pdsc'), pdsc('LinkVendor', 'LINK_DFP', '1.0.0'));
    try {
      // Junctions are creatable without elevation on Windows; the same code path
      // handles directory symlinks elsewhere.
      await symlink(sharedRoot, join(packRoot, 'linked'), 'junction');
    } catch {
      return;
    }

    const identities = await listInstalledPackIdentities([
      {
        packFile: packRoot,
        vendor: 'LinkVendor',
        name: 'LINK_DFP',
        version: '1.0.0',
        source: 'directory'
      }
    ]);

    assert.equal(identities.length, 1);
    assert.equal(identities[0].name, 'LINK_DFP');
    assert.equal(identities[0].hasDevices, false);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});
