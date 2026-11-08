import { existsSync } from 'node:fs';
import { join } from 'node:path';

interface WebviewUriApi {
  cspSource: string;
  asWebviewUri(uri: unknown): unknown;
}

interface WebviewUri {
  path: string;
  with(changed: { path: string }): WebviewUri;
}

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export function renderSidebarHtml(
  webview: WebviewUriApi,
  extensionUri: WebviewUri,
  nonce: string
): string {
  // The compiled copy under out/sidebar is authoritative (scripts/copy-sidebar-assets.js
  // keeps it byte-identical to src). Falling back to src would silently serve
  // stale assets if the copy step ever fails, so the location is probed once.
  const runtimeRoot = existsSync(join(__dirname, 'webview', 'main.js'))
    ? 'out/sidebar'
    : 'src/sidebar';
  const stylesheet = escapeAttribute(String(webview.asWebviewUri(
    extensionUri.with({
      path: `${extensionUri.path}/${runtimeRoot}/webview/main.css`
    })
  )));
  const script = escapeAttribute(String(webview.asWebviewUri(
    extensionUri.with({
      path: `${extensionUri.path}/${runtimeRoot}/webview/main.js`
    })
  )));
  const source = escapeAttribute(webview.cspSource);
  const safeNonce = escapeAttribute(nonce);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${source}; img-src ${source} data:; font-src ${source}; script-src 'nonce-${safeNonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${stylesheet}">
  <title>CMake 工程生成</title>
</head>
<body>
  <main id="app" aria-busy="false">
    <header class="app-header">
      <div class="brand">
        <div class="brand-mark" aria-hidden="true">
          <span class="ui-icon" data-icon="chip"></span>
        </div>
        <div class="brand-copy">
          <span class="brand-kicker">CMake-Embedded</span>
          <h1>工程生成台</h1>
        </div>
      </div>
      <span id="generation-status" class="status-badge" role="status" aria-live="polite">
        <span class="status-dot"></span><span class="status-text">就绪</span>
      </span>
    </header>
    <section id="mode-switcher" class="mode-switcher" aria-label="工程类型">
      <button id="mode-mcu" class="mode-button" type="button" aria-pressed="true">
        <span class="ui-icon" data-icon="chip" aria-hidden="true"></span><span>MCU 固件</span>
      </button>
      <button id="mode-linux" class="mode-button" type="button" aria-pressed="false">
        <span class="ui-icon" data-icon="device-desktop" aria-hidden="true"></span><span>Linux / SoC</span>
      </button>
      <button id="mode-native" class="mode-button" type="button" aria-pressed="false">
        <span class="ui-icon" data-icon="code" aria-hidden="true"></span><span>桌面 C/C++</span>
      </button>
    </section>
    <section class="workspace-card" aria-label="当前工作区">
      <span class="ui-icon" data-icon="folder" aria-hidden="true"></span>
      <div class="workspace-picker">
        <label for="project-root">目标工程</label>
        <select id="project-root" aria-label="目标工程">
          <option value="">正在发现工程</option>
        </select>
        <small id="workspace-name" class="workspace-name">正在读取工作区</small>
      </div>
    </section>

    <section id="mcu-panel" class="configuration-panel" aria-label="MCU 配置" hidden>
      <section class="control-section target-section" aria-labelledby="target-title">
        <div class="section-header">
          <span class="section-icon"><span class="ui-icon" data-icon="chip" aria-hidden="true"></span></span>
          <div class="section-heading">
            <h2 id="target-title">目标配置</h2>
            <p>先选厂商与系列，再确定 Pack 与型号。</p>
          </div>
        </div>
        <div id="target-host" class="target-host"></div>
        <div class="pack-actions">
          <button id="import-pack" class="secondary-action compact" type="button" data-command="importPack">
            <span class="ui-icon" data-icon="folder" aria-hidden="true"></span><span>导入 Pack 包…</span>
          </button>
          <button id="install-pack-online" class="secondary-action compact" type="button" data-command="installPackOnline">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span><span>在线安装 Pack…</span>
          </button>
          <button id="install-core-pack" class="secondary-action compact" type="button" data-command="installCorePack">
            <span class="ui-icon" data-icon="chip" aria-hidden="true"></span><span>安装内核包…</span>
          </button>
        </div>
        <p id="mcu-blocked-notice" class="operation-notice" data-tone="warning" role="alert" hidden></p>
        <p id="pack-catalog-notice" class="field-detail" role="status" aria-live="polite" hidden></p>
        <p id="core-pack-notice" class="field-detail" role="status" aria-live="polite" hidden></p>
        <div id="core-pack-host" class="core-pack-host"></div>
        <div class="toggle-list">
          <label class="toggle-row">
            <span class="toggle-leading">
              <span class="ui-icon" data-icon="chip" aria-hidden="true"></span>
              <span class="toggle-copy">
                <span class="toggle-title">生成内核包 include</span>
                <small class="field-detail">生成时把 CMSIS 内核头文件复制进工程 CMSIS/Include</small>
              </span>
            </span>
            <span class="switch-track">
              <input id="toggle-core-pack" class="switch-input" type="checkbox"><span></span>
            </span>
          </label>
        </div>
      </section>

      <section class="control-section flash-section" aria-labelledby="flash-title">
        <div class="section-header">
          <span class="section-icon"><span class="ui-icon" data-icon="zap" aria-hidden="true"></span></span>
          <div class="section-heading">
            <h2 id="flash-title">烧录与调试</h2>
            <p>选择后端与探针，可单独生成烧录脚本或调试配置。</p>
          </div>
        </div>
        <div id="flash-host" class="flash-host"></div>
        <div class="quick-actions">
          <button id="quick-flash" class="quick-action" type="button" data-command="generateFlashScript">
            <span class="ui-icon" data-icon="zap" aria-hidden="true"></span><span>生成 flash.py</span>
          </button>
          <button id="quick-debug" class="quick-action" type="button" data-command="generateDebugConfiguration">
            <span class="ui-icon" data-icon="debug-alt" aria-hidden="true"></span><span>生成 Debug 配置</span>
          </button>
        </div>
        <details id="backend-details" class="advanced">
          <summary>
            <span class="ui-icon" data-icon="settings-gear" aria-hidden="true"></span>
            <span class="details-title">后端细节</span>
            <span id="backend-hint" class="summary-hint"></span>
          </summary>
          <div id="backend-details-host" class="advanced-grid"></div>
        </details>
      </section>
    </section>

    <section id="configuration" class="configuration" aria-label="生成配置"></section>

    <section id="workspace-section" class="control-section workspace-section" aria-labelledby="workspace-title">
      <div id="workspace-head" class="workspace-head">
        <h2 id="workspace-title">工作区</h2>
        <button id="scan-workspace" class="secondary-action compact" type="button" data-command="scanWorkspace">
          <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span><span>扫描工作区</span>
        </button>
        <button id="cancel-workspace-scan" class="secondary-action compact" type="button"
          data-command="cancelWorkspaceScan" data-always-enabled="true" hidden>
          <span class="ui-icon" data-icon="cancel" aria-hidden="true"></span><span>取消扫描</span>
        </button>
      </div>
      <p id="workspace-summary" class="workspace-summary" aria-live="polite">尚未扫描工作区</p>
    </section>

    <section id="result-region" class="result-region" hidden>
      <h2>已生成文件</h2>
      <div id="generated-files" class="file-tree"></div>
    </section>

    <p id="operation-notice" class="operation-notice" role="alert" hidden></p>

    <footer id="actions" class="actions">
      <button id="generate-project" class="primary-action" type="button" data-command="generateProject">
        <span class="ui-icon" data-icon="play" aria-hidden="true"></span><span>生成工程</span>
      </button>
    </footer>
  </main>
  <script nonce="${safeNonce}" src="${script}"></script>
</body>
</html>`;
}
