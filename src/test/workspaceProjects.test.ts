import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  discoverWorkspaceProjects,
  reconcileProjectRoot
} from '../scanner/workspaceProjects';

async function withWorkspace(
  run: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'cmake-embedded-workspace-'));
  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test('lists nested projects instead of treating the workspace root as one project', async () => {
  await withWorkspace(async (root) => {
    await mkdir(join(root, 'firmware'), { recursive: true });
    await mkdir(join(root, 'desktop'), { recursive: true });
    await mkdir(join(root, 'third-party', 'build'), { recursive: true });
    await writeFile(join(root, 'firmware', 'CMakeLists.txt'), '');
    await writeFile(join(root, 'desktop', 'main.c'), 'int main(void) { return 0; }');
    await writeFile(join(root, 'third-party', 'build', 'CMakeLists.txt'), '');

    const projects = await discoverWorkspaceProjects([root]);

    assert.deepEqual(
      projects.map((project) => project.root),
      [join(root, 'desktop'), join(root, 'firmware')]
    );
    assert.deepEqual(
      projects.map((project) => project.relativePath),
      ['desktop', 'firmware']
    );
  });
});

test('uses one multi-root workspace folder per project', async () => {
  await withWorkspace(async (root) => {
    const left = join(root, 'left');
    const right = join(root, 'right');
    await mkdir(left, { recursive: true });
    await mkdir(right, { recursive: true });
    await writeFile(join(left, 'CMakeLists.txt'), '');
    await writeFile(join(right, 'project.uvprojx'), '<Project/>');

    const projects = await discoverWorkspaceProjects([left, right]);

    assert.deepEqual(projects.map((project) => project.root), [left, right]);
    assert.deepEqual(projects.map((project) => project.markers), [
      ['cmake'],
      ['keil']
    ]);
  });
});

test('falls back to a root with sources when no project marker exists', async () => {
  await withWorkspace(async (root) => {
    await writeFile(join(root, 'main.c'), 'int main(void) { return 0; }');

    const projects = await discoverWorkspaceProjects([root]);

    assert.deepEqual(projects.map((project) => project.root), [root]);
    assert.deepEqual(projects[0].markers, ['source']);
  });
});

test('does not discover a root that only contains generated build output', async () => {
  await withWorkspace(async (root) => {
    await mkdir(join(root, 'build'), { recursive: true });
    await writeFile(join(root, 'build', 'generated.c'), '');

    assert.deepEqual(await discoverWorkspaceProjects([root]), []);
  });
});

test('keeps sibling projects out of a parent workspace source fallback', async () => {
  await withWorkspace(async (root) => {
    await mkdir(join(root, 'app-a', 'src'), { recursive: true });
    await mkdir(join(root, 'app-b', 'src'), { recursive: true });
    await writeFile(join(root, 'app-a', 'src', 'main.c'), 'int main(void) { return 0; }');
    await writeFile(join(root, 'app-b', 'src', 'main.c'), 'int main(void) { return 0; }');

    const projects = await discoverWorkspaceProjects([root]);

    assert.deepEqual(projects.map((project) => project.relativePath), ['app-a', 'app-b']);
  });
});

test('aborts project discovery when the signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();

  await assert.rejects(
    () => discoverWorkspaceProjects(['C:/not-read'], { signal: controller.signal }),
    /cancelled/
  );
});

test('auto-selects a sole project and clears a stale multi-project choice', () => {
  const single = [{ root: 'C:/work/app', relativePath: 'app', label: 'work/app', markers: ['cmake' as const] }];
  assert.equal(reconcileProjectRoot(single, ''), 'C:/work/app');
  assert.equal(reconcileProjectRoot(single, 'C:/stale'), 'C:/work/app');

  const multiple = [
    { root: 'C:/work/a', relativePath: 'a', label: 'work/a', markers: ['cmake' as const] },
    { root: 'C:/work/b', relativePath: 'b', label: 'work/b', markers: ['source' as const] }
  ];
  assert.equal(reconcileProjectRoot(multiple, 'C:/work/b'), 'C:/work/b');
  assert.equal(reconcileProjectRoot(multiple, 'C:/stale'), '');
});
