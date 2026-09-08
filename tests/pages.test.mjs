import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, readFile, readdir, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {buildPages} from '../scripts/build-pages.mjs';

test('Pages artifact contains the application and excludes native server and tests', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'branchglass-pages-test-'));
  try {
    const out = await buildPages(join(temp, 'site'), {requireVendor: false});
    const files = await readdir(out);
    for (const name of ['index.html', 'app.js', 'styles.css', 'core', '.nojekyll', 'LICENSE', 'build.json']) assert.ok(files.includes(name), name);
    for (const name of ['server', 'tests', '.git', '.github', 'node_modules', 'package.json']) assert.ok(!files.includes(name), name);
    assert.ok((await stat(join(out, 'core/worker.js'))).isFile());
    assert.equal(JSON.parse(await readFile(join(out, 'build.json'), 'utf8')).name, 'Branchglass');
  } finally {await rm(temp, {recursive: true, force: true});}
});

test('Pages assets resolve below the project subpath', async () => {
  const html = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    assert.ok(!match[1].startsWith('/'), `Root-relative asset: ${match[1]}`);
    assert.ok(new URL(match[1], 'https://example.github.io/Branchglass/').pathname.startsWith('/Branchglass/'));
  }
});

test('Pages builder refuses to overwrite the source tree', async () => {
  await assert.rejects(buildPages(fileURLToPath(new URL('../', import.meta.url))), /must not overwrite/);
  await assert.rejects(buildPages(fileURLToPath(new URL('../web', import.meta.url))), /must not overwrite/);
});
