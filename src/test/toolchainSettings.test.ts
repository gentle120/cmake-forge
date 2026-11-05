import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadHostModule } from './support/hostModule';
import type { CommandResult } from '../shared/commandResult';

interface SettingsApi {
  getArmToolchainPath(): string | undefined;
  saveArmToolchainPath(input: string): Promise<CommandResult>;
  registerArmToolchainSettings(context: object): void;
}

async function fixture(scope: 'global' | 'workspace' | 'folder' = 'global') {
  const bin = await mkdtemp(join(tmpdir(), 'ce ARM GNU '));
  for (const tool of ['gcc', 'g++', 'objcopy', 'size']) {
    await writeFile(join(bin, `arm-none-eabi-${tool}.exe`), '');
  }
  let value = '';
  let picked: Array<{ fsPath: string }> | undefined = [{ fsPath: bin }];
  const updates: Array<{ key: string; value: string; target: number }> = [];
  const errors: string[] = [];
  const commands = new Map<string, (input?: string) => Promise<CommandResult>>();
  const resource = { fsPath: '/workspace' };
  const vscode = {
    ConfigurationTarget: { Global: 1, Workspace: 2, WorkspaceFolder: 3 },
    Uri: { file: (path: string) => ({ fsPath: path }) },
    workspace: {
      workspaceFolders: [{ uri: resource }],
      getConfiguration: (section: string, uri: object) => {
        assert.equal(section, 'cmakeEmbedded');
        assert.equal(uri, resource);
        return {
          get: () => value,
          inspect: () => ({
            workspaceValue: scope === 'workspace' ? value : undefined,
            workspaceFolderValue: scope === 'folder' ? value : undefined
          }),
          update: async (key: string, next: string, target: number) => {
            value = next;
            updates.push({ key, value: next, target });
          }
        };
      }
    },
    commands: {
      registerCommand: (id: string, command: (input?: string) => Promise<CommandResult>) => {
        commands.set(id, command); return { dispose() {} };
      }
    },
    window: {
      showErrorMessage: (message: string) => { errors.push(message); },
      showOpenDialog: async (options: { canSelectFolders: boolean; canSelectFiles: boolean }) => {
        assert.equal(options.canSelectFolders, true);
        assert.equal(options.canSelectFiles, false);
        return picked;
      }
    }
  };
  const settings = loadHostModule<SettingsApi>(join(__dirname, '..', 'integration', 'toolchainSettings.js'), vscode);
  settings.registerArmToolchainSettings({ subscriptions: [] });
  return { bin, updates, errors, settings,
    command: commands.get('cmakeEmbedded.selectArmToolchain')!,
    cancelDialog: () => { picked = undefined; },
    dispose: () => rm(bin, { recursive: true, force: true })
  };
}

test('manual toolchain selection saves a normalized bin directory and clearing restores PATH', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.command(join(f.bin, 'arm-none-eabi-gcc.exe'))).ok, true);
    assert.equal(f.updates[0].key, 'armToolchainPath');
    assert.equal(f.updates[0].target, 1);
    assert.equal(f.settings.getArmToolchainPath(), f.bin.replace(/\\/g, '/'));
    assert.equal((await f.command('')).ok, true);
    assert.equal(f.settings.getArmToolchainPath(), undefined);
  } finally { await f.dispose(); }
});

for (const [scope, target] of [['workspace', 2], ['folder', 3]] as const) {
  test(`folder picker updates the effective ${scope} override`, async () => {
    const f = await fixture(scope);
    try {
      assert.equal((await f.command()).ok, true);
      assert.equal(f.updates[0].target, target);
      assert.equal(f.updates[0].value, f.bin.replace(/\\/g, '/'));
    } finally { await f.dispose(); }
  });
}

test('invalid and cancelled selections preserve the current setting', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.command('C:/missing/ARMCLANG/bin')).ok, false);
    assert.match(f.errors[0], /arm-none-eabi-gcc/);
    f.cancelDialog();
    const cancelled = await f.command();
    assert.equal(cancelled.ok, false);
    assert.equal(cancelled.cancelled, true);
    assert.equal(f.updates.length, 0);
  } finally { await f.dispose(); }
});
