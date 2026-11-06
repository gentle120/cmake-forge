import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { parseIncomingMessage } from '../sidebar/messages';

test('accepts each supported sidebar command', () => {
  assert.deepEqual(parseIncomingMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepEqual(parseIncomingMessage({ type: 'scanWorkspace' }), { type: 'scanWorkspace' });
  assert.deepEqual(parseIncomingMessage({ type: 'generateProject' }), { type: 'generateProject' });
  assert.deepEqual(parseIncomingMessage({ type: 'generateFlashScript' }), {
    type: 'generateFlashScript'
  });
  assert.deepEqual(parseIncomingMessage({ type: 'generateDebugConfiguration' }), {
    type: 'generateDebugConfiguration'
  });
  assert.deepEqual(parseIncomingMessage({ type: 'buildProject' }), { type: 'buildProject' });
  assert.deepEqual(parseIncomingMessage({ type: 'browseArmToolchain' }), { type: 'browseArmToolchain' });
  assert.deepEqual(parseIncomingMessage({ type: 'openSettings' }), { type: 'openSettings' });
});

test('keeps the selection payload for provider-side sanitization', () => {
  const selection = { mode: 'linux', nested: true };
  assert.deepEqual(parseIncomingMessage({ type: 'saveSelection', selection }), {
    type: 'saveSelection',
    selection
  });
});

test('accepts the selected project root and rejects non-string values', () => {
  assert.deepEqual(parseIncomingMessage({ type: 'setProjectRoot', root: 'C:/work/app' }), {
    type: 'setProjectRoot',
    root: 'C:/work/app'
  });
  assert.equal(parseIncomingMessage({ type: 'setProjectRoot' }), undefined);
  assert.equal(parseIncomingMessage({ type: 'setProjectRoot', root: 42 }), undefined);
});

test('accepts only string toolchain paths and allows clearing the configured directory', () => {
  assert.deepEqual(parseIncomingMessage({ type: 'setArmToolchainPath', path: 'C:/Arm/bin' }), {
    type: 'setArmToolchainPath', path: 'C:/Arm/bin'
  });
  assert.deepEqual(parseIncomingMessage({ type: 'setArmToolchainPath', path: '' }), {
    type: 'setArmToolchainPath', path: ''
  });
  assert.equal(parseIncomingMessage({ type: 'setArmToolchainPath' }), undefined);
  assert.equal(parseIncomingMessage({ type: 'setArmToolchainPath', path: 42 }), undefined);
});

test('rejects malformed messages', () => {
  assert.equal(parseIncomingMessage(undefined), undefined);
  assert.equal(parseIncomingMessage(null), undefined);
  assert.equal(parseIncomingMessage([]), undefined);
  assert.equal(parseIncomingMessage('ready'), undefined);
  assert.equal(parseIncomingMessage({}), undefined);
  assert.equal(parseIncomingMessage({ type: 'unknown' }), undefined);
  assert.equal(parseIncomingMessage({ type: 'saveSelection' }), undefined);
});

test('provider routes buildProject to the cmakeEmbedded.buildProject command', () => {
  const provider = readFileSync(join(__dirname, '..', '..', 'src', 'sidebar', 'provider.ts'), 'utf8');
  const block = provider.slice(provider.indexOf("message.type === 'buildProject'"));
  assert.ok(
    /vscode\.commands\.executeCommand(?:<[^\n]+>)?\('cmakeEmbedded\.buildProject'\)/.test(block),
    'expected buildProject to dispatch the cmakeEmbedded.buildProject command'
  );
});
