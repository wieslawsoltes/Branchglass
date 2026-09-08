import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {GitService} from '../server/git.mjs';
import {diffLines,patch} from '../web/core/diff.js';

const raw=(dir,...args)=>execFileSync('git',['-c','color.ui=false','-C',dir,...args],{encoding:'utf8',env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_EDITOR:'true'},stdio:['pipe','pipe','pipe']}).trim();
async function fixture(t){const root=await fs.mkdtemp(path.join(os.tmpdir(),'branchglass-test-')),dir=path.join(root,'project'),service=new GitService({root});await service.prepare();const repo=await service.dispatch('init',null,{path:dir});const call=(action,args={})=>service.dispatch(action,repo.id,args);await call('configSave',{values:{'user.name':'Test Author','user.email':'test@example.test'}});t.after(async()=>{await service.dispose();await fs.rm(root,{force:true,recursive:true});});const write=async(name,content)=>{await fs.mkdir(path.dirname(path.join(dir,name)),{recursive:true});await fs.writeFile(path.join(dir,name),content);};const commit=async(message='fixture')=>{raw(dir,'add','--all');raw(dir,'commit','-m',message);return raw(dir,'rev-parse','HEAD');};return {root,dir,service,repo,call,write,commit};}

test('native status, root commits, tab/unicode filenames, and binary previews',async t=>{
 const f=await fixture(t),name='folder/space ü\tfile.txt';await f.write(name,'hello\n');await f.write('-option.txt','safe\n');const oid=await f.commit('initial');
 assert.equal((await f.call('status')).files.length,0);assert.equal((await f.call('snapshot')).commits[0].oid,oid);
 assert.ok((await f.call('commitFiles',{oid})).some(x=>x.path===name));assert.ok((await f.call('tree',{oid})).some(x=>x.path===name));
 await f.write(name,'new content\n');await f.write('untracked ü.txt','new\n');let status=await f.call('status');assert.ok(status.files.find(x=>x.path===name).unstaged);assert.ok(status.files.find(x=>x.path==='untracked ü.txt').untracked);
 await f.call('stage',{paths:[name]});status=await f.call('status');assert.ok(status.files.find(x=>x.path===name).staged);assert.ok(!(status.files.find(x=>x.path===name).unstaged));
 const pair=await f.call('pair',{path:name,mode:'staged'});assert.equal(pair.before,'hello\n');assert.equal(pair.after,'new content\n');
 await f.write('image.png',Buffer.from([137,80,78,71,0,1,2]));assert.ok((await f.call('pair',{path:'image.png'})).image);await assert.rejects(f.call('read',{path:'image.png'}),/Binary/);
 await f.write('legacy.txt',Buffer.from([0xff,0xfe,0x41]));await assert.rejects(f.call('read',{path:'legacy.txt'}),/UTF-8/);
});

test('atomic text saves reject stale data, protected paths, and symlink escapes',async t=>{
 const f=await fixture(t);await f.write('a.txt','one\n');await f.commit();const opened=await f.call('read',{path:'a.txt'});await f.write('a.txt','external\n');await assert.rejects(f.call('save',{path:'a.txt',content:'overwrite',expectedHash:opened.hash}),/changed on disk/);assert.equal(await fs.readFile(path.join(f.dir,'a.txt'),'utf8'),'external\n');
 for(const name of ['../escape','.git/config','x/../../escape','/tmp/escape','x\\y'])await assert.rejects(f.call('save',{path:name,content:'bad'}),/Invalid|protected|escapes/);
 await fs.symlink(os.tmpdir(),path.join(f.dir,'outside'));await assert.rejects(f.call('save',{path:'outside/escape',content:'bad'}),/Symlink/);
 await assert.rejects(f.service.dispatch('open',null,{path:os.tmpdir()}),/outside/);await fs.symlink(os.tmpdir(),path.join(f.root,'outside'));await assert.rejects(f.service.dispatch('init',null,{path:path.join(f.root,'outside','escape')}),/Symlink/);
 await assert.rejects(f.call('checkout',{ref:'--help'}),/Invalid/);
 const fresh=await f.call('read',{path:'a.txt'});await f.call('save',{path:'a.txt',content:'saved\n',expectedHash:fresh.hash});assert.equal(await fs.readFile(path.join(f.dir,'a.txt'),'utf8'),'saved\n');
});

test('real partial staging and unstaging preserve the working tree',async t=>{
 const f=await fixture(t);const before='A\nB\nC\n',after='A\nX\nY\nC\n';await f.write('a.txt',before);await f.commit();await f.write('a.txt',after);
 let pair=await f.call('pair',{path:'a.txt',mode:'unstaged'});const edits=diffLines(pair.before,pair.after),ids=edits.filter(e=>e.type==='del'||e.type==='add'&&e.text==='X\n').map(e=>e.id);
 await f.call('selection',{...pair,ids});assert.equal(raw(f.dir,'show',':a.txt'),'A\nX\nC');assert.equal(await fs.readFile(path.join(f.dir,'a.txt'),'utf8'),after);
 await assert.rejects(f.call('selection',{...pair,ids}),/stale/);
 pair=await f.call('pair',{path:'a.txt',mode:'staged'});await f.call('selection',{...pair,ids:diffLines(pair.before,pair.after).filter(e=>e.type!=='equal').map(e=>e.id)});assert.equal(raw(f.dir,'show',':a.txt'),'A\nB\nC');assert.equal(await fs.readFile(path.join(f.dir,'a.txt'),'utf8'),after);
 await f.write('new.txt','one\ntwo\n');pair=await f.call('pair',{path:'new.txt',mode:'unstaged'});await f.call('selection',{...pair,ids:[0]});assert.equal(raw(f.dir,'show',':new.txt'),'one');assert.equal(await fs.readFile(path.join(f.dir,'new.txt'),'utf8'),'one\ntwo\n');
 pair=await f.call('pair',{path:'new.txt',mode:'staged'});await f.call('selection',{...pair,ids:[0]});assert.ok((await f.call('status')).files.find(x=>x.path==='new.txt').untracked);
});

test('commits, branches, annotated tags, stash, worktrees, reflog and blame',async t=>{
 const f=await fixture(t);await f.write('a.txt','one\n');const initial=await f.commit('initial');await f.call('branchCreate',{name:'feature/test',ref:initial,checkout:true});assert.equal((await f.call('status')).branch.name,'feature/test');
 await f.write('a.txt','one\ntwo\n');await f.call('stage',{paths:['a.txt']});await f.call('commit',{message:'second',signoff:true});assert.match(raw(f.dir,'log','-1','--format=%B'),/Signed-off-by/);
 await f.call('tagCreate',{name:'v1.0',message:'release',ref:'HEAD'});assert.ok((await f.call('refs')).some(r=>r.name==='v1.0'&&r.type==='tag'));
 await f.write('a.txt','pending\n');await f.write('new.txt','untracked\n');await f.call('stashSave',{message:'shelf',untracked:true});assert.equal((await f.call('status')).files.length,0);const stash=(await f.call('stashes'))[0];assert.match(stash.name,/stash@/);await f.call('stashApply',{name:stash.name});assert.equal(await fs.readFile(path.join(f.dir,'a.txt'),'utf8'),'pending\n');await f.call('stashDrop',{name:stash.name});assert.equal((await f.call('stashes')).length,0);
 await f.call('reset',{mode:'hard',oid:'HEAD',confirm:true});await f.call('deleteFile',{path:'new.txt'});
 const tree=path.join(f.root,'parallel');await f.call('worktreeAdd',{path:tree,ref:'HEAD',branch:'parallel'});assert.ok((await f.call('worktrees')).some(w=>w.path===tree));await f.call('worktreeLock',{path:tree});await assert.rejects(f.call('worktreeRemove',{path:tree}),/locked/);await f.call('worktreeUnlock',{path:tree});await f.call('worktreeRemove',{path:tree});
 await f.call('branchRename',{name:'feature/test',to:'feature/renamed'});assert.equal((await f.call('status')).branch.name,'feature/renamed');assert.ok((await f.call('reflog')).length>=3);const blame=await f.call('blame',{path:'a.txt'});assert.equal(blame.length,2);assert.equal(blame[0].author,'Test Author');
});

test('local bare remote supports clone, fetch, push, and fast-forward pull',async t=>{
 const f=await fixture(t);await f.write('a.txt','one\n');await f.commit('initial');const bare=path.join(f.root,'origin.git');await fs.mkdir(bare);raw(bare,'init','--bare','--initial-branch=main');await f.call('remoteAdd',{name:'origin',url:bare});await f.call('push',{remote:'origin',branch:'main',setUpstream:true});
 const cloneRepo=await f.service.dispatch('clone',null,{url:bare,path:path.join(f.root,'clone')});const call2=(action,args={})=>f.service.dispatch(action,cloneRepo.id,args);await call2('configSave',{values:{'user.name':'Other Author','user.email':'other@example.test'}});assert.equal((await call2('log')).length,1);
 await f.write('a.txt','one\ntwo\n');await f.commit('second');await f.call('push',{remote:'origin',branch:'main'});await call2('fetch',{remote:'origin',prune:true});assert.equal((await call2('status')).branch.behind,1);await call2('pull',{remote:'origin',branch:'main'});assert.equal(await fs.readFile(path.join(cloneRepo.path,'a.txt'),'utf8'),'one\ntwo\n');
 await call2('newFile',{path:'other.txt',content:'from clone\n'});await call2('stage',{paths:['other.txt']});await call2('commit',{message:'from other clone'});await call2('push',{remote:'origin',branch:'main'});await f.call('fetch',{remote:'origin'});await f.call('pull',{remote:'origin',branch:'main'});assert.equal(await fs.readFile(path.join(f.dir,'other.txt'),'utf8'),'from clone\n');
 await assert.rejects(f.call('push',{remote:'origin',branch:'main',force:true}),/confirmation/);await assert.rejects(f.call('remoteAdd',{name:'bad',url:'ext::sh -c evil'}),/HTTPS|SSH|Unsupported|Remote/);
});

test('merge conflicts expose all stages, resolution stages content and continues',async t=>{
 const f=await fixture(t);await f.write('a.txt','base\n');await f.commit('base');await f.call('branchCreate',{name:'other',checkout:true});await f.write('a.txt','incoming\n');await f.commit('incoming');await f.call('checkout',{ref:'main'});await f.write('a.txt','ours\n');await f.commit('ours');
 await assert.rejects(f.call('merge',{ref:'other'}),/CONFLICT|conflict/);let status=await f.call('status');assert.ok(status.files[0].conflict);assert.ok(status.progress.includes('merge'));const c=await f.call('conflict',{path:'a.txt'});assert.equal(c.base,'base\n');assert.equal(c.ours,'ours\n');assert.equal(c.theirs,'incoming\n');
 await assert.rejects(f.call('resolve',{path:'a.txt',content:c.result,expectedHash:c.hash}),/markers/);await f.call('resolve',{path:'a.txt',content:'ours\nincoming\n',expectedHash:c.hash});assert.ok(!(await f.call('status')).files.some(r=>r.conflict));await f.call('sequence',{kind:'merge',step:'continue'});status=await f.call('status');assert.equal(status.files.length,0);assert.equal(status.progress.length,0);const commit=(await f.call('log'))[0];assert.equal(commit.parents.length,2);assert.ok((await f.call('commitFiles',{oid:commit.oid})).some(r=>r.path==='a.txt'));
});

test('interactive rebase reorders independent commits, rewords, fixes up, and drops',async t=>{
 const f=await fixture(t);await f.write('base.txt','base\n');const base=await f.commit('base');await f.write('one.txt','one\n');const one=await f.commit('one');await f.write('two.txt','two\n');const two=await f.commit('two');await f.write('three.txt','three\n');const three=await f.commit('three');await f.write('drop.txt','drop\n');const drop=await f.commit('drop');
 const original=await f.call('rebasePlan',{base});assert.equal(original.commits.length,4);
 await f.call('rebaseInteractive',{base,plan:[{oid:two,action:'reword',message:'Two, clarified'},{oid:one,action:'pick'},{oid:three,action:'fixup'},{oid:drop,action:'drop'}]});
 const history=raw(f.dir,'log','--format=%s',`${base}..HEAD`).split('\n');assert.deepEqual(history,['one','Two, clarified']);assert.equal((await f.call('status')).files.length,0);assert.equal(await fs.readFile(path.join(f.dir,'three.txt'),'utf8'),'three\n');await assert.rejects(fs.access(path.join(f.dir,'drop.txt')));
});

test('generated patches apply exactly, including quoted paths and final newlines',async t=>{
 const f=await fixture(t);for(const [i,name,a,b]of [[0,'a file.txt','hello','hello\n'],[1,'unicode ü.txt','a\nb\nc\n','a\nz\nc\n'],[2,'tabs\tfile.txt','a\r\nb\r\n','a\r\nx\r\nb\r\n']]){await f.write(name,a);await f.commit('case '+i);const output=patch(a,b,name);await f.call('patchApply',{patch:output});assert.equal(await fs.readFile(path.join(f.dir,name),'utf8'),b);await f.commit('patched '+i);}
 const rows=await f.call('search',{query:'z'});assert.ok(rows.some(r=>r.path==='unicode ü.txt'&&r.line===2));
});

test('renames remain a single staged status entry and hooks are disabled by default',async t=>{
 const f=await fixture(t);await f.write('old name.txt','one\ntwo\nthree\n');await f.commit('base');await f.call('renameFile',{path:'old name.txt',to:'new name.txt'});await f.call('stage',{paths:['old name.txt','new name.txt']});const state=await f.call('status');assert.equal(state.files.length,1);assert.equal(state.files[0].origPath,'old name.txt');assert.equal(state.files[0].path,'new name.txt');
 const marker=path.join(f.root,'hook-ran');await fs.writeFile(path.join(f.dir,'.git/hooks/pre-commit'),`#!/bin/sh\necho unsafe > '${marker}'\nexit 1\n`,{mode:0o755});await f.call('commit',{message:'rename'});await assert.rejects(fs.access(marker));const changed=await f.call('commitFiles',{oid:'HEAD'});assert.equal(changed[0].origPath,'old name.txt');
});

test('rename diffs compare the old path and partial staging respects Git normalization',async t=>{
 const f=await fixture(t);await f.write('old.txt','one\ntwo\nthree\n');await f.commit('base');await f.call('renameFile',{path:'old.txt',to:'new.txt'});await f.call('stage',{paths:['old.txt','new.txt']});let pair=await f.call('pair',{path:'new.txt',mode:'staged'});assert.equal(pair.before,'one\ntwo\nthree\n');assert.equal(pair.after,pair.before);await f.call('commit',{message:'rename'});pair=await f.call('pair',{path:'new.txt',mode:'commit',oid:'HEAD'});assert.equal(pair.before,pair.after);assert.equal(pair.origPath,'old.txt');
 await f.write('.gitattributes','*.txt text eol=lf\n');await f.commit('attributes');await f.write('new.txt','one\nchanged\nthree\n');pair=await f.call('pair',{path:'new.txt',mode:'unstaged'});await assert.rejects(f.call('selection',{...pair,ids:diffLines(pair.before,pair.after).filter(e=>e.type!=='equal').map(e=>e.id)}),/attributes/);await f.call('stage',{paths:['new.txt']});assert.equal(raw(f.dir,'show',':new.txt'),'one\nchanged\nthree');
});

test('cherry-pick, revert, reset, and manual bisect invoke real Git operations',async t=>{
 const f=await fixture(t);await f.write('base.txt','base\n');const base=await f.commit('base');await f.call('branchCreate',{name:'topic',checkout:true});await f.write('topic.txt','topic\n');const topic=await f.commit('topic');await f.call('checkout',{ref:'main'});await f.call('cherryPick',{oid:topic});assert.equal(await fs.readFile(path.join(f.dir,'topic.txt'),'utf8'),'topic\n');await f.call('revert',{oid:'HEAD'});await assert.rejects(fs.access(path.join(f.dir,'topic.txt')));await f.call('reset',{mode:'soft',oid:'HEAD~1',confirm:true});assert.ok((await f.call('status')).files.some(r=>r.staged));await assert.rejects(f.call('reset',{mode:'hard',oid:'HEAD'}),/confirmation/);await f.call('reset',{mode:'hard',oid:'HEAD',confirm:true});
 for(let i=0;i<4;i++){await f.write('steps.txt','step '+i+'\n');await f.commit('step '+i);}await f.call('bisect',{step:'start',good:base,bad:'HEAD'});assert.match((await f.call('bisectStatus')).output,/bisect start/);await f.call('bisect',{step:'reset'});assert.equal((await f.call('status')).branch.name,'main');await f.call('checkout',{ref:'HEAD',detached:true});await f.call('newFile',{path:'detached.txt',content:'detached commit\n'});await f.call('stage',{paths:['detached.txt']});await f.call('commit',{message:'detached tip remains visible'});assert.equal((await f.call('log'))[0].subject,'detached tip remains visible');
});
