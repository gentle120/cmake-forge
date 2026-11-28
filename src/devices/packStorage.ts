import { cp, mkdir, rename, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Pack records and downloaded tools used to live in the extension's global
 * storage directory. VS Code deletes that directory when the extension is
 * uninstalled, so a reinstall (or switching between released and development
 * builds) looked like every imported Pack had vanished. They now live in a
 * per-user data directory that survives extension updates, with the old
 * location migrated once.
 */
export interface DataRootOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
}

const applicationDirectory = 'cmake-forge';

/** The directory that owns `packs.json`, `packs/` and `tools/`. */
export function resolveDataRoot(options: DataRootOptions = {}): string {
  const environment = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  if (platform === 'win32') {
    const appData = environment.APPDATA?.trim();
    return join(appData ? appData : join(home, 'AppData', 'Roaming'), applicationDirectory);
  }
  const xdg = environment.XDG_DATA_HOME?.trim();
  return join(xdg ? xdg : join(home, '.local', 'share'), applicationDirectory);
}

export interface PreparedDataRoot {
  root: string;
  migrated: boolean;
}

const storageEntries = ['packs.json', 'packs', 'tools'] as const;

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Makes sure the data root exists and, the first time it is used, moves the
 * records and tools out of the extension storage directory. A migration that
 * cannot finish leaves the old directory in charge: losing a Pack because a
 * copy failed is worse than staying on the legacy location.
 */
export async function prepareDataRoot(
  legacyRoot: string,
  root: string = resolveDataRoot(),
  move: typeof rename = rename
): Promise<PreparedDataRoot> {
  if (legacyRoot === root) {
    return { root, migrated: false };
  }
  try {
    await mkdir(root, { recursive: true });
  } catch {
    return { root: legacyRoot, migrated: false };
  }
  if (await exists(join(root, 'packs.json'))) {
    return { root, migrated: false };
  }
  const legacyEntries: string[] = [];
  for (const entry of storageEntries) {
    if (await exists(join(legacyRoot, entry))) {
      legacyEntries.push(entry);
    }
  }
  if (legacyEntries.length === 0) {
    return { root, migrated: false };
  }
  try {
    for (const entry of legacyEntries) {
      const source = join(legacyRoot, entry);
      const target = join(root, entry);
      try {
        await move(source, target);
      } catch {
        // A rename across volumes fails with EXDEV; copying keeps the same
        // contents, only slower.
        await cp(source, target, { recursive: true, force: false, errorOnExist: false });
      }
    }
    return { root, migrated: true };
  } catch {
    return { root: legacyRoot, migrated: false };
  }
}
