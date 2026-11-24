/**
 * Direct OpenOCD invocation: argument builders, identity parsing and the
 * one-shot chip probe.
 *
 * The sidebar flashes through this module instead of the generated `flash.py`,
 * so a flash needs no Python and the output panel shows exactly the command
 * that ran. `flash.py` stays for the J-Link/pyOCD backends.
 */

import { runTool, type FlashEvent, type FlashRunResult } from './flashRunner';

export interface OpenOcdTarget {
  /** 形如 `interface/stlink.cfg` 或绝对路径。 */
  interfaceConfig: string;
  /** 形如 `target/stm32f1x.cfg`。 */
  targetConfig: string;
  transport: 'swd' | 'jtag';
  /** kHz；OpenOCD `adapter speed` 的单位。 */
  speedKHz: number;
}

export interface OpenOcdFlashOptions {
  target: OpenOcdTarget;
  firmwarePath: string;
  verify: boolean;
  reset: boolean;
}

function searchDirArgs(searchDirs: readonly string[] | undefined): string[] {
  const args: string[] = [];
  for (const dir of searchDirs ?? []) {
    const trimmed = dir.trim();
    if (trimmed) {
      args.push('-s', trimmed);
    }
  }
  return args;
}

function transportArgs(transport: 'swd' | 'jtag'): string[] {
  return transport === 'swd' ? [] : ['-c', 'transport select jtag'];
}

function quotePath(value: string): string {
  return `"${value.replace(/\\/g, '/')}"`;
}

/** `program "<elf>" [verify] [reset] exit` — OpenOCD's one-shot flash. */
export function buildOpenOcdFlashArgs(options: OpenOcdFlashOptions, searchDirs?: readonly string[]): string[] {
  const command = ['program', quotePath(options.firmwarePath)];
  if (options.verify) {
    command.push('verify');
  }
  if (options.reset) {
    command.push('reset');
  }
  command.push('exit');
  return [
    ...searchDirArgs(searchDirs),
    '-f',
    options.target.interfaceConfig,
    '-f',
    options.target.targetConfig,
    '-c',
    'foreach _mcu_target [target names] { $_mcu_target configure -work-area-backup 1 }',
    '-c',
    `adapter speed ${Math.trunc(options.target.speedKHz)}`,
    ...transportArgs(options.target.transport),
    '-c',
    command.join(' ')
  ];
}

/**
 * Connects, reads CPUID and the two common DBGMCU IDCODE windows, then shuts
 * down. Each read is wrapped in `catch`, so a part that does not expose one
 * window still reports the other instead of aborting the session. The reads
 * never halt, reset or write the target.
 */
export function buildOpenOcdDetectArgs(target: OpenOcdTarget, searchDirs?: readonly string[]): string[] {
  const read = (label: string, address: string): string =>
    `catch {echo "${label} [format %08X [lindex [read_memory ${address} 32 1] 0]]"} _ep_err`;
  return [
    ...searchDirArgs(searchDirs),
    '-f',
    target.interfaceConfig,
    '-f',
    target.targetConfig,
    '-c',
    `adapter speed ${Math.trunc(target.speedKHz)}`,
    ...transportArgs(target.transport),
    '-c',
    'init',
    '-c',
    read('EP_CPUID', '0xE000ED00'),
    '-c',
    read('EP_IDCODE', '0xE0042000'),
    '-c',
    read('EP_IDCODE_ALT', '0x40015800'),
    '-c',
    'shutdown'
  ];
}

export interface ChipIdentity {
  cpuid?: number;
  core?: string;
  /** 已知 DEV_ID 表内的系列名，如 `STM32F1x`。 */
  family?: string;
  deviceId?: number;
  revision?: number;
}

export interface DetectChipResult {
  ok: boolean;
  identity?: ChipIdentity;
  outputTail: string[];
  /** 探测成功的探针 id；失败时为空。 */
  probeId?: string;
}

const CPUID_PARTS: Record<number, string> = {
  0xc20: 'Cortex-M0',
  0xc21: 'Cortex-M1',
  0xc23: 'Cortex-M3',
  0xc24: 'Cortex-M4',
  0xc27: 'Cortex-M7',
  0xc60: 'Cortex-M0+',
  0xd20: 'Cortex-M23',
  0xd21: 'Cortex-M33',
  0xd22: 'Cortex-M55',
  0xd23: 'Cortex-M85',
  0xd24: 'Cortex-M52',
  0xd31: 'Cortex-M35P'
};

/**
 * STM32 DBGMCU DEV_ID → 系列（ST RM0008/RM0090 等手册中的稳定值）。不在表内
 * 的器件仍然报告原始 DEV_ID，交给用户判断，不猜。
 */
const STM32_DEVICE_FAMILIES: Record<number, string> = {
  0x410: 'STM32F1x',
  0x411: 'STM32F2x',
  0x412: 'STM32F1x',
  0x413: 'STM32F4x',
  0x414: 'STM32F1x',
  0x418: 'STM32F1x',
  0x419: 'STM32F4x',
  0x420: 'STM32F1x',
  0x421: 'STM32F4x',
  0x422: 'STM32F3x',
  0x423: 'STM32F4x',
  0x428: 'STM32F1x',
  0x430: 'STM32F1x',
  0x431: 'STM32F4x',
  0x432: 'STM32F3x',
  0x433: 'STM32F4x',
  0x434: 'STM32F4x',
  0x438: 'STM32F3x',
  0x439: 'STM32F3x',
  0x440: 'STM32F0x',
  0x441: 'STM32F4x',
  0x442: 'STM32F0x',
  0x444: 'STM32F0x',
  0x445: 'STM32F0x',
  0x446: 'STM32F3x',
  0x448: 'STM32F0x',
  0x449: 'STM32F7x',
  0x450: 'STM32H7x',
  0x451: 'STM32F7x',
  0x452: 'STM32F7x',
  0x456: 'STM32G0x',
  0x458: 'STM32F4x',
  0x460: 'STM32G0x',
  0x463: 'STM32F4x',
  0x466: 'STM32G0x',
  0x467: 'STM32G0x',
  0x468: 'STM32G4x',
  0x469: 'STM32G4x',
  0x479: 'STM32G4x',
  0x480: 'STM32H7x',
  0x483: 'STM32H7x',
  0x415: 'STM32L4x',
  0x416: 'STM32L1x',
  0x417: 'STM32L0x',
  0x427: 'STM32L1x',
  0x429: 'STM32L1x',
  0x435: 'STM32L4x',
  0x436: 'STM32L1x',
  0x437: 'STM32L1x',
  0x447: 'STM32L0x',
  0x461: 'STM32L4x',
  0x462: 'STM32L4x',
  0x464: 'STM32L4x',
  0x470: 'STM32L4x',
  0x472: 'STM32L5x',
  0x482: 'STM32U5x',
  0x495: 'STM32WBx',
  0x496: 'STM32WLx',
  0x497: 'STM32WLx'
};

export function coreFromCpuid(word: number | undefined): string | undefined {
  return word === undefined ? undefined : CPUID_PARTS[(word >>> 4) & 0xfff];
}

export function familyFromDeviceId(deviceId: number | undefined): string | undefined {
  return deviceId === undefined ? undefined : STM32_DEVICE_FAMILIES[deviceId & 0xfff];
}

/** Pulls `EP_*` markers out of raw OpenOCD output. */
export function parseIdentityLines(lines: readonly string[]): ChipIdentity {
  const values = new Map<string, number>();
  for (const line of lines) {
    const match = /EP_(CPUID|IDCODE_ALT|IDCODE)\s+([0-9A-Fa-f]{8})/.exec(line);
    if (match) {
      values.set(match[1], Number.parseInt(match[2], 16) >>> 0);
    }
  }
  const usable = (word: number | undefined): number | undefined => {
    if (word === undefined) {
      return undefined;
    }
    const deviceId = word & 0xfff;
    return deviceId === 0 || deviceId === 0xfff ? undefined : word;
  };
  const cpuid = values.get('CPUID');
  const idcode = usable(values.get('IDCODE')) ?? usable(values.get('IDCODE_ALT'));
  const identity: ChipIdentity = {};
  if (cpuid !== undefined) {
    identity.cpuid = cpuid;
    const core = coreFromCpuid(cpuid);
    if (core) {
      identity.core = core;
    }
  }
  if (idcode !== undefined) {
    identity.deviceId = idcode & 0xfff;
    identity.revision = (idcode >>> 16) & 0xffff;
    const family = familyFromDeviceId(identity.deviceId);
    if (family) {
      identity.family = family;
    }
  }
  return identity;
}

/** "Cortex-M4 · STM32F4x · DEV_ID 0x413"，缺失字段自动省略。 */
export function describeIdentity(identity: ChipIdentity | undefined): string {
  if (!identity) {
    return '';
  }
  const parts: string[] = [];
  if (identity.core) {
    parts.push(identity.core);
  }
  if (identity.family) {
    parts.push(identity.family);
  }
  if (identity.deviceId !== undefined) {
    parts.push(`DEV_ID 0x${identity.deviceId.toString(16).toUpperCase().padStart(3, '0')}`);
  }
  return parts.join(' · ');
}

export interface DetectChipOptions {
  openocdPath: string;
  probes: Array<{ id: string; interfaceConfig: string }>;
  targetConfig: string;
  transport: 'swd' | 'jtag';
  speedKHz: number;
  searchDirs?: readonly string[];
  cwd: string;
  timeoutMs?: number;
  spawn?: typeof import('node:child_process').spawn;
}

/**
 * Tries each probe interface until one completes a session and reports a
 * CPUID. An unsuccessful probe is not an error: the next interface is tried.
 */
export async function detectChip(options: DetectChipOptions): Promise<DetectChipResult> {
  const timeoutMs = Math.max(1000, options.timeoutMs ?? 8000);
  let lastTail: string[] = [];
  for (const probe of options.probes) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let result: FlashRunResult;
    try {
      result = await runTool({
        executable: options.openocdPath,
        args: buildOpenOcdDetectArgs(
          {
            interfaceConfig: probe.interfaceConfig,
            targetConfig: options.targetConfig,
            transport: options.transport,
            speedKHz: options.speedKHz
          },
          options.searchDirs
        ),
        cwd: options.cwd,
        signal: controller.signal,
        spawn: options.spawn,
        matchLine: () => undefined,
        tailLines: 60
      });
    } finally {
      clearTimeout(timer);
    }
    lastTail = result.outputTail;
    if (result.cancelled) {
      return { ok: false, outputTail: lastTail };
    }
    const identity = parseIdentityLines(result.outputTail);
    if (result.ok && identity.cpuid !== undefined) {
      return { ok: true, identity, outputTail: lastTail, probeId: probe.id };
    }
  }
  return { ok: false, outputTail: lastTail };
}

/** Stage lines of a direct OpenOCD flash; `** ... **` markers match flash.py's. */
export function matchOpenOcdStage(line: string): FlashEvent | undefined {
  const lower = line.toLowerCase();
  if (lower.includes('** programming started **')) {
    return { stage: 'program', message: line, percent: 40 };
  }
  if (lower.includes('** programming finished **')) {
    return { stage: 'program', message: line, percent: 70 };
  }
  if (lower.includes('** verified ok **')) {
    return { stage: 'verify', message: line, percent: 85 };
  }
  if (lower.includes('** resetting')) {
    return { stage: 'reset', message: line, percent: 95 };
  }
  if (lower.includes('shutdown command invoked')) {
    return { stage: 'done', message: line, percent: 100 };
  }
  if (/error:|failed|not found/.test(lower)) {
    return { stage: 'failed', message: line };
  }
  return undefined;
}
