// Optional browser-only Git dependency. Native Git + the entire UI need no npm
// install. This script pins and vendors the upstream MIT-licensed distribution.
import {writeFile,mkdir} from 'node:fs/promises';
const version='1.41.9';
const root=new URL('../web/vendor/',import.meta.url);await mkdir(root,{recursive:true});
for(const [remote,local] of [['index.umd.min.js','isomorphic-git.js'],['http/web/index.js','http.js'],['LICENSE.md','isomorphic-git.LICENSE.md']]) {
  const url=`https://cdn.jsdelivr.net/npm/isomorphic-git@${version}/${remote}`;
  const response=await fetch(url,{signal:AbortSignal.timeout(60000)});
  if(!response.ok)throw Error(`${response.status}: ${url}`);
  await writeFile(new URL(local,root),new Uint8Array(await response.arrayBuffer()));
  console.log(`Vendored ${local}`);
}
