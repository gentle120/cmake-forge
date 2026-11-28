/**
 * Runs the generated flash helper and turns its text output into progress
 * events.
 *
 * flash.py owns the backend details and the 120 s timeout; this module only
 * supervises the process so the UI can show progress and stop a stuck flash.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';

export type FlashStage = 'init' | 'program' | 'verify' | 'reset' | 'done' | 'failed';

export interface FlashEvent {
  stage: FlashStage;
  message: string;
  /** 0-100，未知时为 undefined。 */
  percent?: number;
}

export interface FlashRunOptions {
  /** Python 解释器，默认 'python'（Windows 上由调用方决定 python/py）。 */
  pythonPath?: string;
  scriptPath: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  /** 注入以便测试；默认用 node:child_process 的 spawn。 */
  spawn?: typeof import('node:child_process').spawn;
  onEvent?(event: FlashEvent): void;
  /** 失败时保留的输出行数，默认 40。 */
  tailLines?: number;
}

export interface ToolRunOptions {
  /** 直接启动的可执行文件（OpenOCD、J-Link Commander 等）。 */
  executable: string;
  args: string[];
  cwd: string;
  signal?: AbortSignal;
  spawn?: typeof import('node:child_process').spawn;
  onEvent?(event: FlashEvent): void;
  tailLines?: number;
  /** 覆盖默认阶段行匹配：不同后端的进度文案不同。 */
  matchLine?(line: string): StageMatch | undefined;
  /**
   * How long to wait for the process to exit after a cancel before settling
   * anyway. A stuck driver can ignore the kill and would otherwise leave the
   * side bar busy forever.
   */
  abortGraceMs?: number;
}

export interface FlashRunResult {
  ok: boolean;
  /** 进程退出码；被取消或 spawn 失败时为 undefined。 */
  exitCode?: number;
  cancelled: boolean;
  /** spawn 自身失败（ENOENT 等）的错误信息。 */
  spawnError?: string;
  events: FlashEvent[];
  /** 最后 tailLines 行，失败诊断用。 */
  outputTail: string[];
  elapsedMs: number;
}

interface StageMatch {
  stage: FlashStage;
  percent?: number;
}

const DEFAULT_TAIL_LINES = 40;

/** OpenOCD colorizes progress output when it thinks it is attached to a TTY. */
const ANSI_ESCAPE = /\u001B\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(value: string): string {
  return value.replace(ANSI_ESCAPE, '');
}

function matchStage(line: string): StageMatch | undefined {
  const lower = line.toLowerCase();
  if (lower.includes('open on-chip debugger') || /^info\s*:/.test(lower)) {
    return { stage: 'init', percent: 10 };
  }
  if (lower.includes('** programming started **')) {
    return { stage: 'program', percent: 40 };
  }
  if (lower.includes('** programming finished **')) {
    return { stage: 'program', percent: 70 };
  }
  if (lower.includes('** verified ok **')) {
    return { stage: 'verify', percent: 85 };
  }
  if (lower.includes('** resetting')) {
    return { stage: 'reset', percent: 95 };
  }
  if (lower.includes('flash completed successfully.')) {
    return { stage: 'done', percent: 100 };
  }
  // flash.py prints the backend name before the exit code; the stage is the
  // same for OpenOCD, J-Link, and pyOCD.
  if (lower.includes('flash failed')) {
    return { stage: 'failed' };
  }
  return undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Windows keeps the whole helper process tree alive. Killing only python can
 * leave OpenOCD holding the probe, so prefer taskkill /T. Tests inject a fake
 * spawn without a real pid, hence `allowTaskkill` is off for injected spawns.
 */
function terminate(target: ChildProcess, allowTaskkill: boolean): void {
  if (allowTaskkill && process.platform === 'win32' && typeof target.pid === 'number') {
    const killed = spawnSync('taskkill', ['/pid', String(target.pid), '/T', '/F'], {
      windowsHide: true
    });
    if (killed.status === 0) {
      return;
    }
  }
  target.kill();
}

export async function runTool(options: ToolRunOptions): Promise<FlashRunResult> {
  const startedAt = Date.now();
  const events: FlashEvent[] = [];
  const output: string[] = [];
  // `program` has two milestones (started/finished); the key keeps both while
  // still collapsing the repeated `Info :` lines OpenOCD prints all the time.
  const emitted = new Set<string>();
  const spawnFn = options.spawn ?? spawn;
  const allowTaskkill = options.spawn === undefined;
  const tailLimit = Math.max(0, Math.trunc(options.tailLines ?? DEFAULT_TAIL_LINES));
  // Only the tail is ever reported, so a chatty session must not keep every line
  // in memory.
  const outputLimit = Math.max(tailLimit * 5, 200);
  const abortGraceMs = Math.max(0, options.abortGraceMs ?? 5000);

  if (options.signal?.aborted) {
    return {
      ok: false,
      cancelled: true,
      events,
      outputTail: [],
      elapsedMs: 0
    };
  }

  return await new Promise<FlashRunResult>((resolve) => {
    let settled = false;
    let cancelled = false;
    let spawnError: string | undefined;
    let pending = '';
    let child: ChildProcess | undefined;
    let abortTimer: ReturnType<typeof setTimeout> | undefined;

    function handleLine(raw: string): void {
      const line = stripAnsi(raw).replace(/\r$/, '').trim();
      if (!line) {
        return;
      }
      output.push(line);
      if (output.length > outputLimit) {
        output.splice(0, output.length - outputLimit);
      }
      const match = (options.matchLine ?? matchStage)(line);
      if (!match) {
        return;
      }
      const key = `${match.stage}:${match.percent ?? ''}`;
      if (match.stage !== 'failed') {
        if (emitted.has(key)) {
          return;
        }
        emitted.add(key);
      }
      const event: FlashEvent = match.percent === undefined
        ? { stage: match.stage, message: line }
        : { stage: match.stage, message: line, percent: match.percent };
      events.push(event);
      options.onEvent?.(event);
    }

    function consume(chunk: string): void {
      pending += chunk;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const line of lines) {
        handleLine(line);
      }
    }

    function onAbort(): void {
      if (settled || cancelled) {
        return;
      }
      cancelled = true;
      if (child) {
        terminate(child, allowTaskkill);
        // Killing a process tree is not guaranteed (driver hangs, taskkill
        // missing); report the cancellation instead of staying busy forever.
        abortTimer = setTimeout(() => settle(null), abortGraceMs);
      }
    }

    function settle(exitCode: number | null): void {
      if (settled) {
        return;
      }
      settled = true;
      if (abortTimer !== undefined) {
        clearTimeout(abortTimer);
        abortTimer = undefined;
      }
      if (pending.length > 0) {
        const rest = pending;
        pending = '';
        handleLine(rest);
      }
      options.signal?.removeEventListener('abort', onAbort);
      const code = exitCode ?? undefined;
      const result: FlashRunResult = {
        ok: !cancelled && spawnError === undefined && code === 0,
        cancelled,
        events,
        outputTail: tailLimit === 0 ? [] : output.slice(-tailLimit),
        elapsedMs: Date.now() - startedAt
      };
      if (code !== undefined) {
        result.exitCode = code;
      }
      if (spawnError !== undefined) {
        result.spawnError = spawnError;
      }
      resolve(result);
    }

    let spawned: ChildProcess;
    try {
      spawned = spawnFn(options.executable, options.args, {
        cwd: options.cwd,
        windowsHide: true
      });
    } catch (error) {
      spawnError = describeError(error);
      settle(null);
      return;
    }

    child = spawned;
    spawned.stdout?.on('data', (chunk: Buffer | string) => {
      consume(chunk.toString());
    });
    spawned.stderr?.on('data', (chunk: Buffer | string) => {
      consume(chunk.toString());
    });
    spawned.on('error', (error: Error) => {
      if (settled) {
        return;
      }
      spawnError = error.message;
      settle(null);
    });
    spawned.on('close', (code: number | null) => {
      settle(code);
    });

    options.signal?.addEventListener('abort', onAbort, { once: true });
    // The signal can abort between the guard above and listener registration.
    if (options.signal?.aborted) {
      onAbort();
    }
  });
}

/**
 * Runs the generated `flash.py` helper. Kept as the compatibility surface for
 * the J-Link and pyOCD backends; the OpenOCD path calls `runTool` directly.
 */
export async function runFlash(options: FlashRunOptions): Promise<FlashRunResult> {
  return runTool({
    executable: options.pythonPath ?? 'python',
    args: [options.scriptPath, ...options.args],
    cwd: options.cwd,
    signal: options.signal,
    spawn: options.spawn,
    onEvent: options.onEvent,
    tailLines: options.tailLines
  });
}
