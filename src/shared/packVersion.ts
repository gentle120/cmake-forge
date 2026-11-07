/**
 * CMSIS Pack version ordering shared by the device catalog and the online index.
 *
 * Versions are dotted numeric strings, but packs also publish suffixes such as
 * `1.0.0-rc1` or `2.1.0_1`, so comparison splits on every separator and treats
 * each part as a number; a missing part counts as 0.
 */
export function comparePackVersions(left: string, right: string): number {
  const a = left.split(/[._-]/).map((part) => Number(part) || 0);
  const b = right.split(/[._-]/).map((part) => Number(part) || 0);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}
