import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('loopback API enforces token, origin, host, content type, and root restrictions',async t=>{
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'branchglass-http-'));const port=await new Promise(resolve=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n));});});
 const child=spawn(process.execPath,[fileURLToPath(new URL('../server/index.mjs',import.meta.url)),'--root',root,'--port',String(port)],{env:{...process.env,BRANCHGLASS_TOKEN:'test-token-only'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);t.after(async()=>{child.kill();await fs.rm(root,{recursive:true,force:true});});const base='http://127.0.0.1:'+port;
 for(let i=0;i<100;i++){try{await fetch(base);break;}catch{await new Promise(r=>setTimeout(r,20));}}
 const headers={'Content-Type':'application/json','X-Branchglass-Token':'test-token-only'},body=JSON.stringify({action:'hello'}),request=(extra={},data=body)=>fetch(base+'/api',{method:'POST',headers:{...headers,...extra},body:data});
 assert.equal((await fetch(base+'/api',{method:'POST',headers:{'Content-Type':'application/json'},body})).status,401);
 assert.equal((await request({'X-Branchglass-Token':'wrong'})).status,401);
 assert.equal((await request({Origin:'https://attacker.example'})).status,403);
 assert.equal(await new Promise((resolve,reject)=>{const req=http.request(base+'/api',{method:'POST',headers:{...headers,Host:'attacker.example:'+port}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end(body);}),403);
 assert.equal((await request({'Content-Type':'text/plain'})).status,415);
 assert.equal((await request({},'{invalid')).status,400);
 const hello=await request({Origin:base});assert.equal(hello.status,200);assert.equal((await hello.json()).result.root,root);
 const outside=await request({},JSON.stringify({action:'open',args:{path:os.tmpdir()}}));assert.equal(outside.status,400);assert.match((await outside.json()).error,/outside/);
 const staticPage=await fetch(base+'/');assert.equal(staticPage.status,200);assert.match(staticPage.headers.get('Content-Security-Policy'),/object-src 'none'/);assert.equal(staticPage.headers.get('X-Frame-Options'),'DENY');assert.equal((await fetch(base+'/server/git.mjs')).status,404);
 assert.equal((await fetch(base+'/api')).status,405);assert.equal((await request({},JSON.stringify({action:'runArbitraryShell',args:{}}))).status,400);
});
