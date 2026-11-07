/**
 * Vendor option assembly for the sidebar: local vendors (registered profiles,
 * installed/imported packs with importable devices) come first, then the
 * keil.com index vendors so every chip family stays browsable and activatable
 * by download. PDSC-derived vendor ids are expected to carry no
 * registry-number suffix (see packIdentity), so packs like 'ARM' and 'ARM:82'
 * resolve to one id before reaching this module.
 */

export interface PackVendorCandidate {
  vendorId: string;
  vendorName: string;
  hasDevices: boolean;
}

export interface PackVendorOption {
  value: string;
  label: string;
  description?: string;
}

const ONLINE_DESCRIPTION = '在线索引厂商：激活其 Pack 版本时下载导入';

export function buildPackVendorOptions(input: {
  registered: Array<{ id: string; label: string }>;
  imported: PackVendorCandidate[];
  installed: PackVendorCandidate[];
  online: Array<{ vendorId: string; vendorName: string }>;
}): PackVendorOption[] {
  const vendors = new Map<string, { label: string; online: boolean }>();
  for (const vendor of input.registered) {
    if (!vendors.has(vendor.id)) {
      vendors.set(vendor.id, { label: vendor.label, online: false });
    }
  }
  for (const pack of [...input.imported, ...input.installed]) {
    if (pack.hasDevices && !vendors.has(pack.vendorId)) {
      vendors.set(pack.vendorId, { label: pack.vendorName, online: false });
    }
  }
  for (const vendor of input.online) {
    if (!vendors.has(vendor.vendorId)) {
      vendors.set(vendor.vendorId, { label: `${vendor.vendorName}（在线）`, online: true });
    }
  }
  return [...vendors].map(([value, vendor]) => ({
    value,
    label: vendor.label,
    ...(vendor.online ? { description: ONLINE_DESCRIPTION } : {})
  }));
}
