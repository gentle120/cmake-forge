/**
 * Compiler toolchain discovery for the MCU and desktop directions.
 *
 * Toolchains are read from the environment (`PATH`) only: the generator writes
 * portable command names into the project, so a compiler that is not on `PATH`
 * would not be usable by the generated build anyway. No external process runs;
 * candidates are recognised by their executable names.
 *
 * MCU candidates are ARM bare-metal GCC installations (`arm-none-eabi-gcc`,
 * `arm-zephyr-eabi-gcc`, ...). Desktop candidates are the host compilers
 * (`gcc`, `clang`) and Windows MinGW prefixes (`x86_64-w64-mingw32-gcc`).
 */

import { readdirSync } from 'node:fs';

export type BuildToolchainDirection = 'mcu' | 'native';

export interface BuildToolchain {
  /** Stable selection id: `mcu:arm-none-eabi`, `native:gcc`. */
  id: string;
  direction: BuildToolchainDirection;
  /** Compiler prefix for MCU (`arm-none-eabi`); empty for a host compiler. */
  prefix: string;
  /** C compiler command name written into the generated project. */
  cCompiler: string;
  /** C++ compiler command name, when the installation ships one. */
  cxxCompiler?: string;
  /** Absolute `bin` directory the compiler was found in. */
  binDir: string;
  label: string;
  detail: string;
}

export interface DiscoveredBuildToolchains {
  mcu: BuildToolchain[];
  native: BuildToolchain[];
}

export interface BuildToolchainFileSystem {
  readDir(path: string): string[];
}

const defaultFileSystem: BuildToolchainFileSystem = {
  readDir: (path) => readdirSync(path)
};

const executableExtensions = ['.exe', ''];

function environmentPathEntries(
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform
): string[] {
  const value = environment.PATH ?? environment.Path ?? '';
  return value
    .split(platform === 'win32' ? ';' : ':')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

interface DirectoryListing {
  /** Executable base names without the `.exe` suffix. */
  names: Set<string>;
}

function listDirectory(fileSystem: BuildToolchainFileSystem, directory: string): DirectoryListing {
  let entries: string[] = [];
  try {
    entries = fileSystem.readDir(directory);
  } catch {
    return { names: new Set() };
  }
  const names = new Set<string>();
  for (const entry of entries) {
    const lowered = entry.toLowerCase();
    const extension = executableExtensions.find((candidate) => lowered.endsWith(candidate));
    if (extension === undefined) {
      continue;
    }
    names.add(extension === '' ? entry : entry.slice(0, -extension.length));
  }
  return { names };
}

/** `arm-none-eabi-` from `arm-none-eabi-gcc`; undefined for a host compiler. */
function mcuPrefix(basename: string): string | undefined {
  if (!basename.toLowerCase().endsWith('-gcc')) {
    return undefined;
  }
  const prefix = basename.slice(0, -'gcc'.length);
  // Only bare-metal ARM GCC installations: `arm-linux-gnueabihf-gcc` is a Linux
  // cross compiler and does not belong to the MCU direction.
  return /^arm[a-z0-9]*-.*eabi-$/i.test(prefix) ? prefix : undefined;
}

function nativeCompiler(basename: string): { cCompiler: string; cxxCompiler: string } | undefined {
  if (basename === 'gcc') {
    return { cCompiler: 'gcc', cxxCompiler: 'g++' };
  }
  if (basename === 'clang') {
    return { cCompiler: 'clang', cxxCompiler: 'clang++' };
  }
  const mingw = /^([a-z0-9_]+-w64-mingw32)-gcc$/i.exec(basename);
  return mingw
    ? { cCompiler: `${mingw[1]}-gcc`, cxxCompiler: `${mingw[1]}-g++` }
    : undefined;
}

function mcuLabel(prefix: string): string {
  const trimmed = prefix.endsWith('-') ? prefix.slice(0, -1) : prefix;
  if (trimmed === 'arm-none-eabi') {
    return 'Arm GNU Toolchain (arm-none-eabi)';
  }
  const vendor = /^arm-(.+?)-eabi$/.exec(trimmed);
  return vendor ? `ARM EABI (${vendor[1]})` : trimmed;
}

function nativeLabel(cCompiler: string): string {
  if (cCompiler === 'gcc') {
    return '本机 GCC';
  }
  if (cCompiler === 'clang') {
    return '本机 Clang';
  }
  return cCompiler;
}

/**
 * Finds every usable compiler toolchain on `PATH`.
 *
 * Results keep `PATH` order and are deduplicated by compiler name, so the first
 * installation wins when the same compiler appears in several directories.
 */
export function discoverBuildToolchains(
  environment: NodeJS.ProcessEnv = process.env,
  fileSystem: BuildToolchainFileSystem = defaultFileSystem,
  platform: NodeJS.Platform = process.platform
): DiscoveredBuildToolchains {
  const mcu: BuildToolchain[] = [];
  const native: BuildToolchain[] = [];
  const seenMcu = new Set<string>();
  const seenNative = new Set<string>();

  for (const directory of environmentPathEntries(environment, platform)) {
    const listing = listDirectory(fileSystem, directory);
    for (const name of listing.names) {
      const rawPrefix = mcuPrefix(name);
      if (rawPrefix !== undefined) {
        const prefix = rawPrefix.slice(0, -1);
        if (seenMcu.has(prefix)) {
          continue;
        }
        seenMcu.add(prefix);
        const cCompiler = `${prefix}-gcc`;
        const cxxCompiler = `${prefix}-g++`;
        mcu.push({
          id: `mcu:${prefix}`,
          direction: 'mcu',
          prefix,
          cCompiler,
          ...(listing.names.has(cxxCompiler) ? { cxxCompiler } : {}),
          binDir: directory,
          label: mcuLabel(rawPrefix),
          detail: directory
        });
        continue;
      }
      const host = nativeCompiler(name);
      if (host === undefined || seenNative.has(host.cCompiler)) {
        continue;
      }
      seenNative.add(host.cCompiler);
      native.push({
        id: `native:${host.cCompiler.replace(/-gcc$/, '')}`,
        direction: 'native',
        prefix: '',
        cCompiler: host.cCompiler,
        ...(listing.names.has(host.cxxCompiler) ? { cxxCompiler: host.cxxCompiler } : {}),
        binDir: directory,
        label: nativeLabel(host.cCompiler),
        detail: `${host.cCompiler} — ${directory}`
      });
    }
  }

  // A MinGW installation usually ships both `gcc` and `x86_64-w64-mingw32-gcc`
  // in one `bin` directory; the plain driver is the same compiler, so the
  // prefixed duplicate is only offered as a fallback when it is the sole entry.
  const plainDirs = new Set(
    native
      .filter((toolchain) => toolchain.cCompiler === 'gcc' || toolchain.cCompiler === 'clang')
      .map((toolchain) => toolchain.binDir)
  );
  return {
    mcu,
    native: native.filter((toolchain) =>
      !(toolchain.cCompiler.endsWith('-w64-mingw32-gcc') && plainDirs.has(toolchain.binDir))
    )
  };
}

/** Looks a selection id up; `''` means the automatic/default compiler. */
export function findBuildToolchain(
  discovered: DiscoveredBuildToolchains,
  direction: BuildToolchainDirection,
  id: string
): BuildToolchain | undefined {
  if (id === '') {
    return undefined;
  }
  return discovered[direction].find((toolchain) => toolchain.id === id);
}
