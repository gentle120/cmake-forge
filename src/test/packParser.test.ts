import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { hasImportablePackDevice, parsePack } from '../packs/packParser';

const fixturePath = join(__dirname, '..', '..', 'src', 'test', 'fixtures', 'ms32f031.pack');

function buildZip(entries: Array<{ name: string; data: string | Buffer }>): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
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

function wrapPdsc(deviceXml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<package>
  <vendor>MS Semi</vendor>
  <name>MS32F031_DFP</name>
  <devices>
    <family Dvendor="MS Semi" Dfamily="MS32F031">
${deviceXml}
    </family>
  </devices>
</package>
`;
}

test('parses the fixture pack into a device candidate with a hole-filled vector table', () => {
  const pack = parsePack(readFileSync(fixturePath));

  assert.equal(pack.vendorName, 'MS Semi');
  assert.equal(pack.devices.length, 1);
  const device = pack.devices[0];
  assert.equal(device.error, undefined);
  assert.equal(device.part, 'MS32F031A6A0ZW');
  assert.equal(device.family, 'MS32F031');
  assert.equal(device.series, 'MS32F031');
  assert.equal(device.core, 'cortex-m0');
  assert.equal(device.fpu, '');
  assert.deepEqual(device.flash, { origin: 0x08000000, length: 0x8000 });
  assert.deepEqual(device.ram, { origin: 0x20000000, length: 0x2000 });
  assert.deepEqual(device.defines, ['MS32F031x6']);

  const handlers = device.interruptHandlers ?? [];
  // IRQ numbers map to array indexes; values 1 and 13 are absent, so their
  // slots are reserved with the literal '0'.
  assert.equal(handlers.length, 16);
  assert.equal(handlers[0], 'WWDG_IRQHandler');
  assert.equal(handlers[1], '0');
  assert.equal(handlers[12], 'TIM1_CC_IRQHandler');
  assert.equal(handlers[13], '0');
  assert.equal(handlers[14], 'TIM3_IRQHandler');
  assert.equal(handlers[handlers.length - 1], 'TIM6_IRQHandler');
  assert.equal(handlers.filter((handler) => handler !== '0').length, 14);
});

test('inherits the family processor node and accepts full-name Dcore values', () => {
  // Sinomcu-style layout: <processor Dcore> on the family, full core name,
  // subFamily processor carries only Dclock and must not erase the family.
  const pdsc = `<?xml version="1.0" encoding="utf-8"?>
<package>
  <devices>
    <family Dvendor="Sinomcu:985" Dfamily="MS32FXXX Series">
      <processor Dcore="Cortex-M0" DcoreVersion="r0p0" Dfpu="0" Dmpu="0" Dendian="Little-endian"/>
      <subFamily DsubFamily="MS32F031">
        <processor Dclock="48000000"/>
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
  const pack = parsePack(
    buildZip([{ name: 'Sinomcu.MS32F0xx_DFP.pdsc', data: pdsc }, { name: 'MS32F031.svd', data: svd }])
  );

  assert.equal(pack.vendorName, 'Sinomcu:985');
  const device = pack.devices[0];
  assert.equal(device.part, 'MS32F031A6A0ZW');
  assert.equal(device.core, 'cortex-m0');
  assert.equal(device.error, undefined);
  assert.deepEqual(device.defines, ['MS32F031']);
});

test('falls back to the startup file vector table when the pack has no SVD', () => {
  const pdsc = wrapPdsc(`      <device Dname="MS32F031A6A0ZW" Dcore="CM0">
        <memory id="ROM" start="0x08000000" size="0x8000"/>
        <memory id="RAM" start="0x20000000" size="0x2000"/>
      </device>`);
  const startup = `
        AREA    RESET, DATA, READONLY

g_pfnVectors:
        DCD     _estack
        DCD     Reset_Handler
        DCD     NMI_Handler
        DCD     HardFault_Handler
        DCD     0
        DCD     0
        DCD     0
        DCD     0
        DCD     SVC_Handler
        DCD     DebugMon_Handler
        DCD     0
        DCD     PendSV_Handler
        DCD     SysTick_Handler
        DCD     WWDG_IRQHandler
        DCD     RTC_IRQHandler ; trailing comment is stripped
        DCD     FLASH_IRQHandler, RCC_IRQHandler
        DCD     0x00000000 ; numeric operands stay out of the IRQ table

__Vectors_End
        AREA    |.text|, CODE, READONLY
`;
  const pack = parsePack(buildZip([{ name: 'MS32F031.pdsc', data: pdsc }, { name: 'startup_MS32F031A6A0ZW.s', data: startup }]));

  assert.equal(pack.devices[0].error, undefined);
  assert.deepEqual(pack.devices[0].interruptHandlers, [
    'WWDG_IRQHandler',
    'RTC_IRQHandler',
    'FLASH_IRQHandler',
    'RCC_IRQHandler'
  ]);
});

test('marks a device without SVD or startup file as failed', () => {
  const pdsc = wrapPdsc(`      <device Dname="MS32F031A6A0ZW" Dcore="CM0">
        <memory id="ROM" start="0x08000000" size="0x8000"/>
        <memory id="RAM" start="0x20000000" size="0x2000"/>
      </device>`);
  const pack = parsePack(buildZip([{ name: 'MS32F031.pdsc', data: pdsc }]));

  assert.equal(pack.devices[0].interruptHandlers, undefined);
  assert.equal(pack.devices[0].error, 'no interrupt source');
});

const cortexSvd = `<?xml version="1.0" encoding="utf-8"?>
<device>
  <peripherals>
    <peripheral>
      <name>NVIC</name>
      <interrupt>
        <name>WWDG</name>
        <value>0</value>
      </interrupt>
    </peripheral>
  </peripherals>
</device>
`;

test('resolves a device-level processor node as the core source', () => {
  // Cortex_DFP layout: <processor Dcore> sits inside <device>, full core name.
  const pdsc = wrapPdsc(`      <device Dname="ARMCM0">
        <processor Dcore="Cortex-M0" Dfpu="NO_FPU"/>
        <memory id="ROM" start="0x00000000" size="0x40000"/>
        <memory id="RAM" start="0x20000000" size="0x20000"/>
        <debug svd="ARMCM0.svd"/>
      </device>
      <device Dname="ARMCA5">
        <processor Dcore="Cortex-A5"/>
        <memory id="ROM" start="0x00000000" size="0x40000"/>
        <debug svd="ARMCM0.svd"/>
      </device>`);
  const pack = parsePack(
    buildZip([{ name: 'ARM.Cortex_DFP.pdsc', data: pdsc }, { name: 'ARMCM0.svd', data: cortexSvd }])
  );

  assert.deepEqual(pack.devices.map((device) => [device.part, device.core, device.error]), [
    ['ARMCM0', 'cortex-m0', undefined],
    ['ARMCA5', '', 'unsupported Dcore']
  ]);
});

test('accepts plus-spelled full-name Dcore values', () => {
  const pdsc = wrapPdsc(`      <device Dname="ARMCM0P">
        <processor Dcore="Cortex-M0+"/>
        <memory id="ROM" start="0x00000000" size="0x40000"/>
        <memory id="RAM" start="0x20000000" size="0x20000"/>
        <debug svd="ARMCM0.svd"/>
      </device>`);
  const pack = parsePack(
    buildZip([{ name: 'ARM.Cortex_DFP.pdsc', data: pdsc }, { name: 'ARMCM0.svd', data: cortexSvd }])
  );

  assert.equal(pack.devices[0].core, 'cortex-m0plus');
  assert.equal(pack.devices[0].error, undefined);
});

test('reports an importable device only when core, memory, and an interrupt source exist', () => {
  const componentPdsc = `<?xml version="1.0" encoding="utf-8"?>
<package><vendor>ARM</vendor><name>CMSIS</name><release version="6.3.0"/></package>`;
  const devicePdsc = wrapPdsc(`      <device Dname="ARMCM0">
        <processor Dcore="Cortex-M0"/>
        <memory id="ROM" start="0x00000000" size="0x40000"/>
        <memory id="RAM" start="0x20000000" size="0x20000"/>
      </device>`);
  const attributePdsc = wrapPdsc(`      <device Dname="MS32F031A6A0ZW" Dcore="CM0">
        <memory id="ROM" start="0x08000000" size="0x8000"/>
        <memory id="RAM" start="0x20000000" size="0x2000"/>
      </device>`);
  const unsupportedPdsc = wrapPdsc(`      <device Dname="ARMCA5">
        <processor Dcore="Cortex-A5"/>
        <memory id="ROM" start="0x00000000" size="0x40000"/>
      </device>`);
  const memorylessPdsc = wrapPdsc(`      <device Dname="ARMCM0">
        <processor Dcore="Cortex-M0"/>
      </device>`);
  // Generic core SVD without interrupt declarations, as shipped by Cortex_DFP.
  const bareSvd = `<?xml version="1.0" encoding="utf-8"?>
<device>
  <peripherals>
    <peripheral><name>NVIC</name></peripheral>
  </peripherals>
</device>
`;
  const irqSvd = cortexSvd;
  const entries = (...names: string[]): Array<{ name: string; data: Buffer }> => {
    const sources: Record<string, string> = {
      'component.pdsc': componentPdsc,
      'device.pdsc': devicePdsc,
      'attribute.pdsc': attributePdsc,
      'unsupported.pdsc': unsupportedPdsc,
      'memoryless.pdsc': memorylessPdsc,
      'bare.svd': bareSvd,
      'irq.svd': irqSvd,
      'broken.pdsc': '<package><devices>'
    };
    return names.map((name) => ({ name, data: Buffer.from(sources[name]) }));
  };

  assert.equal(hasImportablePackDevice(entries('component.pdsc')), false);
  // Cores and memory resolve, but no interrupt source exists in the pack.
  assert.equal(hasImportablePackDevice(entries('device.pdsc')), false);
  assert.equal(hasImportablePackDevice(entries('device.pdsc', 'bare.svd')), false);
  assert.equal(hasImportablePackDevice(entries('device.pdsc', 'irq.svd')), true);
  assert.equal(hasImportablePackDevice(entries('attribute.pdsc', 'irq.svd')), true);
  assert.equal(hasImportablePackDevice(entries('unsupported.pdsc', 'irq.svd')), false);
  assert.equal(hasImportablePackDevice(entries('memoryless.pdsc', 'irq.svd')), false);
  assert.equal(hasImportablePackDevice(entries('broken.pdsc')), false);
  assert.equal(hasImportablePackDevice([]), false);
});

test('marks devices with an unsupported Dcore as failed', () => {
  const pdsc = wrapPdsc(`      <device Dname="MS32CA7" Dcore="CA7">
        <memory id="ROM" start="0x08000000" size="0x8000"/>
        <memory id="RAM" start="0x20000000" size="0x2000"/>
      </device>`);
  const pack = parsePack(buildZip([{ name: 'MS32F031.pdsc', data: pdsc }]));

  assert.equal(pack.devices[0].error, 'unsupported Dcore');
  assert.equal(pack.devices[0].core, '');
});

test('expands DnameVariant entries and reads the series from a subFamily', () => {
  const pdsc = `<?xml version="1.0" encoding="utf-8"?>
<package>
  <devices>
    <family Dvendor="MS Semi" Dfamily="MS32F031">
      <subFamily Dname="MS32F0">
        <device Dname="MS32F031A6A0ZW" DnameVariant="MS32F031A6, MS32F031K6" Dcore="CM0">
          <memory id="ROM" start="0x08000000" size="0x8000"/>
          <memory id="RAM" start="0x20000000" size="0x2000"/>
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
  const pack = parsePack(
    buildZip([{ name: 'MS32F031.pdsc', data: pdsc }, { name: 'MS32F031.svd', data: svd }])
  );

  assert.deepEqual(
    pack.devices.map((device) => device.part),
    ['MS32F031A6A0ZW', 'MS32F031A6', 'MS32F031K6']
  );
  assert.ok(pack.devices.every((device) => device.series === 'MS32F0' && device.core === 'cortex-m0'));
  assert.deepEqual(pack.devices[2].interruptHandlers, ['WWDG_IRQHandler']);
});
