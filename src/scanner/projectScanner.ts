import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { listVendorMetadata, vendorRegistryVersion } from '../devices/vendorRegistry';

export interface ProjectDescription {
  sources: string[];
  includeDirs: string[];
  defines: string[];
}

export interface ScanOptions {
  /** Aborts the scan as soon as it is signalled. */
  signal?: AbortSignal;
  /** Called for every visited directory, for progress reporting. */
  onDirectory?: (directory: string) => void;
}

/** Thrown when a scan is aborted through ScanOptions.signal. */
export class ScanCancelledError extends Error {
  constructor() {
    super('The workspace scan was cancelled.');
    this.name = 'ScanCancelledError';
  }
}

const ignoredDirectories = new Set([
  '.git',
  '.vscode',
  '.cmsis',
  '.eide',
  '.pack',
  '.cache',
  'build',
  'CMakeFiles',
  'cmake-build-debug',
  'cmake-build-release',
  'cmake',
  '_cmake',
  'node_modules',
  'out',
  'objects',
  'listings'
]);

const sourceExtensions = new Set(['.c', '.cc', '.cpp', '.cxx', '.s']);
const headerExtensions = new Set(['.h', '.hh', '.hpp', '.hxx']);
const protectedDefines = new Set(['USE_HAL_DRIVER']);

function toProjectPath(root: string, filePath: string): string {
  return relative(root, filePath).split(sep).join('/');
}

let definePattern: RegExp | null = null;
let definePatternVersion = -1;

function relevantDefinePattern(): RegExp {
  if (definePattern === null || definePatternVersion !== vendorRegistryVersion()) {
    const prefixes = [...new Set([
      ...listVendorMetadata().flatMap((metadata) => metadata.definePrefixes),
      'USE_HAL_DRIVER'
    ])].sort((left, right) => right.length - left.length);
    definePattern = new RegExp(`^(${prefixes.join('|')})`);
    definePatternVersion = vendorRegistryVersion();
  }
  return definePattern;
}

function isRelevantDefine(name: string, includeGuard?: string): boolean {
  return name !== includeGuard
    && !name.endsWith('_H')
    && relevantDefinePattern().test(name);
}

function findIncludeGuard(content: string): string | undefined {
  const match = content.match(
    /^\s*#\s*ifndef\s+([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?:\/\/[^\r\n]*)?\r?\n\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)[ \t]*(?:\/\/[^\r\n]*)?/m
  );
  if (!match || match[1] !== match[2] || protectedDefines.has(match[1])) {
    return undefined;
  }
  return match[1];
}

interface DirentEntry {
  name: string;
  isDirectory(): boolean;
  isFile(): boolean;
}

function throwIfScanCancelled(options: ScanOptions): void {
  if (options.signal?.aborted) {
    throw new ScanCancelledError();
  }
}

async function readDirectoryEntries(
  directory: string,
  options: ScanOptions
): Promise<DirentEntry[]> {
  throwIfScanCancelled(options);
  const entries = await readdir(directory, { withFileTypes: true });
  throwIfScanCancelled(options);
  return (entries as DirentEntry[])
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function walk(
  root: string,
  directory: string,
  sources: string[],
  includeDirs: Set<string>,
  defines: Set<string>,
  options: ScanOptions
): Promise<void> {
  throwIfScanCancelled(options);
  options.onDirectory?.(directory);
  throwIfScanCancelled(options);
  const entries = await readDirectoryEntries(directory, options);

  for (const entry of entries) {
    throwIfScanCancelled(options);
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith('cmake-build-')) {
        await walk(root, join(directory, entry.name), sources, includeDirs, defines, options);
      }
      continue;
    }

    const filePath = join(directory, entry.name);
    const extension = entry.name.slice(entry.name.lastIndexOf('.')).toLowerCase();
    if (sourceExtensions.has(extension)) {
      sources.push(toProjectPath(root, filePath));
    }
    if (!headerExtensions.has(extension) && !sourceExtensions.has(extension)) {
      continue;
    }

    let content: string;
    try {
      content = await readFile(filePath, { encoding: 'utf8', signal: options.signal });
    } catch (error) {
      if (options.signal?.aborted) {
        throw new ScanCancelledError();
      }
      throw error;
    }
    const includeGuard = headerExtensions.has(extension) ? findIncludeGuard(content) : undefined;
    const definePattern = /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)\b/gm;
    for (const match of content.matchAll(definePattern)) {
      const name = match[1];
      if (isRelevantDefine(name, includeGuard)) {
        defines.add(name);
      }
    }
    if (headerExtensions.has(extension)) {
      includeDirs.add(toProjectPath(root, directory));
    }
  }
}

export async function scanProject(root: string, options: ScanOptions = {}): Promise<ProjectDescription> {
  const sources: string[] = [];
  const includeDirs = new Set<string>();
  const defines = new Set<string>();
  await walk(root, root, sources, includeDirs, defines, options);
  return {
    sources: sources.sort(),
    includeDirs: [...includeDirs].filter(Boolean).sort(),
    defines: [...defines].sort()
  };
}
