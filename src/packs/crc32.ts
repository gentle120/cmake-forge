/**
 * CRC-32 (IEEE 802.3) used by ZIP entries.
 *
 * Kept in its own module so the archive reader and the test archive builders
 * agree on the polynomial instead of duplicating a table.
 */
const table = (() => {
  const values = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    values[index] = value >>> 0;
  }
  return values;
})();

export function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
