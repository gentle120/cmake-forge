import assert from 'node:assert/strict';
import test from 'node:test';
import { parseIncomingMessage } from '../sidebar/messages';

test('accepts each supported sidebar command', () => {
  assert.deepEqual(parseIncomingMessage({ type: 'ready' }), { type: 'ready' });
  assert.deepEqual(parseIncomingMessage({ type: 'scanWorkspace' }), { type: 'scanWorkspace' });
  assert.deepEqual(parseIncomingMessage({ type: 'cancelWorkspaceScan' }), {
    type: 'cancelWorkspaceScan'
  });
  assert.deepEqual(parseIncomingMessage({ type: 'generateProject' }), { type: 'generateProject' });
  assert.deepEqual(parseIncomingMessage({ type: 'generateFlashScript' }), {
    type: 'generateFlashScript'
  });
  assert.deepEqual(parseIncomingMessage({ type: 'generateDebugConfiguration' }), {
    type: 'generateDebugConfiguration'
  });
  assert.deepEqual(parseIncomingMessage({ type: 'openSettings' }), { type: 'openSettings' });
  assert.equal(parseIncomingMessage({ type: 'scanEnvironment' }), undefined);
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

test('accepts Pack selection and version activation messages', () => {
  assert.deepEqual(parseIncomingMessage({ type: 'selectPack', packId: 'STM:STM32F1xx_DFP' }), {
    type: 'selectPack',
    packId: 'STM:STM32F1xx_DFP'
  });
  assert.deepEqual(parseIncomingMessage({
    type: 'activatePack',
    packId: 'STM:STM32F1xx_DFP',
    version: '2.4.1'
  }), {
    type: 'activatePack',
    packId: 'STM:STM32F1xx_DFP',
    version: '2.4.1'
  });
  assert.equal(parseIncomingMessage({ type: 'activatePack', packId: 42, version: '1.0.0' }), undefined);
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
