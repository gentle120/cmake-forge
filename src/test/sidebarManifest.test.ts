import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

test('registers the CMake sidebar as an Activity Bar webview', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));

  assert.equal(manifest.contributes.viewsContainers.activitybar[0].id, 'cmakeForge');
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].title, 'CMake Forge');
  assert.equal(manifest.contributes.viewsContainers.activitybar[0].icon, 'images/activity-icon.svg');
  assert.equal(manifest.contributes.views.cmakeForge[0].id, 'cmakeForge.sidebar');
  assert.equal(manifest.contributes.views.cmakeForge[0].type, 'webview');
  assert.ok(manifest.activationEvents.includes('onView:cmakeForge.sidebar'));
});

test('packages the local sidebar assets and Chinese default readme', () => {
  const manifest = JSON.parse(readFileSync(join(__dirname, '..', '..', 'package.json'), 'utf8'));

  assert.equal(manifest.readme, 'README.md');
  assert.ok(!manifest.files || manifest.files.some((entry: string) => entry.includes('sidebar')));
});
