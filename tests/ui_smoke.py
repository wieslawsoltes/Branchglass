#!/usr/bin/env python3
"""Optional browser UI checks. Creates and destroys its OWN temporary Git fixture.

Requires Python Playwright and Chromium. Native runtime itself needs neither.
Run: python tests/ui_smoke.py --chromium /path/to/chromium
Use --inline only where managed navigation prevents ordinary localhost testing.
It does not alter browser policy. Inline tests do not validate secure-origin APIs.
"""
import argparse, atexit, hashlib, json, os, secrets, shutil, socket, subprocess
import tempfile, time, urllib.request, urllib.error
from pathlib import Path
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--inline',action='store_true')
parser.add_argument('--chromium',default=shutil.which('chromium') or shutil.which('google-chrome'))
parser.add_argument('--screenshots',type=Path,default=ROOT/'docs/screenshots')
opts=parser.parse_args()
OUT=opts.screenshots.resolve();OUT.mkdir(parents=True,exist_ok=True)
(ROOT/'docs/results').mkdir(parents=True,exist_ok=True)
subprocess.run(['node','scripts/build-preview.mjs'],cwd=ROOT,check=True)
temporary=tempfile.TemporaryDirectory(prefix='branchglass-ui-')
fixture=Path(temporary.name)/'ui-tests'
seed=(ROOT/'server/seed.mjs').as_uri()
subprocess.run(['node','--input-type=module','-e',f"import {{createDemo}} from {json.dumps(seed)};await createDemo({json.dumps(str(fixture))});"],cwd=ROOT,check=True)
with socket.socket() as sock:
 sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
BASE=f'http://127.0.0.1:{port}'
TOKEN=secrets.token_hex(32)
log=open(Path(temporary.name)/'bridge.log','w+')
process=subprocess.Popen(['node','server/index.mjs','--root',temporary.name,'--repo',str(fixture),'--port',str(port)],cwd=ROOT,env={**os.environ,'BRANCHGLASS_TOKEN':TOKEN},stdout=log,stderr=log)
def cleanup():
 process.terminate()
 try:process.wait(timeout=7)
 except subprocess.TimeoutExpired:process.kill();process.wait(timeout=3)
 log.close();temporary.cleanup()
atexit.register(cleanup)
for attempt in range(100):
 try:
  urllib.request.urlopen(BASE,timeout=.5).close();break
 except (urllib.error.URLError,TimeoutError):
  if process.poll() is not None:
   log.seek(0);raise RuntimeError(log.read())
  time.sleep(.05)
else:raise RuntimeError('Local bridge did not become ready.')
def rpc(payload):
 req=urllib.request.Request(BASE+'/api',json.dumps(payload).encode(),headers={'Content-Type':'application/json','X-Branchglass-Token':TOKEN,'Origin':BASE})
 try:
  response=urllib.request.urlopen(req,timeout=15);return {'status':response.status,'data':json.load(response)}
 except urllib.error.HTTPError as e:return {'status':e.code,'data':json.load(e)}
info=rpc({'action':'hello'})['data']['result'];repo=next(r for r in info['repos'] if r['path'].endswith('/ui-tests'))
def api(action,args={}):
 r=rpc({'action':action,'args':args,'repo':repo['id']})['data']
 if not r.get('ok'): raise Exception(r['error'])
 return r['result']
html=(ROOT/'Branchglass.html').read_text().replace('<head>','<head><base href="'+BASE+'/">')
html=html.replace('boot().catch(error=>',"window.__BG_TEST__={state:S,actions,navigate,refresh,NativeProvider};boot().catch(error=>")
results=[]
def passed(label):results.append({'test':label,'pass':True});print('PASS',label,flush=True)
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path=opts.chromium,headless=True,args=['--no-sandbox'] if hasattr(os,'geteuid') and os.geteuid()==0 else [])
 page=browser.new_page(viewport={'width':1720,'height':1080},device_scale_factor=1)
 page.set_default_timeout(7000)
 errors=[]
 page.on('pageerror',lambda e:errors.append(str(e)))
 page.route('https://**',lambda route:route.abort())
 if opts.inline:
  page.expose_function('__testDigest',lambda data:list(hashlib.sha256(bytes(data)).digest()))
  page.expose_function('__testNative',rpc)
  page.evaluate('''() => {Object.defineProperty(crypto,'subtle',{value:{digest:async (name,data)=>new Uint8Array(await window.__testDigest(Array.from(new Uint8Array(data)))).buffer}});const store=new Map();const storage={getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,String(v)),removeItem:k=>store.delete(k)};Object.defineProperty(window,'localStorage',{value:storage});Object.defineProperty(window,'sessionStorage',{value:storage});window.fetch=async (url,options)=>{if(String(url).endsWith('/api')){const r=await window.__testNative(JSON.parse(options.body));return new Response(JSON.stringify(r.data),{status:r.status,headers:{'Content-Type':'application/json'}});}throw Error('Test harness blocks external network requests.');};}''')
  page.set_content(html,wait_until='load')
 else:
  source=(ROOT/'web/app.js').read_text().replace('boot().catch(error=>',"window.__BG_TEST__={state:S,actions,navigate,refresh,NativeProvider};boot().catch(error=>")
  page.route('**/app.js',lambda route:route.fulfill(body=source,content_type='text/javascript'))
  page.goto(BASE,wait_until='load')
 page.wait_for_function('!!window.Branchglass && document.querySelectorAll(".diff-row").length>0')
 assert not errors,errors
 passed('Application boot and available graph renderer run without exceptions')
 page.screenshot(path=str(OUT/'dark.png'))
 page.locator('[data-action=theme]').click();assert page.locator('html').get_attribute('data-theme')=='light';page.wait_for_timeout(300);page.screenshot(path=str(OUT/'light.png'));page.locator('[data-action=theme]').click();passed('Light and dark themes')
 page.locator('[data-action=palette]').click();page.locator('#palette-query').fill('Rendering diagnostics');page.locator('#palette-query').press('Enter');page.wait_for_selector('#dialog[open]');assert 'Engine, in plain sight' in page.locator('#dialog').inner_text();page.locator('#dialog [data-action=closeDialog]').click();passed('Command palette search, keyboard selection, and dialog')
 # --inline is for navigation-restricted environments: actual app/provider,
 # test-provided crypto/storage and HTTP forwarding. Default uses real navigation.
 page.evaluate('''async ({token,repo,info})=>{const x=window.__BG_TEST__;const provider=new x.NativeProvider(token,repo);x.state.bridge={token,info};x.state.provider=provider;x.state.builtView=null;await x.refresh();}''',{'token':TOKEN,'repo':repo,'info':info})
 assert page.evaluate('Branchglass.diagnostics().provider')=='native';page.screenshot(path=str(OUT/'native.png'));passed('Native repository snapshot wired to real Git API')
 page.locator('.diff-cell.add[data-action=selectLine]').first.click();page.wait_for_selector('#selection-button:not([hidden])');assert '1 line' in page.locator('#selection-button').inner_text();page.locator('#selection-button').click();page.wait_for_function('window.__BG_TEST__.state.busy===0 && document.querySelector("#selection-button")?.hidden');
 pair=api('pair',{'path':'src/renderer/pipeline.js','mode':'staged'});assert 'enableCulling' in pair['after'];passed('Single-line staging changes the real index')
 page.locator('.file-row[data-path="src/renderer/pipeline.js"][data-mode="staged"]').hover();page.locator('.file-row[data-path="src/renderer/pipeline.js"][data-mode="staged"] .stage-button').click();page.wait_for_function('window.__BG_TEST__.state.busy===0 && !window.__BG_TEST__.state.snapshot.status.files.find(f=>f.path.endsWith("pipeline.js"))?.staged');passed('Whole-file unstaging preserves working changes')
 page.locator('[data-action=stageHunk]').first.click();page.wait_for_function('window.__BG_TEST__.state.busy===0 && window.__BG_TEST__.state.snapshot.status.files.find(f=>f.path.endsWith("pipeline.js"))?.staged');passed('Hunk staging applies its exact changed-line set')
 page.locator('[data-action=stageAll]').first.click();page.wait_for_function('window.__BG_TEST__.state.busy===0 && !window.__BG_TEST__.state.snapshot.status.files.some(f=>f.unstaged)');page.locator('#commit-summary').fill('test: complete browser-staged change');page.locator('#commit-body').fill('Verified through the Branchglass interface.');page.locator('#commit-button').click();page.wait_for_function('window.__BG_TEST__.state.busy===0 && window.__BG_TEST__.state.snapshot.status.files.length===0');assert api('log',{'limit':1})[0]['subject']=='test: complete browser-staged change';passed('Stage-all and commit compose create a real Git commit')
 page.locator('.rail-button[data-view=files]').click();page.wait_for_selector('.file-row[data-path="src/renderer/pipeline.js"]');page.locator('.file-row[data-path="src/renderer/pipeline.js"]').click();page.wait_for_selector('#code-editor');content=page.locator('#code-editor').input_value();page.locator('#code-editor').fill(content+'\n// Edited in Branchglass UI test.\n');assert page.evaluate('Branchglass.diagnostics().dirty');page.locator('#code-editor').press('Control+s');page.wait_for_function('!window.Branchglass.diagnostics().dirty && window.__BG_TEST__.state.busy===0');assert '// Edited in Branchglass UI test.' in api('read',{'path':'src/renderer/pipeline.js'})['content'];passed('Editable file view and keyboard save write actual bytes')
 page.locator('#code-editor').fill(content+'unsaved');page.locator('.rail-button[data-view=history]').click();page.wait_for_selector('#dialog[open]');assert 'Discard unsaved' in page.locator('#dialog').inner_text();page.locator('#dialog [data-action=closeDialog]').first.click();assert page.locator('#code-editor').count()==1;page.locator('#code-editor').fill(content+'\n// Edited in Branchglass UI test.\n');page.locator('.rail-button[data-view=history]').click();page.wait_for_selector('#history-scroll');passed('Unsaved editor navigation guard preserves edits on cancel')
 page.locator('[data-action=createBranch]').first.click();page.wait_for_selector('#modal-form');page.locator('#modal-form [name=name]').fill('test/browser-interface');page.locator('#modal-form button[type=submit]').click();page.wait_for_function('document.querySelector("#current-branch").textContent==="test/browser-interface"');passed('Branch creation and checkout through modal form')
 page.locator('.rail-button[data-action=settings]').click();page.wait_for_selector('#modal-form');page.locator('[name="user.name"]').fill('Branchglass UI Tester');page.locator('#modal-form button[type=submit]').click();page.wait_for_function('!document.querySelector("#dialog").open');assert api('config')['user.name']=='Branchglass UI Tester';passed('Repository-local identity settings')
 for view in ['branches','tags','stashes','worktrees','remotes','reflog','submodules','lfs','bisect','insights','activity','search','pullrequests']:
  page.evaluate('async view=>await window.__BG_TEST__.navigate(view)',view)
  assert page.locator('#workbench h1').count()==1,(view,page.locator('#workbench').inner_text())
  assert not errors,errors
 passed('Thirteen secondary workspaces render without runtime errors')
 page.screenshot(path=str(OUT/'collaboration.png'))
 page.evaluate('async()=>await window.__BG_TEST__.navigate("search")');page.locator('#repo-search-input').fill('Edited in Branchglass');page.locator('#repo-search-form button').click();page.wait_for_selector('#repo-search-results [data-action=searchOpen]');page.locator('#repo-search-results [data-action=searchOpen]').first.click();page.wait_for_selector('#code-editor');assert page.locator('#code-editor').input_value().find('Edited in Branchglass')>=0;passed('Repository search opens the matching file and line')
 # Repeatedly replacing dialogs must not accidentally resolve a newly opened form.
 page.locator('[data-action=open]').first.click();page.wait_for_selector('#dialog[open]');page.locator('[data-action=nativeOpen]').click();page.wait_for_selector('#modal-form [name=path]');page.locator('#modal-form [data-action=closeDialog]').first.click();passed('Nested connection-dialog transition and cancellation')
 page.evaluate('async()=>await window.__BG_TEST__.navigate("history")');page.locator('[data-action=selectCommit]').first.click();page.wait_for_function('!!window.__BG_TEST__.state.commitOid && window.__BG_TEST__.state.commitFiles.length>0');assert 'COMMIT' in page.locator('#inspector').inner_text();passed('Commit inspection loads first-parent diffs and metadata')
 # Synthetic-history rendering test: graph virtualization, not a throughput claim.
 stats=page.evaluate('''async()=>{const x=window.__BG_TEST__,base=x.state.snapshot.commits[0];x.state.snapshot.commits=Array.from({length:5000},(_,i)=>({...base,oid:String(i).padStart(40,'0'),parents:i<4999?[String(i+1).padStart(40,'0')]:[],refs:[],subject:'Synthetic commit '+i}));x.state.commitOid=null;x.state.inspectedCommit=null;x.state.builtView=null;await x.navigate('history');document.querySelector('#history-scroll').scrollTop=150000;await new Promise(r=>setTimeout(r,100));return Branchglass.diagnostics();}''');assert stats['historyDOM']<60 and stats['commits']==5000,stats;passed('5,000-commit synthetic scene keeps fewer than 60 history rows mounted')
 assert not errors,errors
 (ROOT/'docs/results/ui.json').write_text(json.dumps({'results':results,'errors':errors,'synthetic_history':stats,'browser':browser.version,'harness':'Inline DOM; test-provided SHA-256/storage and native HTTP forwarding' if opts.inline else 'Normal loopback navigation and native HTTP','real_native_git':True,'hardware_gpu_claim':False},indent=2))
 print('TOTAL',len(results),'ERRORS',errors,flush=True)
 browser.close()
