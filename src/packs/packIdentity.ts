/**
 * Pack identity helpers shared by the store, the installed-pack catalog and
 * the online catalog. Identity always comes from PDSC metadata; installation
 * folder and archive names are only a fallback for legacy records.
 */

/** Builds a registry-safe id from a raw CMSIS vendor name. */
export function packVendorId(vendorName: string): string {
  const cleaned = vendorName.replace(/[^A-Za-z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'Unknown';
}

/** PDSC Dvendor values carry a numeric suffix ('Sinomcu:985'); drop it for display. */
export function packVendorDisplayName(vendorName: string): string {
  return vendorName.replace(/:\d+$/, '') || vendorName;
}

/** Strips a trailing '.pack' and the trailing version from a pack file name. */
export function packNameFromFileName(fileName: string): { name: string; version?: string } {
  const base = fileName.split(/[/\\]/).pop()?.replace(/\.pack$/i, '') ?? fileName;
  const versionMatch = /^(.*)\.(\d+(?:\.\d+)*(?:[-_][A-Za-z0-9.-]+)?)$/.exec(base);
  return {
    name: versionMatch?.[1] ?? base,
    version: versionMatch?.[2]
  };
}
