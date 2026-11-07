import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { getDeviceProfile } from '../devices/deviceProfiles';
import { importPack } from '../devices/importedProfiles';
import { generateCMakeLists } from '../generator/cmakeGenerator';
import { generateLinkerScript } from '../generator/linkerGenerator';
import { generateGnuStartup } from '../generator/startupGenerator';
import { fixturePackBuffer } from './support/fixtureDevice';

test('the fixture Pack imports through the real pipeline and drives GCC generation', async () => {
  const storageRoot = await mkdtemp(join(tmpdir(), 'cmake-embedded-fixture-pack-'));
  try {
    const result = await importPack(fixturePackBuffer(), 'Example.F1_DFP.1.0.0.pack', storageRoot);

    assert.deepEqual(result.skipped, []);
    assert.ok(result.imported.includes('STM32F103C8T6'));

    // The imported identity: PDSC vendor, no Keil-specific fields, portable
    // arm-none-eabi toolchain prefix.
    const profile = getDeviceProfile('STM32F103C8T6');
    assert.equal(profile.vendor, 'Example');
    assert.equal(profile.core, 'cortex-m3');
    assert.deepEqual(profile.flash, { origin: 0x08000000, length: 0x10000 });
    assert.deepEqual(profile.ram, { origin: 0x20000000, length: 0x5000 });
    assert.equal(profile.toolchainPrefix, 'arm-none-eabi');
    assert.equal('gccCompatHeaderFileName' in profile, false);
    assert.equal('scatterFileName' in profile, false);
    assert.equal('areaNames' in profile, false);
    assert.ok(profile.compilerFlags.every((flag) => /^-m(cpu|thumb|fpu|float-abi)/.test(flag)));

    // The generated startup file is GNU assembler, with the vector table
    // derived from the pack SVD; no ARMASM directives survive.
    const startup = generateGnuStartup(profile);
    assert.match(startup, /\.section \.isr_vector/);
    assert.match(startup, /\.word WWDG_IRQHandler/);
    assert.match(startup, /\.weak USBWakeUp_IRQHandler/);
    assert.doesNotMatch(startup, /\bAREA\b|\bDCD\b|\bEXPORT\b|\bENDP\b|\bALIGN\b/);
    assert.doesNotMatch(startup, /arm-linux|keil/i);

    // The linker script is GNU ld syntax driven by the PDSC memory map.
    const linker = generateLinkerScript(profile);
    assert.match(linker, /FLASH \(rx\).*ORIGIN = 0x08000000.*LENGTH = 64K/s);
    assert.match(linker, /RAM \(rw\).*ORIGIN = 0x20000000.*LENGTH = 20K/s);
    assert.doesNotMatch(linker, /SCATTER|Load\*\_Region/);

    // CMakeLists references the generated GNU files and portable command names.
    const cmake = generateCMakeLists('firmware', {
      sources: ['main.c'],
      includeDirs: [],
      defines: []
    }, profile);
    assert.match(cmake, new RegExp(profile.gnuStartupFileName.replace(/\$/g, '')));
    assert.doesNotMatch(cmake, /arm-none-linux|armcc|armclang/);
  } finally {
    await rm(storageRoot, { recursive: true, force: true });
  }
});
