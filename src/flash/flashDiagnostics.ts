/**
 * Turns raw flasher output into one actionable diagnosis.
 *
 * The full log already lives in the output panel, so repeating it would not
 * help. The patterns below follow the first failure the generators actually
 * print, letting the UI show a cause and a next step instead of an error dump.
 */

export interface FlashFailureInput {
  output: string[];
  exitCode?: number;
  spawnError?: string;
  backend: 'openocd' | 'jlink' | 'pyocd';
}

export interface FlashDiagnosis {
  title: string;
  detail: string;
  actions: string[];
}

interface LinePattern {
  title: string;
  matches(line: string): boolean;
  actions: string[];
}

const BACKEND_LABELS: Record<FlashFailureInput['backend'], string> = {
  openocd: 'OpenOCD',
  jlink: 'J-Link',
  pyocd: 'pyOCD'
};

// Order matters: a missing .cfg is reported as "unable to open" and must be
// classified before the generic permission/probe-busy rule.
const LINE_PATTERNS: LinePattern[] = [
  {
    title: '找不到 OpenOCD',
    matches: (line) => line.includes('openocd was not found') || line.includes('spawn openocd enoent'),
    actions: [
      '在设置 cmakeForge.openocdPath 里填写 openocd.exe 的完整路径。',
      '或把 OpenOCD 的 bin 目录加入 PATH 后重试。'
    ]
  },
  {
    title: 'OpenOCD 找不到配置文件',
    matches: (line) =>
      line.includes('.cfg') &&
      (line.includes('unable to open') || line.includes("couldn't find") || line.includes('couldn’t find')),
    actions: [
      '检查 cmakeForge.openocdPath 是否指向可用的 OpenOCD。',
      '确认 OPENOCD_SCRIPTS 指向 scripts 目录，且 target / interface 的 .cfg 文件存在。'
    ]
  },
  {
    title: '没有找到调试探针',
    matches: (line) =>
      line.includes('unable to find a matching') ||
      line.includes('no j-link found') ||
      line.includes('no jlink found') ||
      line.includes('no cmsis-dap') ||
      line.includes("couldn't find an st-link") ||
      line.includes('no device found'),
    actions: [
      '检查 USB 线是否插在调试口上，换一根数据线再试。',
      'ST-Link / DAPLink 需要 WinUSB 驱动（可用 Zadig 安装）；J-Link 需先装 SEGGER 驱动。'
    ]
  },
  {
    title: '探针被占用或驱动异常',
    matches: (line) =>
      line.includes('libusb_error') ||
      line.includes('open failed') ||
      line.includes('permission denied') ||
      line.includes('already in use'),
    actions: [
      '关闭 Keil、IAR、CubeProgrammer 等可能占用调试器的程序。',
      '拔插探针后重试；若仍失败，检查 ST-Link / J-Link 驱动是否安装正确。'
    ]
  },
  {
    title: '目标芯片与 target 配置不匹配',
    matches: (line) =>
      line.includes('init mode failed') ||
      line.includes('error: target not examined') ||
      line.includes('unknown target'),
    actions: [
      '在侧栏重新选择与芯片型号匹配的 OpenOCD target。',
      '确认开发板上的芯片型号与工程配置一致。'
    ]
  },
  {
    title: '烧录超时',
    matches: (line) => line.includes('timed out') || line.includes('timeout') || line.includes('120s'),
    actions: [
      '检查开发板供电、SWD 接线，以及 BOOT0 / 复位引脚状态。',
      '缩短线缆或降低 SWD 时钟后重试。'
    ]
  }
];

export function diagnoseFlashFailure(input: FlashFailureInput): FlashDiagnosis {
  const lines = input.output.map((line) => line.trim()).filter((line) => line.length > 0);

  if (input.spawnError && input.spawnError.toUpperCase().includes('ENOENT')) {
    return {
      title: '找不到 Python',
      detail: input.spawnError.trim(),
      actions: [
        '安装 Python 3 并把它加入 PATH。',
        '或在扩展设置里填写 python 解释器的完整路径后重试。'
      ]
    };
  }

  const evidence = lines.map((line) => ({ line, lower: line.toLowerCase() }));
  for (const pattern of LINE_PATTERNS) {
    const hit = evidence.find((candidate) => pattern.matches(candidate.lower));
    if (hit) {
      return { title: pattern.title, detail: hit.line, actions: [...pattern.actions] };
    }
  }

  const label = BACKEND_LABELS[input.backend];
  const lastLine = lines.at(-1);
  const exitCode = input.exitCode ?? '未知';
  return {
    title: '烧录失败',
    detail: lastLine ?? `没有捕获到输出（${label} 退出码 ${exitCode}）。`,
    actions: [
      `查看输出面板里的完整日志，定位 ${label} 的第一处 Error。`,
      `退出码 ${exitCode}；确认 .vscode/flash.py 与工程配置未被手动改动后重试。`
    ]
  };
}
