import { inflateRawSync } from 'node:zlib';
import { crc32 } from './crc32';

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
const ZIP64_EXTRA_ID = 0x0001;
// A Pack is data, not a decompression target: cap the work a malicious or
// corrupt archive can force the extension host to do.
const MAX_ENTRY_COUNT = 100_000;
const MAX_UNCOMPRESSED_ENTRY_BYTES = 512 * 1024 * 1024;
const ZIP64_EOCD_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;

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
  let entryCount = buffer.readUInt16LE(eocdOffset + 10);
  let directoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  let directorySize = buffer.readUInt32LE(eocdOffset + 12);
  if (entryCount === 0xffff || directoryOffset === 0xffffffff || directorySize === 0xffffffff) {
    // The classic record saturates its counters and defers to a Zip64 end
    // record; TI's MSPM0 DFP is built that way even though the archive is small.
    const zip64 = findZip64EndOfCentralDirectory(buffer, eocdOffset);
    if (!zip64) {
      throw new Error('Unsupported ZIP feature: Zip64 central directory');
    }
    entryCount = zip64.entryCount;
    directoryOffset = zip64.directoryOffset;
    directorySize = zip64.directorySize;
  }
  if (entryCount > MAX_ENTRY_COUNT) {
    throw new Error('Invalid ZIP archive: too many entries');
  }
  if (directoryOffset + directorySize > buffer.length) {
    throw new Error('Invalid ZIP archive: central directory out of range');
  }
  const entries: ZipEntry[] = [];
  let cursor = directoryOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== CENTRAL_HEADER_SIGNATURE) {
      throw new Error('Invalid ZIP archive: corrupt central directory');
    }
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const expectedCrc = buffer.readUInt32LE(cursor + 16);
    let uncompressedSize = buffer.readUInt32LE(cursor + 24);
    let compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    let localHeaderOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.toString('utf8', cursor + 46, cursor + 46 + nameLength);

    // Zip64 stores saturated 32-bit fields in a 0x0001 extra field: only the
    // saturated ones are present, in the order uncompressed, compressed, offset.
    if (compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff || uncompressedSize === 0xffffffff) {
      const extraStart = cursor + 46 + nameLength;
      const extra = buffer.subarray(extraStart, extraStart + extraLength);
      let position = 0;
      while (position + 4 <= extra.length) {
        const headerId = extra.readUInt16LE(position);
        const dataSize = extra.readUInt16LE(position + 2);
        const dataStart = position + 4;
        if (headerId === ZIP64_EXTRA_ID) {
          let offset = dataStart;
          const end = Math.min(extra.length, dataStart + dataSize);
          if (uncompressedSize === 0xffffffff && offset + 8 <= end) {
            uncompressedSize = Number(extra.readBigUInt64LE(offset));
            offset += 8;
          }
          if (compressedSize === 0xffffffff && offset + 8 <= end) {
            compressedSize = Number(extra.readBigUInt64LE(offset));
            offset += 8;
          }
          if (localHeaderOffset === 0xffffffff && offset + 8 <= end) {
            localHeaderOffset = Number(extra.readBigUInt64LE(offset));
          }
        }
        position = dataStart + dataSize;
      }
      if (compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff) {
        throw new Error(`Unsupported ZIP feature: incomplete Zip64 entry ${name}`);
      }
    }

    const wanted = !select || select(name);
    if (wanted) {
      // Validate only the entries a caller actually reads: a Pack archive may
      // contain encrypted or Zip64 payloads the import never touches, and they
      // must not make the whole archive unusable.
      if ((flags & 0x0001) !== 0) {
        throw new Error(`Unsupported ZIP feature: encrypted entry ${name}`);
      }
      entries.push({
        name,
        data: readEntryData(
          buffer,
          name,
          localHeaderOffset,
          method,
          compressedSize,
          uncompressedSize,
          expectedCrc
        )
      });
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

interface Zip64Directory {
  entryCount: number;
  directorySize: number;
  directoryOffset: number;
}

function findZip64EndOfCentralDirectory(buffer: Buffer, eocdOffset: number): Zip64Directory | undefined {
  const locatorOffset = eocdOffset - 20;
  if (locatorOffset < 0 || buffer.readUInt32LE(locatorOffset) !== ZIP64_LOCATOR_SIGNATURE) {
    return undefined;
  }
  const directoryOffset = Number(buffer.readBigUInt64LE(locatorOffset + 8));
  if (directoryOffset + 56 > buffer.length
    || buffer.readUInt32LE(directoryOffset) !== ZIP64_EOCD_SIGNATURE) {
    return undefined;
  }
  return {
    entryCount: Number(buffer.readBigUInt64LE(directoryOffset + 32)),
    directorySize: Number(buffer.readBigUInt64LE(directoryOffset + 40)),
    directoryOffset: Number(buffer.readBigUInt64LE(directoryOffset + 48))
  };
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  // readUInt32LE below would throw a RangeError on a negative offset, so a
  // truncated or empty file must be reported as an invalid archive instead.
  if (buffer.length < EOCD_MIN_LENGTH) {
    throw new Error('Invalid ZIP archive: end of central directory record not found');
  }
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
  compressedSize: number,
  uncompressedSize: number,
  expectedCrc: number
): Buffer {
  if (uncompressedSize > MAX_UNCOMPRESSED_ENTRY_BYTES) {
    throw new Error(`Invalid ZIP archive: entry ${name} is too large`);
  }
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
  const data = method === STORED_METHOD
    ? raw
    : method === DEFLATE_METHOD
      ? inflateEntry(raw, name)
      : unsupportedMethod(method, name);
  if (data.length !== uncompressedSize) {
    throw new Error(`Invalid ZIP archive: size mismatch for ${name}`);
  }
  // A payload that inflates but does not match its recorded CRC is corrupt;
  // parsing it as XML would fail later with a misleading error.
  if (crc32(data) !== expectedCrc) {
    throw new Error(`Invalid ZIP archive: CRC mismatch for ${name}`);
  }
  return data;
}

function inflateEntry(raw: Buffer, name: string): Buffer {
  try {
    // `maxOutputLength` stops a deflate bomb before it allocates the expansion;
    // the central directory's declared size is checked separately.
    return inflateRawSync(raw, { maxOutputLength: MAX_UNCOMPRESSED_ENTRY_BYTES });
  } catch {
    throw new Error(`Invalid ZIP archive: failed to inflate entry ${name}`);
  }
}

function unsupportedMethod(method: number, name: string): never {
  throw new Error(`Unsupported ZIP feature: compression method ${method} in entry ${name}`);
}
