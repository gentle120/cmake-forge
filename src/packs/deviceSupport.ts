/**
 * Device support files a Pack ships for one device family: the device header
 * (`gd32f10x.h`), the matching `system_<stem>.h` and `system_<stem>.c`.
 *
 * A generated project needs them next to the CMSIS core headers: the device
 * header is what user code includes, and the system source provides `SystemInit`
 * and the clock setup that the startup calls. Packs are read once at import time
 * and the handful of relevant files is snapshotted into extension storage, so a
 * later generation does not depend on the original Pack archive or install
 * directory still being present.
 */

import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { readDirectoryEntries } from './packFs';
import { readZipEntries } from './zipReader';

/** Project-relative directory that receives the copied device headers. */
export const deviceIncludeDir = 'CMSIS/Device/Include';

/** Project-relative directory that receives the copied `system_*.c` sources. */
export const deviceSourceDir = 'CMSIS/Device/Source';

/** Path of a snapshot file relative to the extension storage root. */
export function deviceSnapshotDir(storageRoot: string, packFile: string): string {
  return join(storageRoot, `${packFile.replace(/\\/g, '/')}.device`);
}

/**
 * Directories that carry examples, documentation or the vendor's copy of the
 * standard peripheral driver library. The generated project copies the device
 * header and system files only; a StdPeriph/HAL tree is the user's own choice
 * (and can be tens of megabytes).
 */
const excludedSupportPath = /(^|\/)(examples?|documentation|docs|boards?|middleware|stdperiph_driver|hal_driver|standard_peripheral)\//i;

/**
 * Whether a Pack entry can contribute a device header or system source.
 *
 * Packs follow the CMSIS layout loosely: `Device/Include` + `Device/Source`
 * (ST, GigaDevice), `devices/<part>` (NXP), and a few flat `Include` folders.
 * The predicate is deliberately broad but skips example trees, which contain
 * thousands of `main.c` files; only files actually referenced by the device are
 * read back later.
 */
export function isDeviceSupportEntry(name: string): boolean {
  const lower = name.replace(/\\/g, '/').toLowerCase();
  if (!lower.endsWith('.h') && !lower.endsWith('.c')) {
    return false;
  }
  if (excludedSupportPath.test(lower)) {
    return false;
  }
  if (/(^|\/)cmsis\/(driver|dsp|rtos2?|nn|pack|view)\//.test(lower)) {
    return false;
  }
  const base = lower.split('/').pop() ?? '';
  return base.startsWith('system_') || /(^|\/)(devices?|include|source)\//.test(lower);
}

/**
 * Copies the device support entries of an imported Pack into extension storage.
 *
 * The snapshot keeps the pack-relative paths, which keeps the loader simple and
 * makes the storage layout recognisable next to the archive it came from.
 *
 * Marker written next to the snapshot files.
 *
 * Its presence says "this snapshot was built by the current filter". Old
 * snapshots (full driver tree, no marker) are rebuilt once instead of being
 * re-read from the archive on every generation.
 */
const snapshotMarkerName = 'snapshot.json';
const snapshotMarkerVersion = 2;

export async function writeDeviceSupportSnapshot(
  storageRoot: string,
  packFile: string,
  entries: Array<{ name: string; data: Buffer }>
): Promise<void> {
  const directory = deviceSnapshotDir(storageRoot, packFile);
  await rm(directory, { recursive: true, force: true });
  const selected = entries.filter((entry) => isDeviceSupportEntry(entry.name));
  for (const entry of selected) {
    const target = join(directory, entry.name);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, entry.data);
  }
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, snapshotMarkerName),
    `${JSON.stringify({ version: snapshotMarkerVersion })}\n`
  );
}

/** True when the snapshot was produced by the current filter. */
function hasCurrentSnapshot(directory: string): boolean {
  try {
    const marker = JSON.parse(readFileSync(join(directory, snapshotMarkerName), 'utf8')) as {
      version?: unknown;
    };
    return marker.version === snapshotMarkerVersion;
  } catch {
    return false;
  }
}

/** Removes the snapshot that belongs to a removed Pack. */
export async function removeDeviceSupportSnapshot(storageRoot: string, packFile: string): Promise<void> {
  await rm(deviceSnapshotDir(storageRoot, packFile), { recursive: true, force: true });
}

/**
 * Rebuilds a missing snapshot.
 *
 * Packs imported before the snapshot existed have only their archive (or, for a
 * directory install, their original directory) available; regenerating a
 * project must still pick up the device files instead of silently going
 * without them.
 */
async function rebuildSnapshot(
  storageRoot: string,
  packFile: string,
  sourceRoot?: string
): Promise<void> {
  const archive = resolve(storageRoot, packFile);
  if (existsSync(archive)) {
    try {
      const buffer = await readFile(archive);
      await writeDeviceSupportSnapshot(storageRoot, packFile, readZipEntries(buffer, isDeviceSupportEntry));
      return;
    } catch {
      // Fall through to the installed directory.
    }
  }
  if (sourceRoot) {
    try {
      const entries = await readDirectoryEntries(sourceRoot, isDeviceSupportEntry);
      if (entries.length > 0) {
        await writeDeviceSupportSnapshot(storageRoot, packFile, entries);
      }
    } catch {
      // The Pack install is gone; nothing can be recovered here.
    }
  }
}

/**
 * Guesses the device header of a Pack imported before the PDSC header was
 * recorded.
 *
 * Packs carry exactly one non-CMSIS header in `Device/Include`; the family name
 * (`GD32F10x` -> `gd32f10x.h`) matches that header for some vendors, so the
 * hints are tried first and a single unambiguous candidate is accepted last.
 */
export function guessDeviceHeader(
  entries: Array<{ name: string }>,
  hints: string[] = []
): string | undefined {
  // `Device/Include/stm32f10x.h` is the device header; headers below the same
  // Pack's StdPeriph/HAL tree are peripheral drivers, not device candidates.
  const ranked = entries
    .filter((entry) => isDeviceSupportEntry(entry.name) && entry.name.toLowerCase().endsWith('.h'))
    .map((entry) => {
      const name = entry.name.replace(/\\/g, '/');
      const rank = /(^|\/)device\/include\//i.test(name)
        ? 0
        : /(^|\/)include\//i.test(name) ? 1 : 2;
      return { rank, base: basename(name) };
    })
    .filter((entry) => !/^(system_|core_|cmsis_|mpu_|armv)/i.test(entry.base))
    // Vendor umbrella/configuration headers sit next to the device header and
    // must not win the tie: `gd32f10x_libopt.h`, `*_conf.h`, `*_it.h`.
    .filter((entry) => !/(_libopt|_conf|_config|_it)\.h$/i.test(entry.base))
    .sort((left, right) => left.rank - right.rank);
  if (ranked.length === 0) {
    return undefined;
  }
  const preferred = ranked.filter((entry) => entry.rank === ranked[0].rank);
  const byLowerName = new Map(preferred.map((entry) => [entry.base.toLowerCase(), entry.base]));
  for (const hint of hints) {
    const normalized = hint.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!normalized) {
      continue;
    }
    const exact = byLowerName.get(`${normalized}.h`);
    if (exact) {
      return exact;
    }
    // Packs name the family with a suffix (`GD32F10x Series`) while the header
    // is `gd32f10x.h`; accept the longest candidate stem that prefixes the hint.
    const prefix = preferred
      .map((entry) => entry.base.replace(/\.h$/i, '').toLowerCase())
      .filter((stem) => stem.length > 0 && normalized.startsWith(stem))
      .sort((left, right) => right.length - left.length)[0];
    if (prefix) {
      return byLowerName.get(`${prefix}.h`);
    }
  }
  const unique = [...new Set(preferred.map((entry) => entry.base.toLowerCase()))];
  return unique.length === 1 ? byLowerName.get(unique[0]) : undefined;
}

/**
 * Fills in a device header for Packs whose PDSC omits `<compile header>`.
 *
 * The family name usually matches the header stem (`GD32F10x` -> `gd32f10x.h`);
 * only names that really exist in the pack are accepted, so a Pack without a
 * device header stays without one.
 */
export function annotateDeviceHeaders(
  devices: Array<{ family: string; series: string; header?: string }>,
  entries: Array<{ name: string }>
): void {
  const available = new Set(
    entries
      .filter((entry) => isDeviceSupportEntry(entry.name) && entry.name.toLowerCase().endsWith('.h'))
      .map((entry) => basename(entry.name).toLowerCase())
  );
  for (const device of devices) {
    if (device.header) {
      continue;
    }
    const stems = [device.family, device.series]
      .map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ''))
      .filter((value) => value.length > 0);
    const match = stems.map((stem) => `${stem}.h`).find((name) => available.has(name));
    if (match) {
      device.header = match;
    }
  }
}

export interface DeviceSupportFile {
  /** Path relative to the project root, forward slashes. */
  relative: string;
  content: Buffer;
}

/** Picks the best entry for a basename, preferring the canonical device folder. */
function pickSupportEntry(
  entries: Array<{ name: string; data: Buffer }>,
  wantedBasename: string
): { name: string; data: Buffer } | undefined {
  const matches = entries.filter(
    (entry) => basename(entry.name).toLowerCase() === wantedBasename.toLowerCase()
  );
  return matches.sort((left, right) => {
    const rank = (name: string): number => (/(^|\/)device\/include\//i.test(name.replace(/\\/g, '/')) ? 0 : 1);
    return rank(left.name) - rank(right.name) || left.name.length - right.name.length;
  })[0];
}

/**
 * Reads the device header and system files a generation copies into the project.
 *
 * `headerName` is the device header the Pack declared; its stem determines the
 * `system_<stem>.h`/`.c` pair, which is the CMSIS naming convention followed by
 * the vendor Packs this extension supports.
 */

/**
 * Headers reachable from the device header through quoted `#include`s.
 *
 * The snapshot flattens the vendor layout (`Device/Include`, peripheral `inc/`
 * trees, …); include names are matched by basename, which is how these Packs
 * reference each other. A header the snapshot does not contain (for example the
 * user's own `stm32f10x_conf.h`) is simply skipped.
 */
function headerIncludeClosure(
  entries: Array<{ name: string; data: Buffer }>,
  root: { name: string; data: Buffer },
  followIncludes: (baseName: string) => boolean = () => true
): Array<{ name: string; data: Buffer }> {
  const byBasename = new Map<string, { name: string; data: Buffer }>();
  for (const entry of entries) {
    const base = basename(entry.name).toLowerCase();
    if (base.endsWith('.h') && !byBasename.has(base)) {
      byBasename.set(base, entry);
    }
  }
  const picked: Array<{ name: string; data: Buffer }> = [];
  const seen = new Set<string>();
  const queue: Array<{ name: string; data: Buffer }> = [root];
  while (queue.length > 0) {
    const entry = queue.shift()!;
    const key = basename(entry.name).toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    picked.push(entry);
    const baseName = basename(entry.name);
    if (!followIncludes(baseName)) {
      continue;
    }
    const text = entry.data.toString('utf8');
    for (const match of text.matchAll(/#\s*include\s+"([^"]+)"/g)) {
      const included = match[1].replace(/\\/g, '/').split('/').pop() ?? match[1];
      const next = byBasename.get(included.toLowerCase());
      if (next) {
        queue.push(next);
      }
    }
  }
  return picked;
}

export async function loadDeviceSupportFiles(
  storageRoot: string,
  packFile: string,
  headerName: string | undefined,
  options: { sourceRoot?: string; familyHints?: string[] } = {}
): Promise<DeviceSupportFile[]> {
  const snapshot = deviceSnapshotDir(storageRoot, packFile);
  let needsRebuild = !existsSync(snapshot) || !hasCurrentSnapshot(snapshot);
  if (!needsRebuild) {
    // A snapshot written by an older filter can still hold files the current one
    // would not keep; rebuild it once.
    const names = await readdir(snapshot, { recursive: true }).catch(() => [] as string[]);
    needsRebuild = names.some((name) => /\.(h|c)$/i.test(name) && !isDeviceSupportEntry(name.replace(/\\/g, '/')));
  }
  if (needsRebuild) {
    await rebuildSnapshot(storageRoot, packFile, options.sourceRoot);
  }
  let all = await readDirectoryEntries(snapshot);
  // Packs imported before the PDSC header was recorded have no header on their
  // profile; the snapshot still names the device header, so resolve it here.
  let header = headerName?.trim();
  if (!header) {
    header = guessDeviceHeader(all, options.familyHints);
  }
  if (!header) {
    return [];
  }
  const headerBasename = basename(header);
  const stem = headerBasename.replace(/\.h$/i, '');
  const files: DeviceSupportFile[] = [];
  const headerEntry = pickSupportEntry(all, headerBasename);
  if (!headerEntry) {
    return [];
  }
  // A device header usually includes a vendor umbrella header (GD32's
  // `gd32f10x_libopt.h`) and that one pulls in the peripheral register headers,
  // so copy the whole include closure. Without it a project that defines
  // `USE_STDPERIPH_DRIVER` cannot even preprocess `#include "gd32f10x.h"`.
  // The vendor umbrella header only lists peripheral driver headers; copy the
  // umbrella itself (the device header includes it) but not what it would pull
  // in. Driver headers are the project's own concern.
  for (const entry of headerIncludeClosure(all, headerEntry, (base) => !/_libopt\.h$/i.test(base))) {
    files.push({ relative: `${deviceIncludeDir}/${basename(entry.name)}`, content: entry.data });
  }
  const systemHeader = pickSupportEntry(all, `system_${stem}.h`);
  if (systemHeader && !files.some((file) => file.relative.toLowerCase() === `${deviceIncludeDir}/${basename(systemHeader.name)}`.toLowerCase())) {
    files.push({ relative: `${deviceIncludeDir}/${basename(systemHeader.name)}`, content: systemHeader.data });
  }
  // Keil's RTE header is generated by the IDE, not shipped by the Pack, but a
  // vendor umbrella header (GD32's `gd32f10x_libopt.h`) includes it
  // unconditionally. A minimal, empty component list keeps the device header
  // preprocessable while the peripheral drivers stay out of the project.
  const copiedIncludeNames = new Set(files.map((file) => basename(file.relative).toLowerCase()));
  // The vendor system file configures the clock through the RCU register
  // definitions; enable that single component and copy the matching header,
  // without dragging in the rest of the peripheral driver library.
  const usesLibopt = [...copiedIncludeNames].some((name) => /_libopt\.h$/i.test(name));
  const rcuEntry = usesLibopt
    ? all.find((entry) => /(^|_)rcu\.h$/i.test(basename(entry.name)))
    : undefined;
  if (rcuEntry) {
    for (const entry of headerIncludeClosure(all, rcuEntry, (base) => !/_libopt\.h$/i.test(base))) {
      const base = basename(entry.name);
      if (!files.some((file) => basename(file.relative).toLowerCase() === base.toLowerCase())) {
        files.push({ relative: `${deviceIncludeDir}/${base}`, content: entry.data });
      }
    }
  }
  const missingRte = files.some((file) => {
    const text = file.content.toString('utf8');
    return /#\s*include\s+"RTE_Components\.h"/i.test(text)
      && !copiedIncludeNames.has('rte_components.h');
  });
  if (missingRte) {
    files.push({
      relative: `${deviceIncludeDir}/RTE_Components.h`,
      content: Buffer.from(
        '/* Generated by CMake Embedded: the Pack does not ship Keil\'s RTE header,\n'
        + '   but the vendor umbrella header includes it. Define RTE_DEVICE_STDPERIPHERALS_*\n'
        + '   macros here (or replace this file) to pull in peripheral drivers. */\n'
        + '#ifndef RTE_COMPONENTS_H\n#define RTE_COMPONENTS_H\n'
        + (rcuEntry ? '#define RTE_DEVICE_STDPERIPHERALS_RCU 1\n' : '')
        + '#endif\n'
      )
    });
  }
  const systemSource = pickSupportEntry(all, `system_${stem}.c`);
  if (systemSource) {
    files.push({ relative: `${deviceSourceDir}/${basename(systemSource.name)}`, content: systemSource.data });
    // Headers the system source directly includes (normally just the device
    // header) are copied with it; the umbrella's driver list is not followed.
    const sourceIncludes = headerIncludeClosure(all, systemSource, (base) => !/_libopt\.h$/i.test(base));
    for (const entry of sourceIncludes) {
      const base = basename(entry.name);
      if (/^_?system_/i.test(base) || files.some((file) => basename(file.relative).toLowerCase() === base.toLowerCase())) {
        continue;
      }
      files.push({ relative: `${deviceIncludeDir}/${base}`, content: entry.data });
    }
  }
  return files;
}
