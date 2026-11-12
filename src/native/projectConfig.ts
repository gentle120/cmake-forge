/**
 * Reads back the .native-cmake.json written by a previous generation.
 *
 * The source list, include directories and definitions are re-derived from the
 * workspace scan on every run. The output kind and language standards cannot be
 * recovered from a scan, so they are reused as the defaults offered by the
 * command palette instead of silently falling back to the first entry.
 */

import { readFile } from 'node:fs/promises';
import type { NativeTargetType } from './types';

export interface SavedNativeProject {
  targetType?: NativeTargetType;
  cStandard?: number;
  cxxStandard?: number;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function isTargetType(value: unknown): value is NativeTargetType {
  return value === 'executable' || value === 'static' || value === 'shared';
}

function standardOf(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}

export async function readNativeProjectConfig(filePath: string): Promise<SavedNativeProject | undefined> {
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
  const structure = asRecord(record.structure);
  return {
    targetType: isTargetType(record.targetType) ? record.targetType : undefined,
    cStandard: standardOf(structure?.cStandard),
    cxxStandard: standardOf(structure?.cxxStandard)
  };
}
