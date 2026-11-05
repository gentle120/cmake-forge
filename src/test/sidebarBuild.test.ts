import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

test('sidebar locks generation while building and forwards the actual failure result', async () => {
  const started = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<{ ok: boolean; message: string }>();
  const messages: Array<{ type: string; result?: { ok: boolean; message: string } }> = [];
  let scanCalls = 0;
  let commandCalls = 0;
  const vscode = {
    workspace: {
      workspaceFolders: [],
      getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback })
    },
    commands: { executeCommand: (id: string) => {
      commandCalls++;
      assert.equal(id, 'cmakeEmbedded.buildProject');
      started.resolve(); return gate.promise;
    } }
  };
  const filename = join(__dirname, '..', 'sidebar', 'provider.js');
  const moduleObject = { exports: {} as { SidebarProvider: new (context: object, dependencies: object) => {
    resolveWebviewView(view: object): void; dispose(): void;
  } } };
  const load = runInNewContext('(function(require,module,exports){\n' + readFileSync(filename, 'utf8') + '\n})');
  const req = createRequire(filename);
  load((name: string) => name === 'vscode' ? vscode : req(name), moduleObject, moduleObject.exports);
  const uri = { path: '/extension', with(change: object) { return { ...this, ...change }; } };
  const provider = new moduleObject.exports.SidebarProvider({
    workspaceState: { get: () => undefined, update: async () => {} }, extensionUri: uri
  }, {
    workflow: { workspaceRoot: () => '.', scanWorkspace: async () => { scanCalls++; return undefined; } },
    confirmOverwrite: async () => true, discoverToolchains: () => []
  });
  let receive: ((value: object) => void) | undefined;
  provider.resolveWebviewView({
    webview: {
      cspSource: 'test', asWebviewUri: () => 'test',
      postMessage: (message: typeof messages[number]) => {
        messages.push(message);
        if (message.type === 'operationFinished') { finished.resolve(); }
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener: typeof receive) => { receive = listener; return { dispose() {} }; }
    },
    onDidDispose: () => ({ dispose() {} })
  });
  try {
    receive!({ type: 'buildProject' }); await started.promise;
    assert.ok(messages.some(message => message.type === 'operationStarted'));
    receive!({ type: 'generateProject' });
    receive!({ type: 'setArmToolchainPath', path: 'C:/Other ARM/bin' });
    receive!({ type: 'browseArmToolchain' });
    receive!({ type: 'scanEnvironment' });
    assert.equal(scanCalls, 0);
    assert.equal(commandCalls, 1);
    gate.resolve({ ok: false, message: 'configure failed' }); await finished.promise;
    const result = messages.find(message => message.type === 'operationFinished')!.result!;
    assert.equal(result.ok, false);
    assert.equal(result.message, 'configure failed');
  } finally {
    gate.resolve({ ok: false, message: 'stopped' });
    provider.dispose();
  }
});
