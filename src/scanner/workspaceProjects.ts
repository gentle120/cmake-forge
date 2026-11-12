import { readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';
import { ignoredDirectories, sourceExtensions } from './scanRules';

export type WorkspaceProjectMarker =
  | 'cmake'
  | 'keil'
  | 'iar'
  | 'platformio'
  | 'empty'
  | 'source';

export interface WorkspaceProject {
  root: string;
  relativePath: string;
  label: string;
  markers: WorkspaceProjectMarker[];
}

export interface WorkspaceProjectScanOptions {
  signal?: AbortSignal;
}

export class WorkspaceProjectsCancelledError extends Error {
  constructor() {
    super('Workspace project discovery was cancelled.');
    this.name = 'WorkspaceProjectsCancelledError';
  }
}

const keilContainers = new Set(['mdk-arm', 'mdk', 'project', 'projects']);
const iarContainers = new Set(['ewarm', 'iar', 'project', 'projects']);

function posixPath(value: string): string {
  return value.replace(/\\/g, '/');
}

function workspaceRelative(root: string, directory: string): string {
  return relative(root, directory).split(sep).join('/');
}

function projectLabel(root: string, relativePath: string): string {
  const workspaceName = basename(root).replace(/[\\/]+$/, '');
  return relativePath
    ? `${workspaceName}/${relativePath}`
    : workspaceName;
}

function markerContainerRoot(directory: string, root: string, containers: Set<string>): string {
  let current = directory;
  while (current !== root && posixPath(current) !== posixPath(root)) {
    const parent = dirname(current);
    if (containers.has(basename(current).toLowerCase())) {
      return parent;
    }
    current = parent;
  }
  return directory;
}

async function directoryEntries(
  directory: string,
  signal?: AbortSignal
): Promise<Array<{ name: string; isDirectory: boolean; isFile: boolean }>> {
  if (signal?.aborted) {
    throw new WorkspaceProjectsCancelledError();
  }
  try {
    return (await readdir(directory, { withFileTypes: true }))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map((entry) => ({
        name: entry.name,
        isDirectory: entry.isDirectory(),
        isFile: entry.isFile()
      }));
  } catch (error) {
    if (signal?.aborted) {
      throw new WorkspaceProjectsCancelledError();
    }
    return [];
  }
}

async function discoverRoot(
  root: string,
  markerRoots: Map<string, Set<WorkspaceProjectMarker>>,
  signal?: AbortSignal
): Promise<void> {
  const sourceDirectories = new Set<string>();
  const found = new Map<string, Set<WorkspaceProjectMarker>>();
  const walk = async (directory: string): Promise<void> => {
    const entries = await directoryEntries(directory, signal);
    for (const entry of entries) {
      if (signal?.aborted) {
        throw new WorkspaceProjectsCancelledError();
      }
      const path = join(directory, entry.name);
      if (entry.isDirectory) {
        if (!ignoredDirectories.has(entry.name) && !entry.name.startsWith('cmake-build-')) {
          await walk(path);
        }
        continue;
      }
      if (!entry.isFile) {
        continue;
      }

      const lowerName = entry.name.toLowerCase();
      const extension = lowerName.slice(lowerName.lastIndexOf('.'));
      if (sourceExtensions.has(extension)) {
        sourceDirectories.add(directory);
      }

      let projectRoot = directory;
      let marker: WorkspaceProjectMarker | undefined;
      if (lowerName === 'cmakelists.txt'
          || lowerName === '.mcu-cmake.json'
          || lowerName === '.linux-cmake.json'
          || lowerName === '.native-cmake.json') {
        marker = 'cmake';
      } else if (lowerName.endsWith('.uvprojx') || lowerName.endsWith('.uvproj')) {
        marker = 'keil';
        projectRoot = markerContainerRoot(directory, root, keilContainers);
      } else if (lowerName.endsWith('.ewp')) {
        marker = 'iar';
        projectRoot = markerContainerRoot(directory, root, iarContainers);
      } else if (lowerName === 'platformio.ini') {
        marker = 'platformio';
      }

      if (marker) {
        const markers = found.get(projectRoot) ?? new Set<WorkspaceProjectMarker>();
        markers.add(marker);
        found.set(projectRoot, markers);
      }
    }
  };

  await walk(root);
  if (found.size === 0 && sourceDirectories.size === 0) {
    found.set(root, new Set(['empty']));
  }
  for (const sourceDirectory of sourceDirectories) {
    const relativeSource = workspaceRelative(root, sourceDirectory);
    const candidateRoot = relativeSource
      ? join(root, relativeSource.split('/')[0])
      : root;
    const nestedMarker = [...found.keys()].some((projectRoot) => (
      posixPath(candidateRoot) === posixPath(projectRoot)
      || posixPath(candidateRoot).startsWith(`${posixPath(projectRoot)}/`)
    ));
    if (!nestedMarker && !found.has(candidateRoot)) {
      found.set(candidateRoot, new Set(['source']));
    }
  }
  for (const [projectRoot, markers] of found) {
    const existing = markerRoots.get(projectRoot) ?? new Set<WorkspaceProjectMarker>();
    markers.forEach((marker) => existing.add(marker));
    markerRoots.set(projectRoot, existing);
  }
}

export async function discoverWorkspaceProjects(
  roots: string[],
  options: WorkspaceProjectScanOptions = {}
): Promise<WorkspaceProject[]> {
  if (options.signal?.aborted) {
    throw new WorkspaceProjectsCancelledError();
  }
  const found = new Map<string, Set<WorkspaceProjectMarker>>();
  for (const root of roots) {
    await discoverRoot(root, found, options.signal);
  }
  return [...found.entries()]
    .map(([root, markers]) => {
      const owner = roots.find((workspaceRoot) => (
        posixPath(root) === posixPath(workspaceRoot)
        || posixPath(root).startsWith(`${posixPath(workspaceRoot).replace(/\/$/, '')}/`)
      )) ?? roots[0] ?? root;
      const relativePath = workspaceRelative(owner, root);
      return {
        root,
        relativePath,
        label: projectLabel(owner, relativePath),
        markers: [...markers].sort()
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

/** Keeps a valid stored choice; auto-selects one project and clears stale or ambiguous choices. */
export function reconcileProjectRoot(projects: WorkspaceProject[], storedRoot: string): string {
  if (storedRoot && projects.some((project) => posixPath(project.root) === posixPath(storedRoot))) {
    return storedRoot;
  }
  // The dropdown can only show one entry: selecting the first discovered
  // project is better than displaying it while generation uses an empty root.
  return projects[0]?.root ?? '';
}
