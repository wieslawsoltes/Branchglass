import {spawn} from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {selectChanges} from '../web/core/diff.js';

const MAX_OUTPUT=32*1024*1024, MAX_FILE=4*1024*1024;
const digest=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const exists=async p=>{try{await fs.lstat(p);return true;}catch(e){if(e.code==='ENOENT')return false;throw e;}};
const text=b=>b.toString('utf8');
const cleanError=s=>String(s).replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g,'https://[redacted]@').slice(0,10000);
export class GitService {
  constructor({root=os.homedir(),allowHooks=false}={}){this.root=path.resolve(root);this.allowHooks=allowHooks;this.repos=new Map();this.locks=new Map();this.logs=[];this.emptyHooks=null;this.rebases=new Map();}
  async dispose(){for(const {dir}of this.rebases.values())await fs.rm(dir,{recursive:true,force:true});if(this.emptyHooks)await fs.rm(this.emptyHooks,{recursive:true,force:true});}
  async prepare(){this.root=await fs.realpath(this.root);this.emptyHooks=await fs.mkdtemp(path.join(os.tmpdir(),'branchglass-no-hooks-'));await fs.chmod(this.emptyHooks,0o700);this.version=(await this.run(null,['--version'])).stdout.trim();}
  async safeRoot(p,{create=false}={}) {
    if(typeof p!=='string'||!p.trim()||p.includes('\0'))throw Error('A valid absolute folder path is required.');
    let absolute=path.resolve(p.startsWith('~/')?path.join(os.homedir(),p.slice(2)):p);
    const under=q=>q===this.root||q.startsWith(this.root.endsWith(path.sep)?this.root:this.root+path.sep);
    if(!under(absolute))throw Error(`Folder is outside the authorized root: ${this.root}. Restart with --root to grant a different root.`);
    if(create&&!await exists(absolute)){let ancestor=path.dirname(absolute);while(!await exists(ancestor))ancestor=path.dirname(ancestor);if(!under(await fs.realpath(ancestor)))throw Error('Symlink escapes authorized root.');return absolute;}
    absolute=await fs.realpath(absolute);if(!under(absolute))throw Error('Symlink escapes authorized root.');return absolute;
  }
  repo(id){const repo=this.repos.get(id);if(!repo)throw Error('Repository not open. Choose Open repository first.');return repo;}
  async filePath(repo,p,{missing=false}={}) {
    if(typeof p!=='string'||!p||path.isAbsolute(p)||p.includes('\0')||p.includes('\\')||p.split('/').some(x=>x==='..'||x.toLowerCase()==='.git'))throw Error('Invalid or protected repository path.');
    let cur=repo.path;
    for(const part of p.split('/').filter(x=>x&&x!=='.')) {cur=path.join(cur,part);try{const s=await fs.lstat(cur);if(s.isSymbolicLink())throw Error('Symlink editing is disabled. Use native Git / your editor for this path.');}catch(e){if(e.code!=='ENOENT'||!missing)throw e;}}
    if(cur===repo.path||!cur.startsWith(repo.path+path.sep))throw Error('Path escapes repository.');return cur;
  }
  run(repo,args,{input,allowFailure=false,env={},timeout=120000}={}) {
    const cwd=typeof repo==='string'?repo:repo?.path;
    const flags=['-c','color.ui=false','-c','core.quotepath=false','-c','core.fsmonitor=false','-c','protocol.ext.allow=never'];
    if(!this.allowHooks&&this.emptyHooks)flags.push('-c',`core.hooksPath=${this.emptyHooks}`);
    const started=Date.now();
    return new Promise((resolve,reject)=>{
      const child=spawn('git',[...flags,...args],{cwd,windowsHide:true,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_PAGER:'cat',GIT_EDITOR:'true',GIT_LITERAL_PATHSPECS:args[0]==='stash'?'0':'1',LC_ALL:'C',...env},stdio:['pipe','pipe','pipe']});
      const out=[],err=[];let bytes=0,killed=false,settled=false;
      const timer=setTimeout(()=>{killed=true;child.kill('SIGKILL');},timeout);timer.unref?.();
      child.stdout.on('data',b=>{bytes+=b.length;if(bytes>MAX_OUTPUT){killed=true;child.kill();}else out.push(b);});
      child.stderr.on('data',b=>{bytes+=b.length;if(bytes>MAX_OUTPUT){killed=true;child.kill();}else err.push(b);});
      child.on('error',e=>{clearTimeout(timer);settled=true;reject(e.code==='ENOENT'?Error('Git executable not found. Install Git and restart Branchglass.'):e);});
      child.on('close',code=>{clearTimeout(timer);if(settled)return;
        const buffer=Buffer.concat(out),stderr=cleanError(Buffer.concat(err).toString()),stdout=buffer.toString();
        this.logs.push({at:new Date().toISOString(),repo:repo?.name||'',command:'git '+args.map(a=>cleanError(a)).join(' ').slice(0,400),code,duration:Date.now()-started,output:cleanError(stderr||stdout).slice(-2000)});if(this.logs.length>300)this.logs.shift();
        if(killed)return reject(Error('Git operation exceeded its time or output limit. Narrow the query or run this operation in native Git.'));
        if(code&&!allowFailure)return reject(Error(stderr.trim()||stdout.trim()||`git ${args[0]} failed (${code}).`));
        resolve({stdout,stderr,buffer,code});
      });
      child.stdin.on('error',()=>{});child.stdin.end(input);
    });
  }
  async serialized(key,fn){const prior=this.locks.get(key)||Promise.resolve();const job=prior.catch(()=>{}).then(fn);this.locks.set(key,job);try{return await job;}finally{if(this.locks.get(key)===job)this.locks.delete(key);}}
  async register(p){p=await this.safeRoot(p);const result=await this.run(p,['rev-parse','--show-toplevel']);const root=await this.safeRoot(result.stdout.trim());const gitDir=await this.safeRoot((await this.run(root,['rev-parse','--absolute-git-dir'])).stdout.trim());const commonRaw=(await this.run(root,['rev-parse','--git-common-dir'])).stdout.trim();await this.safeRoot(path.resolve(root,commonRaw));const id=digest(root).slice(0,20),repo={id,path:root,name:path.basename(root),kind:'native',gitDir};this.repos.set(id,repo);return repo;}
  async oid(repo,ref='HEAD'){if(typeof ref!=='string'||!ref||ref.startsWith('-')||ref.includes('\0'))throw Error('Invalid revision.');return (await this.run(repo,['rev-parse','--verify','--end-of-options',ref+'^{commit}'])).stdout.trim();}
  async validBranch(repo,name){if(!name||name.startsWith('-')||name.includes('@{'))throw Error('Invalid branch name.');await this.run(repo,['check-ref-format','--branch',name]);return name;}
  async remoteURL(url){if(typeof url!=='string'||url.length>4096||url.startsWith('-')||/[\x00-\x1f]/.test(url))throw Error('Invalid repository URL.');
    if(/^(https?|ssh):\/\//i.test(url)){const u=new URL(url);if((u.protocol==='http:'||u.protocol==='https:')&&(u.username||u.password))throw Error('Do not embed credentials in URLs. Configure a native Git credential helper.');return url;}
    if(/^[\w.-]+@[\w.-]+:[^\s]+$/.test(url))return url;
    if(path.isAbsolute(url))return this.safeRoot(url);
    throw Error('Use an HTTPS URL, SSH URL, user@host:path, or an absolute local path within the authorized root.');
  }
  async status(repo){
    const {stdout}=await this.run(repo,['status','--porcelain=v2','-z','--branch','--untracked-files=all']);
    const records=stdout.split('\0'),files=[],branch={name:'HEAD',oid:'',ahead:0,behind:0,upstream:''};
    for(let i=0;i<records.length;i++){
      const r=records[i];if(!r)continue;
      if(r.startsWith('# branch.head '))branch.name=r.slice(14);
      else if(r.startsWith('# branch.oid '))branch.oid=r.slice(13);
      else if(r.startsWith('# branch.upstream '))branch.upstream=r.slice(18);
      else if(r.startsWith('# branch.ab ')){const m=r.match(/\+(\d+) -(\d+)/);if(m){branch.ahead=+m[1];branch.behind=+m[2];}}
      else if(r.startsWith('1 ')||r.startsWith('2 ')||r.startsWith('u ')){
        const count=r[0]==='1'?8:r[0]==='2'?9:10;let pos=0;const fields=[];for(let j=0;j<count;j++){const next=r.indexOf(' ',pos);fields.push(r.slice(pos,next));pos=next+1;}
        const xy=fields[1],filepath=r.slice(pos);const f={path:filepath,x:xy[0],y:xy[1],staged:xy[0]!=='.',unstaged:xy[1]!=='.',conflict:r[0]==='u',untracked:false};
        if(r[0]==='2')f.origPath=records[++i];files.push(f);
      }else if(r.startsWith('? '))files.push({path:r.slice(2),x:'?',y:'?',staged:false,unstaged:true,untracked:true,conflict:false});
    }
    const progress=[];
    for(const [file,name] of [['MERGE_HEAD','merge'],['rebase-merge','rebase'],['rebase-apply','rebase'],['CHERRY_PICK_HEAD','cherry-pick'],['REVERT_HEAD','revert'],['BISECT_LOG','bisect']]){
      const loc=repo.gitDir?path.join(repo.gitDir,file):path.resolve(repo.path,(await this.run(repo,['rev-parse','--git-path',file])).stdout.trim());if(await exists(loc)&&!progress.includes(name))progress.push(name);
    }
    return {files,branch,progress};
  }
  async log(repo,a={}){
    const limit=Math.max(1,Math.min(5000,Number(a.limit)||500)),skip=Math.max(0,Number(a.skip)||0);
    const args=['log','-z','--topo-order',`--max-count=${limit}`,`--skip=${skip}`,'--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%b'];
    if(a.search)args.push('--regexp-ignore-case','--fixed-strings',`--grep=${String(a.search).slice(0,300)}`);
    if(a.author)args.push(`--author=${String(a.author).slice(0,200)}`);
    if(a.branch)args.push(await this.oid(repo,a.branch));else{args.push('--all');const head=await this.run(repo,['rev-parse','--verify','HEAD'],{allowFailure:true});if(!head.code)args.push('HEAD');}
    if(a.follow&&a.path)args.push('--follow');
    if(a.path){await this.filePath(repo,a.path,{missing:true});args.push('--',a.path);}
    const result=await this.run(repo,args,{allowFailure:true});
    if(result.code){const head=await this.run(repo,['rev-parse','--verify','HEAD'],{allowFailure:true});if(head.code)return [];throw Error(result.stderr);}
    const parts=result.stdout.split('\0'),commits=[];
    for(let i=0;i+6<parts.length;i+=7){const [oid,parents,author,email,timestamp,subject,body]=parts.slice(i,i+7);if(!oid.trim())continue;commits.push({oid:oid.trim(),parents:parents?parents.split(' '):[],author,email,timestamp:+timestamp,subject,body,refs:[]});}return commits;
  }
  async refs(repo){const out=await this.run(repo,['for-each-ref','--sort=-committerdate','--format=%(refname)%00%(objectname)%00%(*objectname)%00%(upstream:short)%00%(subject)%00%(HEAD)','refs/heads','refs/remotes','refs/tags']);
    return out.stdout.split('\n').filter(Boolean).map(row=>{const [full,objectOid,peeled,upstream,subject,head]=row.split('\0');return {full,name:full.replace(/^refs\/(heads|remotes|tags)\//,''),oid:peeled||objectOid,objectOid,upstream,subject,current:head==='*',type:full.startsWith('refs/heads/')?'branch':full.startsWith('refs/tags/')?'tag':'remote'};});}
  async stashes(repo){return (await this.run(repo,['stash','list','-z','--format=%gd%x00%H%x00%s%x00%at'])).stdout.split('\0').reduce((a,_,i,all)=>{if(i%4===0&&all[i])a.push({name:all[i],oid:all[i+1],subject:all[i+2],timestamp:+all[i+3]});return a;},[]);}
  async worktrees(repo){const out=(await this.run(repo,['worktree','list','--porcelain','-z'])).stdout.split('\0');const rows=[];let item={};for(const r of out){if(!r){if(item.path)rows.push(item);item={};continue;}const k=r.indexOf(' '),key=k<0?r:r.slice(0,k),value=k<0?true:r.slice(k+1);if(key==='worktree')item.path=value;else item[key]=value;}if(item.path)rows.push(item);return rows;}
  async remotes(repo){const names=(await this.run(repo,['remote'])).stdout.trim().split('\n').filter(Boolean);return Promise.all(names.map(async name=>({name,url:(await this.run(repo,['remote','get-url',name])).stdout.trim()})));}
  async snapshot(repo,a){const [status,commits,refs,stashes,worktrees,remotes]=await Promise.all([this.status(repo),this.log(repo,a),this.refs(repo),this.stashes(repo),this.worktrees(repo),this.remotes(repo)]);for(const c of commits)c.refs=refs.filter(r=>r.oid===c.oid).map(r=>({name:r.name,type:r.type,current:r.current}));return {repo,status,commits,refs,stashes,worktrees,remotes,limit:Math.min(5000,Number(a.limit)||500),gitVersion:this.version,allowHooks:this.allowHooks};}
  async blob(repo,rev,p){await this.filePath(repo,p,{missing:true});const result=await this.run(repo,['show',`${rev}:${p}`],{allowFailure:true});return result.code?{bytes:Buffer.alloc(0),exists:false}:{bytes:result.buffer,exists:true};}
  async working(repo,p){const abs=await this.filePath(repo,p,{missing:true});try{const s=await fs.stat(abs);if(!s.isFile())throw Error('This is not a regular file. Use the Submodules view for nested repositories.');if(s.size>MAX_FILE)throw Error('File exceeds the 4 MiB editor limit. Use an external editor.');return {bytes:await fs.readFile(abs),exists:true,mode:s.mode};}catch(e){if(e.code==='ENOENT')return {bytes:Buffer.alloc(0),exists:false};throw e;}}
  async pair(repo,a){const p=a.path;let before,after;const mode=a.mode||'unstaged';
    let oldPath=a.origPath;if(!oldPath&&mode==='staged')oldPath=(await this.status(repo)).files.find(f=>f.path===p)?.origPath;if(!oldPath&&(mode==='commit'||mode==='compare'))oldPath=(await this.fileNames(repo,a)).find(f=>f.path===p)?.origPath;oldPath=oldPath||p;await this.filePath(repo,oldPath,{missing:true});
    if(mode==='unstaged'){[before,after]=await Promise.all([this.blob(repo,'',p),this.working(repo,p)]);}
    else if(mode==='staged'){[before,after]=await Promise.all([this.blob(repo,'HEAD',oldPath),this.blob(repo,'',p)]);}
    else if(mode==='commit'||mode==='compare'){const oid=await this.oid(repo,a.oid||'HEAD');const parent=a.base?await this.oid(repo,a.base):(await this.run(repo,['rev-list','--parents','-n','1',oid])).stdout.trim().split(' ')[1];[before,after]=await Promise.all([parent?this.blob(repo,parent,oldPath):Promise.resolve({bytes:Buffer.alloc(0),exists:false}),this.blob(repo,oid,p)]);}
    else throw Error('Unknown diff mode.');
    if(before.bytes.length>MAX_FILE||after.bytes.length>MAX_FILE)throw Error('Diff exceeds the 4 MiB per-side limit. Use native Git for large binaries.');
    const image=/\.(png|jpg|jpeg|gif|webp|avif|bmp|ico|svg)$/i.test(p),binary=image||[before,after].some(b=>b.bytes.includes(0)||!Buffer.from(b.bytes.toString('utf8')).equals(b.bytes));
    return {path:p,origPath:oldPath!==p?oldPath:undefined,mode,before:binary?'':text(before.bytes),after:binary?'':text(after.bytes),beforeHash:before.exists?digest(before.bytes):'missing',afterHash:after.exists?digest(after.bytes):'missing',beforeExists:before.exists,afterExists:after.exists,binary,image,beforeSize:before.bytes.length,afterSize:after.bytes.length,...(binary?{beforeB64:before.bytes.toString('base64'),afterB64:after.bytes.toString('base64')}:{}),editable:mode==='unstaged'&&!binary};
  }
  async fileNames(repo,a){const oid=await this.oid(repo,a.oid||'HEAD');const parent=a.base?await this.oid(repo,a.base):(await this.run(repo,['rev-list','--parents','-n','1',oid])).stdout.trim().split(' ')[1];const args=parent?['diff','--name-status','-M','-z',parent,oid,'--']:['diff-tree','--no-commit-id','--name-status','-M','-z','-r','--root',oid,'--'];const tokens=(await this.run(repo,args)).stdout.split('\0');const files=[];for(let i=0;i<tokens.length-1;){const code=tokens[i++];if(!code)continue;const p=tokens[i++];if(code.startsWith('R')||code.startsWith('C'))files.push({path:tokens[i++],origPath:p,status:code[0]});else files.push({path:p,status:code});}return files;}
  async tree(repo,a){if(a.oid){const oid=await this.oid(repo,a.oid);return (await this.run(repo,['ls-tree','-r','-z','--long',oid])).stdout.split('\0').filter(Boolean).map(row=>{const tab=row.indexOf('\t'),info=row.slice(0,tab),p=row.slice(tab+1);const [mode,type,oid,size]=info.trim().split(/\s+/);return {path:p,mode,type,oid,size:+size||0};});}
    const out=(await this.run(repo,['ls-files','-z','--cached','--others','--exclude-standard'])).stdout.split('\0').filter(Boolean);return [...new Set(out)].sort().map(p=>({path:p,type:'blob'}));}
  async save(repo,a){const p=await this.filePath(repo,a.path,{missing:true}),current=await this.working(repo,a.path);if(a.expectedHash!==undefined&&a.expectedHash!==(current.exists?digest(current.bytes):'missing'))throw Error('The file changed on disk after you opened it. Reload before saving; your edits have not been written.');if(typeof a.content!=='string'||Buffer.byteLength(a.content)>MAX_FILE)throw Error('Editor text must be under 4 MiB.');await fs.mkdir(path.dirname(p),{recursive:true});const tmp=path.join(path.dirname(p),`.branchglass-save-${crypto.randomBytes(8).toString('hex')}`);try{await fs.writeFile(tmp,a.content,{mode:current.mode?current.mode&0o777:0o644,flag:'wx'});await fs.rename(tmp,p);}finally{await fs.rm(tmp,{force:true}).catch(()=>{});}return {hash:digest(Buffer.from(a.content)),message:'File saved.'};}
  async selection(repo,a){if(!Array.isArray(a.ids)||!a.ids.length)throw Error('Select at least one changed line.');if(!['staged','unstaged'].includes(a.mode))throw Error('Only working changes can be staged.');const pair=await this.pair(repo,a);if(pair.binary)throw Error('Partial staging is text-only.');if(pair.beforeHash!==a.beforeHash||pair.afterHash!==a.afterHash)throw Error('This diff is stale. Refresh before staging.');const stat=await this.status(repo),file=stat.files.find(f=>f.path===a.path);if(file?.conflict||file?.origPath)throw Error('Stage conflicted or renamed files as whole files.');
    const index=(await this.run(repo,['ls-files','--stage','-z','--',a.path])).stdout,mode=index.match(/^([0-7]+)/)?.[1]||'100644';if(!['100644','100755'].includes(mode))throw Error('Partial staging only supports regular files.');
    // Raw index composition must not bypass Git clean filters or normalization.
    // Staged pairs already contain canonical blobs; working pairs may not.
    if(a.mode==='unstaged'){
      const attrs=(await this.run(repo,['check-attr','-z','filter','working-tree-encoding','ident','text','eol','crlf','--',a.path])).stdout.split('\0');
      for(let i=0;i+2<attrs.length;i+=3)if(!['unspecified','unset'].includes(attrs[i+2]))throw Error('Partial staging is disabled for Git attributes that transform file content. Stage this file as a whole so native Git applies its filters and line endings.');
      const autocrlf=(await this.run(repo,['config','--get','core.autocrlf'],{allowFailure:true})).stdout.trim();
      if(autocrlf&&autocrlf!=='false')throw Error('Partial staging is disabled when core.autocrlf is enabled. Stage the whole file to preserve native Git normalization.');
    }
    const content=selectChanges(pair.before,pair.after,a.ids,a.mode==='staged');
    if((a.mode==='staged'&&!pair.beforeExists&&content==='')||(a.mode==='unstaged'&&!pair.afterExists&&content==='')){await this.run(repo,['update-index','--force-remove','--',a.path]);}
    else {const oid=(await this.run(repo,['hash-object','-w','--stdin'],{input:content})).stdout.trim();await this.run(repo,['update-index','--add','--cacheinfo',mode,oid,a.path]);}
    return {message:a.mode==='staged'?'Selected changes unstaged.':'Selected changes staged.'};
  }
  async rebasePlan(repo,a){const base=await this.oid(repo,a.base);const out=await this.run(repo,['rev-list','--reverse','--topo-order',`${base}..HEAD`]);const oids=out.stdout.trim().split('\n').filter(Boolean);if(oids.length>200)throw Error('Interactive rebase is limited to 200 commits. Choose a closer upstream.');const all=await this.log(repo,{limit:5000,branch:'HEAD'});const map=new Map(all.map(c=>[c.oid,c]));const commits=oids.map(oid=>map.get(oid)).filter(Boolean);if(commits.some(c=>c.parents.length>1))throw Error('This plan contains merge commits. Use native Git --rebase-merges; this editor will not flatten merges silently.');return {base,commits};}
  async startRebase(repo,a){const plan=await this.rebasePlan(repo,a),allowed=new Set(plan.commits.map(c=>c.oid));if(!Array.isArray(a.plan)||a.plan.length!==allowed.size||new Set(a.plan.map(x=>x.oid)).size!==allowed.size)throw Error('Plan must contain each selected commit exactly once.');const actions=new Set(['pick','reword','squash','fixup','drop']);for(const step of a.plan)if(!allowed.has(step.oid)||!actions.has(step.action))throw Error('Invalid rebase step.');const first=a.plan.find(s=>s.action!=='drop');if(first&&['squash','fixup'].includes(first.action))throw Error('The first retained commit cannot be squash or fixup.');
    const dir=await fs.mkdtemp(path.join(os.tmpdir(),'branchglass-rebase-'));const todo=a.plan.map(s=>`${s.action} ${s.oid} ${plan.commits.find(c=>c.oid===s.oid)?.subject.replace(/[\r\n\0]/g,' ')||''}`).join('\n')+'\n';await fs.writeFile(path.join(dir,'todo'),todo);
    const messages=a.plan.filter(s=>s.action==='reword').map(s=>({from:plan.commits.find(c=>c.oid===s.oid)?.subject,to:s.message||plan.commits.find(c=>c.oid===s.oid)?.subject}));await fs.writeFile(path.join(dir,'messages.json'),JSON.stringify(messages));
    const helper=fileURLToPath(new URL('./sequence-editor.cjs',import.meta.url));const quoted=s=>'"'+s.replace(/(["\\$`])/g,'\\$1')+'"';const env={BG_REBASE_DIR:dir,GIT_SEQUENCE_EDITOR:`${quoted(process.execPath)} ${quoted(helper)} todo`,GIT_EDITOR:`${quoted(process.execPath)} ${quoted(helper)} message`};this.rebases.set(repo.id,{dir,env});
    try {const out=await this.run(repo,['rebase','--interactive',plan.base],{env});await fs.rm(dir,{recursive:true,force:true});this.rebases.delete(repo.id);return {message:out.stdout||out.stderr||'Rebase complete.'};}catch(e){throw Error(e.message+'\nResolve conflicts, then use Continue or Abort.');}
  }
  async dispatch(action,id,a={}) {
    if(action==='hello')return {name:'Branchglass',version:'0.1.0',git:this.version,root:this.root,allowHooks:this.allowHooks,repos:[...this.repos.values()]};
    if(action==='open')return this.register(a.path);
    if(action==='init'){const p=await this.safeRoot(a.path,{create:true});await fs.mkdir(p,{recursive:true});await this.run(p,['init','--initial-branch=main']);return this.register(p);}
    if(action==='clone'){const p=await this.safeRoot(a.path,{create:true}),url=await this.remoteURL(a.url);return this.serialized(p,async()=>{await fs.mkdir(path.dirname(p),{recursive:true});const args=['clone'];if(a.depth)args.push('--depth',String(Math.max(1,Math.min(100000,Number(a.depth)))));args.push('--',url,p);await this.run(null,args,{timeout:600000});return this.register(p);});}
    if(action==='activity')return this.logs.slice(-150);
    const repo=this.repo(id);
    const reads=new Set(['snapshot','status','log','refs','stashes','worktrees','remotes','pair','commitFiles','tree','read','conflict','blame','reflog','submodules','config','rebasePlan','patchExport','search','lfsStatus','bisectStatus']);
    const operation=async()=>{
      switch(action){
        case 'snapshot':return this.snapshot(repo,a);
        case 'status':return this.status(repo);
        case 'log':return this.log(repo,a);
        case 'refs':return this.refs(repo);
        case 'stashes':return this.stashes(repo);
        case 'worktrees':return this.worktrees(repo);
        case 'remotes':return this.remotes(repo);
        case 'pair':return this.pair(repo,a);
        case 'commitFiles':return this.fileNames(repo,a);
        case 'tree':return this.tree(repo,a);
        case 'read':{const file=a.oid?await this.blob(repo,await this.oid(repo,a.oid),a.path):await this.working(repo,a.path);if(file.bytes.length>MAX_FILE)throw Error('File exceeds the 4 MiB editor limit.');if(file.bytes.includes(0)||!Buffer.from(file.bytes.toString('utf8')).equals(file.bytes))throw Error('Binary or non-UTF-8 file cannot be edited as text.');return {path:a.path,content:text(file.bytes),hash:file.exists?digest(file.bytes):'missing',exists:file.exists};}
        case 'save':return this.save(repo,a);
        case 'newFile':{if((await this.working(repo,a.path)).exists)throw Error('File already exists.');return this.save(repo,{...a,expectedHash:'missing',content:a.content||''});}
        case 'renameFile':{const from=await this.filePath(repo,a.path),to=await this.filePath(repo,a.to,{missing:true});if(await exists(to))throw Error('Destination already exists.');await fs.mkdir(path.dirname(to),{recursive:true});await fs.rename(from,to);return {message:'File renamed in working tree. Stage the change to record it.'};}
        case 'deleteFile':{const p=await this.filePath(repo,a.path);if(!(await fs.lstat(p)).isFile())throw Error('Only regular files can be deleted.');await fs.unlink(p);return {message:'File deleted from working tree.'};}
        case 'stage':case 'unstage':{
          if(!Array.isArray(a.paths)||!a.paths.length)throw Error('Choose files first.');for(const p of a.paths)await this.filePath(repo,p,{missing:true});
          if(action==='stage')await this.run(repo,['add','--',...a.paths]);
          else {const head=await this.run(repo,['rev-parse','--verify','HEAD'],{allowFailure:true});if(head.code)await this.run(repo,['rm','--cached','--ignore-unmatch','--',...a.paths]);else await this.run(repo,['restore','--staged','--',...a.paths]);}
          return {message:`${a.paths.length} path(s) ${action==='stage'?'staged':'unstaged'}.`};}
        case 'selection':return this.selection(repo,a);
        case 'discard':{if(!a.confirm)throw Error('Discard requires explicit confirmation.');for(const p of a.paths||[])await this.filePath(repo,p,{missing:true});if(!a.paths?.length)throw Error('No files selected.');await this.run(repo,['restore','--worktree','--',...a.paths]);return {message:'Working changes discarded; staged changes were retained.'};}
        case 'commit':{if(!a.message?.trim())throw Error('A commit message is required.');const args=['commit','-m',String(a.message).slice(0,65536)];if(a.amend)args.push('--amend');if(a.signoff)args.push('--signoff');if(a.sign)args.push('-S');return {message:(await this.run(repo,args)).stdout};}
        case 'branchCreate':{const name=await this.validBranch(repo,a.name),ref=await this.oid(repo,a.ref||'HEAD');await this.run(repo,['branch','--',name,ref]);if(a.checkout)await this.run(repo,['switch','--',name]);return {message:`Created ${name}.`};}
        case 'branchRename':{await this.validBranch(repo,a.name);await this.validBranch(repo,a.to);await this.run(repo,['branch','-m','--',a.name,a.to]);return {message:'Branch renamed.'};}
        case 'branchDelete':{await this.validBranch(repo,a.name);if(a.force&&!a.confirm)throw Error('Force deletion requires confirmation.');await this.run(repo,['branch',a.force?'-D':'-d','--',a.name]);return {message:'Branch deleted.'};}
        case 'checkout':{if(a.detached){await this.run(repo,['switch','--detach',await this.oid(repo,a.ref)]);}else{await this.validBranch(repo,a.ref);await this.run(repo,['switch',...(a.track?['--track']:[]),'--',a.ref]);}return {message:`Checked out ${a.ref}.`};}
        case 'merge':{const args=['merge','--no-edit'];if(a.squash)args.push('--squash');else if(a.noFF)args.push('--no-ff');args.push('--',await this.oid(repo,a.ref));return {message:(await this.run(repo,args)).stdout||'Merge complete.'};}
        case 'rebase':return {message:(await this.run(repo,['rebase',await this.oid(repo,a.ref)])).stdout||'Rebase complete.'};
        case 'rebasePlan':return this.rebasePlan(repo,a);
        case 'rebaseInteractive':return this.startRebase(repo,a);
        case 'sequence':{if(!['rebase','merge','cherry-pick','revert'].includes(a.kind)||!['continue','abort','skip'].includes(a.step)||a.kind==='merge'&&a.step==='skip')throw Error('Invalid sequence operation.');const meta=this.rebases.get(repo.id);const result=await this.run(repo,[a.kind,`--${a.step}`],{env:meta?.env||{}});if(meta&&(a.step==='abort'||!(await this.status(repo)).progress.includes('rebase'))){await fs.rm(meta.dir,{recursive:true,force:true});this.rebases.delete(repo.id);}return {message:result.stdout||result.stderr||'Operation complete.'};}
        case 'cherryPick':case 'revert':{const args=[action==='revert'?'revert':'cherry-pick'];if(action==='revert')args.push('--no-edit');if(a.noCommit)args.push('--no-commit');if(a.mainline)args.push('-m',String(Math.max(1,Number(a.mainline)||1)));args.push(await this.oid(repo,a.oid));return {message:(await this.run(repo,args)).stdout};}
        case 'reset':{if(!['soft','mixed','hard'].includes(a.mode)||!a.confirm)throw Error('Reset requires a mode and explicit confirmation.');await this.run(repo,['reset',`--${a.mode}`,await this.oid(repo,a.oid)]);return {message:`${a.mode} reset complete.`};}
        case 'tagCreate':{if(!a.name||a.name.startsWith('-'))throw Error('Invalid tag.');await this.run(repo,['check-ref-format',`refs/tags/${a.name}`]);const args=['tag'];if(a.message)args.push('-a','-m',a.message);args.push('--',a.name,await this.oid(repo,a.ref||'HEAD'));await this.run(repo,args);return {message:'Tag created.'};}
        case 'tagDelete':{if(!a.name||a.name.startsWith('-'))throw Error('Invalid tag.');await this.run(repo,['tag','-d','--',a.name]);return {message:'Local tag deleted.'};}
        case 'fetch':case 'pull':case 'push':{
          const remotes=await this.remotes(repo),remote=remotes.find(r=>r.name===(a.remote||'origin'));if(!remote)throw Error('Remote not configured. Add it in Remotes.');await this.remoteURL(remote.url);let args;
          if(action==='fetch')args=['fetch',...(a.prune?['--prune']:[]),'--',remote.name];
          else if(action==='pull')args=['pull',a.rebase?'--rebase':'--ff-only','--',remote.name,...(a.branch?[await this.validBranch(repo,a.branch)]:[])];
          else {args=['push'];if(a.force){if(!a.confirm)throw Error('Force-with-lease push requires confirmation.');args.push('--force-with-lease');}if(a.setUpstream)args.push('--set-upstream');args.push('--',remote.name,await this.validBranch(repo,a.branch||(await this.status(repo)).branch.name));}
          const out=await this.run(repo,args,{timeout:600000});return {message:out.stdout||out.stderr||`${action} complete.`};}
        case 'remoteAdd':case 'remoteEdit':{if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a.name))throw Error('Invalid remote name.');await this.run(repo,['remote',action==='remoteAdd'?'add':'set-url',a.name,await this.remoteURL(a.url)]);return {message:'Remote saved.'};}
        case 'remoteDelete':{if(!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a.name))throw Error('Invalid remote name.');await this.run(repo,['remote','remove',a.name]);return {message:'Remote removed locally.'};}
        case 'stashSave':{const args=['stash','push','-m',a.message||'Branchglass stash'];if(a.untracked)args.push('--include-untracked');if(a.keepIndex)args.push('--keep-index');return {message:(await this.run(repo,args)).stdout};}
        case 'stashApply':case 'stashPop':case 'stashDrop':{if(!/^stash@\{\d+\}$/.test(a.name))throw Error('Invalid stash.');return {message:(await this.run(repo,['stash',action==='stashApply'?'apply':action==='stashPop'?'pop':'drop',a.name])).stdout};}
        case 'worktreeAdd':{const p=await this.safeRoot(a.path,{create:true}),ref=await this.oid(repo,a.ref||'HEAD');const args=['worktree','add'];if(a.branch)args.push('-b',await this.validBranch(repo,a.branch));else args.push('--detach');args.push('--',p,ref);await this.run(repo,args);return {message:'Worktree created.'};}
        case 'worktreeRemove':{const p=await this.safeRoot(a.path);await this.run(repo,['worktree','remove','--',p]);return {message:'Clean worktree removed.'};}
        case 'worktreeLock':case 'worktreeUnlock':{const p=await this.safeRoot(a.path);await this.run(repo,['worktree',action==='worktreeLock'?'lock':'unlock','--',p]);return {message:'Worktree lock updated.'};}
        case 'conflict':{const [base,ours,theirs,current]=await Promise.all([this.blob(repo,':1',a.path),this.blob(repo,':2',a.path),this.blob(repo,':3',a.path),this.working(repo,a.path)]);if([base,ours,theirs,current].some(x=>x.bytes.includes(0)))throw Error('Use an external merge tool for binary conflicts.');return {base:text(base.bytes),ours:text(ours.bytes),theirs:text(theirs.bytes),result:text(current.bytes),hash:current.exists?digest(current.bytes):'missing',oursExists:ours.exists,theirsExists:theirs.exists};}
        case 'resolve':{if(/^(<{7}|={7}|>{7})( |\r?$)/m.test(a.content))throw Error('Unresolved conflict markers remain.');await this.save(repo,a);await this.run(repo,['add','--',a.path]);return {message:'Resolution saved and staged.'};}
        case 'blame':{await this.filePath(repo,a.path,{missing:true});const args=['blame','--line-porcelain',...(a.oid?[await this.oid(repo,a.oid)]:[]),'--',a.path];const out=(await this.run(repo,args)).stdout.split('\n'),rows=[];let item={};for(const line of out){const match=line.match(/^([\da-f]{40,64}) (\d+) (\d+)(?: (\d+))?$/);if(match)item={oid:match[1],originalLine:+match[2],line:+match[3]};else if(line.startsWith('\t'))rows.push({...item,text:line.slice(1)});else {const k=line.indexOf(' ');if(k>0)item[line.slice(0,k)]=line.slice(k+1);}}return rows;}
        case 'reflog':{const parts=(await this.run(repo,['reflog','-z','--max-count=300','--format=%H%x00%gd%x00%gs%x00%at'])).stdout.split('\0'),rows=[];for(let i=0;i+3<parts.length;i+=4)rows.push({oid:parts[i],selector:parts[i+1],subject:parts[i+2],timestamp:+parts[i+3]});return rows;}
        case 'submodules':{const out=await this.run(repo,['submodule','status','--recursive'],{allowFailure:true});return {output:out.stdout||out.stderr};}
        case 'submoduleUpdate':return {message:(await this.run(repo,['submodule','update','--init','--recursive'],{timeout:600000})).stdout||'Submodules updated.'};
        case 'submoduleAdd':{await this.filePath(repo,a.path,{missing:true});await this.run(repo,['submodule','add','--',await this.remoteURL(a.url),a.path],{timeout:600000});return {message:'Submodule added.'};}
        case 'config':{const result={};for(const key of ['user.name','user.email','commit.gpgsign','user.signingkey','core.autocrlf'])result[key]=(await this.run(repo,['config','--get',key],{allowFailure:true})).stdout.trim();return result;}
        case 'configSave':{const allowed=['user.name','user.email','commit.gpgsign','user.signingkey'];for(const [key,value] of Object.entries(a.values||{})){if(!allowed.includes(key))throw Error('Configuration key is not allowed.');await this.run(repo,['config','--local',key,String(value).slice(0,1000)]);}return {message:'Repository-local identity saved.'};}
        case 'patchExport':{const args=['diff','--no-ext-diff','--no-textconv','--binary'];if(a.mode==='staged')args.push('--cached');else if(a.oid){const oid=await this.oid(repo,a.oid);const parent=(await this.run(repo,['rev-list','--parents','-n','1',oid])).stdout.trim().split(' ')[1];if(parent)args.push(parent,oid);else return {patch:(await this.run(repo,['show','--format=','--binary','--no-ext-diff','--no-textconv',oid])).stdout};}if(a.path){await this.filePath(repo,a.path,{missing:true});args.push('--',a.path);}return {patch:(await this.run(repo,args)).stdout};}
        case 'patchApply':{if(typeof a.patch!=='string'||a.patch.length>MAX_FILE)throw Error('Patch must be smaller than 4 MiB.');const flags=['--whitespace=nowarn',...(a.index?['--index']:[])];await this.run(repo,['apply','--check',...flags,'-'],{input:a.patch});await this.run(repo,['apply',...flags,'-'],{input:a.patch});return {message:'Patch applied.'};}
        case 'search':{if(!a.query?.trim())return [];const out=await this.run(repo,['grep','-n','-I','-z','--no-color','-F','-e',String(a.query).slice(0,300),'--'],{allowFailure:true});if(out.code>1)throw Error(out.stderr);const rows=[];let rest=out.stdout;while(rest&&rows.length<1000){const p=rest.indexOf('\0'),n=rest.indexOf('\0',p+1),e=rest.indexOf('\n',n+1);if(p<0||n<0)break;rows.push({path:rest.slice(0,p),line:+rest.slice(p+1,n),text:rest.slice(n+1,e<0?undefined:e)});rest=e<0?'':rest.slice(e+1);}return rows;}
        case 'lfsStatus':{const version=await this.run(repo,['lfs','version'],{allowFailure:true});if(version.code)return {available:false,output:'Git LFS is not installed. Install it separately to use LFS operations.'};return {available:true,version:version.stdout,output:(await this.run(repo,['lfs','status'])).stdout,files:(await this.run(repo,['lfs','ls-files'])).stdout};}
        case 'lfsPull':return {message:(await this.run(repo,['lfs','pull'],{timeout:600000})).stdout||'LFS objects downloaded.'};
        case 'lfsTrack':{if(!a.pattern||a.pattern.startsWith('-'))throw Error('Provide a valid LFS pattern.');await this.run(repo,['lfs','track','--',a.pattern]);return {message:'LFS pattern added to .gitattributes. Stage and commit it.'};}
        case 'bisectStatus':{const out=await this.run(repo,['bisect','log'],{allowFailure:true});return {output:out.stdout||'No bisect session in progress.'};}
        case 'bisect':{const step=a.step;if(step==='start'){const good=await this.oid(repo,a.good),bad=await this.oid(repo,a.bad||'HEAD');return {message:(await this.run(repo,['bisect','start',bad,good])).stdout};}if(!['good','bad','skip','reset'].includes(step))throw Error('Invalid bisect step.');return {message:(await this.run(repo,['bisect',step])).stdout};}
        default:throw Error(`Unsupported operation: ${action}`);
      }
    };
    return reads.has(action)?operation():this.serialized(repo.id,operation);
  }
}
