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

/**
 * Splits a CMSIS pack file name into pack name and version. The version is the
 * trailing all-numeric dotted group (`Vendor.Name.1.2.3.pack`), so the name
 * keeps every earlier dot segment; matching must start from the shortest
 * candidate name, otherwise `1.2` would be read as the name's tail and `3` —
 * or in a four-part version the last number alone — as the version.
 */
export function packNameFromFileName(fileName: string): { name: string; version?: string } {
  const base = fileName.split(/[/\\]/).pop()?.replace(/\.pack$/i, '') ?? fileName;
  const versionMatch = /^(.*?)\.(\d+(?:\.\d+)*(?:[-_][A-Za-z0-9.-]+)?)$/.exec(base);
  return {
    name: versionMatch?.[1] ?? base,
    version: versionMatch?.[2]
  };
}
