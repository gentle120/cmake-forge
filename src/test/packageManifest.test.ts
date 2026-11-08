import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('uses the extension name in command and settings display titles', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
  assert.deepEqual(
    manifest.contributes.commands.map((command: { title: string }) => command.title),
    [
      'CMake Forge: Generate MCU Project',
      'CMake Forge: Generate Linux Project',
      'CMake Forge: Generate C/C++ Project',
      'CMake Forge: Generate OpenOCD Flash Script',
      'CMake Forge: Generate Cortex-Debug Configuration',
      'CMake Forge: Import CMSIS Pack',
      'CMake Forge: Install Pack Online',
      'CMake Forge: Remove Imported CMSIS Pack',
      'CMake Forge: Install ARM CMSIS Core Pack'
    ]
  );
  assert.ok(!manifest.contributes.commands.some((command: { command: string }) =>
    ['cmakeForge.scanEnvironment', 'cmakeForge.buildProject', 'cmakeForge.selectArmToolchain']
      .includes(command.command)
  ));
  assert.equal(manifest.contributes.configuration.properties['cmakeForge.armToolchainPath'], undefined);
  assert.equal(manifest.contributes.configuration.title, 'CMake Forge');
  assert.ok(manifest.extensionDependencies.includes('ms-vscode.cmake-tools'));
  assert.ok(!manifest.extensionDependencies.includes('marus25.cortex-debug'));
});

test('exposes the Pack mirror as an optional setting', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const mirror = manifest.contributes.configuration.properties['cmakeForge.packMirror'];

  // A mirror is an opt-in speedup, never a requirement: the default stays empty
  // so an install with no configuration still goes straight to the CDN.
  assert.equal(mirror.type, 'string');
  assert.equal(mirror.default, '');
});

test('registers every contributed command in the extension host', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const source = readFileSync(join(__dirname, '..', '..', 'src', 'extension.ts'), 'utf8');
  const registered = [...source.matchAll(/registerCommand\(\s*'([^']+)'/g)].map((match) => match[1]);

  assert.deepEqual(
    manifest.contributes.commands.map((command: { command: string }) => command.command),
    registered
  );
});

test('ships every icon the manifest contributes', () => {
  const root = join(__dirname, '..', '..');
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const containers = manifest.contributes.viewsContainers.activitybar as Array<{ icon?: string }>;
  for (const container of containers) {
    assert.ok(container.icon, 'activity bar entry needs an icon');
    // A missing file makes VS Code render an empty activity-bar slot with only a
    // log error, which looks like the extension itself is broken.
    assert.ok(existsSync(join(root, container.icon!)), `${container.icon} must exist`);
  }
});

test('keeps the Marketplace icon square and below the upload size limit', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));
  const iconPath = join(__dirname, '..', '..', manifest.icon);
  const icon = readFileSync(iconPath);
  const width = icon.readUInt32BE(16);
  const height = icon.readUInt32BE(20);

  assert.equal(width, 256);
  assert.equal(height, 256);
  assert.ok(icon.byteLength < 1024 * 1024, `icon is ${icon.byteLength} bytes`);
});
