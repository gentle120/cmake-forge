import { inflateRawSync } from 'node:zlib';

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const EOCD_MIN_LENGTH = 22;
// Fixed EOCD + the maximum 0xffff comment length.
const EOCD_MAX_SCAN = 22 + 0xffff;
const STORED_METHOD = 0;
const DEFLATE_METHOD = 8;
const ZIP64_VERSION_NEEDED = 45;

/**
 * Reads every central-directory entry of a classic 32-bit ZIP archive
 * (.pack/.zip are ZIP by convention). Entry data is taken from the local
 * header offset recorded in the central directory, so entries using a data
 * descriptor (bit 3) still resolve because sizes come from the central record.
 *
 * `select` limits decompression to the entries a caller needs; skipped entries
 * are not read into memory, which keeps large Pack archives cheap to inspect.
 */
export function readZipEntries(
  buffer: Buffer,
  select?: (name: string) => boolean
): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const directorySize = buffer.readUInt32LE(eocdOffset + 12);
  if (directoryOffset === 0xffffffff || directoryOffset + directorySize > buffer.length) {
    throw new Error('Unsupported ZIP feature: Zip64 central directory');
  }

  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error('Invalid ZIP archive: corrupt central directory');
    }
    const versionNeeded = buffer.readUInt16LE(cursor + 6);
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    if ((flags & 0x0001) !== 0) {
      throw new Error(`Unsupported ZIP feature: encrypted entry ${name}`);
    }
    if (versionNeeded >= ZIP64_VERSION_NEEDED || localHeaderOffset === 0xffffffff) {
      throw new Error(`Unsupported ZIP feature: Zip64 entry ${name}`);
    }
    const wanted = !select || select(name);
    if (wanted) {
      entries.push({
        name,
        data: readEntryData(buffer, name, localHeaderOffset, method, compressedSize)
      });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const lowest = Math.max(0, buffer.length - EOCD_MAX_SCAN);
  for (let offset = buffer.length - EOCD_MIN_LENGTH; offset >= lowest; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error('Invalid ZIP archive: end of central directory record not found');
}

function readEntryData(
  buffer: Buffer,
  name: string,
  localHeaderOffset: number,
  method: number,
  compressedSize: number
): Buffer {
  if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== LOCAL_HEADER_SIGNATURE) {
    throw new Error(`Invalid ZIP archive: local header signature mismatch for ${name}`);
  }
  const nameLength = buffer.readUInt16LE(localHeaderOffset + 26);
  const extraLength = buffer.readUInt16LE(localHeaderOffset + 28);
  const dataStart = localHeaderOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + compressedSize;
  if (dataEnd > buffer.length) {
    throw new Error(`Invalid ZIP archive: truncated entry data for ${name}`);
  }
  const raw = buffer.subarray(dataStart, dataEnd);
  if (method === STORED_METHOD) {
    return raw;
  }
  if (method === DEFLATE_METHOD) {
    try {
      return inflateRawSync(raw);
    } catch {
      throw new Error(`Invalid ZIP archive: failed to inflate entry ${name}`);
    }
  }
  throw new Error(`Unsupported ZIP feature: compression method ${method} in entry ${name}`);
}
