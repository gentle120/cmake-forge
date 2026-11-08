import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  copyCoreHeaders,
  coreIncludePrefix,
  coreProjectIncludeDir,
  describeCorePack,
  findInstalledCorePack,
  installCorePack,
  installedCoreIncludeDir,
  isCorePackSourceEntry,
  listInstalledCorePacks,
  planCoreHeaderCopy,
  readCorePack
} from '../packs/corePack';
import { buildZip } from './support/zipFixture';

const corePdsc = `<?xml version="1.0" encoding="UTF-8"?>
<package>
  <vendor>ARM</vendor>
  <name>CMSIS</name>
  <releases>
    <release version="6.4.0" date="2026-10-08">CMSIS-Core 6.4.0</release>
  </releases>
  <components/>
</package>`;

/** A minimal core pack: the PDSC plus the headers a device pack includes. */
function corePackBuffer(version = '6.4.0'): Buffer {
  return buildZip([
    { name: 'ARM.CMSIS.pdsc', data: corePdsc.replace('6.4.0', version) },
    { name: `${coreIncludePrefix}/core_cm3.h`, data: '/* cm3 */ #include "cmsis_version.h"\n' },
    { name: `${coreIncludePrefix}/core_cm4.h`, data: '/* cm4 */ #include "cmsis_version.h"\n' },
    { name: `${coreIncludePrefix}/cmsis_version.h`, data: '#define __CMSIS_VERSION 0x060400\n' },
    // Non-header entries the installer must not carry over.
    { name: 'CMSIS/Documentation/README.md', data: 'docs\n' },
    { name: 'CMSIS/DSP/Source/arm_math.c', data: 'int arm_math;\n' }
  ]);
}

/** A vendor device pack: same archive shape, no core headers. */
function devicePackBuffer(): Buffer {
  return buildZip([
    { name: 'Vendor.Chip_DFP.pdsc', data: '<package><vendor>Vendor</vendor><name>Chip_DFP</name></package>' },
    { name: 'Device/Include/chip.h', data: '#include "core_cm4.h"\n' }
  ]);
}

async function withStorage(run: (root: string) => Promise<void>): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cmake-embedded-core-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('selects only the PDSC and the CMSIS core headers from an archive', () => {
  assert.equal(isCorePackSourceEntry('ARM.CMSIS.pdsc'), true);
  assert.equal(isCorePackSourceEntry('CMSIS/Core/Include/core_cm4.h'), true);
  assert.equal(isCorePackSourceEntry('CMSIS/Core/Include/m-profile/armv7m_mpu.h'), true);
  // Documentation, sources and device headers are not part of the core include set.
  assert.equal(isCorePackSourceEntry('CMSIS/Documentation/Overview.md'), false);
  assert.equal(isCorePackSourceEntry('Device/Include/chip.h'), false);
});

test('recognises a core pack and reads its identity', () => {
  const parsed = readCorePack(corePackBuffer(), 'ARM.CMSIS.6.4.0.pack');
  assert.ok(parsed);
  assert.equal(parsed.identity.vendorName, 'ARM');
  assert.equal(parsed.identity.name, 'CMSIS');
  // The version lives in <releases><release>, which the device identity reader
  // does not descend into, so it comes from the archive name.
  assert.equal(parsed.identity.version, '6.4.0');
  assert.deepEqual(parsed.headers.map((entry) => entry.name).sort(), [
    `${coreIncludePrefix}/cmsis_version.h`,
    `${coreIncludePrefix}/core_cm3.h`,
    `${coreIncludePrefix}/core_cm4.h`
  ]);
});

test('rejects a device pack as a core pack', () => {
  // A DFP has no core headers; installing it as the core pack would leave the
  // build broken with nothing installed to fix it.
  assert.equal(readCorePack(devicePackBuffer(), 'Vendor.Chip_DFP.1.0.0.pack'), undefined);
  assert.equal(readCorePack(buildZip([{ name: 'X.pdsc', data: '<package/>' }]), 'X.pack'), undefined);
});

test('installs the core headers into storage and records the include directory', () =>
  withStorage(async (root) => {
    const result = await installCorePack(corePackBuffer(), 'ARM.CMSIS.6.4.0.pack', root);

    assert.equal(result.record.name, 'CMSIS');
    assert.equal(result.record.version, '6.4.0');
    assert.equal(result.record.files, 3);
    assert.equal(result.replaced, false);
    assert.equal(result.record.includeDir, `cores/ARM.CMSIS.6.4.0/${coreIncludePrefix}`);

    const includeDir = await installedCoreIncludeDir(root);
    assert.ok(includeDir);
    assert.equal(
      (await readFile(join(includeDir, 'core_cm4.h'), 'utf8')).includes('cm4'),
      true
    );
    // Only headers are written; the archive's documentation and sources are not.
    await assert.rejects(stat(join(root, 'cores/ARM.CMSIS.6.4.0/CMSIS/Documentation/README.md')), /ENOENT/);
  }));

test('reports the installed core pack and its missing state', () =>
  withStorage(async (root) => {
    const missing = await describeCorePack(root);
    assert.equal(missing.installed, false);
    assert.match(missing.notice, /未安装/);
    assert.equal(await installedCoreIncludeDir(root), undefined);

    await installCorePack(corePackBuffer(), 'ARM.CMSIS.6.4.0.pack', root);
    const installed = await describeCorePack(root);
    assert.equal(installed.installed, true);
    assert.equal(installed.version, '6.4.0');
    assert.match(installed.notice, /6\.4\.0/);
  }));

test('keeping another version leaves the newest include directory selected', () =>
  withStorage(async (root) => {
    await installCorePack(corePackBuffer('6.3.0'), 'ARM.CMSIS.6.3.0.pack', root);
    const second = await installCorePack(corePackBuffer('6.4.0'), 'ARM.CMSIS.6.4.0.pack', root);

    // The previous version is still installed, but new projects must use the
    // newest one so an explicit downgrade is impossible by accident.
    assert.equal(second.replaced, true);
    const versions = (await listInstalledCorePacks(root)).map((pack) => pack.version);
    assert.deepEqual(versions, ['6.4.0', '6.3.0']);
    const includeDir = await installedCoreIncludeDir(root);
    assert.ok(includeDir);
    assert.match(includeDir, /6\.4\.0/);
  }));

test('reinstalling the same version replaces its headers instead of merging', () =>
  withStorage(async (root) => {
    await installCorePack(corePackBuffer('6.4.0'), 'ARM.CMSIS.6.4.0.pack', root);
    const again = await installCorePack(corePackBuffer('6.4.0'), 'ARM.CMSIS.6.4.0.pack', root);

    assert.equal(again.replaced, false);
    assert.equal((await listInstalledCorePacks(root)).length, 1);
    assert.equal(again.record.files, 3);
  }));

test('a stale include directory is not reported as installed', () =>
  withStorage(async (root) => {
    await installCorePack(corePackBuffer(), 'ARM.CMSIS.6.4.0.pack', root);
    // Simulate a storage cleanup that removed the files but not the manifest.
    await rm(join(root, 'cores/ARM.CMSIS.6.4.0'), { recursive: true, force: true });

    assert.equal(await installedCoreIncludeDir(root), undefined);
    assert.equal((await describeCorePack(root)).installed, false);
  }));

test('refuses archive entries that would escape the install directory', () => {
  assert.equal(isCorePackSourceEntry('CMSIS/Core/Include/../escape.h'), false);
  assert.equal(isCorePackSourceEntry('/CMSIS/Core/Include/core_cm4.h'), false);
  assert.equal(isCorePackSourceEntry('C:/CMSIS/Core/Include/core_cm4.h'), false);

  const escaped = buildZip([
    { name: 'ARM.CMSIS.pdsc', data: corePdsc },
    { name: 'CMSIS/Core/Include/../../evil.h', data: 'evil' },
    { name: '/abs/evil.h', data: 'evil' }
  ]);
  assert.equal(readCorePack(escaped, 'ARM.CMSIS.6.4.0.pack'), undefined);
});

test('sanitises dot-only identity fields before deleting the install directory', () =>
  withStorage(async (root) => {
    const traversal = buildZip([
      { name: 'ARM.CMSIS.pdsc', data: '<package><vendor>..</vendor><name>..</name></package>' },
      { name: `${coreIncludePrefix}/core_cm4.h`, data: '/* cm4 */' }
    ]);

    const result = await installCorePack(traversal, 'ARM.CMSIS.6.4.0.pack', root);

    assert.equal(result.record.includeDir.startsWith('cores/'), true);
    assert.equal(result.record.includeDir.includes('..'), false);
    // The storage root itself must still exist after the install rewrite.
    assert.equal((await stat(root)).isDirectory(), true);
    assert.equal((await stat(join(root, 'cores'))).isDirectory(), true);
  }));

test('resolves the requested installed core pack version only when it exists', () =>
  withStorage(async (root) => {
    await installCorePack(corePackBuffer('6.3.0'), 'ARM.CMSIS.6.3.0.pack', root);
    await installCorePack(corePackBuffer('6.4.0'), 'ARM.CMSIS.6.4.0.pack', root);

    assert.equal((await findInstalledCorePack(root))?.record.version, '6.4.0');
    assert.equal((await findInstalledCorePack(root, '6.3.0'))?.record.version, '6.3.0');
    assert.equal(await findInstalledCorePack(root, '9.9.9'), undefined);
    assert.deepEqual((await describeCorePack(root)).versions, ['6.4.0', '6.3.0']);

    await rm(join(root, 'cores/ARM.CMSIS.6.4.0'), { recursive: true, force: true });
    assert.equal(await findInstalledCorePack(root, '6.4.0'), undefined);
    assert.equal((await findInstalledCorePack(root))?.record.version, '6.3.0');
  }));

test('plans only the core headers the selected core needs', () =>
  withStorage(async (root) => {
    await installCorePack(corePackBuffer(), 'ARM.CMSIS.6.4.0.pack', root);
    const pack = await findInstalledCorePack(root);
    assert.ok(pack);

    const projectRoot = join(root, 'project');
    const plan = await planCoreHeaderCopy(pack.includeDir, projectRoot, coreProjectIncludeDir, 'cortex-m3');
    // core_cm4.h belongs to another core and must stay out of an M3 project.
    assert.deepEqual(plan.map((entry) => entry.relative), [
      `${coreProjectIncludeDir}/cmsis_version.h`,
      `${coreProjectIncludeDir}/core_cm3.h`
    ]);

    const m4 = await planCoreHeaderCopy(pack.includeDir, projectRoot, coreProjectIncludeDir, 'cortex-m4');
    assert.deepEqual(m4.map((entry) => entry.relative), [
      `${coreProjectIncludeDir}/cmsis_version.h`,
      `${coreProjectIncludeDir}/core_cm4.h`
    ]);

    // An unfamiliar core falls back to copying every header, never to nothing.
    const unknown = await planCoreHeaderCopy(pack.includeDir, projectRoot, coreProjectIncludeDir, 'cortex-x9');
    assert.equal(unknown.length, 3);
  }));

test('plans and copies core headers into the generated project', () =>
  withStorage(async (root) => {
    await installCorePack(corePackBuffer(), 'ARM.CMSIS.6.4.0.pack', root);
    const pack = await findInstalledCorePack(root);
    assert.ok(pack);

    const projectRoot = join(root, 'project');
    const plan = await planCoreHeaderCopy(pack.includeDir, projectRoot);
    assert.equal(coreProjectIncludeDir, 'CMSIS/Include');
    assert.deepEqual(plan.map((entry) => entry.relative), [
      `${coreProjectIncludeDir}/cmsis_version.h`,
      `${coreProjectIncludeDir}/core_cm3.h`,
      `${coreProjectIncludeDir}/core_cm4.h`
    ]);
    assert.equal(plan.every((entry) => entry.target.startsWith(projectRoot)), true);

    await copyCoreHeaders(plan);
    const copied = await readFile(join(projectRoot, 'CMSIS', 'Include', 'core_cm4.h'), 'utf8');
    assert.ok(copied.includes('cm4'));
  }));

test('keeps only the GCC compiler headers and the selected core', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cmsis-core-closure-'));
  try {
    const includeDir = join(root, 'include');
    await mkdir(join(includeDir, 'm-profile'), { recursive: true });
    await writeFile(join(includeDir, 'core_cm4.h'), '#include "cmsis_compiler.h"\n#include "cmsis_version.h"\n#include "m-profile/armv7m_mpu.h"\n');
    await writeFile(join(includeDir, 'core_cm3.h'), '');
    await writeFile(join(includeDir, 'cmsis_compiler.h'), '#include "cmsis_gcc.h"\n#include "cmsis_armclang.h"\n');
    await writeFile(join(includeDir, 'cmsis_gcc.h'), '#include "m-profile/cmsis_gcc_m.h"\n');
    await writeFile(join(includeDir, 'cmsis_version.h'), '');
    await writeFile(join(includeDir, 'cmsis_armclang.h'), '');
    await writeFile(join(includeDir, 'm-profile', 'armv7m_mpu.h'), '');
    await writeFile(join(includeDir, 'm-profile', 'cmsis_gcc_m.h'), '');

    const plan = await planCoreHeaderCopy(includeDir, join(root, 'project'), coreProjectIncludeDir, 'cortex-m4');
    assert.deepEqual(
      plan.map((entry) => entry.relative.replace(`${coreProjectIncludeDir}/`, '')),
      [
        'cmsis_compiler.h',
        'cmsis_gcc.h',
        'cmsis_version.h',
        'core_cm4.h',
        'm-profile/armv7m_mpu.h',
        'm-profile/cmsis_gcc_m.h'
      ]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
