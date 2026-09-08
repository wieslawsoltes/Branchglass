/** Exact, newline-preserving line diff. Bounded Myers search falls back to an
 * exact (non-minimal) replacement for adversarial / massively different files. */
export const lines = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];

function edits(a, b, budget = 2000000) {
  let v = new Map([[1, 0]]), trace = [], cells = 0;
  for (let d = 0; d <= a.length + b.length; d++) {
    cells += 2 * d + 1;
    if (cells > budget) return [...a.map(text => ({type:'del',text})), ...b.map(text => ({type:'add',text}))];
    trace.push(new Map(v));
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && (v.get(k-1) ?? -1) < (v.get(k+1) ?? -1)) ? (v.get(k+1) ?? 0) : (v.get(k-1) ?? 0) + 1;
      let y = x - k;
      while (x < a.length && y < b.length && a[x] === b[y]) { x++; y++; }
      v.set(k, x);
      if (x >= a.length && y >= b.length) {
        const result = []; x = a.length; y = b.length;
        for (let depth = trace.length-1; depth >= 0; depth--) {
          const pv = trace[depth], key = x-y;
          const prevK = key === -depth || (key !== depth && (pv.get(key-1) ?? -1) < (pv.get(key+1) ?? -1)) ? key+1 : key-1;
          const prevX = pv.get(prevK) ?? 0, prevY = prevX-prevK;
          while (x > prevX && y > prevY) { result.push({type:'equal',text:a[x-1]}); x--; y--; }
          if (!depth) break;
          if (x === prevX) { result.push({type:'add',text:b[y-1]}); y--; }
          else { result.push({type:'del',text:a[x-1]}); x--; }
        }
        return result.reverse();
      }
    }
  }
  return [];
}

export function diffLines(before, after, options = {}) {
  const a=lines(before), b=lines(after); let start=0, end=0;
  while (start<a.length && start<b.length && a[start]===b[start]) start++;
  while (end<a.length-start && end<b.length-start && a[a.length-1-end]===b[b.length-1-end]) end++;
  const result=[...a.slice(0,start).map(text=>({type:'equal',text})),
    ...edits(a.slice(start,a.length-end),b.slice(start,b.length-end),options.budget),
    ...a.slice(a.length-end).map(text=>({type:'equal',text}))];
  let oldLine=1,newLine=1;
  return result.map((e,id)=>({...e,id,oldLine:e.type==='add'?null:oldLine++,newLine:e.type==='del'?null:newLine++}));
}

/** Select individual changes without changing the working file. `reverse`
 * constructs a partially unstaged index from HEAD -> index instead. */
export function selectChanges(before, after, ids, reverse=false) {
  const selected=new Set(ids);
  return diffLines(before,after).filter(e=>e.type==='equal' ||
    (e.type==='del' ? (reverse ? selected.has(e.id) : !selected.has(e.id)) : (reverse ? !selected.has(e.id) : selected.has(e.id))))
    .map(e=>e.text).join('');
}

export function hunks(edits, context=3) {
  const ranges=[];
  for(let i=0;i<edits.length;i++) if(edits[i].type!=='equal') {
    const start=Math.max(0,i-context), end=Math.min(edits.length,i+context+1), last=ranges.at(-1);
    if(last && start<=last.end) last.end=Math.max(end,last.end); else ranges.push({start,end});
  }
  return ranges.map((r,index)=>({...r,index,lines:edits.slice(r.start,r.end)}));
}

export function displayRows(edits, {split=true, context=3, full=false}={}) {
  const groups=full?[{start:0,end:edits.length,index:0,lines:edits}]:hunks(edits,context), result=[];
  for(const h of groups) {
    result.push({type:'hunk',hunk:h.index, ids:h.lines.filter(e=>e.type!=='equal').map(e=>e.id),label:`@@ ${h.lines.find(e=>e.oldLine)?.oldLine||0} · ${h.lines.find(e=>e.newLine)?.newLine||0} @@`,hidden:h.start-(groups[h.index-1]?.end||0)});
    if(!split) { result.push(...h.lines.map(e=>({type:e.type,left:e,right:e,ids:e.type==='equal'?[]:[e.id]}))); continue; }
    for(let i=0;i<h.lines.length;) {
      const e=h.lines[i];
      if(e.type==='equal') {result.push({type:'equal',left:e,right:e,ids:[]});i++;continue;}
      const del=[],add=[];
      while(i<h.lines.length&&h.lines[i].type!=='equal') { const x=h.lines[i++]; (x.type==='del'?del:add).push(x); }
      for(let j=0;j<Math.max(del.length,add.length);j++) result.push({type:'change',left:del[j],right:add[j],ids:[del[j]?.id,add[j]?.id].filter(x=>x!==undefined)});
    }
  }
  return result;
}

export function patch(before,after,path='file') {
  const list=diffLines(before,after), hs=hunks(list);
  if(!hs.length)return '';
  // Git's quoted paths are used for whitespace, tabs, Unicode, and control chars.
  const quote=p=>JSON.stringify(p);
  const out=[`diff --git ${quote('a/'+path)} ${quote('b/'+path)}`,`--- ${quote('a/'+path)}`,`+++ ${quote('b/'+path)}`];
  for(const h of hs) {
    const oldCount=h.lines.filter(e=>e.type!=='add').length,newCount=h.lines.filter(e=>e.type!=='del').length;
    const prefix=list.slice(0,h.start);
    const oldBefore=prefix.filter(e=>e.type!=='add').length,newBefore=prefix.filter(e=>e.type!=='del').length;
    out.push(`@@ -${oldBefore+(oldCount?1:0)},${oldCount} +${newBefore+(newCount?1:0)},${newCount} @@`);
    for(const e of h.lines) {
      out.push((e.type==='add'?'+':e.type==='del'?'-':' ')+e.text.replace(/\n$/,''));
      if(!e.text.endsWith('\n'))out.push('\\ No newline at end of file');
    }
  }
  return out.join('\n')+'\n';
}

export function splitConflict(text) {
  const input=lines(text), blocks=[]; let plain='', block=null, section='ours';
  for(const line of input) {
    if(/^<{7}( |\r?$)/.test(line)) { if(plain)blocks.push({type:'text',text:plain}); plain=''; block={type:'conflict',ours:'',base:'',theirs:'',oursLabel:line.trim().slice(7).trim()};section='ours'; }
    else if(block&&/^\|{7}( |\r?$)/.test(line))section='base';
    else if(block&&/^={7}\r?\n?$/.test(line))section='theirs';
    else if(block&&/^>{7}( |\r?$)/.test(line)){block.theirsLabel=line.trim().slice(7).trim();blocks.push(block);block=null;}
    else if(block)block[section]+=line; else plain+=line;
  }
  if(block)return [{type:'text',text}]; // Do not silently discard malformed conflicts.
  if(plain)blocks.push({type:'text',text:plain}); return blocks;
}

export function layoutGraph(commits) {
  const slots=[], nodes=[], index=new Map(commits.map((c,i)=>[c.oid,i]));
  let maxLane=0;
  for(let i=0;i<commits.length;i++) {
    const c=commits[i]; let lane=slots.indexOf(c.oid);
    if(lane<0){lane=slots.indexOf(null);if(lane<0)lane=slots.length;slots[lane]=c.oid;}
    const parents=c.parents||[];
    nodes.push({index:i,lane,oid:c.oid,merge:parents.length>1}); maxLane=Math.max(maxLane,lane);
    slots[lane]=null;
    parents.forEach((parent,j)=>{
      if(slots.includes(parent))return;
      let target=j===0&&slots[lane]===null?lane:slots.indexOf(null);
      if(target<0)target=slots.length; slots[target]=parent;maxLane=Math.max(maxLane,target);
    });
  }
  const edges=[];
  for(let i=0;i<commits.length;i++) for(const [p,parent] of (commits[i].parents||[]).entries()) {
    const target=index.get(parent);
    if(target!==undefined&&target>i)edges.push({from:i,to:target,a:nodes[i].lane,b:nodes[target].lane,lane:p?nodes[target].lane:nodes[i].lane});
    else if(target===undefined)edges.push({from:i,to:commits.length+.5,a:nodes[i].lane,b:nodes[i].lane,lane:nodes[i].lane,truncated:true});
  }
  return {nodes,edges,lanes:maxLane+1};
}
