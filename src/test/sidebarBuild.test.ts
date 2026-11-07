import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import {
  registerDeviceProfiles,
  unregisterDeviceProfilesByPack
} from '../devices/deviceProfiles';
import { ScanCancelledError } from '../scanner/projectScanner';
import { WorkspaceProjectsCancelledError } from '../scanner/workspaceProjects';
import { loadHostModule } from './support/hostModule';
import { fixtureDeviceProfile, registerFixtureVendors } from './support/fixtureDevice';

registerFixtureVendors();

interface ProviderHarness {
  messages: Array<Record<string, unknown>>;
  receive(message: Record<string, unknown>): void;
  dispose(): void;
}

function startProvider(
  initialSelection: unknown,
  dependencies: Record<string, unknown>,
  writes: unknown[] = []
): ProviderHarness {
  const vscode = {
    workspace: {
      workspaceFolders: [{ name: 'workspace', uri: { fsPath: 'C:/workspace' } }],
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback })
    },
    commands: { executeCommand: async () => undefined }
  };
  const api = loadHostModule<{
    SidebarProvider: new (context: object, dependencies: object) => {
      resolveWebviewView(view: object): void;
      dispose(): void;
    };
  }>(join(__dirname, '..', 'sidebar', 'provider.js'), vscode);
  const provider = new api.SidebarProvider({
    workspaceState: {
      get: () => initialSelection,
      update: async (_key: string, value: unknown) => { writes.push(value); }
    },
    extensionUri: { path: '/extension', with(change: object) { return { ...this, ...change }; } }
  }, {
    workflow: {},
    confirmOverwrite: async () => true,
    discoverToolchains: () => [],
    discoverProjects: async () => [],
    ...dependencies
  });
  const messages: Array<Record<string, unknown>> = [];
  let receive: ((value: Record<string, unknown>) => void) | undefined;
  provider.resolveWebviewView({
    webview: {
      cspSource: 'test',
      asWebviewUri: () => 'test',
      postMessage: (message: Record<string, unknown>) => {
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
  return {
    messages,
    receive(message) {
      receive!(message);
    },
    dispose: () => provider.dispose()
  };
}

function latestState(messages: Array<Record<string, unknown>>) {
  return [...messages].reverse().find((message) => message.type === 'state')?.state as {
    selection: {
      mode: string;
      mcu: {
        vendor: string;
        packId: string;
        version: string;
        sourcePack?: string;
        series: string;
        part: string;
      };
    };
    vendors: Array<{ value: string }>;
    packCatalogNotice: string;
    pendingPackId: string;
    packs: Array<{ value: string; description?: string }>;
    versions: Array<{ value: string; description?: string }>;
  } | undefined;
}

test('sidebar shows the import hint while no Pack provides any vendor', async () => {
  const provider = startProvider(undefined, {
    loadPackCatalog: async () => ({ options: [] })
  });
  try {
    provider.receive({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const state = latestState(provider.messages);
    assert.deepEqual(state?.vendors ?? [], []);
    assert.match(state?.packCatalogNotice ?? '', /没有可用芯片/);
  } finally {
    provider.dispose();
  }
});

test('sidebar loads Pack catalog for the newly selected vendor and ignores a stale catalog response', async () => {
  const catalogCalls: string[] = [];
  const gdCatalog = Promise.withResolvers<{
    options: Array<Record<string, unknown>>;
    notice?: string;
  }>();
  const stmCatalog = Promise.withResolvers<{
    options: Array<Record<string, unknown>>;
    notice?: string;
  }>();
  const provider = startProvider(undefined, {
    loadPackCatalog: (vendor: string) => {
      catalogCalls.push(vendor);
      return vendor === 'GD' ? gdCatalog.promise : Promise.resolve({
        options: [{
          packId: 'STM:STM32F1_DFP',
          vendorId: 'STM',
          name: 'STM32F1_DFP',
          version: '1.0.0',
          origin: 'installed',
          packFile: 'C:/Keil/STM/STM32F1_DFP/1.0.0',
          source: 'directory'
        }],
        notice: 'STM index unavailable'
      });
    },
    discoverPackVendors: async () => ({
      vendors: [{ value: 'STM', label: 'ST' }, { value: 'GD', label: 'GigaDevice' }]
    })
  });
  try {
    provider.receive({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    provider.receive({
      type: 'saveSelection',
      selection: {
        mode: 'mcu',
        mcu: { vendor: 'GD', packId: 'builtin:GD', version: 'builtin', series: 'F1x', part: 'GD32F103C8T6' }
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(catalogCalls.includes('GD'), true);

    stmCatalog.resolve({
      options: [{
        packId: 'STM:STM32F1_DFP',
        vendorId: 'STM',
        name: 'STM32F1_DFP',
        version: '1.0.0',
        origin: 'installed',
        packFile: 'C:/Keil/STM/STM32F1_DFP/1.0.0',
        source: 'directory'
      }],
      notice: 'STM index unavailable'
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      provider.messages.some((message) => (
        message.type === 'packCatalogLoading' && message.vendor === 'GD'
      )),
      true
    );

    gdCatalog.resolve({
      options: [{
        packId: 'GD:GD32F1_DFP',
        vendorId: 'GD',
        name: 'GD32F1_DFP',
        version: '1.10.0',
        origin: 'downloadable',
        packUrl: 'https://packs.example/GD32F1_DFP.1.10.0.pack'
      }],
      notice: ''
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(
      provider.messages.some((message) => (
        message.type === 'packCatalogState'
        && message.vendor === 'GD'
        && JSON.stringify(message.packs).includes('GD:GD32F1_DFP')
      )),
      true
    );
    assert.equal(
      provider.messages.some((message) => (
        message.type === 'packCatalogState'
        && message.vendor === 'GD'
        && JSON.stringify(message.packs).includes('STM:STM32F1_DFP')
      )),
      false
    );
  } finally {
    provider.dispose();
  }
});

test('sidebar persists the exact downloaded Pack identity and selects its first usable device', async () => {
  const writes: unknown[] = [];
  const selection = {
    mode: 'mcu',
    projectRoot: '',
    mcu: {
      vendor: 'STM',
      packId: 'builtin:STM',
      version: 'builtin',
      series: 'F1x',
      part: 'STM32F103C8T6'
    },
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
  const catalogOption = {
    packId: 'STM:STM32F1xx_DFP',
    vendorId: 'STM',
    name: 'STM32F1xx_DFP',
    version: '1.10.0',
    origin: 'downloadable',
    packUrl: 'https://packs.example/STM32F1xx_DFP.1.10.0.pack'
  };
  const sourcePack = 'packs/STM/STM32F1xx_DFP.1.10.0.pack';
  const builtin = fixtureDeviceProfile();
  registerDeviceProfiles([{
    ...builtin,
    family: 'STM32F1xx custom Pack',
    ram: { ...builtin.ram, length: 24 * 1024 }
  }], sourcePack);
  const provider = startProvider(selection, {
    loadPackCatalog: async () => ({
      options: [ catalogOption]
    }),
    activatePack: async () => ({
      vendorId: 'STM',
      packId: 'STM:STM32F1xx_DFP',
      version: '1.10.0',
      sourcePack,
      message: '已载入 STM32F1xx_DFP 1.10.0。'
    })
  }, writes);
  try {
    provider.receive({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    provider.receive({
      type: 'activatePack',
      packId: 'STM:STM32F1xx_DFP',
      version: '1.10.0'
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const state = latestState(provider.messages);
    assert.equal(state?.selection.mcu.packId, 'STM:STM32F1xx_DFP');
    assert.equal(state?.selection.mcu.version, '1.10.0');
    assert.equal(state?.selection.mcu.sourcePack, sourcePack);
    assert.equal(state?.selection.mcu.series, 'F1x');
    assert.equal(state?.selection.mcu.part, 'STM32F103C8T6');
    assert.equal(
      (writes.at(-1) as { mcu?: { packId?: string; version?: string } } | undefined)?.mcu?.packId,
      'STM:STM32F1xx_DFP'
    );
  } finally {
    provider.dispose();
    unregisterDeviceProfilesByPack(sourcePack);
  }
});

test('sidebar activates an installed Pack through its storage key, not the Keil install path', async () => {
  const writes: unknown[] = [];
  const selection = {
    mode: 'mcu',
    projectRoot: '',
    mcu: {
      vendor: 'STM',
      packId: 'builtin:STM',
      version: 'builtin',
      series: 'F1x',
      part: 'STM32F103C8T6'
    },
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
  const sourcePack = 'packs/STM/STM32F1xx_DFP.2.4.1.pack';
  const installPath = 'C:/Keil_v5/ARM/PACK/Keil/STM32F1xx_DFP/2.4.1';
  const builtin = fixtureDeviceProfile();
  registerDeviceProfiles([{
    ...builtin,
    ram: { ...builtin.ram, length: 20 * 1024 }
  }], sourcePack);
  const provider = startProvider(selection, {
    loadPackCatalog: async () => ({
      options: [ {
        packId: 'STM:STM32F1xx_DFP',
        vendorId: 'STM',
        name: 'STM32F1xx_DFP',
        version: '2.4.1',
        origin: 'installed',
        packFile: installPath,
        source: 'directory'
      }],
      notice: ''
    }),
    activatePack: async () => ({
      vendorId: 'STM',
      packId: 'STM:STM32F1xx_DFP',
      version: '2.4.1',
      sourcePack,
      message: '已载入 STM32F1xx_DFP 2.4.1。'
    })
  }, writes);
  try {
    provider.receive({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    provider.receive({
      type: 'activatePack',
      packId: 'STM:STM32F1xx_DFP',
      version: '2.4.1'
    });
    await new Promise((resolve) => setTimeout(resolve, 40));
    const state = latestState(provider.messages);
    const result = [...provider.messages].reverse()
      .find((message) => message.type === 'operationFinished')?.result as { ok?: boolean } | undefined;
    assert.equal(result?.ok, true, 'installed Pack activation must succeed');
    assert.equal(state?.selection.mcu.packId, 'STM:STM32F1xx_DFP');
    assert.equal(state?.selection.mcu.version, '2.4.1');
    assert.equal(state?.selection.mcu.sourcePack, sourcePack);
    assert.equal(state?.selection.mcu.part, 'STM32F103C8T6');
    assert.equal(state?.versions.length, 1);
    assert.equal(state?.versions[0].value, '2.4.1');
  } finally {
    provider.dispose();
    unregisterDeviceProfilesByPack(sourcePack);
  }
});

test('sidebar keeps the requested mode when the selection only changes mode', async () => {
  const writes: unknown[] = [];
  const provider = startProvider(undefined, {
    loadPackCatalog: async () => ({
      options: []
    })
  }, writes);
  try {
    provider.receive({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const base = latestState(provider.messages)?.selection;
    assert.ok(base, 'expected an initial sidebar state');
    for (const mode of ['linux', 'native', 'mcu'] as const) {
      provider.receive({ type: 'saveSelection', selection: { ...base, mode } });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(latestState(provider.messages)?.selection.mode, mode);
      assert.equal(
        (writes.at(-1) as { mode?: string } | undefined)?.mode,
        mode
      );
    }
  } finally {
    provider.dispose();
  }
});

test('selecting a vendor auto-activates its best installed Pack version', async () => {
  const writes: unknown[] = [];
  const sourcePack = 'packs/GD/GD32F1xx_DFP.pack';
  registerDeviceProfiles([{
    ...fixtureDeviceProfile(),
    part: 'GD32F103C8T6',
    vendor: 'GD'
  }], sourcePack);
  const activations: Array<[string, string, string]> = [];
  const provider = startProvider(undefined, {
    loadPackCatalog: async (vendor: string) => vendor === 'GD'
      ? {
          options: [{
            packId: 'GD:GD32F1xx_DFP',
            vendorId: 'GD',
            name: 'GD32F1xx_DFP',
            version: '2.4.1',
            origin: 'installed',
            packFile: 'C:/Keil/GD/GD32F1xx_DFP/2.4.1',
            source: 'directory',
            hasDevices: true
          }, {
            packId: 'GD:GD32F1xx_DFP',
            vendorId: 'GD',
            name: 'GD32F1xx_DFP',
            version: '3.0.0',
            origin: 'downloadable',
            packUrl: 'https://packs.example/GD32F1xx_DFP.3.0.0.pack'
          }]
        }
      : {
          options: []
        },
    activatePack: async (vendor: string, packId: string, version: string) => {
      activations.push([vendor, packId, version]);
      return { vendorId: 'GD', packId, version, sourcePack, message: '已载入 GD32F1xx_DFP。' };
    }
  }, writes);
  try {
    provider.receive({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const base = latestState(provider.messages)?.selection;
    assert.ok(base, 'expected an initial sidebar state');
    provider.receive({
      type: 'saveSelection',
      selection: { ...base, mcu: { ...base.mcu, vendor: 'GD' } }
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    // The installed version is imported automatically; the downloadable one waits.
    assert.deepEqual(activations, [['GD', 'GD:GD32F1xx_DFP', '2.4.1']]);
    const state = latestState(provider.messages);
    assert.equal(state?.selection.mcu.vendor, 'GD');
    assert.equal(state?.selection.mcu.packId, 'GD:GD32F1xx_DFP');
    assert.equal(state?.selection.mcu.version, '2.4.1');
    assert.equal(state?.selection.mcu.sourcePack, sourcePack);
    assert.equal(state?.selection.mcu.part, 'GD32F103C8T6');
    assert.equal(state?.pendingPackId, 'GD:GD32F1xx_DFP');
    assert.equal(
      (writes.at(-1) as { mcu?: { packId?: string } } | undefined)?.mcu?.packId,
      'GD:GD32F1xx_DFP'
    );
  } finally {
    provider.dispose();
    unregisterDeviceProfilesByPack(sourcePack);
  }
});

test('a vendor with only downloadable Packs is not auto-activated', async () => {
  const activations: Array<[string, string, string]> = [];
  const provider = startProvider(undefined, {
    loadPackCatalog: async (vendor: string) => vendor === 'GD'
      ? {
          options: [{
            packId: 'GD:GD32F1xx_DFP',
            vendorId: 'GD',
            name: 'GD32F1xx_DFP',
            version: '3.0.0',
            origin: 'downloadable',
            packUrl: 'https://packs.example/GD32F1xx_DFP.3.0.0.pack'
          }]
        }
      : {
          options: []
        },
    activatePack: async (vendor: string, packId: string, version: string) => {
      activations.push([vendor, packId, version]);
      throw new Error('must not auto-activate a downloadable Pack');
    }
  });
  try {
    provider.receive({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const base = latestState(provider.messages)?.selection;
    assert.ok(base);
    provider.receive({
      type: 'saveSelection',
      selection: { ...base, mcu: { ...base.mcu, vendor: 'GD' } }
    });
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.equal(activations.length, 0);
    const state = latestState(provider.messages);
    assert.equal(state?.selection.mcu.vendor, 'GD');
    assert.equal(state?.pendingPackId, 'GD:GD32F1xx_DFP');
  } finally {
    provider.dispose();
  }
});

test('startup catalog refresh does not auto-activate an installed Pack', async () => {
  const selection = {
    mode: 'mcu',
    projectRoot: '',
    mcu: {
      vendor: 'GD',
      packId: 'builtin:GD',
      version: 'builtin',
      series: 'F1x',
      part: 'GD32F103C8T6'
    },
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
  const activations: Array<[string, string, string]> = [];
  const provider = startProvider(selection, {
    loadPackCatalog: async () => ({
      options: [{
        packId: 'GD:GD32F1xx_DFP',
        vendorId: 'GD',
        name: 'GD32F1xx_DFP',
        version: '2.4.1',
        origin: 'installed',
        packFile: 'C:/Keil/GD/GD32F1xx_DFP/2.4.1',
        source: 'directory',
        hasDevices: true
      }]
    }),
    activatePack: async (vendor: string, packId: string, version: string) => {
      activations.push([vendor, packId, version]);
      throw new Error('startup must not auto-activate');
    }
  });
  try {
    provider.receive({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 40));
    assert.equal(activations.length, 0);
    assert.equal(latestState(provider.messages)?.selection.mcu.packId, '');
    assert.equal(latestState(provider.messages)?.pendingPackId, 'GD:GD32F1xx_DFP');
  } finally {
    provider.dispose();
  }
});

test('sidebar keeps the previous valid Pack selection when download or parsing fails', async () => {
  const writes: unknown[] = [];
  const selection = {
    mode: 'mcu',
    projectRoot: '',
    mcu: {
      vendor: 'STM',
      packId: 'STM:STM32F1xx_DFP',
      version: '1.0.0',
      sourcePack: 'packs/STM/STM32F1xx_DFP.1.0.0.pack',
      series: 'F1x',
      part: 'STM32F103C8T6'
    },
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
  const builtin = fixtureDeviceProfile();
  registerDeviceProfiles([{
    ...builtin,
    ram: { ...builtin.ram, length: 20 * 1024 }
  }], 'packs/STM/STM32F1xx_DFP.1.0.0.pack');
  const provider = startProvider(selection, {
    loadPackCatalog: async () => ({
      options: [{
        packId: 'STM:STM32F1xx_DFP',
        vendorId: 'STM',
        name: 'STM32F1xx_DFP',
        version: '1.0.0',
        origin: 'installed',
        packFile: 'C:/Arm/Packs/STM/1.0.0'
      }, {
        packId: 'STM:STM32F1xx_DFP',
        vendorId: 'STM',
        name: 'STM32F1xx_DFP',
        version: '2.0.0',
        origin: 'downloadable',
        packUrl: 'https://packs.example/STM32F1xx_DFP.2.0.0.pack'
      }]
    }),
    activatePack: async () => {
      throw new Error('download failed');
    }
  }, writes);
  try {
    provider.receive({ type: 'ready' });
    await new Promise((resolve) => setTimeout(resolve, 20));
    const before = latestState(provider.messages)?.selection.mcu;
    provider.receive({
      type: 'activatePack',
      packId: 'STM:STM32F1xx_DFP',
      version: '2.0.0'
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const after = latestState(provider.messages)?.selection.mcu;
    assert.deepEqual(after, before);
    assert.equal(after?.version, '1.0.0');
    assert.equal(after?.part, 'STM32F103C8T6');
    assert.equal(writes.length, 0);
    const result = [...provider.messages].reverse()
      .find((message) => message.type === 'operationFinished')?.result as {
        ok?: boolean;
        message?: string;
      } | undefined;
    assert.equal(result?.ok, false);
    assert.match(result?.message ?? '', /download failed/);
  } finally {
    provider.dispose();
    unregisterDeviceProfilesByPack('packs/STM/STM32F1xx_DFP.1.0.0.pack');
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
