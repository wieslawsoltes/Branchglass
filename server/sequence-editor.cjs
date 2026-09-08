// Invoked by Git only with files created by Branchglass. No user shell commands.
const fs=require('node:fs'),path=require('node:path');
const [mode,target]=process.argv.slice(2),dir=process.env.BG_REBASE_DIR;
if(!dir||!target)process.exit(2);
if(mode==='todo')fs.copyFileSync(path.join(dir,'todo'),target);
else if(mode==='message'){
  const current=fs.readFileSync(target,'utf8'),messages=JSON.parse(fs.readFileSync(path.join(dir,'messages.json'),'utf8'));
  const first=current.split('\n').find(s=>s&&!s.startsWith('#'));
  const match=messages.find(m=>m.from===first);
  if(match)fs.writeFileSync(target,match.to+'\n');
  // Squash message: keep Git's generated combined message (comments stripped by Git).
}
