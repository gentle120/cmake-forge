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
  mcu: { vendor: string; series: string; part: string };
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
  series: Array<{ value: string; label: string }>;
  devices: Array<{ value: string; label: string; description?: string; detail?: string }>;
  flashTargets: Array<{ value: string; label: string }>;
  flashProbes: Array<{ value: string; label: string }>;
  flashBackends: Array<{ value: string; label: string }>;
  linuxToolchains: Array<{ value: string; label: string }>;
  armToolchain: { binDir: string; state: 'path' | 'ready' | 'missing'; message: string };
  selection: SidebarSelection;
}

function baseState(overrides: Partial<SidebarState> = {}): SidebarState {
  return {
    workspaceName: 'demo',
    projects: [{ value: '', label: 'demo' }],
    projectRoot: '',
    discoveringProjects: false,
    vendors: [{ value: 'STM', label: 'ST' }],
    series: [{ value: 'F1x', label: 'STM32F1' }],
    devices: [{ value: 'STM32F103C8T6', label: 'STM32F103C8T6', description: 'STM32F1', detail: '64 KB Flash' }],
    flashTargets: [{ value: 'stm32f1xx', label: 'STM32F1' }],
    flashProbes: [{ value: 'stlink', label: 'ST-Link' }],
    flashBackends: [{ value: 'openocd', label: 'OpenOCD' }, { value: 'jlink', label: 'J-Link' }],
    linuxToolchains: [{ value: 'loongson', label: 'Loongson' }],
    armToolchain: { binDir: '', state: 'path', message: '使用 PATH' },
    selection: {
      mode: 'mcu',
      mcu: { vendor: 'STM', series: 'F1x', part: 'STM32F103C8T6' },
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
    'setArmToolchainPath',
    'browseArmToolchain',
    'scanEnvironment',
    'importPack',
    'scanWorkspace',
    'generateProject',
    'generateFlashScript',
    'generateDebugConfiguration',
    'buildProject',
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
    ['browseArmToolchain', 'buildProject', 'generateDebugConfiguration',
      'generateFlashScript', 'generateProject', 'importPack', 'scanEnvironment', 'scanWorkspace']
  );
  // One delegated listener owns the static commands; no per-button wiring remains.
  const catalogListeners = [...scriptSource.matchAll(/app\.addEventListener\('click'/g)];
  assert.equal(catalogListeners.length, 1, 'command buttons must share one delegated listener');
});

test('GCC input commits once on Enter and once on changed blur', () => {
  const harness = startSidebar(baseState());
  const input = harness.element('arm-gcc-path');
  input.value = 'C:/Program Files (x86)/Arm GNU/bin';

  input.dispatch('keydown', { key: 'Enter' });
  const submits = harness.posted.filter((message) => message.type === 'setArmToolchainPath');
  assert.deepEqual(submits, [{ type: 'setArmToolchainPath', path: 'C:/Program Files (x86)/Arm GNU/bin' }]);

  harness.send({ type: 'operationFinished', result: { ok: true, message: 'saved', files: [] } });
  assert.equal(harness.posted.filter((message) => message.type === 'setArmToolchainPath').length, 1);

  input.dispatch('focusout', { relatedTarget: undefined });
  assert.equal(
    harness.posted.filter((message) => message.type === 'setArmToolchainPath').length,
    1,
    'an unchanged field must not resubmit on blur'
  );

  input.value = 'D:/arm/bin';
  input.dispatch('input');
  input.dispatch('focusout', { relatedTarget: undefined });
  assert.deepEqual(harness.posted.filter((message) => message.type === 'setArmToolchainPath').at(-1), {
    type: 'setArmToolchainPath',
    path: 'D:/arm/bin'
  });
});

test('Browse never commits the stale draft behind the host folder picker', () => {
  const harness = startSidebar(baseState());
  const input = harness.element('arm-gcc-path');
  const browse = harness.element('browse-arm-toolchain');
  input.value = 'E:/draft-only';
  input.dispatch('input');

  browse.dispatch('pointerdown');
  input.dispatch('focusout', { relatedTarget: browse });
  browse.dispatch('click', { target: browse });
  // The pointer gesture ends while the host chooser owns focus.
  harness.element('app').ownerDocument.activeElement = undefined;

  assert.equal(
    harness.posted.filter((message) => message.type === 'setArmToolchainPath').length,
    0,
    'browse must not submit the stale draft'
  );
  assert.equal(harness.posted.filter((message) => message.type === 'browseArmToolchain').length, 1);
});

test('unsaved GCC draft survives refreshes, and a rejected save keeps the draft', () => {
  const harness = startSidebar(baseState());
  const input = harness.element('arm-gcc-path');
  input.value = 'F:/typed/draft';
  input.dispatch('input');
  harness.document.activeElement = input;

  harness.send({ type: 'state', state: baseState({
    armToolchain: { binDir: 'C:/stored/bin', state: 'ready', message: '已找到 ARM GCC' }
  }) });
  assert.equal(input.value, 'F:/typed/draft', 'a focused draft must not be overwritten');
  assert.equal(harness.element('arm-gcc-status').getAttribute('data-state'), 'ready');

  input.dispatch('focusout', { relatedTarget: harness.element('scan-environment') });
  harness.send({ type: 'operationFinished', result: { ok: false, message: '目录不完整', files: [] } });
  harness.send({ type: 'state', state: baseState({
    armToolchain: { binDir: 'C:/stored/bin', state: 'ready', message: '已找到 ARM GCC' }
  }) });
  assert.equal(input.value, 'F:/typed/draft', 'a rejected save must not replace or discard the draft');
  assert.equal(harness.element('arm-gcc-notice').textContent, '目录不完整');

});

test('authoritative state fills the GCC field when there is no unsaved draft', () => {
  const harness = startSidebar(baseState());
  const input = harness.element('arm-gcc-path');
  harness.send({ type: 'state', state: baseState({
    armToolchain: { binDir: 'C:/stored/bin', state: 'ready', message: '已找到 ARM GCC' }
  }) });
  assert.equal(input.value, 'C:/stored/bin');
  assert.equal(harness.element('arm-gcc-status').getAttribute('data-state'), 'ready');
  assert.equal(harness.element('arm-gcc-status').querySelector('.toolchain-title')?.textContent,
    '工具文件已找到');
});

test('busy state guards duplicate commands and reports cancellation neutrally', () => {
  const harness = startSidebar(baseState());
  const generate = harness.element('generate-project');
  const build = harness.element('build-project');
  const browse = harness.element('browse-arm-toolchain');

  generate.dispatch('click', { target: generate });
  generate.dispatch('click', { target: generate });
  build.dispatch('click', { target: build });
  assert.equal(harness.posted.filter((message) => message.type === 'generateProject').length, 1);
  assert.equal(harness.posted.filter((message) => message.type === 'buildProject').length, 0);
  assert.equal(harness.element('app').getAttribute('aria-busy'), 'true');
  assert.equal(browse.disabled, true);

  harness.send({ type: 'operationFinished', result: { ok: false, cancelled: true, message: '已取消', files: [] } });
  assert.equal(harness.element('app').getAttribute('aria-busy'), 'false');
  assert.equal(harness.element('generation-status').className, 'status-badge cancelled');
  assert.equal(harness.element('operation-notice').textContent, '已取消');
  assert.equal(browse.disabled, false);

  build.dispatch('click', { target: build });
  assert.equal(harness.posted.filter((message) => message.type === 'buildProject').length, 1);
});

test('failure messages stay visible and focus returns to the initiating control', () => {
  const harness = startSidebar(baseState());
  const importPack = harness.element('import-pack');
  importPack.dispatch('click', { target: importPack });
  harness.send({
    type: 'operationFinished',
    result: { ok: false, message: 'Pack 导入失败：文件损坏', files: [] }
  });

  assert.equal(harness.element('generation-status').className, 'status-badge error');
  const notice = harness.element('operation-notice');
  assert.equal(notice.hidden, false);
  assert.equal(notice.textContent, 'Pack 导入失败：文件损坏');
  assert.equal(harness.document.activeElement, importPack);
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
  assert.equal(harness.element('build-project').hidden, true);

  harness.send({ type: 'state', state: baseState() });
  assert.equal(harness.element('mcu-panel').hidden, false);
  assert.equal(harness.element('build-project').hidden, false);
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
    '.toolchain-status',
    '.toolchain-notice',
    '.path-row',
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

test('sidebar uses local inline mask icons including tools and package', () => {
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
    'tools',
    'package'
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
