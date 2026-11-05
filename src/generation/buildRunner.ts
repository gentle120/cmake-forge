import { spawn, type ChildProcess } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { once } from 'node:events';
import type { Readable } from 'node:stream';

export interface BuildDependencies {
  spawn: typeof spawn;
}

export interface BuildRunOptions {
  presetName: 'debug' | 'release';
  cwd: string;
  cmakePath?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onOutputLine(line: string): void;
}

export interface BuildRunResult {
  ok: boolean;
  cancelled?: boolean;
  message: string;
}

/** Child-only PATH overlay; compiler identifiers in generated toolchains stay portable. */
export function buildEnvironment(
  inherited: NodeJS.ProcessEnv,
  armBinDirectory?: string,
  platform: NodeJS.Platform = process.platform
): NodeJS.ProcessEnv {
  const env = { ...inherited };
  const bin = armBinDirectory?.trim();
  if (!bin) {
    return env;
  }
  const pathKey = platform === 'win32'
    ? Object.keys(env).find(key => key.toLowerCase() === 'path') ?? 'PATH'
    : 'PATH';
  const previous = env[pathKey];
  env[pathKey] = bin + (previous ? (platform === 'win32' ? ';' : ':') + previous : '');
  return env;
}

/** Explicit user-triggered configure/build; a failed configure never starts a build. */
export async function runPresetBuild(
  dependencies: BuildDependencies,
  options: BuildRunOptions
): Promise<BuildRunResult> {
  const command = options.cmakePath?.trim() || 'cmake';
  for (const args of [['--preset', options.presetName], ['--build', '--preset', options.presetName]]) {
    if (options.signal?.aborted) {
      return { ok: false, cancelled: true, message: '构建已取消。' };
    }
    options.onOutputLine(`> ${command} ${args.join(' ')}`);
    let objectPathWarning = false;
    let stackReportWriteFailure = false;
    const result = await runCommand(dependencies, command, args, {
      ...options,
      onOutputLine: line => {
        objectPathWarning ||= line.includes('CMAKE_OBJECT_PATH_MAX');
        stackReportWriteFailure ||= /\.su['"]?\s+for writing:\s*No such file or directory/.test(line);
        options.onOutputLine(line);
      }
    });
    if (!result.ok) {
      if (!result.cancelled && args[0] === '--preset' && process.platform === 'win32'
          && objectPathWarning && stackReportWriteFailure) {
        return {
          ...result,
          message: `${result.message} ARM GNU 栈用量输出路径超过 Windows 工具链限制，请缩短工程目录路径后重新配置，或改用支持长路径的 ARM GNU 工具链。`
        };
      }
      return result;
    }
  }
  return { ok: true, message: `${options.presetName} 构建成功。` };
}

function outputLines(stream: Readable | null, emit: (line: string) => void): () => void {
  const decoder = new StringDecoder('utf8');
  let pending = '';
  const drain = (): void => {
    let index: number;
    while ((index = pending.indexOf('\n')) >= 0) {
      emit(pending.slice(0, index).replace(/\r$/, ''));
      pending = pending.slice(index + 1);
    }
  };
  stream?.on('data', (chunk: Buffer) => {
    pending += decoder.write(chunk);
    drain();
  });
  return () => {
    pending += decoder.end();
    drain();
    if (pending) {
      emit(pending.replace(/\r$/, ''));
      pending = '';
    }
  };
}

function terminateBuild(child: ChildProcess): void {
  if (!child.pid) {
    return;
  }
  if (process.platform === 'win32') {
    // Killing cmake alone leaves its compiler/build-tool children running.
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      windowsHide: true, shell: false
    });
    killer.on('error', () => child.kill());
    killer.on('close', code => { if (code !== 0) { child.kill(); } });
  } else {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  }
}

async function runCommand(
  dependencies: BuildDependencies,
  command: string,
  args: string[],
  options: BuildRunOptions
): Promise<BuildRunResult> {
  let child: ChildProcess;
  try {
    child = dependencies.spawn(command, args, {
      cwd: options.cwd, env: options.env, shell: false, windowsHide: true,
      detached: process.platform !== 'win32'
    });
  } catch (error) {
    return { ok: false, message: `无法启动 ${command}：${error instanceof Error ? error.message : String(error)}` };
  }
  const flushStdout = outputLines(child.stdout, options.onOutputLine);
  const flushStderr = outputLines(child.stderr, options.onOutputLine);
  const cancel = (): void => terminateBuild(child);
  // events.once works on the extension's older Node baseline as well as
  // modern hosts, and rejects on a child process 'error' event.
  const closed = once(child, 'close');
  options.signal?.addEventListener('abort', cancel, { once: true });
  if (options.signal?.aborted) {
    cancel();
  }
  try {
    const [code] = await closed;
    if (options.signal?.aborted) {
      return { ok: false, cancelled: true, message: '构建已取消。' };
    }
    return { ok: code === 0, message: code === 0 ? '' : `${command} ${args.join(' ')} 失败（退出码 ${code ?? 'unknown'}）。` };
  } catch (error) {
    return { ok: false, message: `无法启动 ${command}：${error instanceof Error ? error.message : String(error)}` };
  } finally {
    options.signal?.removeEventListener('abort', cancel);
    flushStdout();
    flushStderr();
  }
}
