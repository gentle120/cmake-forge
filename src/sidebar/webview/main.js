(function () {
  const vscode = acquireVsCodeApi();
  let state;
  let busy = false;
  let initiator = null;
  let activeOperation = '';
  let cancelRequested = false;

  const app = document.getElementById('app');
  const workspaceName = document.getElementById('workspace-name');
  const projectRootSelect = document.getElementById('project-root');
  const statusBadge = document.getElementById('generation-status');
  const statusTextNode = statusBadge.querySelector('.status-text');
  const actionsEl = document.getElementById('actions');
  const modeMcu = document.getElementById('mode-mcu');
  const modeLinux = document.getElementById('mode-linux');
  const modeNative = document.getElementById('mode-native');
  const mcuPanel = document.getElementById('mcu-panel');
  const configuration = document.getElementById('configuration');
  const workspaceSummary = document.getElementById('workspace-summary');
  const cancelWorkspaceScanButton = document.getElementById('cancel-workspace-scan');
  const operationNotice = document.getElementById('operation-notice');
  const resultRegion = document.getElementById('result-region');
  const generatedFiles = document.getElementById('generated-files');
  const toggleFlash = document.getElementById('toggle-flash');
  const toggleDebug = document.getElementById('toggle-debug');
  const backendHint = document.getElementById('backend-hint');

  function post(message) {
    vscode.postMessage(message);
  }

  function icon(name) {
    const element = document.createElement('span');
    element.className = 'ui-icon';
    element.dataset.icon = name;
    element.setAttribute('aria-hidden', 'true');
    return element;
  }

  function setIcon(element, name) {
    if (element && element.dataset.icon !== name) {
      element.dataset.icon = name;
    }
  }

  function paragraph(className, text) {
    const element = document.createElement('p');
    element.className = className;
    element.textContent = text;
    return element;
  }

  function sectionHeader(title, description, iconName) {
    const header = document.createElement('div');
    header.className = 'section-header';
    if (iconName) {
      header.append(icon(iconName));
    }
    const copy = document.createElement('div');
    copy.className = 'section-heading';
    const heading = document.createElement('h2');
    heading.textContent = title;
    copy.append(heading);
    if (description) {
      copy.append(paragraph('', description));
    }
    header.append(copy);
    return header;
  }

  function fillOptions(select, options) {
    const list = Array.isArray(options) ? options : [];
    const signature = list.map((item) => String(item.value)).join('\u0000');
    if (select.dataset.signature === signature) {
      return;
    }
    select.replaceChildren();
    list.forEach((item) => {
      const element = document.createElement('option');
      element.value = String(item.value);
      element.textContent = item.label ?? String(item.value);
      if (item.description) element.title = item.description;
      select.append(element);
    });
    select.dataset.signature = signature;
  }

  function applyOptions(select, options, value) {
    fillOptions(select, options);
    const values = Array.isArray(options) ? options.map((item) => String(item.value)) : [];
    const next = values.includes(String(value)) ? String(value) : values[0] ?? '';
    if (select.value !== next) {
      select.value = next;
    }
  }

  function createSelectField(labelText, onChange) {
    const wrapper = document.createElement('label');
    wrapper.className = 'field';
    const caption = document.createElement('span');
    caption.className = 'field-label';
    caption.textContent = labelText;
    const select = document.createElement('select');
    select.addEventListener('change', () => {
      if (busy) return;
      onChange(select.value);
    });
    wrapper.append(caption, select);
    return { wrapper, select };
  }

  function createPathField(labelText, placeholderText, onChange) {
    const wrapper = document.createElement('label');
    wrapper.className = 'field';
    const caption = document.createElement('span');
    caption.className = 'field-label';
    caption.textContent = labelText;
    const input = document.createElement('input');
    input.type = 'text';
    input.spellcheck = false;
    input.autocomplete = 'off';
    input.placeholder = placeholderText;
    input.addEventListener('change', () => {
      if (busy) return;
      onChange(input.value);
    });
    wrapper.append(caption, input);
    return { wrapper, input };
  }

  function selectedOption(options, value) {
    return (Array.isArray(options) ? options : []).find((item) => String(item.value) === String(value));
  }

  function toggleRow(label, description, iconName) {
    const row = document.createElement('label');
    row.className = 'toggle-row';
    const leading = document.createElement('span');
    leading.className = 'toggle-leading';
    leading.append(icon(iconName));
    const copy = document.createElement('span');
    copy.className = 'toggle-copy';
    const title = document.createElement('span');
    title.className = 'toggle-title';
    title.textContent = label;
    copy.append(title, paragraph('field-detail', description));
    leading.append(copy);
    const track = document.createElement('span');
    track.className = 'switch-track';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'switch-input';
    track.append(checkbox, document.createElement('span'));
    row.append(leading, track);
    return { row, checkbox };
  }

  // --- MCU section wiring (created once, then only synced) ---

  const targetHost = document.getElementById('target-host');
  const packCatalogNotice = document.getElementById('pack-catalog-notice');
  const corePackNotice = document.getElementById('core-pack-notice');
  const packCatalogBusy = document.createElement('p');
  packCatalogBusy.className = 'field-detail';
  packCatalogBusy.setAttribute('role', 'status');
  packCatalogBusy.setAttribute('aria-live', 'polite');
  packCatalogBusy.textContent = '正在读取 Pack 目录…';
  packCatalogBusy.hidden = true;
  const flashHost = document.getElementById('flash-host');
  const backendDetailsHost = document.getElementById('backend-details-host');

  const vendorField = createSelectField('厂商', (value) => {
    if (!state) return;
    saveSelection({ ...state.selection, mcu: { ...state.selection.mcu, vendor: value } });
  });
  const seriesField = createSelectField('系列', (value) => {
    if (!state) return;
    saveSelection({ ...state.selection, mcu: { ...state.selection.mcu, series: value } });
  });
  const packField = createSelectField('芯片支持包 / Pack', (value) => {
    if (!state) return;
    post({ type: 'selectPack', packId: value });
  });
  const versionField = createSelectField('版本', (value) => {
    if (!state) return;
    const selectedVersion = (state.versions || []).find((option) =>
      String(option.value) === String(value)
    );
    if (selectedVersion?.description === 'installed'
      && state.selection.mcu.packId === state.pendingPackId
      && state.selection.mcu.version === value) {
      return;
    }
    if (!startOperation(versionField.select, '正在准备芯片支持包')) return;
    post({
      type: 'activatePack',
      packId: state.pendingPackId || state.selection.mcu.packId,
      version: value
    });
  });
  const deviceField = createSelectField('型号', (value) => {
    if (!state) return;
    saveSelection({ ...state.selection, mcu: { ...state.selection.mcu, part: value } });
  });
  const deviceSummary = document.createElement('div');
  deviceSummary.className = 'device-summary';
  const deviceName = document.createElement('strong');
  const deviceMeta = document.createElement('span');
  deviceSummary.append(deviceName, deviceMeta);
  targetHost.append(
    vendorField.wrapper,
    seriesField.wrapper,
    packField.wrapper,
    versionField.wrapper,
    deviceField.wrapper,
    deviceSummary,
    packCatalogBusy
  );

  const backendField = createSelectField('烧录后端', (value) => {
    if (!state) return;
    saveSelection({ ...state.selection, flash: { ...state.selection.flash, backend: value } });
  });
  const probeField = createSelectField('调试探针', (value) => {
    if (!state) return;
    saveSelection({ ...state.selection, flash: { ...state.selection.flash, probeId: value } });
  });
  flashHost.append(backendField.wrapper, probeField.wrapper);

  const openocdGroup = document.createElement('div');
  openocdGroup.className = 'details-group';
  const targetField = createSelectField('烧录 target cfg', (value) => {
    if (!state) return;
    saveSelection({ ...state.selection, flash: { ...state.selection.flash, targetId: value } });
  });
  const openocdPathField = createPathField('OpenOCD 可执行文件', 'openocd', (value) => {
    if (!state) return;
    saveSelection({ ...state.selection, flash: { ...state.selection.flash, openocdPath: value } });
  });
  openocdGroup.append(targetField.wrapper, openocdPathField.wrapper);

  const settingsGroup = document.createElement('div');
  settingsGroup.className = 'details-group';
  const settingsNote = paragraph('field-detail', '');
  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'secondary-action';
  settingsButton.append(icon('settings-gear'), document.createTextNode('打开工具设置'));
  settingsButton.addEventListener('click', () => {
    if (busy) return;
    post({ type: 'openSettings' });
  });
  settingsGroup.append(settingsNote, settingsButton);

  backendDetailsHost.append(openocdGroup, settingsGroup);

  const settingsNotes = {
    jlink: 'J-Link 路径由扩展设置 cmakeEmbedded.jlinkPath 提供，侧栏不保存该路径。',
    pyocd: 'pyOCD 路径由扩展设置 cmakeEmbedded.pyocdPath 提供，侧栏不保存该路径。'
  };

  function saveSelection(selection) {
    if (!state) return;
    state.selection = selection;
    post({ type: 'saveSelection', selection });
  }

  function syncTargetSection() {
    const selection = state.selection.mcu;
    applyOptions(vendorField.select, state.vendors, selection.vendor);
    applyOptions(packField.select, state.packs, state.pendingPackId || selection.packId);
    applyOptions(versionField.select, state.versions, selection.version);
    applyOptions(seriesField.select, state.series, selection.series);
    applyOptions(deviceField.select, state.devices, selection.part);
    const device = selectedOption(state.devices, selection.part);
    const meta = device
      ? [device.description, device.detail].filter(Boolean).join(' · ')
      : '';
    deviceName.textContent = selection.part || '';
    deviceMeta.textContent = meta;
    deviceSummary.hidden = !device;
    packCatalogNotice.textContent = state.packCatalogNotice || '';
    packCatalogNotice.hidden = !packCatalogNotice.textContent;
    corePackNotice.textContent = state.corePackNotice || '';
    corePackNotice.hidden = !corePackNotice.textContent;
    packCatalogBusy.hidden = !state.packCatalogLoading;
  }

  function syncFlashSection() {
    const flash = state.selection.flash;
    toggleFlash.checked = Boolean(flash.enabled);
    toggleDebug.checked = Boolean(state.selection.debugEnabled);
    applyOptions(backendField.select, state.flashBackends, flash.backend);
    applyOptions(probeField.select, state.flashProbes, flash.probeId);
    applyOptions(targetField.select, state.flashTargets, flash.targetId);
    if (openocdPathField.input.value !== flash.openocdPath
      && document.activeElement !== openocdPathField.input) {
      openocdPathField.input.value = flash.openocdPath || '';
    }
    const isOpenocd = flash.backend === 'openocd';
    openocdGroup.hidden = !isOpenocd;
    settingsGroup.hidden = isOpenocd;
    settingsNote.textContent = settingsNotes[flash.backend] || settingsNotes.jlink;
    const backend = selectedOption(state.flashBackends, flash.backend);
    const probe = selectedOption(state.flashProbes, flash.probeId);
    const hint = [backend?.label, probe?.label].filter(Boolean).join(' · ');
    backendHint.textContent = hint;
    backendHint.hidden = !hint;
  }

  // --- Linux and desktop panels: built once per mode, then synced ---

  let linuxPanel;
  let nativePanel;

  function ensureLinuxPanel() {
    if (linuxPanel) return linuxPanel;
    const panel = document.createElement('div');
    panel.className = 'configuration-panel';
    const section = document.createElement('section');
    section.className = 'control-section';
    section.append(sectionHeader('交叉工具链', '选择目标架构与编译器。', 'device-desktop'));
    const field = createSelectField('交叉工具链', (value) => {
      if (!state) return;
      saveSelection({ ...state.selection, linux: { ...state.selection.linux, toolchainFamily: value } });
    });
    section.append(field.wrapper);
    const status = document.createElement('div');
    status.className = 'toolchain-status';
    const statusIcon = icon('pass');
    const copy = document.createElement('div');
    copy.className = 'toolchain-copy';
    const name = document.createElement('strong');
    name.className = 'toolchain-title';
    const note = document.createElement('span');
    note.className = 'toolchain-message';
    copy.append(name, note);
    status.append(statusIcon, copy);
    panel.append(section, status);
    panel.append(paragraph('empty-note', '生成器会扫描工作区源文件、头文件目录和已保存的宏定义。'));
    linuxPanel = { panel, select: field.select, statusIcon, name, note };
    return linuxPanel;
  }

  function syncLinuxPanel() {
    const panel = ensureLinuxPanel();
    applyOptions(panel.select, state.linuxToolchains, state.selection.linux.toolchainFamily);
    const selected = selectedOption(state.linuxToolchains, state.selection.linux.toolchainFamily);
    setIcon(panel.statusIcon, selected && /Not found/i.test(selected.detail || '') ? 'warning' : 'pass');
    panel.name.textContent = selected ? (selected.description || selected.label) : '';
    panel.note.textContent = selected?.detail || '';
    return panel.panel;
  }

  function ensureNativePanel() {
    if (nativePanel) return nativePanel;
    const panel = document.createElement('div');
    panel.className = 'configuration-panel';
    const section = document.createElement('section');
    section.className = 'control-section';
    section.append(sectionHeader('桌面 C/C++', '使用本机编译器生成普通 CMake 工程。', 'code'));
    const targetType = createSelectField('目标类型', (value) => {
      if (!state) return;
      saveSelection({ ...state.selection, native: { ...state.selection.native, targetType: value } });
    });
    applyOptions(targetType.select, [
      { value: 'executable', label: '可执行文件' },
      { value: 'static', label: '静态库' },
      { value: 'shared', label: '动态库' }
    ], 'executable');
    const cStandard = createSelectField('C 标准', (value) => {
      if (!state) return;
      saveSelection({ ...state.selection, native: { ...state.selection.native, cStandard: Number(value) } });
    });
    applyOptions(cStandard.select, [
      { value: '11', label: 'C11' },
      { value: '17', label: 'C17' },
      { value: '23', label: 'C23' }
    ], '11');
    const cxxStandard = createSelectField('C++ 标准', (value) => {
      if (!state) return;
      saveSelection({ ...state.selection, native: { ...state.selection.native, cxxStandard: Number(value) } });
    });
    applyOptions(cxxStandard.select, [
      { value: '14', label: 'C++14' },
      { value: '17', label: 'C++17' },
      { value: '20', label: 'C++20' },
      { value: '23', label: 'C++23' }
    ], '14');
    const standards = document.createElement('div');
    standards.className = 'target-grid';
    standards.append(cStandard.wrapper, cxxStandard.wrapper);
    section.append(targetType.wrapper, standards);
    panel.append(section);
    panel.append(paragraph(
      'empty-note',
      '将扫描当前工作区并生成 CMakeLists.txt、Debug/Release 预设和 C/C++ IntelliSense 配置。'
    ));
    nativePanel = { panel, targetType: targetType.select, cStandard: cStandard.select, cxxStandard: cxxStandard.select };
    return nativePanel;
  }

  function syncNativePanel() {
    const panel = ensureNativePanel();
    const selection = state.selection.native;
    applyOptions(panel.targetType, [
      { value: 'executable', label: '可执行文件' },
      { value: 'static', label: '静态库' },
      { value: 'shared', label: '动态库' }
    ], selection.targetType);
    applyOptions(panel.cStandard, [
      { value: '11', label: 'C11' },
      { value: '17', label: 'C17' },
      { value: '23', label: 'C23' }
    ], String(selection.cStandard));
    applyOptions(panel.cxxStandard, [
      { value: '14', label: 'C++14' },
      { value: '17', label: 'C++17' },
      { value: '20', label: 'C++20' },
      { value: '23', label: 'C++23' }
    ], String(selection.cxxStandard));
    return panel.panel;
  }

  function render() {
    if (!state) return;
    applyOptions(projectRootSelect, state.projects, state.projectRoot);
    projectRootSelect.disabled = busy || state.discoveringProjects;
    const selectedProject = selectedOption(state.projects, state.projectRoot);
    workspaceName.textContent = state.discoveringProjects
      ? '正在发现工程…'
      : (selectedProject?.label || state.workspaceName || '当前工作区');
    workspaceName.title = selectedProject?.label || state.workspaceName || '';
    const mode = state.selection.mode;
    const isMcu = mode === 'mcu';
    syncCancelWorkspaceScan();
    modeMcu.setAttribute('aria-pressed', String(isMcu));
    modeLinux.setAttribute('aria-pressed', String(mode === 'linux'));
    modeNative.setAttribute('aria-pressed', String(mode === 'native'));
    mcuPanel.hidden = !isMcu;
    configuration.hidden = isMcu;
    if (isMcu) {
      syncTargetSection();
      syncFlashSection();
    } else if (mode === 'native') {
      configuration.replaceChildren(syncNativePanel());
    } else {
      configuration.replaceChildren(syncLinuxPanel());
    }
    applyDisabled();
  }

  function controls() {
    return Array.from(app.querySelectorAll('button, select, input'));
  }

  function applyDisabled() {
    controls().forEach((control) => {
      if (control.dataset.alwaysEnabled === 'true') return;
      control.disabled = busy || (control === projectRootSelect && Boolean(state?.discoveringProjects));
    });
    syncCancelWorkspaceScan();
  }

  function syncCancelWorkspaceScan() {
    const scanActive = Boolean(state?.discoveringProjects)
      || (busy && activeOperation === '正在扫描工作区');
    if (!scanActive) cancelRequested = false;
    cancelWorkspaceScanButton.hidden = !scanActive;
    cancelWorkspaceScanButton.disabled = cancelRequested;
    cancelWorkspaceScanButton.setAttribute('aria-busy', String(cancelRequested));
  }

  function setStatusBadge(tone, text) {
    statusBadge.className = `status-badge${tone ? ` ${tone}` : ''}`;
    if (typeof text === 'string' && text) {
      statusTextNode.textContent = text;
    }
  }

  function setBusy(active, text) {
    busy = active;
    if (active) {
      activeOperation = text || activeOperation;
    }
    if (!active) {
      activeOperation = '';
      cancelRequested = false;
    }
    app.setAttribute('aria-busy', String(active));
    actionsEl.classList.toggle('busy', active);
    if (active) {
      setStatusBadge('busy', text || '处理中');
    }
    applyDisabled();
    syncCancelWorkspaceScan();
  }

  function showNotice(element, message, tone) {
    if (!element) return;
    if (!message) {
      element.hidden = true;
      element.textContent = '';
      element.removeAttribute('data-tone');
      return;
    }
    element.hidden = false;
    element.textContent = message;
    element.dataset.tone = tone;
    element.setAttribute('role', tone === 'error' ? 'alert' : 'status');
  }

  function showFiles(files) {
    generatedFiles.replaceChildren();
    const list = Array.isArray(files) ? files : [];
    list.forEach((file) => {
      const item = document.createElement('li');
      item.append(icon('check'));
      const label = document.createElement('span');
      label.textContent = file;
      item.append(label);
      generatedFiles.append(item);
    });
    resultRegion.hidden = list.length === 0;
  }

  function focusInitiator() {
    if (!initiator || !initiator.isConnected || initiator.disabled || initiator.hidden) return;
    const active = document.activeElement;
    // Never pull focus out of a control the user moved to (including a host
    // chooser that owns focus); an unfocused webview reports body.
    if (active && active !== document.body && active !== initiator) return;
    initiator.focus({ preventScroll: true });
  }

  function finishOperation(result) {
    const value = result && typeof result === 'object' ? result : { ok: false, message: '', files: [] };
    const ok = value.ok === true;
    const cancelled = value.cancelled === true;
    const tone = ok ? 'success' : cancelled ? 'cancelled' : 'error';
    setBusy(false);
    setStatusBadge(tone, ok ? '已完成' : cancelled ? '已取消' : '失败');
    const message = typeof value.message === 'string' ? value.message : '';
    showNotice(operationNotice, message, tone);
    const files = Array.isArray(value.files) ? value.files : [];
    if (files.length > 0) {
      showFiles(files);
    }
    render();
    focusInitiator();
  }

  function startOperation(target, text) {
    if (busy) return false;
    initiator = target || null;
    cancelRequested = false;
    showNotice(operationNotice, '');
    setBusy(true, text);
    return true;
  }

  // One delegated dispatcher owns every static command button, so relocated or
  // reused markup cannot register a second listener for the same command.
  const commandLabels = {
    importPack: '正在导入 Pack',
    installPackOnline: '正在在线安装 Pack',
    installCorePack: '正在安装 ARM CMSIS 内核包',
    scanWorkspace: '正在扫描工作区',
    generateProject: '正在生成工程',
    generateFlashScript: '正在生成 flash.py',
    generateDebugConfiguration: '正在生成调试配置'
  };
  const cancellableCommands = new Set(['scanWorkspace']);

  app.addEventListener('click', (event) => {
    const target = event.target instanceof Element
      ? event.target.closest('button[data-command]')
      : null;
    if (!target) return;
    const command = target.dataset.command;
    if (!command || !state) return;
    if (command === 'cancelWorkspaceScan') {
      if (cancelRequested || cancelWorkspaceScanButton.hidden) return;
      cancelRequested = true;
      syncCancelWorkspaceScan();
      setStatusBadge('busy', '正在取消扫描');
      post({ type: 'cancelWorkspaceScan' });
      return;
    }
    if (!(command in commandLabels)) return;
    if (!startOperation(target, commandLabels[command])) return;
    if (cancellableCommands.has(command)) syncCancelWorkspaceScan();
    showNotice(operationNotice, '');
    post({ type: command });
  });

  toggleFlash.addEventListener('change', () => {
    if (!state || busy) return;
    saveSelection({
      ...state.selection,
      flash: { ...state.selection.flash, enabled: toggleFlash.checked }
    });
  });

  projectRootSelect.addEventListener('change', () => {
    if (!state || busy || !projectRootSelect.value) return;
    post({ type: 'setProjectRoot', root: projectRootSelect.value });
  });

  toggleDebug.addEventListener('change', () => {
    if (!state || busy) return;
    saveSelection({ ...state.selection, debugEnabled: toggleDebug.checked });
  });

  modeMcu.addEventListener('click', () => {
    if (!state || busy) return;
    if (state.selection.mode === 'mcu') return;
    saveSelection({ ...state.selection, mode: 'mcu' });
  });

  modeLinux.addEventListener('click', () => {
    if (!state || busy) return;
    if (state.selection.mode === 'linux') return;
    saveSelection({ ...state.selection, mode: 'linux' });
  });

  modeNative.addEventListener('click', () => {
    if (!state || busy) return;
    if (state.selection.mode === 'native') return;
    saveSelection({ ...state.selection, mode: 'native' });
  });

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (!message || typeof message.type !== 'string') return;
    if (message.type === 'state') {
      state = message.state;
      render();
      return;
    }
    if (message.type === 'packCatalogLoading' || message.type === 'packCatalogState') {
      if (!state || message.vendor !== state.selection.mcu.vendor) return;
      state.packs = Array.isArray(message.packs) ? message.packs : [];
      state.versions = Array.isArray(message.versions) ? message.versions : [];
      state.pendingPackId = state.pendingPackId || state.selection.mcu.packId;
      state.packCatalogLoading = message.type === 'packCatalogLoading';
      if (message.type === 'packCatalogState') {
        state.packCatalogNotice = message.notice || '';
      }
      syncTargetSection();
      return;
    }
    if (message.type === 'operationStarted') {
      if (!busy) {
        initiator = null;
        activeOperation = message.operation || '';
      }
      setBusy(true, message.operation);
      return;
    }
    if (message.type === 'operationProgress') {
      if (typeof message.message === 'string' && message.message) {
        setStatusBadge('busy', message.message);
      }
      return;
    }
    if (message.type === 'operationFinished') {
      finishOperation(message.result);
      return;
    }
    if (message.type === 'workspaceScan') {
      workspaceSummary.textContent = `${message.sources} 个源文件 · ${message.includeDirs} 个头文件目录 · ${message.defines} 个宏`;
      return;
    }
    if (message.type === 'notification') {
      const tone = message.level === 'error' ? 'error' : message.level === 'warning' ? 'warning' : '';
      setStatusBadge(tone, message.message);
      showNotice(operationNotice, message.message, tone === 'error' ? 'error' : tone === 'warning' ? 'warning' : 'info');
    }
  });

  post({ type: 'ready' });
})();
