import {diffLines,selectChanges,patch} from './diff.js';
import {HandleFS} from './fs-access.js';
const encoder=new TextEncoder(),decoder=new TextDecoder();
export const sha=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',typeof data==='string'?encoder.encode(data):data))).map(x=>x.toString(16).padStart(2,'0')).join('');
const clone=o=>JSON.parse(JSON.stringify(o));
export class NativeProvider {
  constructor(token,repo=null){this.kind='native';this.token=token;this.repo=repo;}
  async call(action,args={}){
    const response=await fetch(new URL('api',document.baseURI),{method:'POST',headers:{'Content-Type':'application/json','X-Branchglass-Token':this.token},body:JSON.stringify({action,repo:this.repo?.id,args})});
    let data;try{data=await response.json();}catch{throw Error('Cannot reach the local bridge. Start it with npm start and use the private URL from your terminal.');}
    if(!response.ok||!data.ok)throw Error(data.error||'Local bridge request failed.');return data.result;
  }
  async open(path){this.repo=await this.call('open',{path});return this.repo;}
}

export const DEMO_PIPELINE=`/** A minimal rendering pipeline. */
export class RenderPipeline {
  constructor(device) {
    this.device = device;
    this.frameCount = 0;
    this.dirty = true;
  }

  render(scene) {
    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginRenderPass(scene.descriptor);
    pass.setPipeline(scene.pipeline);
    pass.draw(scene.vertexCount);
    pass.end();
    this.device.queue.submit([encoder.finish()]);
    this.frameCount++;
  }

  invalidate() {
    this.dirty = true;
  }
}
`;
export const DEMO_AFTER=DEMO_PIPELINE.replace('    this.dirty = true;','    this.dirty = true;\n    this.enableCulling = true;').replace('    const encoder = this.device.createCommandEncoder();','    if (!this.dirty) return;\n\n    const visible = scene.filterVisible(this.enableCulling);\n    const encoder = this.device.createCommandEncoder({\n      label: "horizon-frame",\n    });').replace('    pass.draw(scene.vertexCount);','    for (const batch of visible.batches) {\n      pass.setVertexBuffer(0, batch.buffer);\n      pass.draw(batch.vertexCount, batch.instanceCount);\n    }').replace('    this.frameCount++;','    this.frameCount++;\n    this.dirty = false;');
const demoBase={
  'src/renderer/pipeline.js':DEMO_PIPELINE,
  'src/renderer/buffer-pool.js':`export class BufferPool {\n  constructor(device) {\n    this.device = device;\n    this.buffers = new Map();\n  }\n\n  acquire(key, size, usage) {\n    const current = this.buffers.get(key);\n    if (current && current.size >= size) return current;\n    current?.destroy();\n    const buffer = this.device.createBuffer({size, usage});\n    this.buffers.set(key, buffer);\n    return buffer;\n  }\n\n  dispose() {\n    for (const buffer of this.buffers.values()) buffer.destroy();\n    this.buffers.clear();\n  }\n}\n`,
  'src/components/toolbar.js':`export function toolbar(actions) {\n  const root = document.createElement('nav');\n  root.className = 'toolbar';\n  for (const action of actions) {\n    const button = document.createElement('button');\n    button.textContent = action.label;\n    button.addEventListener('click', action.run);\n    root.append(button);\n  }\n  return root;\n}\n`,
  'src/components/command-menu.js':`export const commands = [\n  { id: 'open', label: 'Open workspace', shortcut: 'Mod+O' },\n  { id: 'search', label: 'Search everything', shortcut: 'Mod+K' },\n];\n\nexport function filterCommands(query) {\n  return commands.filter(command =>\n    command.label.toLowerCase().includes(query.toLowerCase())\n  );\n}\n`,
  'src/tokens.css':`:root {\n  --surface: #12151c;\n  --accent: #a395f7;\n  --radius: 8px;\n  --space: 8px;\n}\n`,
  'tests/renderer.test.js':`import {test} from 'node:test';\nimport {strict as assert} from 'node:assert';\ntest('viewport dimensions are positive', () => assert.ok(1280 > 0));\n`,
  'docs/performance.md':'# Performance budget\n\nRender only what is visible.\nRe-use GPU buffers between frames.\nAvoid allocating objects in the animation loop.\n',
  'README.md':'# Horizon\n\nA local-first rendering toolkit.\n\n## Getting started\n\nOpen index.html in your browser.\n',
  'package.json':'{\n  "name": "horizon",\n  "version": "0.9.0",\n  "type": "module"\n}\n',
  '.gitignore':'node_modules/\ndist/\n.DS_Store\n'
};
const subjects=[
 'feat: batch visible geometry in the WebGPU pipeline','perf: reuse vertex buffers across render passes','fix: keep selection stable when filtering commits','feat: add a reusable GPU buffer pool','Merge branch “fix/resize-observer” into main','fix: respect device pixel ratio on viewport resize','test: cover command discovery and filtering','docs: define viewport rendering budgets','design: refine focus rings and keyboard navigation','feat: searchable command menu','Merge command menu into main','perf: avoid layout reads during pointer movement','feat: persist workspace preferences locally','fix: clean up resize observers on dispose','design: introduce the graphite color system','feat: support keyboard shortcuts in toolbar','test: add coverage for viewport culling','docs: document accessibility expectations','refactor: extract shared event utilities','feat: add theme-aware design tokens','fix: preserve file selection during refresh','test: cover worker error recovery','feat: move layout calculations to a worker','perf: defer non-visible panels','feat: add WebGPU feature detection','docs: describe rendering architecture','feat: introduce the rendering pipeline','chore: initialize the Horizon workspace'
];
function fakeOid(n){let s='';for(let i=0;i<5;i++){n=Math.imul(n^0x9e3779b9,1664525)+1013904223;s+=(n>>>0).toString(16).padStart(8,'0');}return s;}
export class DemoProvider {
  constructor(){this.kind='demo';this.repo={id:'sandbox',name:'horizon',path:'Interactive sandbox · no local files connected',kind:'demo'};this.reset();}
  reset(){
    this.head=clone(demoBase);this.index=clone(this.head);this.work=clone(this.head);this.work['src/renderer/pipeline.js']=DEMO_AFTER;
    this.index['src/tokens.css']+='\n[data-theme="light"] {\n  --surface: #ffffff;\n  --accent: #725bc9;\n}\n';this.work['src/tokens.css']=this.index['src/tokens.css'];
    this.work['src/renderer/visibility.js']='export function intersects(a, b) {\n  return a.x < b.x + b.width &&\n    a.x + a.width > b.x &&\n    a.y < b.y + b.height &&\n    a.y + a.height > b.y;\n}\n';
    this.work['README.md']+='\n## WebGPU\n\nThe renderer batches visible geometry and reuses buffers.\n';
    this.branch='feature/webgpu-renderer';this.ahead=3;this.stash=[];this.activity=[];this.config={'user.name':'Alex Morgan','user.email':'alex@example.test'};
    this.commits=subjects.map((subject,i)=>({oid:fakeOid(50+i),parents:i<subjects.length-1?[fakeOid(51+i)]:[],subject,body:i===0?'Viewport-aware rendering with instanced draw calls.\n\nAvoid redundant frames and only submit visible batches.':'',author:['Alex Morgan','Alex Morgan','Jordan Lee','Alex Morgan','Sam Rivera','Sam Rivera','Jordan Lee'][i%7],email:'alex@example.test',timestamp:Math.floor(Date.now()/1000)-i*14000-2400,refs:[]}));
    const parents={0:[1],1:[3],2:[6],3:[4],4:[7,5],5:[8],6:[9],7:[10],8:[10],9:[12],10:[11,12],11:[14],12:[15],13:[17],14:[16],15:[18],16:[18],17:[19],18:[19],19:[20]};for(const [i,ps]of Object.entries(parents))this.commits[+i].parents=ps.map(p=>this.commits[p].oid);
    this.refs=[{name:this.branch,type:'branch',oid:this.commits[0].oid,current:true},{name:'main',type:'branch',oid:this.commits[4].oid},{name:'feature/command-menu',type:'branch',oid:this.commits[2].oid},{name:'fix/resize-observer',type:'branch',oid:this.commits[5].oid},{name:'origin/main',type:'remote',oid:this.commits[4].oid},{name:'origin/feature/webgpu-renderer',type:'remote',oid:this.commits[3].oid},{name:'v0.9.0',type:'tag',oid:this.commits[4].oid},{name:'v0.8.0',type:'tag',oid:this.commits[10].oid}];
    this.trees=new Map(this.commits.map(c=>[c.oid,clone(this.head)]));for(let i=1;i<this.commits.length;i++)this.trees.get(this.commits[i].oid)['src/renderer/pipeline.js']=DEMO_PIPELINE.replace('    this.frameCount++;','    this.frameCount += 1;');
    this.reflog=[];
  }
  status(){const paths=[...new Set([...Object.keys(this.head),...Object.keys(this.index),...Object.keys(this.work)])];return {files:paths.filter(p=>this.head[p]!==this.index[p]||this.index[p]!==this.work[p]).map(p=>({path:p,x:this.head[p]!==this.index[p]?(this.index[p]===undefined?'D':this.head[p]===undefined?'A':'M'):'.',y:this.index[p]!==this.work[p]?(this.work[p]===undefined?'D':this.index[p]===undefined?'?':'M'):'.',staged:this.head[p]!==this.index[p],unstaged:this.index[p]!==this.work[p],untracked:this.head[p]===undefined&&this.index[p]===undefined,conflict:false})),branch:{name:this.branch,oid:this.refs.find(r=>r.name===this.branch)?.oid||this.commits[0].oid,ahead:this.ahead,behind:0,upstream:'origin/'+this.branch},progress:[]};}
  async call(action,a={}){
    const record=msg=>{this.activity.push({at:new Date().toISOString(),command:`sandbox ${action}`,code:0,duration:0,output:msg});return {message:msg};};
    const value=(obj,p,v)=>{if(v===undefined)delete obj[p];else obj[p]=v;};
    switch(action){
      case 'snapshot':{const commits=this.commits.filter(c=>(!a.search||(c.subject+' '+c.oid+' '+c.author).toLowerCase().includes(a.search.toLowerCase()))&&(!a.author||c.author.toLowerCase().includes(a.author.toLowerCase()))).slice(0,a.limit||500).map(c=>({...c,refs:this.refs.filter(r=>r.oid===c.oid).map(r=>({...r,current:r.name===this.branch}))}));return {repo:this.repo,status:this.status(),commits,refs:this.refs.map(r=>({...r,current:r.name===this.branch})),stashes:this.stash,worktrees:[{path:'sandbox/horizon',branch:'refs/heads/'+this.branch,HEAD:this.commits[0].oid}],remotes:[{name:'origin',url:'https://github.com/example/horizon.git'}],limit:a.limit||500,gitVersion:'Interactive sandbox',allowHooks:false};}
      case 'status':return this.status();
      case 'log':return this.commits;
      case 'refs':return this.refs;
      case 'tree':return Object.keys(a.oid?this.trees.get(a.oid)||this.head:this.work).sort().map(path=>({path,type:'blob'}));
      case 'read':{const content=(a.oid?this.trees.get(a.oid)||this.head:this.work)[a.path];return {content:content||'',hash:content===undefined?'missing':await sha(content),exists:content!==undefined};}
      case 'pair':{let old,newer;if(a.mode==='commit'||a.mode==='compare'){newer=(this.trees.get(a.oid)||this.head)[a.path];const c=this.commits.find(c=>c.oid===a.oid);old=(this.trees.get(a.base||c?.parents[0])||{})[a.path];}else if(a.mode==='staged'){old=this.head[a.path];newer=this.index[a.path];}else{old=this.index[a.path];newer=this.work[a.path];}return {path:a.path,mode:a.mode||'unstaged',before:old||'',after:newer||'',beforeHash:old===undefined?'missing':await sha(old),afterHash:newer===undefined?'missing':await sha(newer),beforeExists:old!==undefined,afterExists:newer!==undefined,binary:false,image:false,beforeSize:old?.length||0,afterSize:newer?.length||0,editable:a.mode!=='staged'&&a.mode!=='commit'&&a.mode!=='compare'};}
      case 'commitFiles':{const c=this.commits.find(c=>c.oid===a.oid),old=this.trees.get(a.base||c?.parents[0])||{},now=this.trees.get(a.oid)||this.head;return [...new Set([...Object.keys(old),...Object.keys(now)])].filter(p=>old[p]!==now[p]).map(p=>({path:p,status:old[p]===undefined?'A':now[p]===undefined?'D':'M'}));}
      case 'stage':for(const p of a.paths)value(this.index,p,this.work[p]);return record('Files staged in sandbox.');
      case 'unstage':for(const p of a.paths)value(this.index,p,this.head[p]);return record('Files unstaged in sandbox.');
      case 'selection':{const p=await this.call('pair',a);if(p.beforeHash!==a.beforeHash||p.afterHash!==a.afterHash)throw Error('Diff changed. Refresh first.');const content=selectChanges(p.before,p.after,a.ids,a.mode==='staged');if(a.mode==='staged'&&!p.beforeExists&&!content)delete this.index[a.path];else this.index[a.path]=content;return record('Selected changes updated in sandbox index.');}
      case 'save':case 'newFile':{const cur=this.work[a.path];if(a.expectedHash!==undefined&&a.expectedHash!==(cur===undefined?'missing':await sha(cur)))throw Error('The file has changed. Reload it first.');this.work[a.path]=a.content||'';return {hash:await sha(this.work[a.path]),message:'Saved in sandbox.'};}
      case 'renameFile':if(this.work[a.to]!==undefined)throw Error('Destination exists.');this.work[a.to]=this.work[a.path];delete this.work[a.path];return record('Renamed in sandbox.');
      case 'deleteFile':delete this.work[a.path];return record('Deleted in sandbox.');
      case 'discard':for(const p of a.paths)value(this.work,p,this.index[p]);return record('Unstaged changes discarded in sandbox.');
      case 'commit':{if(!a.message?.trim())throw Error('Enter a commit message.');if(!this.status().files.some(f=>f.staged)&&!a.amend)throw Error('Stage changes before committing.');const oid=fakeOid(Date.now()),current=this.refs.find(r=>r.name===this.branch),c={oid,parents:[current?.oid||this.commits[0].oid],subject:a.message.split('\n')[0],body:a.message.split('\n').slice(1).join('\n'),author:this.config['user.name'],email:this.config['user.email'],timestamp:Math.floor(Date.now()/1000),refs:[]};if(a.amend){c.parents=this.commits[0].parents;this.commits.shift();}this.commits.unshift(c);this.head=clone(this.index);this.trees.set(oid,clone(this.head));if(current)current.oid=oid;this.ahead++;this.reflog.unshift({oid,selector:'HEAD@{0}',subject:'commit: '+c.subject,timestamp:c.timestamp});return record('Commit created in the interactive sandbox.');}
      case 'branchCreate':if(this.refs.some(r=>r.name===a.name))throw Error('Branch already exists.');this.refs.push({name:a.name,oid:a.ref==='HEAD'||!a.ref?this.commits[0].oid:(this.refs.find(r=>r.name===a.ref)?.oid||a.ref),type:'branch'});if(a.checkout)this.branch=a.name;return record('Sandbox branch created.');
      case 'checkout':{if(this.status().files.length)throw Error('Commit or stash your sandbox changes before switching.');const r=this.refs.find(r=>r.name===a.ref);if(!r&&!a.detached)throw Error('Branch not found.');this.branch=r?.name||'detached';this.head=clone(this.trees.get(r?.oid||a.ref)||this.head);this.index=clone(this.head);this.work=clone(this.head);return record('Sandbox branch checked out.');}
      case 'branchDelete':if(a.name===this.branch)throw Error('Cannot delete the current branch.');this.refs=this.refs.filter(r=>r.name!==a.name);return record('Sandbox branch removed.');
      case 'branchRename':{const r=this.refs.find(r=>r.name===a.name);if(!r)throw Error('Branch not found.');r.name=a.to;if(this.branch===a.name)this.branch=a.to;return record('Sandbox branch renamed.');}
      case 'tagCreate':this.refs.push({name:a.name,type:'tag',oid:a.ref==='HEAD'||!a.ref?this.commits[0].oid:a.ref});return record('Sandbox tag created.');
      case 'tagDelete':this.refs=this.refs.filter(r=>!(r.type==='tag'&&r.name===a.name));return record('Sandbox tag removed.');
      case 'stashSave':this.stash.unshift({name:`stash@{${this.stash.length}}`,oid:fakeOid(Date.now()),subject:a.message||'Work in progress',timestamp:Math.floor(Date.now()/1000),work:clone(this.work),index:clone(this.index)});this.index=clone(this.head);this.work=clone(this.head);return record('Sandbox changes stashed.');
      case 'stashApply':case 'stashPop':{const s=this.stash.find(s=>s.name===a.name);if(!s)throw Error('Stash not found.');if(this.status().files.length)throw Error('Commit or stash changes first.');this.work=clone(s.work);this.index=clone(s.index);if(action==='stashPop')this.stash=this.stash.filter(x=>x!==s);return record('Sandbox stash restored.');}
      case 'stashDrop':this.stash=this.stash.filter(s=>s.name!==a.name);return record('Sandbox stash dropped.');
      case 'patchExport':{const p=await this.call('pair',{...a,path:a.path||'src/renderer/pipeline.js'});return {patch:patch(p.before,p.after,p.path)};}
      case 'blame':{const content=this.head[a.path]||'';return content.split('\n').map((text,i)=>({text,line:i+1,author:this.commits[i%4].author,oid:this.commits[i%4].oid,'author-time':this.commits[i%4].timestamp,summary:this.commits[i%4].subject}));}
      case 'reflog':return [...this.reflog,...this.commits.slice(0,16).map((c,i)=>({oid:c.oid,selector:`HEAD@{${i+this.reflog.length}}`,subject:'commit: '+c.subject,timestamp:c.timestamp}))];
      case 'activity':return this.activity;
      case 'config':return this.config;
      case 'configSave':Object.assign(this.config,a.values);return record('Sandbox identity saved.');
      case 'search':return Object.entries(this.work).flatMap(([path,text])=>text.split('\n').flatMap((text,i)=>text.toLowerCase().includes((a.query||'').toLowerCase())?[{path,line:i+1,text}]:[])).slice(0,1000);
      case 'lfsStatus':return {available:false,output:'Connect a native repository to inspect Git LFS.'};
      case 'submodules':return {output:'No submodules in this sandbox.'};
      case 'bisectStatus':return {output:'Connect a native repository to run a real bisect.'};
      case 'rebasePlan':return {base:a.base,commits:clone(this.commits.slice(0,3)).reverse()};
      default:throw Error('This operation needs a real repository. Open a local repository through the Git bridge. The sandbox never pretends to run native or remote operations.');
    }
  }
}

let gitPromise;
export async function loadBrowserGit(){
  if(window.git)return window.git;
  if(gitPromise)return gitPromise;
  gitPromise=(async()=>{
    const load=src=>new Promise((resolve,reject)=>{const s=document.createElement('script');s.src=src;s.onload=resolve;s.onerror=()=>{s.remove();reject(Error('Cannot load browser Git dependency.'));};document.head.append(s);});
    try{await load(new URL('vendor/isomorphic-git.js',document.baseURI));}catch{await load('https://cdn.jsdelivr.net/npm/isomorphic-git@1.41.9/index.umd.min.js');}
    if(!window.git)throw Error('Browser Git library did not initialize. Run npm run vendor while online.');return window.git;
  })();
  try{return await gitPromise;}catch(e){gitPromise=null;throw e;}
}
// Native fetch transport compatible with isomorphic-git's HTTP client contract.
const browserHTTP={async request({url,method='GET',headers={},body,signal}){
  let payload;if(body){const chunks=[];for await(const c of body)chunks.push(c);payload=new Blob(chunks);}
  const response=await fetch(url,{method,headers,body:payload,signal});
  return {url:response.url,method,statusCode:response.status,statusMessage:response.statusText,headers:Object.fromEntries(response.headers),body:(async function*(){const reader=response.body.getReader();try{while(true){const {done,value}=await reader.read();if(done)break;yield value;}}finally{reader.releaseLock();}})()};
}};

/** Browser Git is opt-in. Unsupported POSIX/worktree/LFS/rebase operations fail
 * explicitly; full-fidelity native repositories should use the local bridge. */
export class BrowserProvider {
  constructor(handle,{name=handle.name,opfs=false,corsProxy='',auth=null}={}){this.kind='browser';this.handle=handle;this.fs=new HandleFS(handle);this.repo={id:'browser-'+name,name,path:opfs?'Browser private storage / '+name:'Granted local folder / '+name,kind:'browser'};this.opfs=opfs;this.corsProxy=corsProxy;this.auth=typeof auth==='string'&&auth?{username:'x-access-token',password:auth}:auth;this.cache={};this.logbook=[];}
  async init({empty=false}={}){this.git=await loadBrowserGit();const dot=await this.fs.handle('/.git').catch(()=>null);if(dot?.kind==='file')throw Error('Linked worktrees use a .git pointer file. Open this repository through the native bridge.');if(!dot&&!empty)throw Error('This folder has no .git directory. Open an existing repository, or use Start something new.');return this;}
  opts(extra={}){return {fs:this.fs,dir:'/',cache:this.cache,...extra};}
  async oid(ref='HEAD'){let oid=await this.git.resolveRef(this.opts({ref}));for(let i=0;i<16;i++){const object=await this.git.readObject(this.opts({oid,format:'parsed'}));if(object.type!=='tag')return oid;oid=object.object.object;}throw Error('Tag chain is too deep.');}
  async assertCompatible(ref='HEAD'){
    const unsupported=message=>{throw Error(message+' Browser writes are blocked. Use the native Git bridge for this repository.');};
    for(const name of ['MERGE_HEAD','CHERRY_PICK_HEAD','REVERT_HEAD','rebase-merge','rebase-apply','BISECT_LOG','info/attributes'])if(await this.fs.handle('/.git/'+name).catch(()=>null))unsupported('A sequenced operation or custom attributes are present.');
    const config=await this.fs.readFile('/.git/config','utf8').catch(()=> '');
    if(/\[\s*(?:filter|lfs|submodule|extensions)(?:\s|\])/i.test(config))unsupported('Advanced Git configuration is present.');
    for(const name of ['core.autocrlf','core.sparseCheckout']){const value=await this.git.getConfig(this.opts({path:name}));if(value&&value!=='false')unsupported('Git line-ending conversion or sparse checkout is enabled.');}
    const trees=[this.git.STAGE()];let oid;try{oid=await this.oid(ref);}catch(e){if(ref!=='HEAD'||!['NotFoundError','ResolveRefError'].includes(e.code))throw e;}
    if(oid)trees.push(this.git.TREE({ref:oid}));
    await this.git.walk(this.opts({trees,map:async(filepath,entries)=>{if(filepath.split('/').at(-1)==='.gitattributes')unsupported('Git attributes require native normalization.');for(const entry of entries){if(!entry)continue;const mode=await entry.mode();if(mode&&mode!==0o100644&&mode!==0o40000)unsupported('Executable files, symlinks, or submodules are present.');}}}));
    const matrix=await this.git.statusMatrix(this.opts());if(matrix.some(([p])=>p.split('/').at(-1)==='.gitattributes'))unsupported('Git attributes require native normalization.');
  }
  async getBlob(ref,p){try{const oid=await this.oid(ref);const {blob}=await this.git.readBlob(this.opts({oid,filepath:p}));return {bytes:blob,exists:true};}catch{return {bytes:new Uint8Array(),exists:false};}}
  async indexBlob(p){try{let entry;await this.git.walk(this.opts({trees:[this.git.STAGE()],map:async(filepath,[stage])=>{if(filepath===p&&stage){const oid=await stage.oid();if(oid){const {object}=await this.git.readObject(this.opts({oid,format:'content'}));entry={bytes:object,exists:true};}}}}));return entry||{bytes:new Uint8Array(),exists:false};}catch{return {bytes:new Uint8Array(),exists:false};}}
  async workBlob(p){try{return {bytes:await this.fs.readFile('/'+p),exists:true};}catch(e){if(e.code==='ENOENT')return {bytes:new Uint8Array(),exists:false};throw e;}}
  validate(p){if(!p||p.split('/').some(x=>x==='..'||x.toLowerCase()==='.git')||p.startsWith('/')||p.includes('\\'))throw Error('Invalid file path.');return p;}
  async status(){const matrix=await this.git.statusMatrix(this.opts());const files=matrix.filter(([,h,w,s])=>h!==w||w!==s).map(([path,h,w,s])=>({path,x:h!==s?(s===0?'D':h===0?'A':'M'):'.',y:w!==s?(w===0?'D':h===0&&s===0?'?':'M'):'.',staged:h!==s,unstaged:w!==s,untracked:h===0&&s===0,conflict:false}));let branch=await this.git.currentBranch(this.opts({fullname:false}));return {files,branch:{name:branch||'(detached)',oid:await this.oid().catch(()=>''),ahead:0,behind:0,upstream:'',trackingUnknown:true},progress:[]};}
  async log(a={}){if(a.path)throw Error('Path-filtered history requires the native Git bridge.');const refs=a.branch?[a.branch]:['HEAD',...(await this.git.listBranches(this.opts())).map(x=>'refs/heads/'+x)];const entries=new Map();for(const ref of refs){try{for(const entry of await this.git.log(this.opts({ref,depth:a.limit||500})))entries.set(entry.oid,entry);}catch{}}
    // Topological ordering, with date priority only amongst zero-child commits.
    const values=[...entries.values()],children=new Map(values.map(c=>[c.oid,0]));for(const c of values)for(const p of c.commit.parent||[])if(children.has(p))children.set(p,children.get(p)+1);
    const ready=values.filter(c=>children.get(c.oid)===0),ordered=[];
    while(ready.length){ready.sort((a,b)=>b.commit.committer.timestamp-a.commit.committer.timestamp);const c=ready.shift();ordered.push(c);for(const p of c.commit.parent||[]){if(children.has(p)){children.set(p,children.get(p)-1);if(children.get(p)===0)ready.push(entries.get(p));}}}
    return ordered.map(({oid,commit})=>({oid,parents:commit.parent,author:commit.author.name,email:commit.author.email,timestamp:commit.author.timestamp,subject:commit.message.split('\n')[0],body:commit.message.split('\n').slice(1).join('\n'),refs:[]})).filter(c=>!a.author||c.author.toLowerCase().includes(a.author.toLowerCase())).filter(c=>!a.search||(c.subject+' '+c.author+' '+c.oid).toLowerCase().includes(a.search.toLowerCase())).slice(0,a.limit||500);
  }
  async refs(){const refs=[];for(const name of await this.git.listBranches(this.opts()))refs.push({name,full:'refs/heads/'+name,type:'branch',oid:await this.oid('refs/heads/'+name)});for(const name of await this.git.listTags(this.opts()))refs.push({name,full:'refs/tags/'+name,type:'tag',oid:await this.oid('refs/tags/'+name)});return refs;}
  async pair(a){this.validate(a.path);let before,after;if(a.mode==='staged'){[before,after]=await Promise.all([this.getBlob('HEAD',a.path),this.indexBlob(a.path)]);}else if(a.mode==='commit'||a.mode==='compare'){const oid=await this.oid(a.oid);const {commit}=await this.git.readCommit(this.opts({oid}));[before,after]=await Promise.all([this.getBlob(a.base||commit.parent[0]||'__empty__',a.path),this.getBlob(oid,a.path)]);}else [before,after]=await Promise.all([this.indexBlob(a.path),this.workBlob(a.path)]);
    if(before.bytes.length>4*1024*1024||after.bytes.length>4*1024*1024)throw Error('Diff exceeds the 4 MiB per-side limit.');const image=/\.(png|jpg|jpeg|gif|webp|svg|avif)$/i.test(a.path),binary=image||before.bytes.includes(0)||after.bytes.includes(0);const b64=bytes=>{let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);};return {path:a.path,mode:a.mode||'unstaged',before:binary?'':decoder.decode(before.bytes),after:binary?'':decoder.decode(after.bytes),beforeHash:before.exists?await sha(before.bytes):'missing',afterHash:after.exists?await sha(after.bytes):'missing',beforeExists:before.exists,afterExists:after.exists,beforeSize:before.bytes.length,afterSize:after.bytes.length,binary,image,...(binary?{beforeB64:b64(before.bytes),afterB64:b64(after.bytes)}:{}),editable:(!a.mode||a.mode==='unstaged')&&!binary};
  }
  async author(){const name=await this.git.getConfig(this.opts({path:'user.name'})),email=await this.git.getConfig(this.opts({path:'user.email'}));if(!name||!email)throw Error('Set your repository identity in Settings before committing.');return {name,email};}
  async network(a){const remotes=await this.git.listRemotes(this.opts()).catch(()=>[]);const url=a.url||remotes.find(r=>r.remote===(a.remote||'origin'))?.url;if(url){const u=new URL(url);if(u.protocol!=='https:'||u.username||u.password)throw Error('Browser Git requires an HTTPS remote without embedded credentials. Use the native bridge for SSH.');}return this.opts({http:browserHTTP,...(this.corsProxy?{corsProxy:this.corsProxy}:{}),onAuth:()=>this.auth||{},...a});}
  async call(action,a={}){
    if(!this.git)await this.init({empty:['initBrowser','cloneBrowser'].includes(action)});
    const mutate=async()=>{switch(action){
      case 'snapshot':{const [status,commits,refs,remotes]=await Promise.all([this.status(),this.log(a),this.refs(),this.git.listRemotes(this.opts())]);for(const c of commits)c.refs=refs.filter(r=>r.oid===c.oid);return {repo:this.repo,status,commits,refs:refs.map(r=>({...r,current:r.name===status.branch.name})),stashes:[],worktrees:[],remotes:remotes.map(r=>({name:r.remote,url:r.url})),limit:a.limit||500,gitVersion:'isomorphic-git '+this.git.version(),allowHooks:false};}
      case 'status':return this.status();
      case 'log':return this.log(a);
      case 'refs':return this.refs();
      case 'pair':return this.pair(a);
      case 'tree':{const names=a.oid?await this.git.listFiles(this.opts({ref:a.oid})):await this.git.statusMatrix(this.opts()).then(m=>m.filter(([,h,w,s])=>w).map(([p])=>p));return names.map(path=>({path,type:'blob'}));}
      case 'read':{this.validate(a.path);const b=a.oid?await this.getBlob(a.oid,a.path):await this.workBlob(a.path);if(b.bytes.length>4*1024*1024)throw Error('File exceeds the 4 MiB editor limit.');if(b.bytes.includes(0)||(()=>{try{new TextDecoder('utf-8',{fatal:true}).decode(b.bytes);return false;}catch{return true;}})())throw Error('Binary or non-UTF-8 file.');return {content:decoder.decode(b.bytes),hash:b.exists?await sha(b.bytes):'missing',exists:b.exists};}
      case 'save':case 'newFile':{this.validate(a.path);const b=await this.workBlob(a.path);if(action==='newFile'&&b.exists)throw Error('File already exists.');const hash=b.exists?await sha(b.bytes):'missing';if(a.expectedHash!==undefined&&hash!==a.expectedHash)throw Error('The file changed. Reload it before saving.');if(encoder.encode(a.content||'').length>4*1024*1024)throw Error('File too large.');await this.fs.mkdir('/'+a.path.split('/').slice(0,-1).join('/'),{recursive:true});await this.fs.writeFile('/'+a.path,a.content||'');return {hash:await sha(a.content||''),message:'File saved to granted directory.'};}
      case 'stage':for(const p of a.paths){this.validate(p);if((await this.workBlob(p)).exists)await this.git.add(this.opts({filepath:p}));else await this.git.remove(this.opts({filepath:p}));}return {message:'Files staged.'};
      case 'unstage':for(const p of a.paths){this.validate(p);await this.git.resetIndex(this.opts({filepath:p}));}return {message:'Files unstaged.'};
      case 'commit':{if(a.sign)throw Error('Signing needs the native bridge.');const author=await this.author();let message=a.message;if(a.signoff)message+=`\n\nSigned-off-by: ${author.name} <${author.email}>`;const oid=await this.git.commit(this.opts({message,author,amend:!!a.amend}));return {message:`Committed ${oid.slice(0,8)}.`};}
      case 'branchCreate':{if(a.checkout&&(await this.status()).files.length)throw Error('Commit your browser changes before creating and checking out a branch.');const object=await this.oid(a.ref||'HEAD');if(a.checkout)await this.assertCompatible(object);await this.git.branch(this.opts({ref:a.name,object,checkout:false}));if(a.checkout)await this.git.checkout(this.opts({ref:a.name,force:false}));return {message:'Branch created.'};}
      case 'branchDelete':{if((await this.git.currentBranch(this.opts()))===a.name)throw Error('Cannot delete the checked-out branch.');if(a.force&&!a.confirm)throw Error('Force deletion requires confirmation.');const oid=await this.oid(),ancestor=await this.oid('refs/heads/'+a.name);if(!a.force&&oid!==ancestor&&!await this.git.isDescendent(this.opts({oid,ancestor})))throw Error('This branch has unmerged commits. Explicit force deletion is required.');await this.git.deleteBranch(this.opts({ref:a.name}));return {message:'Branch deleted.'};}
      case 'branchRename':await this.git.renameBranch(this.opts({ref:a.to,oldref:a.name,checkout:(await this.git.currentBranch(this.opts()))===a.name}));return {message:'Branch renamed.'};
      case 'checkout':{if((await this.status()).files.length)throw Error('Commit or discard browser changes before checking out another branch.');await this.assertCompatible(a.ref);await this.git.checkout(this.opts({ref:a.ref,force:false}));return {message:'Checkout complete.'};}
      case 'tagCreate':if(a.message)await this.git.annotatedTag(this.opts({ref:a.name,object:await this.oid(a.ref||'HEAD'),message:a.message,tagger:await this.author()}));else await this.git.tag(this.opts({ref:a.name,object:await this.oid(a.ref||'HEAD')}));return {message:'Tag created.'};
      case 'tagDelete':await this.git.deleteTag(this.opts({ref:a.name}));return {message:'Tag deleted.'};
      case 'remoteAdd':await this.git.addRemote(this.opts({remote:a.name,url:a.url}));return {message:'Remote added.'};
      case 'remoteDelete':await this.git.deleteRemote(this.opts({remote:a.name}));return {message:'Remote removed.'};
      case 'fetch':await this.git.fetch(await this.network({remote:a.remote||'origin'}));return {message:'Fetch complete.'};
      case 'push':if(a.force)throw Error('Use native Git for force-with-lease protection. Browser force pushing is disabled.');{const result=await this.git.push(await this.network({remote:a.remote||'origin',ref:a.branch||await this.git.currentBranch(this.opts())}));if(result.error)throw Error(result.error);return {message:'Push complete.'};}
      case 'cloneBrowser':await this.git.clone(await this.network({url:a.url,depth:a.depth?Number(a.depth):undefined,singleBranch:!!a.depth,noCheckout:true}));await this.assertCompatible();await this.git.checkout(this.opts({ref:await this.git.currentBranch(this.opts()),force:false}));return {message:'Repository cloned to browser storage.'};
      case 'initBrowser':await this.git.init(this.opts({defaultBranch:'main'}));return {message:'Repository initialized.'};
      case 'config':{const result={};for(const path of ['user.name','user.email'])result[path]=await this.git.getConfig(this.opts({path}))||'';return result;}
      case 'configSave':for(const [path,value] of Object.entries(a.values))if(['user.name','user.email'].includes(path))await this.git.setConfig(this.opts({path,value}));return {message:'Browser repository identity saved.'};
      case 'commitFiles':{const pair=await this.git.readCommit(this.opts({oid:await this.oid(a.oid)}));const before=a.base||pair.commit.parent[0];const left=before?await this.git.listFiles(this.opts({ref:before})):[],right=await this.git.listFiles(this.opts({ref:a.oid}));const files=[];for(const p of new Set([...left,...right])){const [b,c]=await Promise.all([before?this.getBlob(before,p):{bytes:new Uint8Array(),exists:false},this.getBlob(a.oid,p)]);if(await sha(b.bytes)!==await sha(c.bytes)||b.exists!==c.exists)files.push({path:p,status:!b.exists?'A':!c.exists?'D':'M'});}return files;}
      case 'patchExport':{if(!a.path)throw Error('Select a file to export a browser patch.');const p=await this.pair(a);return {patch:patch(p.before,p.after,p.path)};}
      case 'activity':return this.logbook;
      case 'search':{const result=[];for(const {path}of await this.call('tree')){const file=await this.workBlob(path);if(file.bytes.includes(0)||file.bytes.length>1024*1024)continue;decoder.decode(file.bytes).split('\n').forEach((text,i)=>{if(text.includes(a.query)&&result.length<1000)result.push({path,line:i+1,text});});}return result;}
      default:throw Error('This operation requires the native Git bridge. Browser mode supports history, files, editing, whole-file staging, commits, branches, tags, clone, fetch, and push.');
    }};
    const reads=['snapshot','status','log','refs','pair','tree','read','config','commitFiles','activity','search','patchExport'];
    if(reads.includes(action))return mutate();
    // The Web Locks API prevents concurrent writes from Branchglass tabs.
    const run=async()=>{if(!['initBrowser','cloneBrowser','configSave','remoteAdd','remoteDelete','fetch','push','branchDelete','tagCreate','tagDelete'].includes(action))await this.assertCompatible();const result=await mutate();this.cache={};this.logbook.push({at:new Date().toISOString(),command:'browser '+action,code:0,duration:0,output:result?.message||''});return result;};
    return navigator.locks?navigator.locks.request('branchglass:'+this.repo.name,run):run();
  }
}
