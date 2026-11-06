import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { renderSidebarHtml } from '../sidebar/html';
import { Document, Element, parseHtml } from './support/sidebarDom';

const assetsRoot = join(__dirname, '..', '..', 'src', 'sidebar', 'webview');
const scriptSource = readFileSync(join(assetsRoot, 'main.js'), 'utf8');
const stylesheet = readFileSync(join(assetsRoot, 'main.css'), 'utf8');

const webviewUri = {
  cspSource: 'vscode-webview:',
  asWebviewUri(uri: { path: string }): string {
    return `vscode-webview-resource:${uri.path}`;
  }
};
const extensionUri = {
  path: '/C:/extension',
  with(change: { path: string }) {
    return { ...extensionUri, ...change };
  }
};

interface SidebarSelection {
  mode: 'mcu' | 'linux' | 'native';
  mcu: { vendor: string; packId: string; version: string; series: string; part: string };
  linux: { toolchainFamily: string };
  native: { targetType: string; cStandard: number; cxxStandard: number };
  debugEnabled: boolean;
  flash: { enabled: boolean; targetId: string; probeId: string; openocdPath: string; backend: string };
}

interface SidebarState {
  workspaceName: string;
  projects: Array<{ value: string; label: string; description?: string }>;
  projectRoot: string;
  discoveringProjects: boolean;
  vendors: Array<{ value: string; label: string }>;
  packs: Array<{ value: string; label: string; description?: string }>;
  versions: Array<{ value: string; label: string; description?: string }>;
  pendingPackId: string;
  series: Array<{ value: string; label: string }>;
  devices: Array<{ value: string; label: string; description?: string; detail?: string }>;
  flashTargets: Array<{ value: string; label: string }>;
  flashProbes: Array<{ value: string; label: string }>;
  flashBackends: Array<{ value: string; label: string }>;
  linuxToolchains: Array<{ value: string; label: string }>;
  packCatalogNotice: string;
  selection: SidebarSelection;
}

function baseState(overrides: Partial<SidebarState> = {}): SidebarState {
  return {
    workspaceName: 'demo',
    projects: [{ value: '', label: 'demo' }],
    projectRoot: '',
    discoveringProjects: false,
    vendors: [{ value: 'STM', label: 'ST' }],
    packs: [
      { value: 'builtin:STM', label: '内置芯片支持', description: 'builtin' },
      { value: 'STM:STM32F1xx_DFP', label: 'STM32F1xx_DFP', description: 'downloadable' }
    ],
    versions: [{ value: 'builtin', label: '内置', description: 'builtin' }],
    pendingPackId: 'builtin:STM',
    packCatalogNotice: '',
    series: [{ value: 'F1x', label: 'STM32F1' }],
    devices: [{ value: 'STM32F103C8T6', label: 'STM32F103C8T6', description: 'STM32F1', detail: '64 KB Flash' }],
    flashTargets: [{ value: 'stm32f1xx', label: 'STM32F1' }],
    flashProbes: [{ value: 'stlink', label: 'ST-Link' }],
    flashBackends: [{ value: 'openocd', label: 'OpenOCD' }, { value: 'jlink', label: 'J-Link' }],
    linuxToolchains: [{ value: 'loongson', label: 'Loongson' }],
    selection: {
      mode: 'mcu',
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
      flash: { enabled: false, targetId: 'stm32f1xx', probeId: 'stlink', openocdPath: 'openocd', backend: 'openocd' }
    },
    ...overrides
  };
}

interface Harness {
  document: Document;
  posted: Array<Record<string, unknown>>;
  send(message: Record<string, unknown>): void;
  element(id: string): Element;
  byCommand(command: string): Element[];
}

function startSidebar(initial: SidebarState): Harness {
  const markup = renderSidebarHtml(webviewUri, extensionUri, 'nonce');
  const document = new Document();
  parseHtml(markup, document);

  const posted: Array<Record<string, unknown>> = [];
  const messageListeners: Array<(event: { data: unknown }) => void> = [];
  const windowObject = {
    addEventListener(type: string, listener: (event: { data: unknown }) => void) {
      if (type === 'message') messageListeners.push(listener);
    }
  };
  runInNewContext(scriptSource, {
    // The real webview structured-clones messages across realms.
    acquireVsCodeApi: () => ({ postMessage: (message: Record<string, unknown>) =>
      posted.push(JSON.parse(JSON.stringify(message))) }),
    document,
    window: windowObject,
    Element,
    Array,
    Set
  });

  const harness: Harness = {
    document,
    posted,
    send(message) {
      if (message.type === 'state') {
        document.activeElement = document.activeElement;
      }
      messageListeners.forEach((listener) => listener({ data: message }));
    },
    element(id) {
      const found = document.getElementById(id);
      assert.ok(found, `missing #${id}`);
      return found;
    },
    byCommand(command) {
      return document.root.querySelectorAll('button[data-command]')
        .filter((element) => element.getAttribute('data-command') === command);
    }
  };
  harness.send({ type: 'state', state: initial });
  return harness;
}

test('sidebar renderer wires every supported command', () => {
  for (const command of [
    'ready',
    'saveSelection',
    'selectPack',
    'activatePack',
    'scanWorkspace',
    'cancelWorkspaceScan',
    'generateProject',
    'generateFlashScript',
    'generateDebugConfiguration',
    'openSettings'
  ]) {
    assert.match(scriptSource, new RegExp(command));
  }
  assert.doesNotMatch(scriptSource, /https?:\/\//);
  assert.doesNotMatch(scriptSource, /innerHTML/);
});

test('project selection sends the selected project root without starting a command', () => {
  const harness = startSidebar(baseState({
    projects: [
      { value: 'firmware', label: 'demo/firmware' },
      { value: 'desktop', label: 'demo/desktop' }
    ],
    projectRoot: 'firmware'
  }));
  const select = harness.element('project-root');

  assert.equal(select.value, 'firmware');
  assert.equal(harness.element('workspace-name').textContent, 'demo/firmware');
  select.value = 'desktop';
  select.dispatch('change');

  assert.deepEqual(harness.posted.at(-1), {
    type: 'setProjectRoot',
    root: 'desktop'
  });
});

test('MCU selection follows vendor, Pack, version, series, and device order', () => {
  const harness = startSidebar(baseState());
  const selects = harness.element('target-host').querySelectorAll('select');
  assert.equal(selects.length, 5);
  const [vendor, pack, version, series, device] = selects;
  assert.equal(vendor.value, 'STM');
  assert.equal(pack.value, 'builtin:STM');
  assert.equal(version.value, 'builtin');
  assert.equal(series.value, 'F1x');
  assert.equal(device.value, 'STM32F103C8T6');

  pack.value = 'STM:STM32F1xx_DFP';
  pack.dispatch('change');
  assert.deepEqual(harness.posted.at(-1), {
    type: 'selectPack',
    packId: 'STM:STM32F1xx_DFP'
  });
  harness.send({
    type: 'state',
    state: baseState({
      pendingPackId: 'STM:STM32F1xx_DFP',
      versions: [
        { value: '1.0.0', label: '1.0.0', description: 'installed' },
        { value: '1.1.0', label: '1.1.0', description: 'downloadable' }
      ]
    })
  });
  const refreshedSelects = harness.element('target-host').querySelectorAll('select');
  const versionSelect = refreshedSelects[2];
  versionSelect.value = '1.1.0';
  versionSelect.dispatch('change');
  assert.deepEqual(harness.posted.at(-1), {
    type: 'activatePack',
    packId: 'STM:STM32F1xx_DFP',
    version: '1.1.0'
  });
});

test('every command button is unique and its command is dispatched by the renderer', () => {
  const markup = renderSidebarHtml(webviewUri, extensionUri, 'nonce');
  const ids = [...markup.matchAll(/id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length, 'duplicate control ids in shell');

  const commands = [...markup.matchAll(/data-command="([^"]+)"/g)].map((match) => match[1]);
  for (const command of new Set(commands)) {
    assert.match(scriptSource, new RegExp(`\\b${command}\\b`), `renderer never dispatches ${command}`);
  }
  assert.deepEqual(
    [...new Set(commands)].sort(),
    ['cancelWorkspaceScan', 'generateDebugConfiguration',
      'generateFlashScript', 'generateProject', 'scanWorkspace']
  );
  // One delegated listener owns the static commands; no per-button wiring remains.
  const catalogListeners = [...scriptSource.matchAll(/app\.addEventListener\('click'/g)];
  assert.equal(catalogListeners.length, 1, 'command buttons must share one delegated listener');
});

test('busy state guards duplicate commands and reports cancellation neutrally', () => {
  const harness = startSidebar(baseState());
  const generate = harness.element('generate-project');

  generate.dispatch('click', { target: generate });
  generate.dispatch('click', { target: generate });
  assert.equal(harness.posted.filter((message) => message.type === 'generateProject').length, 1);
  assert.equal(harness.element('app').getAttribute('aria-busy'), 'true');

  harness.send({ type: 'operationFinished', result: { ok: false, cancelled: true, message: '已取消', files: [] } });
  assert.equal(harness.element('app').getAttribute('aria-busy'), 'false');
  assert.equal(harness.element('generation-status').className, 'status-badge cancelled');
  assert.equal(harness.element('operation-notice').textContent, '已取消');
});

test('offline catalog notice remains visible while built-in and installed Pack choices stay usable', () => {
  const harness = startSidebar(baseState({
    packs: [
      { value: 'builtin:STM', label: '内置芯片支持', description: 'builtin' },
      { value: 'STM:STM32F1xx_DFP', label: 'STM32F1xx_DFP', description: 'installed' }
    ],
    packCatalogNotice: '在线 Pack 列表暂不可用：network offline'
  }));

  const notice = harness.element('pack-catalog-notice');
  assert.equal(notice.hidden, false);
  assert.match(notice.textContent, /network offline/);
  const pack = harness.element('target-host').querySelectorAll('select')[1];
  assert.equal(pack.disabled, false);
  assert.deepEqual(
    pack.querySelectorAll('option').map((option) => option.value),
    ['builtin:STM', 'STM:STM32F1xx_DFP']
  );
});

test('cancel scan only appears while the initial scan or workspace scan is running', () => {
  const harness = startSidebar(baseState({ discoveringProjects: true }));
  const cancel = harness.element('cancel-workspace-scan');
  assert.equal(cancel.hidden, false);
  assert.equal(cancel.disabled, false);

  harness.send({ type: 'state', state: baseState() });
  assert.equal(cancel.hidden, true);

  const scan = harness.element('scan-workspace');
  scan.dispatch('click', { target: scan });
  harness.send({ type: 'operationStarted', operation: '正在扫描工作区' });
  assert.equal(cancel.hidden, false);
  assert.equal(cancel.disabled, false);
  cancel.dispatch('click', { target: cancel });
  assert.deepEqual(harness.posted.at(-1), { type: 'cancelWorkspaceScan' });
  cancel.dispatch('click', { target: cancel });
  assert.equal(harness.posted.filter((message) => message.type === 'cancelWorkspaceScan').length, 1);
});

test('cancelled workspace scans keep the previous count instead of reporting zero', () => {
  const harness = startSidebar(baseState());
  harness.send({
    type: 'workspaceScan',
    sources: 12,
    includeDirs: 3,
    defines: 2
  });
  const summary = harness.element('workspace-summary');
  const previous = summary.textContent;
  const scan = harness.element('scan-workspace');
  scan.dispatch('click', { target: scan });
  harness.send({
    type: 'operationFinished',
    result: { ok: true, message: '扫描完成', files: [] }
  });
  assert.equal(summary.textContent, previous);
});

test('failure messages stay visible and focus returns to the initiating control', () => {
  const harness = startSidebar(baseState());
  const generate = harness.element('generate-project');
  generate.dispatch('click', { target: generate });
  harness.send({
    type: 'operationFinished',
    result: { ok: false, message: '工程生成失败', files: [] }
  });

  assert.equal(harness.element('generation-status').className, 'status-badge error');
  const notice = harness.element('operation-notice');
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, '工程生成失败');
  assert.equal(harness.document.activeElement, generate);
});

test('only the backend-relevant detail group is exposed and probes come from state', () => {
  const harness = startSidebar(baseState({
    flashProbes: [{ value: 'jlink-ob', label: 'J-Link OB' }],
    selection: { ...baseState().selection, flash: { ...baseState().selection.flash, backend: 'jlink', probeId: 'jlink-ob' } }
  }));
  const detailHost = harness.element('backend-details-host');
  const openocdGroup = detailHost.querySelector('.details-group') as Element | undefined;
  const settingsGroup = detailHost.querySelectorAll('.details-group')[1];
  assert.ok(openocdGroup, 'expected an OpenOCD detail group');
  assert.ok(settingsGroup, 'expected a backend settings group');
  assert.equal(openocdGroup.hidden, true);
  assert.equal(settingsGroup.hidden, false);
  assert.ok(harness.element('backend-hint').textContent.includes('J-Link'));
});

test('Linux and desktop modes stay reachable without duplicate listeners', () => {
  const harness = startSidebar(baseState());
  const settingsGroup = harness.element('backend-details-host').querySelectorAll('.details-group')[1];
  const settingsButton = settingsGroup.querySelector('button');
  assert.ok(settingsButton, 'expected the tool settings button');
  settingsButton.dispatch('click', { target: settingsButton });
  assert.equal(harness.posted.filter((message) => message.type === 'openSettings').length, 1);
  settingsButton.dispatch('click', { target: settingsButton });
  assert.equal(harness.posted.filter((message) => message.type === 'openSettings').length, 2);

  harness.send({ type: 'state', state: baseState({
    selection: { ...baseState().selection, mode: 'linux' }
  }) });
  assert.equal(harness.element('mcu-panel').hidden, true);
  assert.equal(harness.element('configuration').hidden, false);

  harness.send({ type: 'state', state: baseState() });
  assert.equal(harness.element('mcu-panel').hidden, false);
  const generate = harness.element('generate-project');
  generate.dispatch('click', { target: generate });
  assert.equal(harness.posted.filter((message) => message.type === 'generateProject').length, 1);
});

test('sidebar stylesheet covers the required responsive layout without root overflow hiding', () => {
  for (const selector of [
    '.app-header',
    '.brand-mark',
    '.workspace-card',
    '.control-section',
    '.mode-switcher',
    '.configuration-panel',
    '.toggle-row',
    '.switch-track',
    '.status-dot',
    '.actions.busy',
    '.primary-action',
    '.advanced:not([open]) > .advanced-grid',
    '@media (min-width: 300px)',
    '@media (min-width: 420px)',
    '@media (max-width: 258px)',
    'prefers-reduced-motion'
  ]) {
    assert.ok(stylesheet.includes(selector), `missing ${selector}`);
  }
  assert.doesNotMatch(stylesheet, /url\((?:["']?https?:)/i);
  assert.doesNotMatch(stylesheet, /overflow-x:\s*hidden/);
  assert.doesNotMatch(stylesheet, /text-overflow:\s*ellipsis[\s\S]{0,40}(quick-action|secondary-action|primary-action)/);
  assert.match(stylesheet, /min-width:\s*0/);
  assert.match(stylesheet, /overflow-wrap:\s*anywhere/);
});

test('sidebar uses local inline mask icons', () => {
  for (const icon of [
    'folder',
    'chip',
    'device-desktop',
    'refresh',
    'play',
    'zap',
    'debug-alt',
    'settings-gear',
    'pass',
    'warning',
    'check',
    'code',
    'tools'
  ]) {
    assert.match(stylesheet, new RegExp(`data-icon="${icon}"`));
  }
  assert.match(stylesheet, /\.ui-icon/);
  assert.match(stylesheet, /data:image\/svg\+xml/);
  assert.doesNotMatch(stylesheet, /\[image omitted\]/);
  for (const block of stylesheet.matchAll(/--icon:\s*url\("([^"]+)"\)/g)) {
    assert.match(block[1], /^data:image\/svg\+xml,/, 'mask icons must be inline data URLs');
  }
});

test('packages the reviewed sidebar assets into the compiled extension output', () => {
  const compiledRoot = join(__dirname, '..', 'sidebar', 'webview');
  assert.equal(readFileSync(join(compiledRoot, 'main.js'), 'utf8'), scriptSource);
  assert.equal(readFileSync(join(compiledRoot, 'main.css'), 'utf8'), stylesheet);
});
