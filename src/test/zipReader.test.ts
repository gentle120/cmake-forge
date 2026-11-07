import assert from 'node:assert/strict';
import test from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { readZipEntries } from '../packs/zipReader';

interface FakeZipEntry {
  name: string;
  data: Buffer;
  method: 0 | 8;
  flags?: number;
  versionNeeded?: number;
  localHeaderOffsetOverride?: number;
}

function buildZip(entries: FakeZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const compressed = entry.method === 8 ? deflateRawSync(entry.data) : entry.data;
    const nameBuffer = Buffer.from(entry.name, 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.versionNeeded ?? 20, 4);
    local.writeUInt16LE(entry.flags ?? 0, 6);
    local.writeUInt16LE(entry.method, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    localChunks.push(local, nameBuffer, compressed);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.versionNeeded ?? 20, 6);
    central.writeUInt16LE(entry.flags ?? 0, 8);
    central.writeUInt16LE(entry.method, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(entry.localHeaderOffsetOverride ?? offset, 42);
    centralChunks.push(central, nameBuffer);

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

test('rejects Zip64 entries', () => {
  const zip45 = buildZip([{ name: 'big.bin', data: Buffer.from('x'), method: 0, versionNeeded: 45 }]);
  assert.throws(() => readZipEntries(zip45), /Unsupported ZIP feature: Zip64/);

  const zip64Offset = buildZip([
    { name: 'big.bin', data: Buffer.from('x'), method: 0, localHeaderOffsetOverride: 0xffffffff }
  ]);
  assert.throws(() => readZipEntries(zip64Offset), /Unsupported ZIP feature: Zip64/);
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
