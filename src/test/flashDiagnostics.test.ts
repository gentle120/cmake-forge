import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnoseFlashFailure, type FlashDiagnosis } from '../flash/flashDiagnostics';

function diagnose(
  output: string[],
  overrides: Partial<{ exitCode: number; spawnError: string; backend: 'openocd' | 'jlink' | 'pyocd' }> = {}
): FlashDiagnosis {
  return diagnoseFlashFailure({ output, backend: 'openocd', ...overrides });
}

test('maps a missing Python interpreter', () => {
  const diagnosis = diagnose([], { spawnError: 'spawn python ENOENT' });
  assert.equal(diagnosis.title, '找不到 Python');
  assert.match(diagnosis.detail, /ENOENT/);
  assert.equal(diagnosis.actions.length, 2);
  assert.match(diagnosis.actions.join(' '), /Python 3/);
});

test('maps a missing OpenOCD executable', () => {
  for (const line of ['Error: OpenOCD was not found. Set --openocd.', 'spawn openocd ENOENT']) {
    const diagnosis = diagnose([line]);
    assert.equal(diagnosis.title, '找不到 OpenOCD');
    assert.equal(diagnosis.detail, line);
    assert.match(diagnosis.actions.join(' '), /cmakeForge\.openocdPath/);
  }
});

test('maps an OpenOCD config file that cannot be opened', () => {
  for (const line of [
    'Error: unable to open file board/st_nucleo_f1.cfg',
    "Error: Couldn't find target/stm32f1x.cfg"
  ]) {
    const diagnosis = diagnose([line]);
    assert.equal(diagnosis.title, 'OpenOCD 找不到配置文件');
    assert.equal(diagnosis.detail, line);
    assert.match(diagnosis.actions.join(' '), /OPENOCD_SCRIPTS/);
  }
});

test('maps a busy probe or driver failure', () => {
  for (const line of ['Error: LIBUSB_ERROR_ACCESS', 'Error: open failed', 'Error: debug port already in use']) {
    const diagnosis = diagnose([line]);
    assert.equal(diagnosis.title, '探针被占用或驱动异常');
    assert.equal(diagnosis.detail, line);
    assert.match(diagnosis.actions.join(' '), /Keil/);
  }
});

test('maps a target configuration mismatch', () => {
  for (const line of [
    'Error: init mode failed (unable to connect to the target)',
    'Error: Target not examined yet',
    'Error: unknown target stm32f9x'
  ]) {
    const diagnosis = diagnose([line]);
    assert.equal(diagnosis.title, '目标芯片与 target 配置不匹配');
    assert.equal(diagnosis.detail, line);
    assert.match(diagnosis.actions.join(' '), /target/);
  }
});

test('maps a timeout', () => {
  for (const line of ['Error: OpenOCD timed out after 120 seconds.', 'Timeout waiting for target halt']) {
    const diagnosis = diagnose([line]);
    assert.equal(diagnosis.title, '烧录超时');
    assert.equal(diagnosis.detail, line);
    assert.match(diagnosis.actions.join(' '), /BOOT0/);
  }
});

test('falls back to the last non-empty line and the exit code', () => {
  const diagnosis = diagnose(['first line', ' Error: unexpected response ', ''], { exitCode: 7 });
  assert.equal(diagnosis.title, '烧录失败');
  assert.equal(diagnosis.detail, 'Error: unexpected response');
  assert.equal(diagnosis.actions.length, 2);
  assert.match(diagnosis.actions.join(' '), /输出面板/);
  assert.match(diagnosis.actions.join(' '), /7/);
});

test('fallback still explains an empty output', () => {
  const diagnosis = diagnose(['', '   '], { backend: 'jlink' });
  assert.equal(diagnosis.title, '烧录失败');
  assert.match(diagnosis.detail, /J-Link/);
  assert.match(diagnosis.detail, /未知/);
  assert.equal(diagnosis.actions.length, 2);
});
