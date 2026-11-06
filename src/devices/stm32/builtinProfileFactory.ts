import type {
  AdditionalMemoryRegion,
  DeviceProfile,
  MemoryRegion
} from '../deviceProfiles';
import { getStm32BuiltinDefinition } from './builtinDeviceData';

export interface BuiltinDeviceTemplate {
  vendor: string;
  series: string;
  family: string;
  core: string;
  toolchainPrefix: string;
  compilerFlags: string[];
  flash: MemoryRegion;
  ram: MemoryRegion;
  additionalMemory?: AdditionalMemoryRegion[];
  define: string;
  gnuStartupFileName: string;
  toolchainFileName: string;
  interruptHandlersKey: string;
  debugTarget?: string;
}

export interface BuiltinDeviceDifference {
  flashLength?: number;
  ramLength?: number;
  define?: string;
  additionalMemory?: AdditionalMemoryRegion[] | null;
  gnuStartupFileName?: string;
  interruptHandlersKey?: string;
}

export function createBuiltinDeviceProfile(
  part: string,
  template: BuiltinDeviceTemplate,
  difference: BuiltinDeviceDifference,
  interruptTables: Record<string, string[]>
): DeviceProfile {
  const interruptHandlersKey = difference.interruptHandlersKey ?? template.interruptHandlersKey;
  const interruptHandlers = interruptTables[interruptHandlersKey];
  if (!interruptHandlers) {
    throw new Error(`Invalid built-in MCU data for ${part}: unknown vector table ${interruptHandlersKey}`);
  }

  const additionalMemory = difference.additionalMemory === null
    ? undefined
    : difference.additionalMemory ?? template.additionalMemory;
  const additionalMemoryRegions = additionalMemory?.map(region => ({ ...region }));

  return {
    part,
    vendor: template.vendor,
    series: template.series,
    family: template.family,
    core: template.core,
    architecture: 'arm',
    toolchainPrefix: template.toolchainPrefix,
    defines: [difference.define ?? template.define],
    compilerFlags: [...template.compilerFlags],
    flash: {
      origin: template.flash.origin,
      length: difference.flashLength ?? template.flash.length
    },
    ram: {
      origin: template.ram.origin,
      length: difference.ramLength ?? template.ram.length
    },
    ...(additionalMemoryRegions === undefined
      ? {}
      : { additionalMemory: additionalMemoryRegions }),
    linkerFileName: `${part}.ld`,
    gnuStartupFileName: difference.gnuStartupFileName ?? template.gnuStartupFileName,
    toolchainFileName: template.toolchainFileName,
    interruptHandlers: [...interruptHandlers],
    debugTarget: template.debugTarget
  };
}

export function createStm32BuiltinProfile(
  part: string,
  series: string,
  interruptTables: Record<string, string[]>
): DeviceProfile {
  const definition = getStm32BuiltinDefinition(series, part);
  if (!definition) {
    throw new Error(`Invalid built-in MCU data for ${part}: unknown series ${series}`);
  }
  return createBuiltinDeviceProfile(
    part,
    definition.template,
    definition.difference,
    interruptTables
  );
}
