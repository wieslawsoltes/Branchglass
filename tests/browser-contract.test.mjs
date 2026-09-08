import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BrowserProvider,NativeProvider} from '../web/core/providers.js';
import {GraphRenderer} from '../web/core/gpu.js';
import {layoutGraph} from '../web/core/diff.js';

function provider({mode=0o100644,config='',special=false,dirty=false,merged=true}={}){
 const p=new BrowserProvider({name:'fixture'}),calls=[];p.fs={handle:async()=>{if(special)return {kind:'file'};throw Object.assign(Error('absent'),{code:'ENOENT'});},readFile:async()=>config};
 p.git={STAGE:()=>({stage:true}),TREE:({ref})=>({ref}),getConfig:async()=>'',resolveRef:async({ref})=>ref==='refs/heads/topic'?'b'.repeat(40):'a'.repeat(40),readObject:async()=>({type:'commit',object:{}}),walk:async({map})=>map('file.txt',[{mode:async()=>mode}]),statusMatrix:async()=>dirty?[['file.txt',1,2,1]]:[],currentBranch:async()=> 'main',branch:async o=>calls.push(['branch',o]),checkout:async o=>calls.push(['checkout',o]),deleteBranch:async o=>calls.push(['delete',o]),isDescendent:async()=>merged};return {p,calls};
}
test('browser write guard blocks POSIX modes, custom filters, and sequenced operations',async()=>{
 await provider().p.assertCompatible();for(const mode of [0o100755,0o120000,0o160000])await assert.rejects(provider({mode}).p.assertCompatible(),/blocked/);await assert.rejects(provider({config:'[filter "lfs"]\n clean=git-lfs clean'}).p.assertCompatible(),/blocked/);await assert.rejects(provider({special:true}).p.assertCompatible(),/blocked/);
});
test('browser branch creation checks out files, rejects dirty checkout, and protects unmerged deletion',async()=>{
 let {p,calls}=provider();await p.call('branchCreate',{name:'topic',checkout:true});assert.deepEqual(calls.map(c=>c[0]),['branch','checkout']);assert.equal(calls[0][1].checkout,false);assert.equal(calls[1][1].ref,'topic');await assert.rejects(provider({dirty:true}).p.call('branchCreate',{name:'topic',checkout:true}),/Commit your browser changes/);await assert.rejects(p.call('branchDelete',{name:'main'}),/checked-out/);await assert.rejects(provider({merged:false}).p.call('branchDelete',{name:'topic'}),/unmerged/);await assert.rejects(p.call('branchDelete',{name:'topic',force:true}),/confirmation/);
});
test('native provider emits the authenticated API envelope and surfaces backend errors',async t=>{
 const previousFetch=globalThis.fetch,previousDocument=globalThis.document;globalThis.document={baseURI:'http://127.0.0.1:4173/'};let received;globalThis.fetch=async(url,options)=>{received={url:String(url),options};return {ok:true,json:async()=>({ok:true,result:{message:'done'}})};};t.after(()=>{globalThis.fetch=previousFetch;if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;});const p=new NativeProvider('secret',{id:'repo-id'});assert.equal((await p.call('stage',{paths:['safe.txt']})).message,'done');assert.equal(received.url,'http://127.0.0.1:4173/api');assert.equal(received.options.headers['X-Branchglass-Token'],'secret');assert.deepEqual(JSON.parse(received.options.body),{action:'stage',repo:'repo-id',args:{paths:['safe.txt']}});globalThis.fetch=async()=>({ok:false,json:async()=>({error:'Repository denied'})});await assert.rejects(p.call('status'),/denied/);
});
test('graph geometry is viewport culled and uses finite interleaved GPU vertices',()=>{
 const commits=Array.from({length:5000},(_,i)=>({oid:String(i),parents:i<4999?[String(i+1)]:[]}));const renderer=new GraphRenderer({});renderer.layout=layoutGraph(commits);renderer.scrollTop=3000*38;const result=renderer.geometry(160,420);assert.ok(result.vertices.length>0);assert.equal(result.vertices.length%6,0);assert.ok([...result.vertices].every(Number.isFinite));assert.ok(result.coords.filter(x=>x.type==='circle').length<20);assert.ok(result.vertices.length<10000);
});
