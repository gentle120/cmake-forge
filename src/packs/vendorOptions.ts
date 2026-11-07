/**
 * Vendor option assembly for the sidebar: locally usable vendors (imported
 * profiles and installed packs with importable devices) come first, then the
 * curated mainstream chip vendors so the dropdown reads like a product menu.
 * PDSC-derived vendor ids are expected to carry no registry-number suffix
 * (see packIdentity), so packs like 'ARM' and 'ARM:82' resolve to one id
 * before reaching this module.
 */

export interface PackVendorCandidate {
  vendorId: string;
  vendorName: string;
  hasDevices: boolean;
}

export interface CuratedVendor {
  id: string;
  label: string;
}

export interface PackVendorOption {
  value: string;
  label: string;
  description?: string;
}

const NO_LOCAL_PACK_HINT =
  '本地暂无此厂商的 Pack：请用 Keil Pack Installer 安装器件包，或导入本地 .pack';

export function buildPackVendorOptions(input: {
  registered: Array<{ id: string; label: string }>;
  imported: PackVendorCandidate[];
  installed: PackVendorCandidate[];
  curated: CuratedVendor[];
}): PackVendorOption[] {
  const curatedById = new Map(input.curated.map((vendor) => [vendor.id, vendor.label]));
  const vendors = new Map<string, { label: string; local: boolean }>();
  const addLocal = (id: string, vendorName: string): void => {
    if (!vendors.has(id)) {
      vendors.set(id, { label: curatedById.get(id) ?? vendorName, local: true });
    }
  };
  for (const vendor of input.registered) {
    addLocal(vendor.id, vendor.label);
  }
  for (const pack of [...input.imported, ...input.installed]) {
    if (pack.hasDevices) {
      addLocal(pack.vendorId, pack.vendorName);
    }
  }
  for (const vendor of input.curated) {
    if (!vendors.has(vendor.id)) {
      vendors.set(vendor.id, { label: vendor.label, local: false });
    }
  }
  return [...vendors].map(([value, vendor]) => ({
    value,
    label: vendor.label,
    ...(vendor.local ? {} : { description: NO_LOCAL_PACK_HINT })
  }));
}
