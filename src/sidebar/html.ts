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
      <span id="workspace-name" class="workspace-name">正在读取工作区</span>
    </section>

    <section id="mcu-panel" class="configuration-panel" aria-label="MCU 配置" hidden>
      <section class="control-section toolchain-section" aria-labelledby="arm-toolchain-title">
        <div class="section-header">
          <span class="ui-icon" data-icon="tools" aria-hidden="true"></span>
          <div class="section-heading">
            <h2 id="arm-toolchain-title">ARM GNU GCC</h2>
            <p>指定已安装的 ARM GNU 工具链，生成与调试共用该目录。</p>
          </div>
        </div>
        <div class="path-field">
          <label class="field-label" for="arm-gcc-path">工具链 bin 目录</label>
          <div class="path-row">
            <input id="arm-gcc-path" class="path-input" type="text" spellcheck="false" autocomplete="off"
              autocapitalize="off" placeholder="留空使用 PATH">
            <button id="browse-arm-toolchain" class="secondary-action compact" type="button" data-command="browseArmToolchain">
              <span class="ui-icon" data-icon="folder" aria-hidden="true"></span><span>浏览…</span>
            </button>
          </div>
          <p id="arm-gcc-hint" class="field-detail">留空使用 PATH；输入后按 Enter 或移出输入框保存。</p>
        </div>
        <div id="arm-gcc-status" class="toolchain-status" data-state="path" role="status" aria-live="polite">
          <span class="ui-icon" data-icon="folder" aria-hidden="true"></span>
          <div class="toolchain-copy">
            <strong class="toolchain-title">使用 PATH</strong>
            <span class="toolchain-message"></span>
          </div>
        </div>
        <p id="arm-gcc-notice" class="toolchain-notice" role="alert" hidden></p>
        <div id="toolchain-actions" class="section-actions">
          <button id="scan-environment" class="secondary-action" type="button" data-command="scanEnvironment">
            <span class="ui-icon" data-icon="tools" aria-hidden="true"></span><span>扫描环境</span>
          </button>
        </div>
      </section>

      <section class="control-section target-section" aria-labelledby="target-title">
        <div class="section-header">
          <span class="ui-icon" data-icon="chip" aria-hidden="true"></span>
          <div class="section-heading">
            <h2 id="target-title">目标配置</h2>
            <p>先导入可选 CMSIS Pack，再选择厂商、系列与型号。</p>
          </div>
        </div>
        <div id="target-actions" class="section-actions">
          <button id="import-pack" class="secondary-action" type="button" data-command="importPack">
            <span class="ui-icon" data-icon="package" aria-hidden="true"></span><span>导入 Pack</span>
          </button>
        </div>
        <div id="target-host" class="target-host"></div>
      </section>

      <section class="control-section flash-section" aria-labelledby="flash-title">
        <div class="section-header">
          <span class="ui-icon" data-icon="zap" aria-hidden="true"></span>
          <div class="section-heading">
            <h2 id="flash-title">烧录与调试</h2>
            <p>选择后端与探针；生成工程不会编译，也不会烧录硬件。</p>
          </div>
        </div>
        <div class="toggle-list">
          <label class="toggle-row">
            <span class="toggle-leading">
              <span class="ui-icon" data-icon="zap" aria-hidden="true"></span>
              <span class="toggle-copy">
                <span class="toggle-title">生成 flash.py</span>
                <small class="field-detail">按所选后端生成烧录脚本</small>
              </span>
            </span>
            <span class="switch-track">
              <input id="toggle-flash" class="switch-input" type="checkbox"><span></span>
            </span>
          </label>
          <label class="toggle-row">
            <span class="toggle-leading">
              <span class="ui-icon" data-icon="debug-alt" aria-hidden="true"></span>
              <span class="toggle-copy">
                <span class="toggle-title">Cortex-Debug</span>
                <small class="field-detail">launch.json 调试配置</small>
              </span>
            </span>
            <span class="switch-track">
              <input id="toggle-debug" class="switch-input" type="checkbox"><span></span>
            </span>
          </label>
        </div>
        <div id="flash-host" class="flash-host"></div>
        <div class="quick-actions">
          <button id="quick-flash" class="quick-action" type="button" data-command="generateFlashScript">
            <span class="ui-icon" data-icon="zap" aria-hidden="true"></span><span>仅 flash.py</span>
          </button>
          <button id="quick-debug" class="quick-action" type="button" data-command="generateDebugConfiguration">
            <span class="ui-icon" data-icon="debug-alt" aria-hidden="true"></span><span>仅 Debug</span>
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
      </div>
      <p id="workspace-summary" class="workspace-summary" aria-live="polite">尚未扫描工作区</p>
      <div id="mode-actions" class="section-actions">
        <button id="scan-environment-any" class="secondary-action" type="button" data-command="scanEnvironment">
          <span class="ui-icon" data-icon="tools" aria-hidden="true"></span><span>扫描环境</span>
        </button>
        <button id="import-pack-any" class="secondary-action" type="button" data-command="importPack">
          <span class="ui-icon" data-icon="package" aria-hidden="true"></span><span>导入 Pack</span>
        </button>
      </div>
    </section>

    <section id="result-region" class="result-region" hidden>
      <h2>已生成文件</h2>
      <ul id="generated-files"></ul>
    </section>

    <p id="operation-notice" class="operation-notice" role="alert" hidden></p>

    <footer id="actions" class="actions">
      <button id="generate-project" class="primary-action" type="button" data-command="generateProject">
        <span class="ui-icon" data-icon="play" aria-hidden="true"></span><span>生成工程</span>
      </button>
      <button id="build-project" class="secondary-action" type="button" data-command="buildProject">
        <span class="ui-icon" data-icon="play" aria-hidden="true"></span><span>构建…</span>
      </button>
    </footer>
  </main>
  <script nonce="${safeNonce}" src="${script}"></script>
</body>
</html>`;
}
