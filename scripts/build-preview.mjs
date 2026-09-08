/** Build a self-contained sandbox HTML, with no bundler dependencies. */
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),web=path.join(root,'web');
const strip=source=>source.replace(/^import\s[^\n]+\n/gm,'').replace(/^export\s+(?=(?:async\s+)?(?:const|let|function|class)\b)/gm,'');
const diff=strip(await fs.readFile(path.join(web,'core/diff.js'),'utf8'));
const worker=diff+'\n'+strip(await fs.readFile(path.join(web,'core/worker.js'),'utf8'));
const files=['core/diff.js','core/fs-access.js','core/providers.js','core/gpu.js','core/github.js','core/ui.js','app.js'];
const modules=await Promise.all(files.map(async file=>'\n// '+file+'\n'+strip(await fs.readFile(path.join(web,file),'utf8'))));
const js=`globalThis.__BG_WORKER_URL__=URL.createObjectURL(new Blob([${JSON.stringify(worker)}],{type:'text/javascript'}));\n`+modules.join('\n');
let html=await fs.readFile(path.join(web,'index.html'),'utf8');
const css=await fs.readFile(path.join(web,'styles.css'),'utf8');
const icon=await fs.readFile(path.join(web,'icon.svg'),'utf8');
html=html.replace('<link rel="stylesheet" href="styles.css">',()=>`<style>${css}</style>`).replace('href="icon.svg"',`href="data:image/svg+xml,${encodeURIComponent(icon)}"`).replace('<script type="module" src="app.js"></script>',()=>`<script type="module">${js.replace(/<\/script/gi,'<\\/script')}</script>`);
await fs.writeFile(path.join(root,'Branchglass.html'),html);
console.log('Built Branchglass.html · '+Buffer.byteLength(html).toLocaleString()+' bytes');
