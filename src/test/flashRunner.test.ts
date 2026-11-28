import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import {
  runFlash,
  type FlashEvent,
  type FlashRunOptions,
  type FlashRunResult
} from '../flash/flashRunner';

type SpawnFunction = typeof import('node:child_process').spawn;

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  killCalls = 0;

  kill(): boolean {
    this.killCalls += 1;
    return true;
  }
}

const scriptPath = 'C:/project/.vscode/flash.py';
const cwd = 'C:/project';

function spawnReturning(child: FakeChild): SpawnFunction {
  return ((_command: string, _args: readonly string[], _options: unknown) => child) as unknown as SpawnFunction;
}

function startRun(child: FakeChild, overrides: Partial<FlashRunOptions> = {}): Promise<FlashRunResult> {
  return runFlash({
    scriptPath,
    args: ['--preset', 'debug'],
    cwd,
    spawn: spawnReturning(child),
    ...overrides
  });
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test('reports each flash milestone once with increasing percentages', async () => {
  const child = new FakeChild();
  const seen: FlashEvent[] = [];
  const running = startRun(child, { onEvent: (event) => seen.push(event) });
  await nextTurn();

  child.stdout.emit('data', Buffer.from([
    '\u001B[32mInfo : Open On-Chip Debugger 0.12.0\u001B[0m',
    'Info : clock speed 1000 kHz',
    '** Programming Started **',
    '** Programming Finished **',
    '** Verified OK **',
    '** Resetting Target **',
    'Flash completed successfully.'
  ].join('\n') + '\n'));
  child.emit('close', 0, null);

  const result = await running;
  assert.equal(result.ok, true);
  assert.equal(result.exitCode, 0);
  assert.equal(result.cancelled, false);
  assert.equal(result.spawnError, undefined);
  assert.deepEqual(result.events.map((event) => event.stage), [
    'init',
    'program',
    'program',
    'verify',
    'reset',
    'done'
  ]);
  assert.deepEqual(result.events.map((event) => event.percent), [10, 40, 70, 85, 95, 100]);
  assert.deepEqual(seen, result.events);
  for (let index = 1; index < result.events.length; index += 1) {
    assert.ok((result.events[index].percent ?? 0) > (result.events[index - 1].percent ?? 0));
  }
});

test('parses the backend failure line and keeps the exit code', async () => {
  const child = new FakeChild();
  const running = startRun(child);
  await nextTurn();

  child.stderr.emit('data', Buffer.from('Error: Could not initialize the target\nFlash failed (OpenOCD exit code 1)\n'));
  child.emit('close', 1, null);

  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(result.exitCode, 1);
  const failed = result.events.at(-1);
  assert.equal(failed?.stage, 'failed');
  assert.equal(failed?.message, 'Flash failed (OpenOCD exit code 1)');
  assert.equal(failed?.percent, undefined);
});

test('deduplicates repeated stage lines', async () => {
  const child = new FakeChild();
  const running = startRun(child);
  await nextTurn();

  child.stdout.emit('data', Buffer.from([
    'Info : first',
    'Info : second',
    '** Programming Started **',
    '** Programming Started **'
  ].join('\n') + '\n'));
  child.emit('close', 0, null);

  const result = await running;
  assert.deepEqual(result.events.map((event) => event.stage), ['init', 'program']);
});

test('surfaces a spawn ENOENT error without rejecting', async () => {
  const child = new FakeChild();
  const running = startRun(child);
  await nextTurn();

  child.emit('error', Object.assign(new Error('spawn python ENOENT'), { code: 'ENOENT' }));
  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, false);
  assert.match(result.spawnError ?? '', /ENOENT/);
  assert.equal(result.exitCode, undefined);
});

test('turns a synchronous spawn throw into spawnError', async () => {
  const spawn: SpawnFunction = (() => {
    throw new Error('spawn failed before startup');
  }) as unknown as SpawnFunction;
  const result = await runFlash({ scriptPath, args: [], cwd, spawn });
  assert.equal(result.ok, false);
  assert.equal(result.spawnError, 'spawn failed before startup');
  assert.equal(result.exitCode, undefined);
});

test('cancels by killing the child and resolves only when it closes', async () => {
  const child = new FakeChild();
  const controller = new AbortController();
  const running = startRun(child, { signal: controller.signal });
  await nextTurn();

  controller.abort();
  assert.equal(child.killCalls, 1);
  child.emit('close', null, 'SIGTERM');

  const result = await running;
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.equal(result.exitCode, undefined);
});

test('returns immediately when the signal is already aborted', async () => {
  const controller = new AbortController();
  controller.abort();
  let spawnCalls = 0;
  const spawn: SpawnFunction = (() => {
    spawnCalls += 1;
    return new FakeChild();
  }) as unknown as SpawnFunction;

  const result = await runFlash({ scriptPath, args: [], cwd, signal: controller.signal, spawn });
  assert.equal(spawnCalls, 0);
  assert.equal(result.ok, false);
  assert.equal(result.cancelled, true);
  assert.deepEqual(result.events, []);
  assert.deepEqual(result.outputTail, []);
});

test('keeps only the last 40 output lines by default', async () => {
  const child = new FakeChild();
  const running = startRun(child);
  await nextTurn();

  const lines = Array.from({ length: 50 }, (_value, index) => `line ${index}`);
  child.stdout.emit('data', Buffer.from(lines.join('\n') + '\n'));
  child.emit('close', 1, null);

  const result = await running;
  assert.equal(result.outputTail.length, 40);
  assert.equal(result.outputTail[0], 'line 10');
  assert.equal(result.outputTail.at(-1), 'line 49');
});

test('tailLines 0 disables the retained tail', async () => {
  const child = new FakeChild();
  const running = startRun(child, { tailLines: 0 });
  await nextTurn();

  child.stdout.emit('data', Buffer.from('anything\n'));
  child.emit('close', 0, null);

  const result = await running;
  assert.deepEqual(result.outputTail, []);
  assert.equal(result.ok, true);
});

test('a cancelled process that never exits still settles after the grace period', async () => {
  const { runTool } = await import('../flash/flashRunner');
  const child = new FakeChild();
  const controller = new AbortController();
  const running = runTool({
    executable: 'openocd',
    args: ['-f', 'board.cfg'],
    cwd,
    signal: controller.signal,
    spawn: spawnReturning(child),
    abortGraceMs: 20
  } as Parameters<typeof runTool>[0]);
  await nextTurn();
  controller.abort();
  const result = await running;
  assert.equal(result.cancelled, true);
  assert.equal(result.ok, false);
  assert.equal(child.killCalls, 1);
});
