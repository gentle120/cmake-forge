import assert from 'node:assert/strict';
import { spawn, type SpawnOptions } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { runPresetBuild, buildEnvironment } from '../generation/buildRunner';

function processFixture(codes: number[], stderr = 'warning\n') {
  const calls: Array<{ command: string; args: readonly string[]; options: SpawnOptions }> = [];
  const dependencies = {
    spawn: ((command: string, args: string[], options: SpawnOptions) => {
      calls.push({ command, args, options });
      const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough() });
      process.nextTick(() => {
        const utf8 = Buffer.from('编译输出');
        child.stdout.write(utf8.subarray(0, 2));
        child.stdout.end(Buffer.concat([utf8.subarray(2), Buffer.from('\r\n末行')]));
        child.stderr.end(stderr);
        child.emit('close', codes.shift() ?? 0);
      });
      return child;
    }) as unknown as typeof spawn
  };
  return { calls, dependencies };
}

test('configures before building the selected preset and forwards complete UTF-8 output', async () => {
  const fixture = processFixture([0, 0]);
  const lines: string[] = [];
  const result = await runPresetBuild(fixture.dependencies, {
    presetName: 'release', cwd: 'C:/project with spaces', onOutputLine: line => lines.push(line)
  });
  assert.equal(result.ok, true);
  assert.deepEqual(fixture.calls.map(c => c.args), [['--preset', 'release'], ['--build', '--preset', 'release']]);
  assert.ok(fixture.calls.every(c => c.options.cwd === 'C:/project with spaces' && c.options.shell === false));
  assert.ok(lines.includes('编译输出'));
  assert.ok(lines.includes('末行'));
  assert.ok(lines.includes('warning'));
});

test('does not start build after configure exits nonzero', async () => {
  const fixture = processFixture([2]);
  const result = await runPresetBuild(fixture.dependencies, { presetName: 'debug', cwd: '.', onOutputLine() {} });
  assert.equal(result.ok, false);
  assert.match(result.message, /2/);
  assert.equal(fixture.calls.length, 1);
});

test('explains confirmed Windows stack-report path failures without misclassifying other write errors', async () => {
  const filename = join(__dirname, '..', 'generation', 'buildRunner.js');
  const moduleObject = { exports: {} as { runPresetBuild: typeof runPresetBuild } };
  const load = runInNewContext('(function(require,module,exports){\n' + readFileSync(filename, 'utf8') + '\n})', {
    process: { platform: 'win32' }
  });
  load(createRequire(filename), moduleObject, moduleObject.exports);
  const output = 'maximum length for an object path is 250 (CMAKE_OBJECT_PATH_MAX)\n'
    + 'fatal error: cannot open CMakeFiles/probe.dir/test.c.su for writing: No such file or directory\n';
  const fixture = processFixture([1], output);
  const result = await moduleObject.exports.runPresetBuild(fixture.dependencies, {
    presetName: 'debug', cwd: '.', onOutputLine() {}
  });
  assert.match(result.message, /Windows.*限制.*缩短/);
  assert.equal(fixture.calls.length, 1);
  const permissionFailure = await moduleObject.exports.runPresetBuild(processFixture([1],
    'cannot open test.c.su for writing: Permission denied\n').dependencies, {
    presetName: 'debug', cwd: '.', onOutputLine() {}
  });
  assert.doesNotMatch(permissionFailure.message, /Windows/);
});

test('reports a missing CMake executable without starting the build', async () => {
  const result = await runPresetBuild({ spawn }, {
    presetName: 'debug', cwd: '.', cmakePath: '__missing_cmake_executable__', onOutputLine() {}
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /ENOENT/);
});

test('prepends ARM GNU bin to the inherited PATH without modifying it', () => {
  const env = { Path: 'C:/Windows', KEEP: 'value' };
  const result = buildEnvironment(env, 'C:/GNU ARM/bin', 'win32');
  assert.equal(result.Path, 'C:/GNU ARM/bin;C:/Windows');
  assert.equal(result.KEEP, 'value');
  assert.equal(env.Path, 'C:/Windows');
  assert.equal(result.PATH, undefined);
  assert.equal(buildEnvironment({}, '/opt/arm/bin', 'linux').PATH, '/opt/arm/bin');
});

test('passes the toolchain environment and configured CMake executable to each subprocess', async () => {
  const fixture = processFixture([0, 0]);
  await runPresetBuild(fixture.dependencies, {
    presetName: 'debug', cwd: '.', cmakePath: 'C:/CMake/bin/cmake.exe',
    env: { PATH: '/opt/arm/bin:/bin' }, onOutputLine() {}
  });
  assert.ok(fixture.calls.every(c => c.command === 'C:/CMake/bin/cmake.exe' && c.options.env?.PATH === '/opt/arm/bin:/bin'));
});

test('cancellation before configure spawns no process', async () => {
  const fixture = processFixture([0]);
  const controller = new AbortController();
  controller.abort();
  const result = await runPresetBuild(fixture.dependencies, {
    presetName: 'debug', cwd: '.', signal: controller.signal, onOutputLine() {}
  });
  assert.equal(result.cancelled, true);
  assert.equal(fixture.calls.length, 0);
});

test('runs on extension hosts that do not provide Promise.withResolvers', async () => {
  const filename = join(__dirname, '..', 'generation', 'buildRunner.js');
  const legacyPromise = new Proxy(Promise, {
    get: (target, key) => key === 'withResolvers' ? undefined : Reflect.get(target, key)
  });
  const exports = { exports: {} as { runPresetBuild: typeof runPresetBuild } };
  const load = runInNewContext('(function(require,module,exports){\n' + readFileSync(filename, 'utf8') + '\n})', {
    Promise: legacyPromise, process
  });
  load(createRequire(filename), exports, exports.exports);
  const fixture = processFixture([0, 0]);
  const result = await exports.exports.runPresetBuild(fixture.dependencies, {
    presetName: 'debug', cwd: '.', onOutputLine() {}
  });
  assert.equal(result.ok, true);
});
