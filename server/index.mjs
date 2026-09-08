#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {GitService} from './git.mjs';
import {createDemo} from './seed.mjs';
const argv=process.argv.slice(2),value=(key,fallback)=>{const i=argv.indexOf(key);return i<0?fallback:argv[i+1];};
if(argv.includes('--help')){console.log(`Branchglass local Git bridge

Usage: node server/index.mjs [options]
  --root PATH       Authorized folder (defaults to your home directory)
  --repo PATH       Repository to open at startup
  --port NUMBER     Loopback port (default 4173)
  --demo            Create an isolated demo under ROOT/.branchglass/demo
  --allow-hooks     Enable repository hooks; trusted repositories only

Open the private URL printed at startup. Keep its token secret.
`);process.exit(0);}
const allowedArgs=new Set(['--root','--repo','--port','--demo','--allow-hooks']);for(let i=0;i<argv.length;i++){const flag=argv[i];if(!allowedArgs.has(flag))throw Error('Unknown option: '+flag);if(['--root','--repo','--port'].includes(flag)&&(!argv[++i]||argv[i].startsWith('--')))throw Error(flag+' requires a value.');}
const port=Number(value('--port','4173')),host='127.0.0.1';if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Choose a port between 1024 and 65535.');
const root=path.resolve(value('--root',os.homedir())),webroot=fileURLToPath(new URL('../web/',import.meta.url));
const token=process.env.BRANCHGLASS_TOKEN||crypto.randomBytes(32).toString('hex');
const git=new GitService({root,allowHooks:argv.includes('--allow-hooks')});await git.prepare();
let initial;
if(argv.includes('--demo')){const demo=path.join(root,'.branchglass','demo');await createDemo(demo);initial=await git.register(demo);}
const repoArg=value('--repo',null);if(repoArg)initial=await git.register(repoArg);
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon','.md':'text/plain; charset=utf-8'};
const expectedHosts=new Set([`${host}:${port}`,`localhost:${port}`]);
const authorize=req=>{const supplied=Buffer.from(req.headers['x-branchglass-token']||'');const actual=Buffer.from(token);return supplied.length===actual.length&&crypto.timingSafeEqual(supplied,actual);};
const server=http.createServer(async(req,res)=>{
  const authority=req.headers.host||'';
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cross-Origin-Resource-Policy','same-origin');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https:; worker-src 'self' blob:; object-src 'none'; frame-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
  if(!expectedHosts.has(authority))return send(403,{error:'Invalid Host header.'});
  const origin=req.headers.origin;
  if(origin&&!new Set([`http://${host}:${port}`,`http://localhost:${port}`]).has(origin))return send(403,{error:'Cross-origin requests are not permitted.'});
  try {
    const url=new URL(req.url,`http://${authority}`);
    if(url.pathname==='/api'){
      if(req.method!=='POST')return send(405,{error:'Use POST.'});
      if(!authorize(req))return send(401,{error:'Bridge not connected. Open the private URL printed in your terminal (including #token=…).'});
      if(!req.headers['content-type']?.startsWith('application/json'))return send(415,{error:'JSON is required.'});
      let body='',size=0;for await(const chunk of req){size+=chunk.length;if(size>12*1024*1024)return send(413,{error:'Request is too large.'});body+=chunk;}
      const {action,repo,args}=JSON.parse(body);if(typeof action!=='string'||args!==undefined&&(typeof args!=='object'||args===null||Array.isArray(args)))return send(400,{error:'Invalid request.'});
      const result=await git.dispatch(action,repo,args);return send(200,{ok:true,result});
    }
    if(req.method!=='GET'&&req.method!=='HEAD')return send(405,{error:'Read-only static server.'});
    const decoded=decodeURIComponent(url.pathname);const filename=decoded==='/'?'index.html':decoded.slice(1),absolute=path.resolve(webroot,filename);
    if(!absolute.startsWith(webroot)||filename.includes('\0')||filename.includes('\\'))return send(403,{error:'Invalid static path.'});
    let data;try{data=await fs.readFile(absolute);}catch{return send(404,{error:'Not found.'});}
    res.writeHead(200,{'Content-Type':MIME[path.extname(absolute)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:data);
  }catch(e){send(400,{error:e.message});}
});
server.listen(port,host,()=>{console.log(`\n  BRANCHGLASS  /  your code, in perspective\n\n  Open this private URL in your browser:\n  http://${host}:${port}/#token=${token}${initial?'&repo='+initial.id:''}\n\n  Authorized root: ${root}\n  ${git.version}  ·  Hooks ${git.allowHooks?'enabled (trusted repositories only)':'disabled'}\n  Loopback only. Keep this token private. Ctrl+C stops the bridge.\n`);});
server.on('error',e=>{console.error(e.message);process.exit(1);});

let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(stopping)return;stopping=true;server.close(async()=>{await git.dispose();process.exit(0);});setTimeout(()=>process.exit(1),5000).unref();});
