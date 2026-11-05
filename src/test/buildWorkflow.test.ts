import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createBuildProjectCommand, type BuildProjectHost } from '../generation/buildWorkflow';
import type { BuildRunOptions } from '../generation/buildRunner';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'ce-build-workflow-'));
  const errors: string[] = [], infos: string[] = [], lines: string[] = [], runs: BuildRunOptions[] = [];
  let trusted = true, workspace: string | undefined = root;
  let preset: 'debug' | 'release' | undefined = 'debug';
  const host: BuildProjectHost = {
    workspaceRoot: () => workspace,
    isTrusted: () => trusted,
    choosePreset: async () => preset,
    showError: text => errors.push(text),
    showInformation: text => infos.push(text),
    showOutput() {},
    appendLine: line => lines.push(line),
    cmakePath: () => 'cmake',
    armToolchainPath: () => 'C:/ARM GNU/bin',
    withProgress: run => run(new AbortController().signal)
  };
  const run = async (options: BuildRunOptions) => { runs.push(options); return { ok: true, message: '构建成功。' }; };
  const command = createBuildProjectCommand(host, run);
  const files = async () => {
    await writeFile(join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.22)');
    await writeFile(join(root, 'CMakePresets.json'), '{}');
  };
  return { root, errors, infos, lines, runs, command, host, files,
    setTrust: (value: boolean) => { trusted = value; },
    setWorkspace: (value: string | undefined) => { workspace = value; },
    setPreset: (value: typeof preset) => { preset = value; }
  };
}

test('does not execute workspace code before trust and generation prerequisites pass', async () => {
  const f = await fixture();
  try {
    f.setTrust(false);
    await f.command();
    assert.match(f.errors.pop()!, /信任/);
    f.setTrust(true); f.setWorkspace(undefined);
    await f.command();
    assert.match(f.errors.pop()!, /目录/);
    f.setWorkspace(f.root);
    await f.command();
    assert.match(f.errors.pop()!, /生成/);
    assert.equal(f.runs.length, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('passes preset and ARM toolchain environment to the runner and reports success', async () => {
  const f = await fixture();
  try {
    await f.files(); f.setPreset('release');
    const result = await f.command();
    assert.equal(result?.ok, true);
    assert.equal(f.runs[0].presetName, 'release');
    assert.equal(f.runs[0].cwd, f.root);
    const key = Object.keys(f.runs[0].env!).find(k => k.toLowerCase() === 'path')!;
    assert.ok(f.runs[0].env![key]?.startsWith('C:/ARM GNU/bin'));
    assert.equal(f.infos.length, 1);
    f.setPreset(undefined);
    await f.command();
    assert.equal(f.runs.length, 1);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('failure is reported and cancelled builds never claim success', async () => {
  const f = await fixture();
  try {
    await f.files();
    await createBuildProjectCommand(f.host, async () => ({ ok: false, message: 'CMake failed' }))();
    assert.match(f.errors.pop()!, /CMake failed/);
    await createBuildProjectCommand(f.host, async () => ({ ok: false, cancelled: true, message: 'cancelled' }))();
    assert.equal(f.errors.length, 0);
    assert.equal(f.infos.length, 0);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});

test('concurrent requests do not spawn duplicate builds and a later request can run', async () => {
  const f = await fixture();
  try {
    await f.files();
    const gate = Promise.withResolvers<{ ok: boolean; message: string }>();
    const started = Promise.withResolvers<void>();
    let calls = 0;
    const command = createBuildProjectCommand(f.host, async () => { calls++; started.resolve(); return gate.promise; });
    const first = command(); await started.promise;
    await command();
    assert.equal(calls, 1);
    assert.match(f.infos.pop()!, /正在/);
    gate.resolve({ ok: true, message: 'done' }); await first;
    await command(); assert.equal(calls, 2);
  } finally { await rm(f.root, { recursive: true, force: true }); }
});
