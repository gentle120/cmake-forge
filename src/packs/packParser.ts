import { XMLParser } from 'fast-xml-parser';
import type { AdditionalMemoryRegion, MemoryRegion } from '../devices/deviceProfiles';
import { readZipEntries } from './zipReader';

export interface PackDeviceCandidate {
  part: string;
  family: string;
  series: string;
  core: string;
  fpu: string;
  flash: MemoryRegion;
  ram: MemoryRegion;
  additionalMemory: AdditionalMemoryRegion[];
  defines: string[];
  interruptHandlers?: string[];
  error?: string;
}

export interface ParsedPack {
  vendorName: string;
  devices: PackDeviceCandidate[];
}

/** Package-level identity from the PDSC header, independent of device parsing. */
export interface PackIdentity {
  vendorName: string;
  name: string;
  version: string;
}

const CORE_BY_DCORE: Record<string, string> = {
  // Short form used by Keil-built packs.
  CM0: 'cortex-m0',
  CM0PLUS: 'cortex-m0plus',
  CM1: 'cortex-m1',
  SC000: 'sc000',
  CM3: 'cortex-m3',
  CM4: 'cortex-m4',
  CM7: 'cortex-m7',
  CM23: 'cortex-m23',
  CM33: 'cortex-m33',
  CM35P: 'cortex-m35p',
  CM55: 'cortex-m55',
  // Full names as written by vendor packs (Sinomcu, GigaDevice, ...).
  'cortex-m0': 'cortex-m0',
  'cortex-m0plus': 'cortex-m0plus',
  'cortex-m1': 'cortex-m1',
  'sc000': 'sc000',
  'cortex-m3': 'cortex-m3',
  'cortex-m4': 'cortex-m4',
  'cortex-m7': 'cortex-m7',
  'cortex-m23': 'cortex-m23',
  'cortex-m33': 'cortex-m33',
  'cortex-m35p': 'cortex-m35p',
  'cortex-m55': 'cortex-m55'
};

// Startup file vectors that belong to the 16 core slots rather than an IRQ.
const CORE_VECTOR_SYMBOLS: Record<string, true> = {
  NMI_Handler: true,
  HardFault_Handler: true,
  MemManage_Handler: true,
  BusFault_Handler: true,
  UsageFault_Handler: true,
  SVC_Handler: true,
  DebugMon_Handler: true,
  PendSV_Handler: true,
  SysTick_Handler: true,
  _estack: true,
  Reset_Handler: true
};

// External IRQ numbers hard-limit the synthesized vector table size.
const MAX_INTERRUPT_VALUE = 1024;

// Keil-style packs use IROM1/IRAM1, ST packs use FLASH; CMSISPack generic
// packs use ROM/RAM. All are recognized as flash/RAM candidates.
const FLASH_MEMORY_IDS: Record<string, true> = {
  ROM: true,
  ROM1: true,
  IROM: true,
  IROM1: true,
  FLASH: true
};
const RAM_MEMORY_IDS: Record<string, true> = {
  RAM: true,
  RAM1: true,
  IRAM: true,
  IRAM1: true,
  SRAM: true
};

type XmlNode = Record<string, unknown>;

interface ProcessorAttributes {
  dcore?: string;
  dfpu?: string;
}

const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

/** Extracts the inheritable processor attributes of a family/subFamily node. */
function processorAttributes(node: XmlNode): ProcessorAttributes {
  const processor = asNode(asNodeArray(node.processor)[0]);
  const attributes: ProcessorAttributes = {};
  const dcore = textOf(processor['@_Dcore']);
  const dfpu = textOf(processor['@_Dfpu']);
  // Only present attributes override the inherited ones; a subFamily
  // <processor Dclock> alone must not erase the family Dcore.
  if (dcore !== undefined) {
    attributes.dcore = dcore;
  }
  if (dfpu !== undefined) {
    attributes.dfpu = dfpu;
  }
  return attributes;
}

/**
 * Reads the package-level PDSC identity: release vendor, pack name and version.
 * An extracted Keil installation folder or archive name is not authoritative.
 */
export function parsePackIdentity(entries: Array<{ name: string; data: Buffer }>): PackIdentity {
  const pdscEntry = entries.find((entry) => entry.name.toLowerCase().endsWith('.pdsc'));
  if (!pdscEntry) {
    throw new Error('No .pdsc file found in pack');
  }
  const document = xmlParser.parse(pdscEntry.data.toString('utf8')) as XmlNode;
  const packageNode = asNode(document.package);
  const devicesNode = asNode(packageNode.devices);
  const firstFamily = asNode(asNodeArray(devicesNode.family)[0]);
  const vendorName =
    textOf(firstFamily['@_Dvendor']) ?? textOf(packageNode.vendor);
  if (!vendorName) {
    throw new Error('PDSC has no family vendor (Dvendor)');
  }
  const name = textOf(packageNode.name) ?? '';
  const release = asNode(packageNode.release);
  return {
    vendorName,
    name,
    version: textOf(release['@_version']) ?? ''
  };
}

/** Selects the entries the device parsers consume: PDSC, SVD and startup sources. */
export function isPackDeviceSourceEntry(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.endsWith('.pdsc')
    || lower.endsWith('.svd')
    || /(^|\/)startup[^/]*\.s$/.test(lower);
}

/**
 * Reports whether the pack contains at least one device the importer would
 * register: a resolvable ARM core, positive flash and RAM regions, and a
 * non-empty interrupt table. Only PDSC, SVD and startup entries are read, so
 * component packs answer false without loading the rest of the archive.
 * Unreadable PDSCs also answer false so callers can skip the pack.
 */
export function hasImportablePackDevice(entries: Array<{ name: string; data: Buffer }>): boolean {
  const pdscEntry = entries.find((entry) => entry.name.toLowerCase().endsWith('.pdsc'));
  if (!pdscEntry) {
    return false;
  }
  let document: XmlNode;
  try {
    document = xmlParser.parse(pdscEntry.data.toString('utf8')) as XmlNode;
  } catch {
    return false;
  }
  const families = asNodeArray(asNode(asNode(document.package).devices).family);
  for (const family of families) {
    const familyProcessor = processorAttributes(family);
    for (const device of asNodeArray(family.device)) {
      if (isImportableDevice(entries, device, familyProcessor)) {
        return true;
      }
    }
    for (const subFamily of asNodeArray(family.subFamily)) {
      const subFamilyProcessor = { ...familyProcessor, ...processorAttributes(subFamily) };
      for (const device of asNodeArray(subFamily.device)) {
        if (isImportableDevice(entries, device, subFamilyProcessor)) {
          return true;
        }
      }
    }
  }
  return false;
}

function isImportableDevice(
  entries: Array<{ name: string; data: Buffer }>,
  device: XmlNode,
  inheritedProcessor: ProcessorAttributes
): boolean {
  const part = textOf(device['@_Dname']);
  if (!part || !resolveDeviceCore(device, inheritedProcessor)) {
    return false;
  }
  const memory = collectMemoryRegions(device);
  if (memory.flash.length <= 0 || memory.ram.length <= 0) {
    return false;
  }
  return (resolveInterruptHandlers(entries, device, part)?.length ?? 0) > 0;
}

/** Parses a .pack (ZIP) archive. */
/**
 * Parses a .pack (ZIP) archive. Pass `select` (typically
 * `isPackDeviceSourceEntry`) so unrelated archive entries are never
 * decompressed — real DFPs ship hundreds of megabytes of SVD, PDF and source
 * files the parser never reads.
 */
export function parsePack(buffer: Buffer, select?: (name: string) => boolean): ParsedPack {
  return parsePackEntries(readZipEntries(buffer, select));
}

/** Parses already-collected pack entries: a .pack archive or an extracted pack directory. */
export function parsePackEntries(entries: Array<{ name: string; data: Buffer }>): ParsedPack {
  const pdscEntry = entries.find((entry) => entry.name.toLowerCase().endsWith('.pdsc'));
  if (!pdscEntry) {
    throw new Error('No .pdsc file found in pack');
  }

  const document = xmlParser.parse(pdscEntry.data.toString('utf8')) as XmlNode;
  const packageNode = asNode(document.package);
  const devicesNode = asNode(packageNode.devices);
  const families = asNodeArray(devicesNode.family);
  if (families.length === 0) {
    throw new Error('PDSC has no devices section');
  }

  const vendorName = textOf(families[0]['@_Dvendor']);
  if (!vendorName) {
    throw new Error('PDSC has no family vendor (Dvendor)');
  }

  const devices: PackDeviceCandidate[] = [];
  for (const family of families) {
    const familyName = textOf(family['@_Dfamily']) ?? textOf(family['@_Dname']) ?? '';
    const familyDefines = definesFromCompileNodes(family);
    // <processor Dcore> may sit on the family or subFamily instead of the
    // device (Sinomcu and other vendor packs do this); devices inherit it.
    const familyProcessor = processorAttributes(family);
    for (const device of asNodeArray(family.device)) {
      collectDeviceCandidates(entries, device, familyName, familyName, familyDefines, familyProcessor, devices);
    }
    for (const subFamily of asNodeArray(family.subFamily)) {
      const subFamilyName = textOf(subFamily['@_Dname']) ?? '';
      const subFamilyDefines = [...familyDefines, ...definesFromCompileNodes(subFamily)];
      const subFamilyProcessor = {
        ...familyProcessor,
        ...processorAttributes(subFamily)
      };
      for (const device of asNodeArray(subFamily.device)) {
        collectDeviceCandidates(entries, device, familyName, subFamilyName || familyName, subFamilyDefines, subFamilyProcessor, devices);
      }
    }
  }
  return { vendorName, devices };
}

/**
 * Resolves the supported core of a device node. Priority: the Dcore
 * attribute, then a device-level <processor> child (Cortex_DFP-style packs),
 * then the inherited family/subFamily processor. Full-name values such as
 * 'Cortex-M0+' are normalized to the supported core table; '' means the core
 * is unsupported or undeclared.
 */
function resolveDeviceCore(device: XmlNode, inherited: ProcessorAttributes): string {
  const dcore = textOf(device['@_Dcore'])
    ?? processorAttributes(device).dcore
    ?? inherited.dcore
    ?? '';
  if (!dcore) {
    return '';
  }
  return CORE_BY_DCORE[dcore.toUpperCase()]
    ?? CORE_BY_DCORE[dcore.toLowerCase().replace(/\+/g, 'plus')]
    ?? '';
}

function collectDeviceCandidates(
  entries: Array<{ name: string; data: Buffer }>,
  device: XmlNode,
  familyName: string,
  seriesName: string,
  inheritedDefines: string[],
  inheritedProcessor: ProcessorAttributes,
  out: PackDeviceCandidate[]
): void {
  const baseName = textOf(device['@_Dname']) ?? '';
  const variantNames = (textOf(device['@_DnameVariant']) ?? '')
    .split(',')
    .map((variant) => variant.trim())
    .filter((variant) => variant.length > 0);

  const core = resolveDeviceCore(device, inheritedProcessor);
  const dfpu = (
    textOf(device['@_Dfpu'])
    ?? processorAttributes(device).dfpu
    ?? inheritedProcessor.dfpu
    ?? ''
  ).toUpperCase();
  const fpu = dfpu.length === 0 || dfpu === 'NO_FPU' ? '' : textOf(device['@_Dfpu']) ?? dfpu;

  const names = [baseName, ...variantNames].filter((name) => name.length > 0);
  const partNames = names.length > 0 ? names : [''];
  if (!core) {
    for (const part of partNames) {
      out.push({
        part,
        family: familyName,
        series: seriesName,
        core: '',
        fpu: '',
        flash: { origin: 0, length: 0 },
        ram: { origin: 0, length: 0 },
        additionalMemory: [],
        defines: [],
        error: 'unsupported Dcore'
      });
    }
    return;
  }

  const memory = collectMemoryRegions(device);
  const defines = dedupePreservingOrder([...inheritedDefines, ...definesFromCompileNodes(device)]);
  const interruptHandlers = resolveInterruptHandlers(entries, device, baseName);

  for (const part of names) {
    out.push({
      part,
      family: familyName,
      series: seriesName,
      core,
      fpu,
      flash: memory.flash,
      ram: memory.ram,
      additionalMemory: memory.additional,
      defines,
      interruptHandlers,
      error: interruptHandlers ? undefined : 'no interrupt source'
    });
  }
}

function collectMemoryRegions(device: XmlNode): {
  flash: MemoryRegion;
  ram: MemoryRegion;
  additional: AdditionalMemoryRegion[];
} {
  let flash: MemoryRegion = { origin: 0, length: 0 };
  let hasFlash = false;
  const ramCandidates: Array<MemoryRegion & { access: AdditionalMemoryRegion['attributes'] }> = [];
  const additional: AdditionalMemoryRegion[] = [];

  for (const memoryNode of asNodeArray(device.memory)) {
    const id = textOf(memoryNode['@_id']) ?? `MEM${additional.length + 1}`;
    const origin = numberValue(memoryNode['@_start']);
    const length = numberValue(memoryNode['@_size']);
    if (origin === undefined || length === undefined || length <= 0) {
      continue;
    }
    // CMSIS access codes map onto linker segment flags; unknown values stay
    // read-write so a malformed attribute never widens permissions.
    const access = (textOf(memoryNode['@_access']) ?? '').toLowerCase();
    const attributes: AdditionalMemoryRegion['attributes'] =
      access === 'rx' || access === 'rwx' ? access : 'rw';
    const upperId = id.toUpperCase();
    if (FLASH_MEMORY_IDS[upperId]) {
      // The first ROM-class region is the boot flash; later banks become extra.
      if (!hasFlash) {
        flash = { origin, length };
        hasFlash = true;
      } else {
        additional.push({ name: id, attributes, origin, length });
      }
    } else if (RAM_MEMORY_IDS[upperId]) {
      ramCandidates.push({ origin, length, access: attributes });
    } else {
      additional.push({ name: id, attributes, origin, length });
    }
  }

  let ramIndex = -1;
  for (let index = 0; index < ramCandidates.length; index += 1) {
    if (ramIndex === -1 || ramCandidates[index].length > ramCandidates[ramIndex].length) {
      ramIndex = index;
    }
  }
  const ram: MemoryRegion = ramIndex === -1
    ? { origin: 0, length: 0 }
    : { origin: ramCandidates[ramIndex].origin, length: ramCandidates[ramIndex].length };
  for (const [index, candidate] of ramCandidates.entries()) {
    if (index !== ramIndex) {
      additional.push({ name: 'RAM_EXTRA', attributes: candidate.access, origin: candidate.origin, length: candidate.length });
    }
  }
  return { flash, ram, additional };
}

function resolveInterruptHandlers(
  entries: Array<{ name: string; data: Buffer }>,
  device: XmlNode,
  part: string
): string[] | undefined {
  const svdCandidates = collectSvdCandidates(entries, device);
  for (const svdEntry of svdCandidates) {
    const handlers = interruptsFromSvd(svdEntry.data.toString('utf8'));
    if (handlers.length > 0) {
      return handlers;
    }
  }
  for (const startupEntry of collectStartupCandidates(entries, part)) {
    const handlers = interruptsFromStartupFile(startupEntry.data.toString('utf8'));
    if (handlers.length > 0) {
      return handlers;
    }
  }
  return undefined;
}

function collectSvdCandidates(
  entries: Array<{ name: string; data: Buffer }>,
  device: XmlNode
): Array<{ name: string; data: Buffer }> {
  const svdAttribute = textOf(asNodeArray(device.debug)[0]?.['@_svd']);
  const svdEntries = entries.filter((entry) => entry.name.toLowerCase().endsWith('.svd'));
  if (!svdAttribute) {
    return svdEntries;
  }
  const normalized = svdAttribute.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  const exact = svdEntries.find((entry) => entry.name.replace(/\\/g, '/').toLowerCase() === normalized);
  if (exact) {
    return [exact, ...svdEntries.filter((entry) => entry !== exact)];
  }
  const baseName = normalized.split('/').pop() ?? normalized;
  const fuzzy = svdEntries.filter((entry) => {
    const entryName = entry.name.replace(/\\/g, '/').toLowerCase();
    return entryName === baseName || entryName.endsWith(`/${baseName}`);
  });
  return fuzzy.length > 0 ? [...fuzzy, ...svdEntries.filter((entry) => !fuzzy.includes(entry))] : svdEntries;
}

function interruptsFromSvd(svd: string): string[] {
  const document = xmlParser.parse(svd) as XmlNode;
  const device = asNode(document.device);
  const peripherals = asNodeArray(asNode(device.peripherals).peripheral);
  const namesByValue = new Map<number, string>();
  for (const peripheral of peripherals) {
    for (const interrupt of asNodeArray(peripheral.interrupt)) {
      const name = textOf(interrupt.name) ?? textOf(interrupt['@_name']);
      const value = numberValue(interrupt.value ?? interrupt['@_value']);
      if (!name || value === undefined || value < 0 || value > MAX_INTERRUPT_VALUE) {
        continue;
      }
      // First declaration wins on duplicate IRQ numbers.
      if (!namesByValue.has(value)) {
        namesByValue.set(value, name);
      }
    }
  }
  return handlersFromNameMap(namesByValue);
}

function handlersFromNameMap(namesByValue: Map<number, string>): string[] {
  if (namesByValue.size === 0) {
    return [];
  }
  const maxValue = Math.max(...namesByValue.keys());
  const handlers: string[] = [];
  for (let value = 0; value <= maxValue; value += 1) {
    const name = namesByValue.get(value);
    handlers.push(name ? `${name}_IRQHandler` : '0');
  }
  return handlers;
}

function collectStartupCandidates(
  entries: Array<{ name: string; data: Buffer }>,
  part: string
): Array<{ name: string; data: Buffer }> {
  const startupEntries = entries.filter((entry) => /(^|\/)startup[^/]*\.s$/i.test(entry.name));
  return startupEntries.sort((left, right) => {
    const leftMatch = part.length > 0 && left.name.toLowerCase().includes(part.toLowerCase()) ? 0 : 1;
    const rightMatch = part.length > 0 && right.name.toLowerCase().includes(part.toLowerCase()) ? 0 : 1;
    return leftMatch - rightMatch || left.name.length - right.name.length;
  });
}

function interruptsFromStartupFile(startup: string): string[] {
  const lines = startup.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => /^\s*(g_pfnVectors|__Vectors):/.test(line));
  if (startIndex < 0) {
    return [];
  }
  const handlers: string[] = [];
  for (let index = startIndex + 1; index < lines.length; index += 1) {
    if (/^\s*\.size\b/.test(lines[index])) {
      break;
    }
    const vectorMatch = /^\s*(?:DCD|\.word|\.long)\s+(.*)$/i.exec(lines[index]);
    if (!vectorMatch) {
      continue;
    }
    for (const operand of vectorMatch[1].split(/;/)[0].split(',')) {
      const symbol = operand.trim();
      if (isIrqHandlerSymbol(symbol)) {
        handlers.push(symbol);
      }
    }
  }
  return handlers;
}

function isIrqHandlerSymbol(symbol: string): boolean {
  if (symbol.length === 0 || /^[0-9]+$/.test(symbol) || /^0[xX][0-9a-fA-F]+$/.test(symbol)) {
    return false;
  }
  return !CORE_VECTOR_SYMBOLS[symbol];
}

function definesFromCompileNodes(node: XmlNode): string[] {
  const defines: string[] = [];
  for (const compile of asNodeArray(node.compile)) {
    const define = textOf(compile['@_define']);
    if (define) {
      defines.push(...define.split(/\s+/).filter((entry) => entry.length > 0));
    }
  }
  return defines;
}

function dedupePreservingOrder(values: string[]): string[] {
  return [...new Set(values)];
}

function asNode(value: unknown): XmlNode {
  return (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as XmlNode;
}

/** Normalizes fast-xml-parser output where a single child is an object but repeats become arrays. */
function asNodeArray(value: unknown): XmlNode[] {
  if (value === undefined || value === null) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).filter(
    (entry): entry is XmlNode => entry !== null && typeof entry === 'object'
  );
}

function textOf(value: unknown): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  if (typeof value === 'number' || typeof value === 'bigint') {
    return String(value);
  }
  return undefined;
}

/** Accepts XML numbers already coerced by the parser and decimal/hex strings. */
function numberValue(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) ? value : undefined;
  }
  if (typeof value === 'string') {
    const parsed = parseInt(value, 0);
    return Number.isInteger(parsed) ? parsed : undefined;
  }
  return undefined;
}
