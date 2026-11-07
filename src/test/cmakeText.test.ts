import assert from 'node:assert/strict';
import test from 'node:test';
import { cmakeString, hexadecimal, indented, kilobytes, projectPath } from '../shared/cmakeText';

test('cmakeString normalizes Windows separators and escapes quotes', () => {
  assert.equal(cmakeString('src\\app main.c'), 'src/app main.c');
  assert.equal(cmakeString('a"b.c'), 'a\\"b.c');
});

test('projectPath expands the generator root variable', () => {
  assert.equal(projectPath('MCU_PROJECT_ROOT', 'src/main.c'), '"${MCU_PROJECT_ROOT}/src/main.c"');
  assert.equal(projectPath('LINUX_PROJECT_ROOT', '.'), '"${LINUX_PROJECT_ROOT}/."');
});

test('projectPath keeps a Windows path usable inside a CMake string', () => {
  assert.equal(projectPath('ROOT', 'inc\\sub'), '"${ROOT}/inc/sub"');
});

test('indented writes one entry per line with the house indentation', () => {
  assert.equal(indented(['a', 'b']), '    a\n    b');
  assert.equal(indented([]), '');
});

test('hexadecimal prints a fixed-width upper-case address', () => {
  assert.equal(hexadecimal(0x08000000), '0x08000000');
  assert.equal(hexadecimal(0x2000), '0x00002000');
});

test('kilobytes renders linker-script sizes', () => {
  assert.equal(kilobytes(64 * 1024), '64K');
  assert.equal(kilobytes(1536), '1.5K');
});
