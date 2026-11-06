/**
 * Vendor option assembly for the sidebar: a vendor appears only when a pack
 * source can actually provide MCU devices. PDSC-derived vendor ids are
 * expected to carry no registry-number suffix (see packIdentity), so packs
 * like 'ARM' and 'ARM:82' resolve to one id before reaching this module.
 */

export interface PackVendorCandidate {
  vendorId: string;
  vendorName: string;
  hasDevices: boolean;
}

export interface PackVendorOption {
  value: string;
  label: string;
}

export function buildPackVendorOptions(input: {
  builtin: Array<{ id: string; label: string }>;
  imported: PackVendorCandidate[];
  installed: PackVendorCandidate[];
}): PackVendorOption[] {
  const vendors = new Map<string, string>();
  for (const vendor of input.builtin) {
    if (!vendors.has(vendor.id)) {
      vendors.set(vendor.id, vendor.label);
    }
  }
  for (const pack of [...input.imported, ...input.installed]) {
    if (pack.hasDevices && !vendors.has(pack.vendorId)) {
      vendors.set(pack.vendorId, pack.vendorName);
    }
  }
  return [...vendors].map(([value, label]) => ({ value, label }));
}
