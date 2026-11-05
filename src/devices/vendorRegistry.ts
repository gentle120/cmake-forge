export interface VendorMetadata {
  id: string;
  label: string;
  definePrefixes: string[];
  order: number;
}

/** Vendors registered by pack imports start after every built-in vendor. */
export const importedVendorBaseOrder = 100;

const vendors = new Map<string, VendorMetadata>();
let registryVersion = 0;

export function registerVendor(metadata: VendorMetadata): void {
  const id = metadata.id.trim();
  if (id.length === 0) {
    throw new Error('Vendor id is required');
  }
  if (vendors.has(id)) {
    throw new Error(`Duplicate vendor registration: ${id}`);
  }
  vendors.set(id, {
    ...metadata,
    id,
    definePrefixes: [...new Set(metadata.definePrefixes)]
  });
  registryVersion += 1;
}

export function hasVendor(id: string): boolean {
  return vendors.has(id.trim());
}

export function getVendorMetadata(id: string): VendorMetadata {
  const metadata = vendors.get(id.trim());
  if (!metadata) {
    throw new Error(`Unknown vendor: ${id}`);
  }
  return { ...metadata, definePrefixes: [...metadata.definePrefixes] };
}

export function listVendorMetadata(): VendorMetadata[] {
  return [...vendors.values()]
    .map((metadata) => ({ ...metadata, definePrefixes: [...metadata.definePrefixes] }))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
}

/** Bumped on every registration so cached derived data can detect changes. */
export function vendorRegistryVersion(): number {
  return registryVersion;
}

registerVendor({ id: 'STM', label: 'STM32', definePrefixes: ['STM32'], order: 0 });
registerVendor({ id: 'GD', label: 'GD32', definePrefixes: ['GD32'], order: 1 });
