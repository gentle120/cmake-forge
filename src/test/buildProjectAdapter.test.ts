import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadHostModule } from './support/hostModule';

const toolsAvailable = ['cmake', 'ninja'].every(tool => spawnSync(tool, ['--version']).status === 0);

test('registered build command drives real CMake through the VS Code output/progress adapter', {
  skip: !toolsAvailable, timeout: 60000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ce registered build '));
  try {
    await writeFile(join(root, 'CMakeLists.txt'), [
      'cmake_minimum_required(VERSION 3.22)', 'project(adapter_build NONE)',
      'add_custom_target(marker ALL COMMAND ${CMAKE_COMMAND} -E touch ${CMAKE_BINARY_DIR}/built.txt)'
    ].join('\n'));
    await writeFile(join(root, 'CMakePresets.json'), JSON.stringify({
      version: 3,
      configurePresets: [{ name: 'debug', generator: 'Ninja', binaryDir: '${sourceDir}/build/debug' }],
      buildPresets: [{ name: 'debug', configurePreset: 'debug' }]
    }));
    const lines: string[] = [], infos: string[] = [], errors: string[] = [];
    const commands = new Map<string, () => Promise<void>>();
    let outputShown = false, progressSeen = false, cancellationDisposed = false;
    const vscode = {
      ProgressLocation: { Notification: 15 },
      workspace: {
        isTrusted: true, workspaceFolders: [{ uri: { fsPath: root } }],
        getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback })
      },
      commands: { registerCommand: (id: string, callback: () => Promise<void>) => {
        commands.set(id, callback); return { dispose() {} };
      } },
      window: {
        createOutputChannel: (name: string) => {
          assert.equal(name, 'CMake-Embedded Build');
          return { appendLine: (line: string) => lines.push(line), show: () => { outputShown = true; }, dispose() {} };
        },
        showQuickPick: async () => ({ value: 'debug' }),
        showErrorMessage: (text: string) => { errors.push(text); },
        showInformationMessage: (text: string) => { infos.push(text); },
        withProgress: async (options: { cancellable: boolean }, run: (progress: object, token: object) => Promise<unknown>) => {
          assert.equal(options.cancellable, true); progressSeen = true;
          return run({}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose: () => { cancellationDisposed = true; } }) });
        }
      }
    };
    const adapterPath = join(__dirname, '..', 'integration', 'buildProject.js');
    const adapter = loadHostModule<{
      registerBuildProject(context: object, workspaceRoot: () => string | undefined): void;
    }>(adapterPath, vscode);
    const context = { subscriptions: [] as Array<{ dispose(): void }> };
    adapter.registerBuildProject(context, () => root);
    assert.equal(context.subscriptions.length, 3);
    assert.ok(commands.has('cmakeEmbedded.buildProject'));
    await commands.get('cmakeEmbedded.buildProject')!();
    assert.equal(errors.length, 0, errors.join('\n'));
    assert.equal(infos.length, 1);
    assert.ok(outputShown && progressSeen && cancellationDisposed);
    assert.ok(lines.some(line => line.includes('cmake --build --preset debug')));
    await access(join(root, 'build', 'debug', 'built.txt'));
    context.subscriptions.forEach(disposable => disposable.dispose());
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('registered build command uses the project root supplied by the caller', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ce selected build '));
  const other = await mkdtemp(join(tmpdir(), 'ce other workspace '));
  try {
    await writeFile(join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.22)\nproject(selected NONE)\n');
    await writeFile(join(root, 'CMakePresets.json'), JSON.stringify({
      version: 3,
      configurePresets: [{ name: 'debug', generator: 'Ninja', binaryDir: '${sourceDir}/build/debug' }],
      buildPresets: [{ name: 'debug', configurePreset: 'debug' }]
    }));
    await writeFile(join(other, 'marker.txt'), 'other');
    const lines: string[] = [];
    const commands = new Map<string, () => Promise<void>>();
    const vscode = {
      ProgressLocation: { Notification: 15 },
      workspace: {
        isTrusted: true, workspaceFolders: [{ uri: { fsPath: other } }],
        getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback })
      },
      commands: { registerCommand: (id: string, callback: () => Promise<void>) => {
        commands.set(id, callback); return { dispose() {} };
      } },
      window: {
        createOutputChannel: () => ({
          appendLine: (line: string) => lines.push(line), show() {}, dispose() {}
        }),
        showQuickPick: async () => ({ value: 'debug' }),
        showErrorMessage: () => {},
        showInformationMessage: () => {},
        withProgress: async (_options: unknown, run: (progress: object, token: object) => Promise<unknown>) =>
          run({}, { isCancellationRequested: false, onCancellationRequested: () => ({ dispose() {} }) })
      }
    };
    const adapterPath = join(__dirname, '..', 'integration', 'buildProject.js');
    const adapter = loadHostModule<{
      registerBuildProject(context: object, workspaceRoot: () => string | undefined): void;
    }>(adapterPath, vscode);
    const context = { subscriptions: [] as Array<{ dispose(): void }> };
    adapter.registerBuildProject(context, () => root);
    await commands.get('cmakeEmbedded.buildProject')!();
    assert.ok(lines.some((line) => line.includes(`=== debug: ${root} ===`)));
    context.subscriptions.forEach(disposable => disposable.dispose());
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(other, { recursive: true, force: true });
  }
});
