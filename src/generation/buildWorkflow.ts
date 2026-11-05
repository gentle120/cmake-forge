import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { buildEnvironment, runPresetBuild, type BuildRunOptions, type BuildRunResult } from './buildRunner';

export interface BuildProjectHost {
  workspaceRoot(): string | undefined;
  isTrusted(): boolean;
  choosePreset(): Promise<'debug' | 'release' | undefined>;
  cmakePath(): string;
  armToolchainPath(): string | undefined;
  showOutput(): void;
  appendLine(line: string): void;
  showError(message: string): void;
  showInformation(message: string): void;
  withProgress(run: (signal: AbortSignal) => Promise<BuildRunResult>): Promise<BuildRunResult>;
}

/** One active explicit build per command instance; no generation or flashing side effects. */
export function createBuildProjectCommand(
  host: BuildProjectHost,
  run: (options: BuildRunOptions) => Promise<BuildRunResult> = options => runPresetBuild({ spawn }, options)
): () => Promise<BuildRunResult | undefined> {
  let active = false;
  return async () => {
    if (active) {
      host.showInformation('工程正在构建，请等待完成或取消当前构建。');
      return;
    }
    active = true;
    try {
      if (!host.isTrusted()) {
        host.showError('请先信任工作区，再执行工程构建。');
        return;
      }
      const root = host.workspaceRoot();
      if (!root) {
        host.showError('请先打开需要编译的工程目录。');
        return;
      }
      try {
        await access(join(root, 'CMakeLists.txt'));
        await access(join(root, 'CMakePresets.json'));
      } catch {
        host.showError('未找到 CMakeLists.txt 或 CMakePresets.json，请先生成 CMake 工程。');
        return;
      }
      const presetName = await host.choosePreset();
      if (!presetName) {
        return;
      }
      host.showOutput();
      host.appendLine(`\n=== ${presetName}: ${root} ===`);
      const armBin = host.armToolchainPath();
      host.appendLine(`ARM GNU GCC: ${armBin || 'PATH'}`);
      const result = await host.withProgress(signal => run({
        cwd: root, presetName, cmakePath: host.cmakePath(),
        env: buildEnvironment(process.env, armBin), signal,
        onOutputLine: line => host.appendLine(line)
      }));
      host.appendLine(result.message);
      if (result.ok) {
        host.showInformation(result.message);
      } else if (!result.cancelled) {
        host.showError(`${result.message} 详情见输出面板「CMake-Embedded Build」。`);
      }
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      host.appendLine(message);
      host.showError(`构建失败：${message}`);
    } finally {
      active = false;
    }
  };
}
