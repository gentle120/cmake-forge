/**
 * Host tool discovery for flash and debug backends.
 *
 * The scanner is pure Node: every file-system access goes through an injected
 * reader so the whole search is testable and loadable without the VS Code API.
 * Only installation-layout probing is performed; no external process runs and
 * no versions are read.
 *
 * Search areas (win32 first, POSIX best effort):
 *   1. Keil MDK installation directories (kind 'keil')
 *   2. STM32CubeCLT roots (openocd, ST-LINK gdb server, CubeProgrammer)
 *   3. SEGGER J-Link installations
 *   4. PATH entries (openocd, J-Link, pyocd)
 */

export type ToolchainKind =
  | 'openocd'
  | 'jlink'
  | 'pyocd'
  | 'stlink-gdbserver'
  | 'stm32cubeprogrammer'
  | 'keil';

export interface ToolchainHit {
  kind: ToolchainKind;
  label: string;
  path: string;
}

export interface ScanRoots {
  keilDirs: string[];
  packRoots: string[];
  /** Parent directories that contain STM32CubeCLT_* version directories. */
  cltRoots: string[];
  /** Parent directories that contain JLink* version directories. */
  seggerRoots: string[];
  pathDirs: string[];
}

export interface ScanFileSystem {
  exists(path: string): boolean;
  readDir(path: string): string[];
}

export interface KeilPackEntry {
  /** Absolute reference: the .pack file path or the extracted pack directory root. */
  packFile: string;
  vendor: string;
  name: string;
  version: string;
  /** 'file' = .pack archive; 'directory' = extracted pack directory. */
  source: 'file' | 'directory';
}

const cubeCltprefix = 'STM32CubeCLT_';
const jlinkPrefix = 'JLink';

/** Candidate executables are probed bare first, then with the Windows extension. */
function probeExecutable(fs: ScanFileSystem, pathWithoutExtension: string): string | undefined {
  if (fs.exists(pathWithoutExtension)) {
    return pathWithoutExtension;
  }
  const withExtension = `${pathWithoutExtension}.exe`;
  return fs.exists(withExtension) ? withExtension : undefined;
}

function joinPath(base: string, name: string): string {
  const trimmed = base.endsWith('/') || base.endsWith('\\') ? base.slice(0, -1) : base;
  return `${trimmed}/${name}`;
}

function safeReadDir(fs: ScanFileSystem, path: string): string[] {
  try {
    return fs.readDir(path);
  } catch {
    return [];
  }
}

/**
 * Resolves a version directory under a parent: the parent itself when it
 * already is a version directory, otherwise the lexicographically largest
 * matching child (newest CubeCLT / J-Link installation).
 */
function resolveVersionedRoot(
  fs: ScanFileSystem,
  root: string,
  prefix: string
): string | undefined {
  if ((root.split(/[\\/]/).pop() ?? '').startsWith(prefix)) {
    return root;
  }
  const matches = safeReadDir(fs, root)
    .filter((entry) => entry.startsWith(prefix))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const latest = matches[matches.length - 1];
  return latest === undefined ? undefined : joinPath(root, latest);
}

interface CubeClTTool {
  kind: ToolchainKind;
  label: string;
  subDirectory: string;
  executable: string;
}

const cubeClTTools: CubeClTTool[] = [
  {
    kind: 'openocd',
    label: 'OpenOCD (STM32CubeCLT)',
    subDirectory: 'OpenOCD/bin',
    executable: 'openocd'
  },
  {
    kind: 'stlink-gdbserver',
    label: 'ST-LINK GDB Server (STM32CubeCLT)',
    subDirectory: 'STLink-gdb-server/bin',
    executable: 'ST-LINK_gdbserver'
  },
  {
    kind: 'stm32cubeprogrammer',
    label: 'STM32CubeProgrammer (STM32CubeCLT)',
    subDirectory: 'STM32CubeProgrammer/bin',
    executable: 'STM32_Programmer_CLI'
  }
];

function collectCubeClTHits(fs: ScanFileSystem, roots: ScanRoots, hits: ToolchainHit[]): void {
  for (const cltRoot of roots.cltRoots) {
    const installation = resolveVersionedRoot(fs, cltRoot, cubeCltprefix);
    if (!installation) {
      continue;
    }
    for (const tool of cubeClTTools) {
      const binDirectory = joinPath(installation, tool.subDirectory);
      const executable = probeExecutable(fs, joinPath(binDirectory, tool.executable));
      if (executable) {
        hits.push({
          kind: tool.kind,
          label: tool.label,
          path: executable
        });
      }
    }
  }
}

function collectSeggerHits(fs: ScanFileSystem, roots: ScanRoots, hits: ToolchainHit[]): void {
  for (const seggerRoot of roots.seggerRoots) {
    const installation = resolveVersionedRoot(fs, seggerRoot, jlinkPrefix);
    if (!installation) {
      continue;
    }
    for (const name of ['JLink', 'JLinkExe']) {
      const executable = probeExecutable(fs, joinPath(installation, name));
      if (executable) {
        hits.push({ kind: 'jlink', label: 'SEGGER J-Link', path: executable });
        break;
      }
    }
  }
}

interface PathTool {
  kind: ToolchainKind;
  label: string;
  names: string[];
}

const pathTools: PathTool[] = [
  { kind: 'openocd', label: 'OpenOCD (PATH)', names: ['openocd'] },
  { kind: 'jlink', label: 'SEGGER J-Link (PATH)', names: ['JLink', 'JLinkExe'] },
  { kind: 'pyocd', label: 'pyOCD (PATH)', names: ['pyocd'] }
];

function collectPathHits(fs: ScanFileSystem, roots: ScanRoots, hits: ToolchainHit[]): void {
  for (const directory of roots.pathDirs) {
    for (const tool of pathTools) {
      for (const name of tool.names) {
        const executable = probeExecutable(fs, joinPath(directory, name));
        if (executable) {
          hits.push({
            kind: tool.kind,
            label: tool.label,
            path: executable
          });
          break;
        }
      }
    }
  }
}

/**
 * Runs the environment scan. Results keep the search-area order (Keil,
 * STM32CubeCLT, SEGGER, PATH) and duplicate paths are reported once.
 */
export function scanToolchains(roots: ScanRoots, fs: ScanFileSystem): ToolchainHit[] {
  const hits: ToolchainHit[] = [];
  for (const keilDir of roots.keilDirs) {
    if (fs.exists(keilDir)) {
      hits.push({ kind: 'keil', label: 'Keil MDK', path: keilDir });
    }
  }
  collectCubeClTHits(fs, roots, hits);
  collectSeggerHits(fs, roots, hits);
  collectPathHits(fs, roots, hits);
  const seen = new Set<string>();
  return hits.filter((hit) => {
    if (seen.has(hit.path)) {
      return false;
    }
    seen.add(hit.path);
    return true;
  });
}

/**
 * Lists the packs of a CMSIS-Pack root with the Keil layout
 * `<packRoot>/<vendor>/<name>/<version>/<vendor>.<name>.<version>.pack`.
 * The same version directory with an extracted .pdsc (Keil installs packs
 * unpacked) is listed once as 'directory', preferring the extracted layout.
 */
export function listKeilPacks(packRoots: string[], fs: ScanFileSystem): KeilPackEntry[] {
  const entries: KeilPackEntry[] = [];
  const seenVersionDirectories = new Set<string>();
  for (const packRoot of packRoots) {
    if (!fs.exists(packRoot)) {
      continue;
    }
    for (const vendor of safeReadDir(fs, packRoot)) {
      // A real Pack root also holds CMSIS caches such as ".Web" (thousands of
      // flat .pdsc files), ".Download" and ".Local", plus "pack.idx". Vendor
      // directories never start with a dot, and probing those caches cost a
      // failed readdir per file (~3400 per scan on a stock install).
      if (vendor.startsWith('.')) {
        continue;
      }
      const vendorDirectory = joinPath(packRoot, vendor);
      for (const name of safeReadDir(fs, vendorDirectory)) {
        const nameDirectory = joinPath(vendorDirectory, name);
        for (const version of safeReadDir(fs, nameDirectory)) {
          const versionDirectory = joinPath(nameDirectory, version);
          const pdscFiles = safeReadDir(fs, versionDirectory)
            .filter((file) => file.toLowerCase().endsWith('.pdsc'));
          if (pdscFiles.length > 0) {
            // Extracted pack: version directory root with the .pdsc inside.
            seenVersionDirectories.add(versionDirectory);
            entries.push({ packFile: versionDirectory, vendor, name, version, source: 'directory' });
            continue;
          }
          const packFile = `${vendor}.${name}.${version}.pack`;
          if (fs.exists(joinPath(versionDirectory, packFile))) {
            entries.push({ packFile: joinPath(versionDirectory, packFile), vendor, name, version, source: 'file' });
          }
        }
      }
    }
  }
  return entries.filter((entry) =>
    entry.source === 'directory' || !seenVersionDirectories.has(entry.packFile)
  ).sort(
    (a, b) =>
      a.vendor.localeCompare(b.vendor) ||
      a.name.localeCompare(b.name) ||
      a.version.localeCompare(b.version)
  );
}

/** Installation roots for the current machine, derived only from platform and environment. */
export function defaultScanRoots(
  platform: NodeJS.Platform,
  env: Record<string, string | undefined>,
  homeDir: string,
  driveRoots: string[] = []
): ScanRoots {
  const isWindows = platform === 'win32';
  // Drive roots may arrive as 'C:' or 'C:\\'; normalize so joins produce clean paths.
  const normalize = (value: string): string => {
    let path = value.replace(/\\/g, '/');
    if (path.length === 2 && path[1] === ':') {
      path += '/';
    }
    return path.endsWith('/') ? path.slice(0, -1) : path;
  };
  const pathValue = env.PATH ?? env.Path ?? '';
  const pathDirs = pathValue
    .split(isWindows ? ';' : ':')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

  const keilDirs = isWindows ? ['C:/Keil_v5', 'C:/Keil'] : [`${homeDir}/keil`, '/Applications/Keil'];
  if (isWindows && env.KEIL_PATH) {
    keilDirs.push(env.KEIL_PATH);
  }

  const packRoots: string[] = [];
  if (env.CMSIS_PACK_ROOT) {
    packRoots.push(normalize(env.CMSIS_PACK_ROOT));
  }
  if (env.LOCALAPPDATA) {
    packRoots.push(`${normalize(env.LOCALAPPDATA)}/Arm/Packs`);
  }
  for (const keilDir of keilDirs) {
    packRoots.push(`${keilDir}/ARM/PACK`);
  }

  const drives = [...new Set([
    normalize(env.SystemDrive ?? 'C:'), ...driveRoots.map(normalize)
  ])];
  const programFiles = normalize(env.ProgramFiles ?? 'C:/Program Files');
  const programFilesX86 = normalize(env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)');

  return {
    keilDirs,
    packRoots,
    cltRoots: isWindows ? drives.flatMap(drive => [`${drive}/ST`, `${drive}/`]) : ['/opt/st'],
    // J-Link installs under Program Files (or its x86 redirect); honouring the
    // environment keeps a relocated Windows install discoverable.
    seggerRoots: isWindows
      ? [...new Set([`${programFiles}/SEGGER`, `${programFilesX86}/SEGGER`])]
      : ['/opt/SEGGER'],
    pathDirs
  };
}
