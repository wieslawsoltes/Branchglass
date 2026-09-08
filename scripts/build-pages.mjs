/** Create a static-only GitHub Pages artifact. No bridge or repository data. */
import {cp, mkdir, readFile, rm, writeFile} from 'node:fs/promises';
import {resolve, dirname, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
export async function buildPages(destination = resolve(root, '_site'), {requireVendor = true} = {}) {
  const out = resolve(destination), source = resolve(root, 'web');
  if (out === resolve(root) || resolve(root).startsWith(out + sep) || out === source || out.startsWith(source + sep)) {
    throw new Error('The Pages output must not overwrite the repository or web sources.');
  }
  if (requireVendor) {
    for (const name of ['isomorphic-git.js', 'isomorphic-git.LICENSE.md']) {
      await readFile(resolve(source, 'vendor', name)).catch(() => {
        throw new Error(`Missing browser dependency ${name}. Run npm run vendor first.`);
      });
    }
  }
  await rm(out, {recursive: true, force: true});
  await mkdir(out, {recursive: true});
  await cp(source, out, {recursive: true, dereference: false});
  for (const name of ['LICENSE', 'THIRD_PARTY.md']) await cp(resolve(root, name), resolve(out, name));
  await writeFile(resolve(out, '.nojekyll'), '');
  const {version} = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  await writeFile(resolve(out, 'build.json'), JSON.stringify({name: 'Branchglass', version, commit: process.env.GITHUB_SHA || null}, null, 2) + '\n');
  return out;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log('Static Pages artifact:', await buildPages());
}
