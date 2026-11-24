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
          <span class="brand-kicker">CMake Forge</span>
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

      <section class="control-section environment-section" aria-labelledby="environment-title">
        <div class="section-header">
          <span class="section-icon"><span class="ui-icon" data-icon="tool" aria-hidden="true"></span></span>
          <div class="section-heading">
            <h2 id="environment-title">编译与烧录工具</h2>
            <p>只使用 ARM GNU 工具链与 OpenOCD；缺少时点「下载」，无需自己找安装包。</p>
          </div>
        </div>
        <div id="environment" class="environment" aria-live="polite">
          <div class="env-row" id="env-armgcc">
            <span class="env-name">ARM GNU 工具链</span>
            <span id="env-armgcc-detail" class="env-detail">检测中…</span>
            <button id="env-armgcc-install" class="secondary-action" type="button" data-command="installArmGcc">下载</button>
          </div>
          <div class="env-row" id="env-openocd">
            <span class="env-name">OpenOCD</span>
            <span id="env-openocd-detail" class="env-detail">检测中…</span>
            <button id="env-openocd-install" class="secondary-action" type="button" data-command="installOpenOcd">下载</button>
          </div>
          <div id="env-progress" class="env-progress" hidden>
            <div class="env-progress-track"><div id="env-progress-bar" class="env-progress-bar"></div></div>
            <span id="env-progress-text" class="env-progress-text"></span>
          </div>
        </div>
      </section>

      <section class="control-section flash-section" aria-labelledby="flash-title">
        <div class="section-header">
          <span class="section-icon"><span class="ui-icon" data-icon="zap" aria-hidden="true"></span></span>
          <div class="section-heading">
            <h2 id="flash-title">烧录与调试</h2>
            <p>检测探针读芯片型号、选固件后一键烧录，调试配置同时生成好。</p>
          </div>
        </div>
        <div id="flash-host" class="flash-host"></div>
        <div id="flash-detection" class="flash-detection" aria-live="polite">
          <div class="flash-detect-row">
            <span class="flash-detect-key">固件</span>
            <span id="flash-firmware" class="flash-detect-value">尚未检测</span>
            <button id="flash-pick-firmware" class="link-action" type="button" data-command="pickFirmware">选择…</button>
          </div>
          <div class="flash-detect-row">
            <span class="flash-detect-key">目标</span>
            <span id="flash-target-label" class="flash-detect-value">—</span>
          </div>
          <div class="flash-detect-row">
            <span class="flash-detect-key">探针</span>
            <span id="flash-probe-label" class="flash-detect-value">—</span>
          </div>
          <div class="flash-detect-row">
            <span class="flash-detect-key">芯片</span>
            <span id="flash-chip-label" class="flash-detect-value">未检测</span>
          </div>
          <p id="flash-firmware-detail" class="field-detail"></p>
          <p id="flash-blocked" class="field-detail" data-tone="warning" role="alert" hidden></p>
        </div>
        <div class="flash-options">
          <label class="flash-option">
            <input id="flash-verify" type="checkbox" checked><span>烧录后校验</span>
          </label>
          <label class="flash-option">
            <input id="flash-reset" type="checkbox" checked><span>完成后复位运行</span>
          </label>
          <button id="flash-redetect" class="secondary-action compact" type="button" data-command="detectFlash">
            <span class="ui-icon" data-icon="refresh" aria-hidden="true"></span><span>检测探针</span>
          </button>
        </div>
        <div id="flash-progress" class="flash-progress" hidden>
          <div class="flash-progress-track"><div id="flash-progress-bar" class="flash-progress-bar"></div></div>
          <p id="flash-progress-text" class="flash-progress-text" role="status" aria-live="polite"></p>
        </div>
        <div class="quick-actions">
          <button id="quick-flash" class="quick-action primary" type="button" data-command="flash">
            <span class="ui-icon" data-icon="zap" aria-hidden="true"></span><span>烧录</span>
          </button>
          <button id="cancel-flash" class="quick-action" type="button" data-command="cancelFlash"
            data-always-enabled="true" hidden>
            <span class="ui-icon" data-icon="cancel" aria-hidden="true"></span><span>取消烧录</span>
          </button>
          <button id="quick-debug" class="quick-action" type="button" data-command="generateDebugConfiguration">
            <span class="ui-icon" data-icon="debug-alt" aria-hidden="true"></span><span>调试配置</span>
          </button>
        </div>
        <details id="flash-output-details" class="advanced" hidden>
          <summary>
            <span class="details-title">烧录输出</span>
            <span id="flash-output-hint" class="summary-hint"></span>
          </summary>
          <pre id="flash-output" class="flash-output"></pre>
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
