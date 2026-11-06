import assert from 'node:assert/strict';
import test from 'node:test';
import { renderSidebarHtml } from '../sidebar/html';

const webview = {
  cspSource: 'vscode-webview:',
  asWebviewUri(uri: unknown): unknown {
    const file = uri as { path: string };
    return `vscode-webview-resource:${file.path}`;
  }
};
interface TestUri {
  path: string;
  with(changed: { path: string }): TestUri;
}

const extensionUri: TestUri = {
  path: '/C:/extension',
  with(changed: { path: string }): TestUri {
    return { ...extensionUri, ...changed };
  }
};

test('renders a CSP-safe sidebar shell with local assets', () => {
  const html = renderSidebarHtml(webview, extensionUri, 'nonce123');

  assert.match(html, /default-src 'none'/);
  assert.match(html, /script-src 'nonce-nonce123'/);
  assert.match(html, /img-src vscode-webview: data:/);
  assert.match(html, /main\.css/);
  assert.match(html, /main\.js/);
  assert.match(html, /id="mode-mcu"/);
  assert.match(html, /id="mode-linux"/);
  assert.match(html, /id="mode-native"/);
  assert.match(html, /id="project-root"/);
  assert.match(html, /aria-label="目标工程"/);
  assert.match(html, /id="generate-project"/);
  assert.match(html, /id="generation-status"/);
  assert.match(html, /id="cancel-workspace-scan"/);
  assert.match(html, /data-command="cancelWorkspaceScan"/);
  assert.match(html, /data-always-enabled="true"/);
  assert.match(html, /id="cancel-workspace-scan"[^>]*hidden/);
  assert.match(html, /id="cancel-workspace-scan"[^>]*data-always-enabled="true"/);
  assert.doesNotMatch(html, /scan-environment/);
  assert.doesNotMatch(html, /扫描环境/);
  assert.doesNotMatch(html, /id="toolchain-actions"/);
  assert.doesNotMatch(html, /https?:\/\//);
});

test('does not render the extension-owned ARM path or CMake build controls', () => {
  const html = renderSidebarHtml(webview, extensionUri, 'nonce123');

  assert.doesNotMatch(html, /arm-toolchain-title|arm-gcc-path|browse-arm-toolchain|arm-gcc-status/);
  assert.doesNotMatch(html, /id="build-project"|data-command="buildProject"/);
});

test('presents Pack selection as the MCU target flow instead of a manual import action', () => {
  const html = renderSidebarHtml(webview, extensionUri, 'nonce123');

  assert.match(html, /id="target-host"/);
  assert.match(html, /id="pack-catalog-notice"/);
  assert.doesNotMatch(html, /id="import-pack-any"|data-command="importPack"/);
});

test('renders the Chinese default titles', () => {
  const html = renderSidebarHtml(webview, extensionUri, 'nonce123');

  assert.match(html, /CMake 工程生成/);
  assert.match(html, /生成工程/);
  assert.match(html, /扫描工作区/);
  assert.match(html, /取消扫描/);
});

test('renders no placeholder action container without a command', () => {
  const html = renderSidebarHtml(webview, extensionUri, 'nonce123');

  assert.doesNotMatch(html, /id="mode-actions"/);
  assert.doesNotMatch(html, /class="section-actions"/);
});
