/**
 * Reads back the .linux-cmake.json written by a previous generation.
 *
 * The structure is re-derived from the workspace scan on every run, so only the
 * things a scan cannot know are reused: the toolchain that was chosen, the
 * output kind (executable/library), and the preprocessor definitions, which the
 * scanner does not collect for Linux.
 */

import { readFile } from 'node:fs/promises';
import {
  isLinuxToolchainFamily,
  type LinuxTargetType,
  type LinuxToolchainFamily
} from './types';

export interface SavedLinuxProject {
  toolchainFamily?: LinuxToolchainFamily;
  defines: string[];
  /** Output kind of the previous generation; executable when absent. */
  targetType?: LinuxTargetType;
  /** Target root remembered from the previous generation. */
  sysroot?: string;
}

/** True for the three target kinds the generator can emit. */
export function isLinuxTargetType(value: unknown): value is LinuxTargetType {
  return value === 'executable' || value === 'static' || value === 'shared';
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export async function readLinuxProjectConfig(filePath: string): Promise<SavedLinuxProject | undefined> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return undefined;
  }

  const record = asRecord(parsed);
  if (!record) {
    return undefined;
  }

  const family = asRecord(record.toolchain)?.family;
  const structure = asRecord(record.structure);
  const defines = structure?.defines;

  return {
    toolchainFamily: typeof family === 'string' && isLinuxToolchainFamily(family) ? family : undefined,
    defines: Array.isArray(defines)
      ? defines.filter((define): define is string => typeof define === 'string' && define.trim().length > 0)
      : [],
    targetType: isLinuxTargetType(structure?.targetType) ? structure!.targetType as LinuxTargetType : undefined,
    ...(typeof structure?.sysroot === 'string' && structure.sysroot.trim()
      ? { sysroot: structure.sysroot.trim() }
      : {})
  };
}
