import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import {
  buildOpenOcdDetectArgs,
  buildOpenOcdFlashArgs,
  coreFromCpuid,
  describeIdentity,
  familyFromDeviceId,
  detectChip,
  matchOpenOcdStage,
  parseIdentityLines
} from '../flash/openocdDirect';

const target = {
  interfaceConfig: 'interface/stlink.cfg',
  targetConfig: 'target/stm32f4x.cfg',
  transport: 'swd' as const,
  speedKHz: 4000
};

test('flash arguments program the image with verify, reset and exit', () => {
  const args = buildOpenOcdFlashArgs({
    target,
    firmwarePath: 'D:\\repo\\build\\debug\\app.elf',
    verify: true,
    reset: true
  });
  assert.deepEqual(args, [
    '-f', 'interface/stlink.cfg',
    '-f', 'target/stm32f4x.cfg',
    '-c', 'foreach _mcu_target [target names] { $_mcu_target configure -work-area-backup 1 }',
    '-c', 'adapter speed 4000',
    '-c', 'program "D:/repo/build/debug/app.elf" verify reset exit'
  ]);
});

test('flash arguments drop verify and reset when the user turns them off', () => {
  const args = buildOpenOcdFlashArgs({
    target,
    firmwarePath: '/repo/build/app.elf',
    verify: false,
    reset: false
  });
  assert.equal(args.at(-1), 'program "/repo/build/app.elf" exit');
});

test('jtag targets select the transport and search directories come first', () => {
  const args = buildOpenOcdFlashArgs(
    {
      target: { ...target, transport: 'jtag' },
      firmwarePath: '/repo/build/app.elf',
      verify: true,
      reset: true
    },
    ['/opt/openocd/share/openocd/scripts']
  );
  assert.deepEqual(args.slice(0, 2), ['-s', '/opt/openocd/share/openocd/scripts']);
  assert.ok(args.includes('transport select jtag'));
});

test('detect arguments read CPUID and both DBGMCU windows, then shut down', () => {
  const args = buildOpenOcdDetectArgs(target);
  const commands = args.filter((value, index) => args[index - 1] === '-c');
  assert.ok(args.includes('-f'));
  assert.ok(commands.includes('init'));
  assert.ok(commands.includes('shutdown'));
  assert.ok(commands.some((command) => command.includes('EP_CPUID') && command.includes('0xE000ED00')));
  assert.ok(commands.some((command) => command.includes('EP_IDCODE') && command.includes('0xE0042000')));
  assert.ok(commands.some((command) => command.includes('EP_IDCODE_ALT') && command.includes('0x40015800')));
  assert.ok(!commands.some((command) => command.includes('program')));
});

test('identity lines turn into core, family and device id', () => {
  const identity = parseIdentityLines([
    'Info : clock speed 2000 kHz',
    'EP_CPUID 410FC241',
    'EP_IDCODE 10076413',
    'EP_IDCODE_ALT 00000000'
  ]);
  assert.equal(identity.cpuid, 0x410fc241);
  assert.equal(identity.core, 'Cortex-M4');
  assert.equal(identity.deviceId, 0x413);
  assert.equal(identity.family, 'STM32F4x');
  assert.equal(describeIdentity(identity), 'Cortex-M4 · STM32F4x · DEV_ID 0x413');
});

test('a zero or all-ones idcode is treated as unread and the alt window is used', () => {
  const identity = parseIdentityLines(['EP_CPUID 410FC241', 'EP_IDCODE 00000FFF', 'EP_IDCODE_ALT 20036410']);
  assert.equal(identity.deviceId, 0x410);
  assert.equal(identity.family, 'STM32F1x');
  assert.equal(identity.revision, 0x2003);
});

test('unknown device ids are reported raw instead of guessed', () => {
  const identity = parseIdentityLines(['EP_IDCODE 12345ABC']);
  assert.equal(identity.deviceId, 0xabc);
  assert.equal(identity.family, undefined);
  assert.equal(describeIdentity(identity), 'DEV_ID 0xABC');
});

test('cpuid and device id lookups cover the M0+ corner and an STM32G0 part', () => {
  assert.equal(coreFromCpuid(0x410cc601), 'Cortex-M0+');
  assert.equal(coreFromCpuid(0x410fc241), 'Cortex-M4');
  assert.equal(familyFromDeviceId(0x460), 'STM32G0x');
  assert.equal(familyFromDeviceId(0x999), undefined);
});

test('OpenOCD stage markers map to progress events and failures', () => {
  assert.deepEqual(matchOpenOcdStage('** Programming Started **'), { stage: 'program', message: '** Programming Started **', percent: 40 });
  assert.deepEqual(matchOpenOcdStage('** Programming Finished **'), { stage: 'program', message: '** Programming Finished **', percent: 70 });
  assert.deepEqual(matchOpenOcdStage('** Verified OK **'), { stage: 'verify', message: '** Verified OK **', percent: 85 });
  assert.deepEqual(matchOpenOcdStage('** Resetting Target **'), { stage: 'reset', message: '** Resetting Target **', percent: 95 });
  assert.deepEqual(matchOpenOcdStage('shutdown command invoked'), { stage: 'done', message: 'shutdown command invoked', percent: 100 });
  assert.equal(matchOpenOcdStage('Error: open failed')?.stage, 'failed');
  assert.equal(matchOpenOcdStage('Info : Listening on port 3333 for gdb connections'), undefined);
});

class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();

  kill(): boolean {
    return true;
  }
}

type SpawnFunction = typeof import('node:child_process').spawn;

function spawnSequence(children: FakeChild[]): SpawnFunction {
  let index = 0;
  return ((_command: string, _args: readonly string[], _options: unknown) => {
    const child = children[Math.min(index, children.length - 1)];
    index += 1;
    return child;
  }) as unknown as SpawnFunction;
}

async function nextTurn(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

test('a probe that cannot open is skipped and the next interface reports the chip', async () => {
  const failing = new FakeChild();
  const working = new FakeChild();
  const detecting = detectChip({
    openocdPath: 'openocd',
    probes: [
      { id: 'jlink', interfaceConfig: 'interface/jlink.cfg' },
      { id: 'stlink', interfaceConfig: 'interface/stlink.cfg' }
    ],
    targetConfig: 'target/stm32f4x.cfg',
    transport: 'swd',
    speedKHz: 2000,
    cwd: 'C:/project',
    spawn: spawnSequence([failing, working])
  });
  await nextTurn();
  failing.stderr.emit('data', Buffer.from('Error: open failed\n'));
  failing.emit('close', 1, null);
  await nextTurn();
  working.stdout.emit('data', Buffer.from('EP_CPUID 410FC241\nEP_IDCODE 10076413\n'));
  working.emit('close', 0, null);
  const result = await detecting;
  assert.equal(result.ok, true);
  assert.equal(result.probeId, 'stlink');
  assert.equal(result.identity?.core, 'Cortex-M4');
  assert.equal(result.identity?.family, 'STM32F4x');
});

test('no probe answering means a failed detection rather than an exception', async () => {
  const child = new FakeChild();
  const detecting = detectChip({
    openocdPath: 'openocd',
    probes: [{ id: 'stlink', interfaceConfig: 'interface/stlink.cfg' }],
    targetConfig: 'target/stm32f4x.cfg',
    transport: 'swd',
    speedKHz: 2000,
    cwd: 'C:/project',
    timeoutMs: 1000,
    spawn: spawnSequence([child])
  });
  await nextTurn();
  child.stderr.emit('data', Buffer.from('Error: open failed\n'));
  child.emit('close', 1, null);
  const result = await detecting;
  assert.equal(result.ok, false);
  assert.equal(result.identity, undefined);
  assert.ok(result.outputTail.some((line) => line.includes('open failed')));
});
