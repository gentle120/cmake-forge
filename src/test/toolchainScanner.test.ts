import assert from 'node:assert/strict';
import test from 'node:test';
import {
  defaultScanRoots,
  listKeilPacks,
  scanToolchains,
  type ScanFileSystem,
  type ScanRoots
} from '../env/toolchainScanner';

function createFakeFs(
  directories: Record<string, string[]>,
  files: string[] = []
): ScanFileSystem {
  const fileSet = new Set(files);
  return {
    exists: (path) =>
      Object.prototype.hasOwnProperty.call(directories, path) || fileSet.has(path),
    readDir: (path) => {
      const entries = directories[path];
      if (!entries) {
        throw new Error(`ENOENT: ${path}`);
      }
      return [...entries];
    }
  };
}

function scanRoots(overrides: Partial<ScanRoots> = {}): ScanRoots {
  return {
    keilDirs: [],
    packRoots: [],
    cltRoots: [],
    seggerRoots: [],
    pathDirs: [],
    ...overrides
  };
}

test('builds win32 scan roots from the environment', () => {
  const roots = defaultScanRoots('win32', {
    PATH: 'C:/tools/bin;C:/segger',
    LOCALAPPDATA: 'C:\\Users\\dev\\AppData\\Local',
    CMSIS_PACK_ROOT: 'C:/packs',
    KEIL_PATH: 'D:/Keil5'
  }, 'C:/Users/dev');

  assert.deepEqual(roots.keilDirs, ['C:/Keil_v5', 'C:/Keil', 'D:/Keil5']);
  assert.deepEqual(roots.packRoots, [
    'C:/packs',
    'C:/Users/dev/AppData/Local/Arm/Packs',
    'C:/Keil_v5/ARM/PACK',
    'C:/Keil/ARM/PACK',
    'D:/Keil5/ARM/PACK'
  ]);
  assert.deepEqual(roots.cltRoots, ['C:/ST', 'C:/']);
  // J-Link is a 32-bit application, so it can live in either Program Files.
  assert.deepEqual(roots.seggerRoots, [
    'C:/Program Files/SEGGER',
    'C:/Program Files (x86)/SEGGER'
  ]);
  assert.deepEqual(roots.pathDirs, ['C:/tools/bin', 'C:/segger']);
});

test('honours a relocated Program Files when looking for SEGGER', () => {
  const roots = defaultScanRoots('win32', {
    ProgramFiles: 'D:/Apps',
    'ProgramFiles(x86)': 'D:/Apps32'
  }, 'C:/Users/dev');

  assert.deepEqual(roots.seggerRoots, ['D:/Apps/SEGGER', 'D:/Apps32/SEGGER']);
});

test('includes detected drives without exposing standalone ARM GNU path scanning', () => {
  const roots = defaultScanRoots('win32', {}, 'C:/Users/dev', ['C:/', 'D:/']);
  assert.deepEqual(roots.cltRoots, ['C:/ST', 'C:/', 'D:/ST', 'D:/']);
  assert.equal('armGccRoots' in roots, false);
});

test('uses numeric STM32CubeCLT installation versions for non-ARM tools', () => {
  const fs = createFakeFs({ 'D:/': ['STM32CubeCLT_1.9.0', 'STM32CubeCLT_1.20.0'] }, [
    'D:/STM32CubeCLT_1.9.0/OpenOCD/bin/openocd.exe',
    'D:/STM32CubeCLT_1.20.0/OpenOCD/bin/openocd.exe'
  ]);
  const hits = scanToolchains(scanRoots({ cltRoots: ['D:/'] }), fs);
  assert.deepEqual(hits, [{
    kind: 'openocd',
    label: 'OpenOCD (STM32CubeCLT)',
    path: 'D:/STM32CubeCLT_1.20.0/OpenOCD/bin/openocd.exe'
  }]);
});

test('omits win32 environment entries that are not set', () => {
  const roots = defaultScanRoots('win32', {}, 'C:/Users/dev');

  assert.deepEqual(roots.keilDirs, ['C:/Keil_v5', 'C:/Keil']);
  assert.deepEqual(roots.packRoots, ['C:/Keil_v5/ARM/PACK', 'C:/Keil/ARM/PACK']);
  assert.deepEqual(roots.pathDirs, []);
});

test('builds posix scan roots from the environment', () => {
  const linux = defaultScanRoots('linux', { PATH: '/usr/bin:/usr/local/bin' }, '/home/dev');
  assert.deepEqual(linux.keilDirs, ['/home/dev/keil', '/Applications/Keil']);
  assert.deepEqual(linux.packRoots, ['/home/dev/keil/ARM/PACK', '/Applications/Keil/ARM/PACK']);
  assert.deepEqual(linux.cltRoots, ['/opt/st']);
  assert.deepEqual(linux.seggerRoots, ['/opt/SEGGER']);
  assert.deepEqual(linux.pathDirs, ['/usr/bin', '/usr/local/bin']);

  const darwin = defaultScanRoots('darwin', { PATH: '/usr/bin' }, '/Users/dev');
  assert.deepEqual(darwin.keilDirs, ['/Users/dev/keil', '/Applications/Keil']);
  assert.deepEqual(darwin.cltRoots, ['/opt/st']);
  assert.deepEqual(darwin.seggerRoots, ['/opt/SEGGER']);
});

test('reports the Keil installation directory', () => {
  const fs = createFakeFs({ 'C:/Keil_v5': ['ARM', 'UV4'] });

  assert.deepEqual(scanToolchains(scanRoots({ keilDirs: ['C:/Keil_v5', 'C:/Keil'] }), fs), [
    { kind: 'keil', label: 'Keil MDK', path: 'C:/Keil_v5' }
  ]);
});

test('probes every STM32CubeCLT tool in the newest installation', () => {
  const fs = createFakeFs(
    {
      'C:/ST': ['STM32CubeCLT_1.13.1', 'STM32CubeCLT_1.16.0']
    },
    [
      'C:/ST/STM32CubeCLT_1.13.1/OpenOCD/bin/openocd.exe',
      'C:/ST/STM32CubeCLT_1.16.0/OpenOCD/bin/openocd.exe',
      'C:/ST/STM32CubeCLT_1.16.0/STLink-gdb-server/bin/ST-LINK_gdbserver.exe',
      'C:/ST/STM32CubeCLT_1.16.0/STM32CubeProgrammer/bin/STM32_Programmer_CLI.exe'
    ]
  );

  assert.deepEqual(scanToolchains(scanRoots({ cltRoots: ['C:/ST'] }), fs), [
    {
      kind: 'openocd',
      label: 'OpenOCD (STM32CubeCLT)',
      path: 'C:/ST/STM32CubeCLT_1.16.0/OpenOCD/bin/openocd.exe'
    },
    {
      kind: 'stlink-gdbserver',
      label: 'ST-LINK GDB Server (STM32CubeCLT)',
      path: 'C:/ST/STM32CubeCLT_1.16.0/STLink-gdb-server/bin/ST-LINK_gdbserver.exe'
    },
    {
      kind: 'stm32cubeprogrammer',
      label: 'STM32CubeProgrammer (STM32CubeCLT)',
      path: 'C:/ST/STM32CubeCLT_1.16.0/STM32CubeProgrammer/bin/STM32_Programmer_CLI.exe'
    }
  ]);
});

test('keeps STM32CubeCLT tools that exist and skips the missing ones', () => {
  const fs = createFakeFs(
    { 'C:/ST': ['STM32CubeCLT_1.16.0'] },
    ['C:/ST/STM32CubeCLT_1.16.0/OpenOCD/bin/openocd']
  );

  assert.deepEqual(scanToolchains(scanRoots({ cltRoots: ['C:/ST'] }), fs), [
    {
      kind: 'openocd',
      label: 'OpenOCD (STM32CubeCLT)',
      path: 'C:/ST/STM32CubeCLT_1.16.0/OpenOCD/bin/openocd'
    }
  ]);
});

test('uses a clt root that already is an installation directory', () => {
  const fs = createFakeFs(
    {},
    ['C:/ST/STM32CubeCLT_1.15.0/OpenOCD/bin/openocd']
  );

  assert.deepEqual(
    scanToolchains(scanRoots({ cltRoots: ['C:/ST/STM32CubeCLT_1.15.0'] }), fs),
    [
      {
        kind: 'openocd',
        label: 'OpenOCD (STM32CubeCLT)',
        path: 'C:/ST/STM32CubeCLT_1.15.0/OpenOCD/bin/openocd'
      }
    ]
  );
});

test('takes the newest SEGGER J-Link installation and its launcher', () => {
  const windows = createFakeFs(
    { 'C:/Program Files/SEGGER': ['Config', 'JLink_V788', 'JLink_V794e'] },
    ['C:/Program Files/SEGGER/JLink_V794e/JLink.exe']
  );
  assert.deepEqual(
    scanToolchains(scanRoots({ seggerRoots: ['C:/Program Files/SEGGER'] }), windows),
    [{ kind: 'jlink', label: 'SEGGER J-Link', path: 'C:/Program Files/SEGGER/JLink_V794e/JLink.exe' }]
  );

  const posix = createFakeFs(
    { '/opt/SEGGER': ['JLink_V794e'] },
    ['/opt/SEGGER/JLink_V794e/JLinkExe']
  );
  assert.deepEqual(scanToolchains(scanRoots({ seggerRoots: ['/opt/SEGGER'] }), posix), [
    { kind: 'jlink', label: 'SEGGER J-Link', path: '/opt/SEGGER/JLink_V794e/JLinkExe' }
  ]);
});

test('finds the supported tools on PATH', () => {
  const fs = createFakeFs(
    {},
    [
      'C:/tools/bin/openocd.exe',
      'C:/tools/bin/pyocd.exe',
      'C:/segger/JLinkExe'
    ]
  );

  assert.deepEqual(
    scanToolchains(scanRoots({ pathDirs: ['C:/tools/bin', 'C:/segger', 'C:/empty'] }), fs),
    [
      { kind: 'openocd', label: 'OpenOCD (PATH)', path: 'C:/tools/bin/openocd.exe' },
      { kind: 'pyocd', label: 'pyOCD (PATH)', path: 'C:/tools/bin/pyocd.exe' },
      { kind: 'jlink', label: 'SEGGER J-Link (PATH)', path: 'C:/segger/JLinkExe' }
    ]
  );
});

test('prefers JLink.exe over JLinkExe in a PATH directory', () => {
  const fs = createFakeFs({}, ['C:/segger/JLink.exe', 'C:/segger/JLinkExe']);

  assert.deepEqual(scanToolchains(scanRoots({ pathDirs: ['C:/segger'] }), fs), [
    { kind: 'jlink', label: 'SEGGER J-Link (PATH)', path: 'C:/segger/JLink.exe' }
  ]);
});

test('does not report a PATH executable twice when it sits in a scanned directory', () => {
  const fs = createFakeFs(
    { 'C:/Program Files/SEGGER': ['JLink_V794e'] },
    ['C:/Program Files/SEGGER/JLink_V794e/JLink.exe']
  );

  const hits = scanToolchains(
    scanRoots({
      seggerRoots: ['C:/Program Files/SEGGER'],
      pathDirs: ['C:/Program Files/SEGGER/JLink_V794e']
    }),
    fs
  );

  assert.deepEqual(hits, [
    { kind: 'jlink', label: 'SEGGER J-Link', path: 'C:/Program Files/SEGGER/JLink_V794e/JLink.exe' }
  ]);
});

test('keeps the scan order Keil, STM32CubeCLT, SEGGER, PATH', () => {
  const fs = createFakeFs(
    {
      'C:/Keil_v5': ['ARM'],
      'C:/ST': ['STM32CubeCLT_1.16.0'],
      'C:/Program Files/SEGGER': ['JLink_V794e']
    },
    [
      'C:/Program Files/SEGGER/JLink_V794e/JLink.exe',
      'D:/pyocd/pyocd.exe'
    ]
  );

  assert.deepEqual(
    scanToolchains(
      scanRoots({
        keilDirs: ['C:/Keil_v5'],
        cltRoots: ['C:/ST'],
        seggerRoots: ['C:/Program Files/SEGGER'],
        pathDirs: ['D:/pyocd']
      }),
      fs
    ).map((hit) => hit.kind),
    ['keil', 'jlink', 'pyocd']
  );
});

test('reports nothing when the machine has none of the tools', () => {
  const fs = createFakeFs({});

  assert.deepEqual(
    scanToolchains(
      scanRoots({
        keilDirs: ['C:/Keil_v5'],
        cltRoots: ['C:/ST'],
        seggerRoots: ['C:/Program Files/SEGGER'],
        pathDirs: ['C:/Windows']
      }),
      fs
    ),
    []
  );
});

test('lists the packs of the Keil CMSIS layout and skips unrelated entries', () => {
  const packRoot = 'C:/Keil_v5/ARM/PACK';
  const fs = createFakeFs(
    {
      [packRoot]: ['ARM', 'Keil', 'Readme.txt'],
      [`${packRoot}/ARM`]: ['CMSIS'],
      [`${packRoot}/ARM/CMSIS`]: ['5.9.0'],
      [`${packRoot}/ARM/CMSIS/5.9.0`]: ['ARM.CMSIS.5.9.0.pack'],
      [`${packRoot}/Keil`]: ['STM32F0xx_DFP', 'STM32F7xx_DFP'],
      [`${packRoot}/Keil/STM32F0xx_DFP`]: ['1.0.0'],
      [`${packRoot}/Keil/STM32F0xx_DFP/1.0.0`]: ['notes.md'],
      [`${packRoot}/Keil/STM32F7xx_DFP`]: ['2.1.0'],
      [`${packRoot}/Keil/STM32F7xx_DFP/2.1.0`]: ['Keil.STM32F7xx_DFP.2.1.0.pack']
    },
    [
      `${packRoot}/ARM/CMSIS/5.9.0/ARM.CMSIS.5.9.0.pack`,
      `${packRoot}/Keil/STM32F7xx_DFP/2.1.0/Keil.STM32F7xx_DFP.2.1.0.pack`
    ]
  );
  assert.deepEqual(listKeilPacks(['C:/missing', packRoot], fs), [
    {
      packFile: `${packRoot}/ARM/CMSIS/5.9.0/ARM.CMSIS.5.9.0.pack`,
      vendor: 'ARM',
      name: 'CMSIS',
      version: '5.9.0',
      source: 'file'
    },
    {
      packFile: `${packRoot}/Keil/STM32F7xx_DFP/2.1.0/Keil.STM32F7xx_DFP.2.1.0.pack`,
      vendor: 'Keil',
      name: 'STM32F7xx_DFP',
      version: '2.1.0',
      source: 'file'
    }
  ]);
});

test('lists extracted pack directories and prefers them over the .pack file', () => {
  const packRoot = 'C:/Arm/Packs';
  const fs = createFakeFs({
    [packRoot]: ['Sinomcu', 'Keil'],
    [`${packRoot}/Sinomcu`]: ['MS32F0xx_DFP'],
    [`${packRoot}/Sinomcu/MS32F0xx_DFP`]: ['1.1.1'],
    // Keil installs packs unpacked: version directory holds the .pdsc.
    [`${packRoot}/Sinomcu/MS32F0xx_DFP/1.1.1`]: ['Sinomcu.MS32F0xx_DFP.pdsc', 'CMSIS'],
    [`${packRoot}/Keil`]: ['STM32F1xx_DFP'],
    [`${packRoot}/Keil/STM32F1xx_DFP`]: ['2.4.1'],
    [`${packRoot}/Keil/STM32F1xx_DFP/2.4.1`]: ['Keil.STM32F1xx_DFP.2.4.1.pack']
  },
  [
    `${packRoot}/Sinomcu/MS32F0xx_DFP/1.1.1/Sinomcu.MS32F0xx_DFP.pdsc`,
    `${packRoot}/Keil/STM32F1xx_DFP/2.4.1/Keil.STM32F1xx_DFP.2.4.1.pack`
  ]);

  assert.deepEqual(listKeilPacks([packRoot], fs), [
    {
      packFile: `${packRoot}/Keil/STM32F1xx_DFP/2.4.1/Keil.STM32F1xx_DFP.2.4.1.pack`,
      vendor: 'Keil',
      name: 'STM32F1xx_DFP',
      version: '2.4.1',
      source: 'file'
    },
    {
      packFile: `${packRoot}/Sinomcu/MS32F0xx_DFP/1.1.1`,
      vendor: 'Sinomcu',
      name: 'MS32F0xx_DFP',
      version: '1.1.1',
      source: 'directory'
    }
  ]);
});

test('reports the installation folder for an extracted Pack so its PDSC can resolve the identity', () => {
  const packRoot = 'C:/Keil_v5/ARM/PACK';
  const fs = createFakeFs({
    [packRoot]: ['Keil'],
    [`${packRoot}/Keil`]: ['MS32F0xx_DFP'],
    [`${packRoot}/Keil/MS32F0xx_DFP`]: ['1.1.1'],
    [`${packRoot}/Keil/MS32F0xx_DFP/1.1.1`]: ['Sinomcu.MS32F0xx_DFP.pdsc']
  }, [`${packRoot}/Keil/MS32F0xx_DFP/1.1.1/Sinomcu.MS32F0xx_DFP.pdsc`]);

  assert.deepEqual(listKeilPacks([packRoot], fs), [{
    packFile: `${packRoot}/Keil/MS32F0xx_DFP/1.1.1`,
    vendor: 'Keil',
    name: 'MS32F0xx_DFP',
    version: '1.1.1',
    source: 'directory'
  }]);
});

test('does not probe the CMSIS download caches of a Pack root', () => {
  const packRoot = 'C:/Users/dev/AppData/Local/Arm/Packs';
  const probed: string[] = [];
  const fakeFs: ScanFileSystem = {
    exists: (path) => path === packRoot,
    readDir: (path) => {
      probed.push(path);
      if (path === packRoot) {
        // A real root carries the CMSIS caches next to the vendor directories.
        return ['.Download', '.Local', '.Web', 'pack.idx', 'Keil'];
      }
      if (path === `${packRoot}/.Web`) {
        return ['Keil.STM32F1xx_DFP.2.4.1.pdsc', 'Keil.STM32F4xx_DFP.2.15.0.pdsc'];
      }
      if (path === `${packRoot}/Keil`) {
        return ['STM32F1xx_DFP'];
      }
      if (path === `${packRoot}/Keil/STM32F1xx_DFP`) {
        return ['2.4.1'];
      }
      if (path === `${packRoot}/Keil/STM32F1xx_DFP/2.4.1`) {
        return ['Keil.STM32F1xx_DFP.2.4.1.pdsc'];
      }
      throw new Error(`unexpected probe ${path}`);
    }
  };

  const packs = listKeilPacks([packRoot], fakeFs);

  assert.deepEqual(packs.map((pack) => pack.packFile), [`${packRoot}/Keil/STM32F1xx_DFP/2.4.1`]);
  // The caches hold thousands of flat .pdsc files; probing each one as a vendor
  // directory cost a failed readdir per file before the dot-directory skip.
  assert.equal(probed.some((path) => path.startsWith(`${packRoot}/.`)), false);
});
