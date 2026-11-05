import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import type { SidebarBootstrapState } from '../sidebar/state';
import { loadHostModule } from './support/hostModule';

interface Provider {
  resolveWebviewView(view: object): void;
  dispose(): void;
}

test('sidebar toolchain input and browsing use the settings command and refresh effective state', async () => {
  const bin = await mkdtemp(join(tmpdir(), 'ce sidebar GCC '));
  for (const tool of ['gcc', 'g++', 'objcopy', 'size']) {
    await writeFile(join(bin, `arm-none-eabi-${tool}.exe`), '');
  }
  let path = '';
  let receive: (value: object) => void = () => {};
  let stateChanged = Promise.withResolvers<SidebarBootstrapState>();
  const commands: Array<{ id: string; input?: string }> = [];
  const vscode = {
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({ get: () => path })
    },
    commands: { executeCommand: async (id: string, input?: string) => {
      commands.push({ id, input });
      path = input ?? bin;
      return { ok: true, message: 'setting updated' };
    } }
  };
  const api = loadHostModule<{ SidebarProvider: new (context: object, dependencies: object) => Provider }>(
    join(__dirname, '..', 'sidebar', 'provider.js'), vscode
  );
  const uri = { path: '/extension', with(change: object) { return { ...this, ...change }; } };
  const provider = new api.SidebarProvider({
    workspaceState: { get: () => undefined, update: async () => {} }, extensionUri: uri
  }, { workflow: {}, confirmOverwrite: async () => true, discoverToolchains: () => [] });
  provider.resolveWebviewView({
    webview: {
      cspSource: 'test', asWebviewUri: () => 'test',
      postMessage: (message: { type: string; state: SidebarBootstrapState }) => {
        if (message.type === 'state') { stateChanged.resolve(message.state); }
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return { dispose() {} }; }
    }, onDidDispose: () => ({ dispose() {} })
  });
  try {
    assert.equal((await stateChanged.promise).armToolchain.state, 'path');
    stateChanged = Promise.withResolvers<SidebarBootstrapState>();
    receive({ type: 'setArmToolchainPath', path: join(bin, 'arm-none-eabi-gcc.exe') });
    const typedState = await stateChanged.promise;
    assert.equal(typedState.armToolchain.binDir, bin.replace(/\\/g, '/'));
    assert.equal(typedState.armToolchain.state, 'ready');
    assert.equal(commands[0].id, 'cmakeEmbedded.selectArmToolchain');
    assert.equal(commands[0].input, join(bin, 'arm-none-eabi-gcc.exe'));
    stateChanged = Promise.withResolvers<SidebarBootstrapState>();
    receive({ type: 'browseArmToolchain' });
    assert.equal((await stateChanged.promise).armToolchain.state, 'ready');
    assert.equal(commands[1].input, undefined);
    stateChanged = Promise.withResolvers<SidebarBootstrapState>();
    receive({ type: 'setArmToolchainPath', path: '' });
    assert.equal((await stateChanged.promise).armToolchain.state, 'path');
  } finally {
    provider.dispose();
    await rm(bin, { recursive: true, force: true });
  }
});
