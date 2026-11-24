import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeConfiguredPath } from '../shared/configuredPath';

test('strips the quotes Explorer adds when copying a path', () => {
  assert.equal(
    normalizeConfiguredPath('"C:\\Program Files\\OpenOCD\\bin\\openocd.exe"'),
    'C:\\Program Files\\OpenOCD\\bin\\openocd.exe'
  );
});

test('expands environment variables and a leading tilde', () => {
  const environment = { ProgramFiles: 'D:\\Apps', USERPROFILE: 'C:\\Users\\dev' } as NodeJS.ProcessEnv;
  assert.equal(
    normalizeConfiguredPath('%ProgramFiles%\\OpenOCD\\bin\\openocd.exe', environment),
    'D:\\Apps\\OpenOCD\\bin\\openocd.exe'
  );
  assert.equal(normalizeConfiguredPath('~/bin/openocd', environment), 'C:\\Users\\dev/bin/openocd');
});

test('keeps an unknown variable and trims surrounding whitespace', () => {
  assert.equal(normalizeConfiguredPath('  %NOPE%\\tool.exe  ', {} as NodeJS.ProcessEnv), '%NOPE%\\tool.exe');
});

test('an empty or missing value stays empty', () => {
  assert.equal(normalizeConfiguredPath(''), '');
  assert.equal(normalizeConfiguredPath(undefined), '');
  assert.equal(normalizeConfiguredPath('""'), '');
});
