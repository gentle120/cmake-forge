import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { readZipEntries } from '../packs/zipReader';
import { crc32 } from '../packs/crc32';

interface FakeZipEntry {
  name: string;
  data: Buffer;
  method: 0 | 8;
  flags?: number;
  versionNeeded?: number;
  localHeaderOffsetOverride?: number;
  /** Deliberately wrong CRC, to prove corrupt payloads are rejected. */
  crcOverride?: number;
  /** Store sizes in the Zip64 extra field instead of the 32-bit header fields. */
  zip64?: boolean;
}

function buildZip(entries: FakeZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const compressed = entry.method === 8 ? deflateRawSync(entry.data) : entry.data;
    const crc = entry.crcOverride ?? crc32(entry.data);
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.versionNeeded ?? 20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localChunks.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.zip64 ? 45 : entry.versionNeeded ?? 20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.zip64 ? 0xffffffff : compressed.length, 20);
    central.writeUInt32LE(entry.zip64 ? 0xffffffff : entry.data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(entry.localHeaderOffsetOverride ?? offset, 42);
    const zip64Extra = entry.zip64 ? Buffer.alloc(20) : undefined;
    if (zip64Extra) {
      zip64Extra.writeUInt16LE(0x0001, 0);
      zip64Extra.writeUInt16LE(16, 2);
      zip64Extra.writeBigUInt64LE(BigInt(entry.data.length), 4);
      zip64Extra.writeBigUInt64LE(BigInt(compressed.length), 12);
      central.writeUInt16LE(zip64Extra.length, 30);
    }
    centralChunks.push(central, nameBuffer, ...(zip64Extra ? [zip64Extra] : []));

    offset += 30 + nameBuffer.length + compressed.length;
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

test('reads stored and deflate entries with UTF-8 names', () => {
  const storedData = Buffer.from('plain stored payload');
  const deflateData = Buffer.from('compressible content '.repeat(24));
  const zip = buildZip([
    { name: '中文目录/说明.txt', data: storedData, method: 0 },
    { name: 'dir/data.bin', data: deflateData, method: 8 }
  ]);

  const entries = readZipEntries(zip);

  assert.deepEqual(
    entries.map((entry) => entry.name),
    ['中文目录/说明.txt', 'dir/data.bin']
  );
  assert.equal(entries[0].data.equals(storedData), true);
  assert.equal(entries[1].data.equals(deflateData), true);
});

test('reads an archive with zero entries', () => {
  const entries = readZipEntries(buildZip([]));
  assert.deepEqual(entries, []);
});

test('rejects encrypted entries', () => {
  const zip = buildZip([{ name: 'secret.txt', data: Buffer.from('x'), method: 0, flags: 0x0001 }]);
  assert.throws(() => readZipEntries(zip), /Unsupported ZIP feature: encrypted/);
});

test('reads Zip64 entries whose sizes live in the 0x0001 extra field', () => {
  const data = Buffer.from('zip64 payload that is stored, not deflated');
  const zip = buildZip([{ name: 'zip64.bin', data, method: 0, zip64: true }]);
  const entries = readZipEntries(zip);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].data.equals(data), true);
});

test('rejects data that has no end of central directory record', () => {
  assert.throws(() => readZipEntries(Buffer.from('definitely not a zip archive')), /end of central directory/);
});

test('reads only the entries a selector asks for', () => {
  const buffer = buildZip([
    { name: 'Vendor.pdsc', data: Buffer.from('<package/>', 'utf8'), method: 0 },
    { name: 'Device.svd', data: Buffer.from('<device/>', 'utf8'), method: 0 }
  ]);

  assert.deepEqual(readZipEntries(buffer, (name) => name.endsWith('.pdsc')).map((entry) => entry.name), [
    'Vendor.pdsc'
  ]);
});

test('reports a truncated archive instead of a range error', () => {
  assert.throws(() => readZipEntries(Buffer.alloc(0)), /end of central directory record not found/);
  assert.throws(() => readZipEntries(Buffer.from('PK')), /end of central directory record not found/);
});

test('rejects a saturated Zip64 entry count when the Zip64 end record is missing', () => {
  const zip = buildZip([
    { name: 'Vendor.pdsc', data: Buffer.from('<package/>'), method: 0 }
  ]);
  // The classic EOCD saturates its entry counter at 0xffff for Zip64 archives;
  // without the Zip64 locator/EOCD there is nothing to resolve it from.
  const eocdOffset = zip.length - 22;
  zip.writeUInt16LE(0xffff, eocdOffset + 10);
  assert.throws(() => readZipEntries(zip), /Unsupported ZIP feature: Zip64 central directory/);
});

test('rejects an entry whose payload does not match its CRC', () => {
  const zip = buildZip([
    { name: 'Vendor.pdsc', data: Buffer.from('<package/>'), method: 0, crcOverride: 0x12345678 }
  ]);
  assert.throws(() => readZipEntries(zip), /CRC mismatch/);
});
