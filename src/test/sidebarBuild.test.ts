import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { ScanCancelledError } from '../scanner/projectScanner';
import { WorkspaceProjectsCancelledError } from '../scanner/workspaceProjects';
import { loadHostModule } from './support/hostModule';

test('sidebar locks generation while building and forwards the actual failure result', async () => {
  const started = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const gate = Promise.withResolvers<{ ok: boolean; message: string }>();
  const messages: Array<{ type: string; result?: { ok: boolean; message: string } }> = [];
  const stateWrites: unknown[] = [];
  let scanCalls = 0;
  let commandCalls = 0;
  const vscode = {
    workspace: {
      workspaceFolders: [{ uri: { fsPath: 'C:/workspace' } }],
      getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback })
    },
    commands: { executeCommand: (id: string) => {
      commandCalls++;
      assert.equal(id, 'cmakeEmbedded.buildProject');
      started.resolve(); return gate.promise;
    } }
  };
  const filename = join(__dirname, '..', 'sidebar', 'provider.js');
  const api = loadHostModule<{ SidebarProvider: new (context: object, dependencies: object) => {
    resolveWebviewView(view: object): void; dispose(): void;
  } }>(filename, vscode);
  const uri = { path: '/extension', with(change: object) { return { ...this, ...change }; } };
  const provider = new api.SidebarProvider({
    workspaceState: {
      get: () => undefined,
      update: async (_key: string, value: unknown) => { stateWrites.push(value); }
    },
    extensionUri: uri
  }, {
    workflow: { workspaceRoot: () => '.', scanWorkspace: async () => { scanCalls++; return undefined; } },
    confirmOverwrite: async () => true, discoverToolchains: () => [],
    discoverProjects: async () => [{
      root: 'C:/workspace/app',
      relativePath: 'app',
      label: 'workspace/app',
      markers: ['cmake' as const]
    }]
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
    await new Promise((resolve) => setTimeout(resolve, 50));
    receive!({ type: 'buildProject' }); await started.promise;
    assert.ok(messages.some(message => message.type === 'operationStarted'));
    receive!({ type: 'generateProject' });
    receive!({ type: 'setArmToolchainPath', path: 'C:/Other ARM/bin' });
    receive!({ type: 'browseArmToolchain' });
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

test('sidebar cancels project discovery before the busy guard and ends discovery state', async () => {
  const started = Promise.withResolvers<void>();
  const cancelled = Promise.withResolvers<void>();
  const messages: Array<{
    type: string;
    message?: string;
    state?: {
      discoveringProjects: boolean;
      projects: Array<{ value: string }>;
      projectRoot: string;
    };
  }> = [];
  let signal: AbortSignal | undefined;
  const vscode = {
    workspace: {
      workspaceFolders: [{ name: 'workspace', uri: { fsPath: 'C:/workspace' } }],
      getConfiguration: () => ({ get: (_key: string, fallback: string) => fallback })
    },
    commands: { executeCommand: async () => undefined }
  };
  const filename = join(__dirname, '..', 'sidebar', 'provider.js');
  const api = loadHostModule<{ SidebarProvider: new (context: object, dependencies: object) => {
    resolveWebviewView(view: object): void; dispose(): void;
  } }>(filename, vscode);
  const provider = new api.SidebarProvider({
    workspaceState: { get: () => undefined, update: async () => {} },
    extensionUri: { path: '/extension', with(change: object) { return { ...this, ...change }; } }
  }, {
    workflow: {},
    confirmOverwrite: async () => true,
    discoverToolchains: () => [],
    discoverProjects: async (_roots: string[], options?: { signal?: AbortSignal }) => {
      signal = options?.signal;
      started.resolve();
      const cancellationSignal = signal;
      if (!cancellationSignal) throw new Error('missing cancellation signal');
      return new Promise<never>((_resolve, reject) => {
        cancellationSignal.addEventListener('abort', () => {
          cancelled.resolve();
          reject(new WorkspaceProjectsCancelledError());
        }, { once: true });
      });
    }
  });
  let receive: ((value: object) => void) | undefined;
  provider.resolveWebviewView({
    webview: {
      cspSource: 'test',
      asWebviewUri: () => 'test',
      postMessage: (message: typeof messages[number]) => {
        messages.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener: typeof receive) => {
        receive = listener;
        return { dispose() {} };
      }
    },
    onDidDispose: () => ({ dispose() {} })
  });
  try {
    receive!({ type: 'ready' });
    await started.promise;
    assert.ok(messages.some((message) => (
      message.type === 'state' && message.state?.discoveringProjects === true
    )));
    receive!({ type: 'cancelWorkspaceScan' });
    await cancelled.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(messages.some((message) => (
      message.type === 'notification' && message.message === '已取消发现工作区工程。'
    )));
    const finalState = [...messages].reverse().find((message) => message.type === 'state')?.state;
    assert.equal(finalState?.discoveringProjects, false);
    assert.equal(finalState?.projectRoot, '');
    assert.equal(finalState?.projects.length, 0);
  } finally {
    provider.dispose();
  }
});

test('sidebar treats an empty workspace root as a selectable target', async () => {
  const root = 'C:/empty-workspace';
  const selection = {
    mode: 'mcu',
    projectRoot: '',
    mcu: { vendor: 'STM', series: 'F1x', part: 'STM32F103C8T6' },
    linux: { toolchainFamily: 'loongson' },
    native: { targetType: 'executable', cStandard: 11, cxxStandard: 17 },
    debugEnabled: false,
    flash: {
      enabled: false,
      targetId: 'stm32f1xx',
      probeId: 'stlink',
      openocdPath: 'openocd',
      backend: 'openocd'
    }
  };
  const messages: Array<{
    type: string;
    result?: { ok: boolean; message: string; files: string[] };
    state?: {
      projects: Array<{ value: string }>;
      projectRoot: string;
      discoveringProjects: boolean;
    };
  }> = [];
  let scannedRoot = '';
  const vscode = {
    workspace: {
      workspaceFolders: [{ name: 'empty-workspace', uri: { fsPath: root } }],
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback })
    },
    commands: { executeCommand: async () => undefined }
  };
  const api = loadHostModule<{ SidebarProvider: new (context: object, dependencies: object) => {
    resolveWebviewView(view: object): void;
    dispose(): void;
  } }>(join(__dirname, '..', 'sidebar', 'provider.js'), vscode);
  const provider = new api.SidebarProvider({
    workspaceState: { get: () => selection, update: async () => {} },
    extensionUri: { path: '/extension', with(change: object) { return { ...this, ...change }; } }
  }, {
    workflow: {},
    confirmOverwrite: async () => true,
    discoverToolchains: () => [],
    discoverProjects: async () => [{
      root,
      relativePath: '',
      label: 'empty-workspace',
      markers: ['empty']
    }],
    scanProject: async (projectRoot: string) => {
      scannedRoot = projectRoot;
      return { sources: [], includeDirs: [], defines: [] };
    }
  });
  let receive: ((value: object) => void) | undefined;
  provider.resolveWebviewView({
    webview: {
      cspSource: 'test',
      asWebviewUri: () => 'test',
      postMessage: (message: typeof messages[number]) => {
        messages.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener: typeof receive) => {
        receive = listener;
        return { dispose() {} };
      }
    },
    onDidDispose: () => ({ dispose() {} })
  });
  try {
    receive!({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const discovered = [...messages].reverse().find((message) => message.type === 'state')?.state;
    assert.equal(discovered?.projectRoot, root);
    assert.deepEqual(discovered?.projects.map((project) => project.value), [root]);
    assert.equal(discovered?.discoveringProjects, false);

    receive!({ type: 'scanWorkspace' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const result = [...messages].reverse()
      .find((message) => message.type === 'operationFinished')?.result;
    assert.equal(scannedRoot, root);
    assert.equal(result?.ok, false);
    assert.equal(result?.message, '工作区中没有找到 C/C++ 或汇编源文件。');
  } finally {
    provider.dispose();
  }
});

test('sidebar reports source scan cancellation before the filesystem scan unwinds', async () => {
  const root = 'C:/workspace';
  const selection = {
    mode: 'mcu',
    projectRoot: root,
    mcu: { vendor: 'STM', series: 'F1x', part: 'STM32F103C8T6' },
    linux: { toolchainFamily: 'loongson' },
    native: { targetType: 'executable', cStandard: 11, cxxStandard: 17 },
    debugEnabled: false,
    flash: {
      enabled: false,
      targetId: 'stm32f1xx',
      probeId: 'stlink',
      openocdPath: 'openocd',
      backend: 'openocd'
    }
  };
  const messages: Array<{
    type: string;
    result?: { ok: boolean; cancelled?: boolean; message: string; files: string[] };
  }> = [];
  const scanStarted = Promise.withResolvers<void>();
  let scanCalls = 0;
  const vscode = {
    workspace: {
      workspaceFolders: [{ name: 'workspace', uri: { fsPath: root } }],
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback })
    },
    commands: { executeCommand: async () => undefined }
  };
  const api = loadHostModule<{ SidebarProvider: new (context: object, dependencies: object) => {
    resolveWebviewView(view: object): void;
    dispose(): void;
  } }>(join(__dirname, '..', 'sidebar', 'provider.js'), vscode);
  const provider = new api.SidebarProvider({
    workspaceState: { get: () => selection, update: async () => {} },
    extensionUri: { path: '/extension', with(change: object) { return { ...this, ...change }; } }
  }, {
    workflow: {},
    confirmOverwrite: async () => true,
    discoverToolchains: () => [],
    discoverProjects: async () => [{
      root,
      relativePath: '',
      label: 'workspace',
      markers: ['source']
    }],
    scanProject: () => {
      scanCalls++;
      scanStarted.resolve();
      return new Promise(() => {});
    }
  });
  let receive: ((value: object) => void) | undefined;
  provider.resolveWebviewView({
    webview: {
      cspSource: 'test',
      asWebviewUri: () => 'test',
      postMessage: (message: typeof messages[number]) => {
        messages.push(message);
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener: typeof receive) => {
        receive = listener;
        return { dispose() {} };
      }
    },
    onDidDispose: () => ({ dispose() {} })
  });
  try {
    receive!({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    receive!({ type: 'scanWorkspace' });
    await scanStarted.promise;
    receive!({ type: 'cancelWorkspaceScan' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const result = [...messages].reverse()
      .find((message) => message.type === 'operationFinished')?.result;
    assert.equal(result?.cancelled, true);
    assert.equal(result?.message, '已取消扫描工作区。');

    receive!({ type: 'scanWorkspace' });
    await scanStarted.promise;
    assert.equal(scanCalls, 2, 'cancellation must release the busy state immediately');
  } finally {
    provider.dispose();
  }
});

test('cancelling overlapping scans aborts the source scan before project discovery', async () => {
  const root = 'C:/workspace';
  const selection = {
    mode: 'mcu',
    projectRoot: root,
    mcu: { vendor: 'STM', series: 'F1x', part: 'STM32F103C8T6' },
    linux: { toolchainFamily: 'loongson' },
    native: { targetType: 'executable', cStandard: 11, cxxStandard: 17 },
    debugEnabled: false,
    flash: {
      enabled: false,
      targetId: 'stm32f1xx',
      probeId: 'stlink',
      openocdPath: 'openocd',
      backend: 'openocd'
    }
  };
  const messages: Array<{
    type: string;
    message?: string;
    result?: { ok: boolean; cancelled?: boolean; message: string; files: string[] };
    state?: { discoveringProjects: boolean };
  }> = [];
  const discoveryStarted = Promise.withResolvers<void>();
  const scanStarted = Promise.withResolvers<void>();
  const scanAborted = Promise.withResolvers<void>();
  const discoveryAborted = Promise.withResolvers<void>();
  const scanFinished = Promise.withResolvers<void>();
  const vscode = {
    workspace: {
      workspaceFolders: [{ name: 'workspace', uri: { fsPath: root } }],
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback })
    },
    commands: { executeCommand: async () => undefined }
  };
  const api = loadHostModule<{ SidebarProvider: new (context: object, dependencies: object) => {
    resolveWebviewView(view: object): void;
    dispose(): void;
  } }>(join(__dirname, '..', 'sidebar', 'provider.js'), vscode);
  const provider = new api.SidebarProvider({
    workspaceState: {
      get: () => selection,
      update: async () => {}
    },
    extensionUri: { path: '/extension', with(change: object) { return { ...this, ...change }; } }
  }, {
    workflow: {},
    confirmOverwrite: async () => true,
    discoverToolchains: () => [],
    discoverProjects: (_roots: string[], options?: { signal?: AbortSignal }) => {
      const signal = options?.signal;
      if (!signal) throw new Error('missing discovery signal');
      discoveryStarted.resolve();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          discoveryAborted.resolve();
          reject(new WorkspaceProjectsCancelledError());
        }, { once: true });
      });
    },
    scanProject: (_root: string, options?: { signal?: AbortSignal }) => {
      const signal = options?.signal;
      if (!signal) throw new Error('missing scan signal');
      scanStarted.resolve();
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          scanAborted.resolve();
          reject(new ScanCancelledError());
        }, { once: true });
      });
    }
  });
  let receive: ((value: object) => void) | undefined;
  provider.resolveWebviewView({
    webview: {
      cspSource: 'test',
      asWebviewUri: () => 'test',
      postMessage: (message: typeof messages[number]) => {
        messages.push(message);
        if (message.type === 'operationFinished') scanFinished.resolve();
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener: typeof receive) => {
        receive = listener;
        return { dispose() {} };
      }
    },
    onDidDispose: () => ({ dispose() {} })
  });
  try {
    receive!({ type: 'ready' });
    await discoveryStarted.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    receive!({ type: 'scanWorkspace' });
    await scanStarted.promise;

    receive!({ type: 'cancelWorkspaceScan' });
    await Promise.race([
      scanAborted.promise,
      new Promise((_resolve, reject) => setTimeout(
        () => reject(new Error('source scan was not aborted')),
        100
      ))
    ]);
    await scanFinished.promise;
    const result = [...messages].reverse()
      .find((message) => message.type === 'operationFinished')?.result;
    assert.equal(result?.cancelled, true);
    assert.equal(result?.message, '已取消扫描工作区。');
    assert.equal(
      [...messages].reverse().find((message) => message.type === 'state')?.state?.discoveringProjects,
      true
    );

    receive!({ type: 'cancelWorkspaceScan' });
    await discoveryAborted.promise;
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.ok(messages.some((message) => (
      message.type === 'notification' && message.message === '已取消发现工作区工程。'
    )));
    assert.equal(
      [...messages].reverse().find((message) => message.type === 'state')?.state?.discoveringProjects,
      false
    );
  } finally {
    provider.dispose();
  }
});

test('sidebar cancels a running source scan and reports a neutral cancellation', async () => {
  const root = 'C:/workspace';
  const selection = {
    mode: 'mcu',
    projectRoot: root,
    mcu: { vendor: 'STM', series: 'F1x', part: 'STM32F103C8T6' },
    linux: { toolchainFamily: 'loongson' },
    native: { targetType: 'executable', cStandard: 11, cxxStandard: 17 },
    debugEnabled: false,
    flash: {
      enabled: false,
      targetId: 'stm32f1xx',
      probeId: 'stlink',
      openocdPath: 'openocd',
      backend: 'openocd'
    }
  };
  const messages: Array<{
    type: string;
    result?: { ok: boolean; cancelled?: boolean; message: string; files: string[] };
  }> = [];
  const scanStarted = Promise.withResolvers<void>();
  const vscode = {
    workspace: {
      workspaceFolders: [{ name: 'workspace', uri: { fsPath: root } }],
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback })
    },
    commands: { executeCommand: async () => undefined }
  };
  const api = loadHostModule<{ SidebarProvider: new (context: object, dependencies: object) => {
    resolveWebviewView(view: object): void;
    dispose(): void;
  } }>(join(__dirname, '..', 'sidebar', 'provider.js'), vscode);
  const provider = new api.SidebarProvider({
    workspaceState: {
      get: () => selection,
      update: async () => {}
    },
    extensionUri: { path: '/extension', with(change: object) { return { ...this, ...change }; } }
  }, {
    workflow: {},
    confirmOverwrite: async () => true,
    discoverToolchains: () => [],
    discoverProjects: async () => [{
      root,
      relativePath: '',
      label: 'workspace',
      markers: ['source']
    }],
    scanProject: async (_root: string, options?: { signal?: AbortSignal }) => {
      const signal = options?.signal;
      if (!signal) throw new Error('missing scan signal');
      scanStarted.resolve();
      return new Promise<{
        sources: string[];
        includeDirs: string[];
        defines: string[];
      }>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          reject(new ScanCancelledError());
        }, { once: true });
      });
    }
  });
  let receive: ((value: object) => void) | undefined;
  const finished = Promise.withResolvers<void>();
  provider.resolveWebviewView({
    webview: {
      cspSource: 'test',
      asWebviewUri: () => 'test',
      postMessage: (message: typeof messages[number]) => {
        messages.push(message);
        if (message.type === 'operationFinished') finished.resolve();
        return Promise.resolve(true);
      },
      onDidReceiveMessage: (listener: typeof receive) => {
        receive = listener;
        return { dispose() {} };
      }
    },
    onDidDispose: () => ({ dispose() {} })
  });
  try {
    receive!({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    receive!({ type: 'scanWorkspace' });
    await scanStarted.promise;
    receive!({ type: 'cancelWorkspaceScan' });
    await finished.promise;
    const result = [...messages].reverse()
      .find((message) => message.type === 'operationFinished')?.result;
    assert.equal(result?.ok, false);
    assert.equal(result?.cancelled, true);
    assert.equal(result?.message, '已取消扫描工作区。');
    assert.equal(result?.files.length, 0);
    assert.equal(messages.filter((message) => message.type === 'workspaceScan').length, 0);
  } finally {
    provider.dispose();
  }
});
