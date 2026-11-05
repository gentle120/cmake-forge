import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { runPresetBuild } from '../generation/buildRunner';

const hostToolsAvailable = ['cmake', 'ninja', 'gcc'].every(tool => spawnSync(tool, ['--version']).status === 0);

test('real CMake and Ninja compile a C executable for both presets in a path with spaces', {
  skip: !hostToolsAvailable, timeout: 120000
}, async () => {
  const root = await mkdtemp(join(tmpdir(), 'ce host build '));
  try {
    await writeFile(join(root, 'main.c'), 'int main(void) { return 0; }\n');
    await writeFile(join(root, 'CMakeLists.txt'), 'cmake_minimum_required(VERSION 3.22)\nproject(host_build C)\nadd_executable(host_build main.c)\n');
    await writeFile(join(root, 'CMakePresets.json'), JSON.stringify({
      version: 3,
      configurePresets: ['debug', 'release'].map(name => ({
        name, generator: 'Ninja', binaryDir: '${sourceDir}/build/' + name,
        cacheVariables: { CMAKE_C_COMPILER: 'gcc', CMAKE_BUILD_TYPE: name === 'debug' ? 'Debug' : 'Release' }
      })),
      buildPresets: ['debug', 'release'].map(name => ({ name, configurePreset: name }))
    }));
    for (const presetName of ['debug', 'release'] as const) {
      const lines: string[] = [];
      const result = await runPresetBuild({ spawn }, { cwd: root, presetName, onOutputLine: line => lines.push(line) });
      assert.equal(result.ok, true, lines.join('\n'));
      await access(join(root, 'build', presetName, process.platform === 'win32' ? 'host_build.exe' : 'host_build'));
      assert.ok(lines.some(line => /Building C object/.test(line)));
      assert.ok(lines.some(line => /Linking C executable/.test(line)));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('cancellation terminates a running process and never starts the build step', { timeout: 20000 }, async () => {
  const controller = new AbortController();
  let count = 0;
  let pid: number | undefined;
  let descendantPid: number | undefined;
  const result = await runPresetBuild({
    spawn: ((command: string, args: string[], options: object) => {
      count++;
      const script = 'process.stdin.resume(); const child = require("node:child_process").spawn(process.execPath, ["-e", "process.stdin.resume(); console.log(process.pid);"]); child.stdout.on("data", chunk => process.stdout.write("LEAF:" + chunk));';
      const child = spawn(process.execPath, ['-e', script], options);
      pid = child.pid;
      return child;
    }) as typeof spawn
  }, {
    cwd: tmpdir(), presetName: 'debug', signal: controller.signal,
    onOutputLine: line => {
      if (line.startsWith('LEAF:')) {
        descendantPid = Number(line.slice(5));
        controller.abort();
      }
    }
  });
  assert.equal(result.cancelled, true);
  assert.equal(count, 1);
  assert.ok(pid);
  assert.ok(descendantPid);
  assert.throws(() => process.kill(pid!, 0));
  assert.throws(() => process.kill(descendantPid!, 0));
});
