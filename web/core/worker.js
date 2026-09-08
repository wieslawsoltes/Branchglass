import {diffLines,displayRows,layoutGraph} from './diff.js';
self.onmessage=({data:{id,type,payload}})=>{
  try {
    let result;
    if(type==='diff'){const edits=diffLines(payload.before,payload.after);result={edits,rows:displayRows(edits,payload.options),added:edits.filter(x=>x.type==='add').length,deleted:edits.filter(x=>x.type==='del').length};}
    else if(type==='graph')result=layoutGraph(payload);
    else throw Error('Unknown worker operation');
    self.postMessage({id,result});
  }catch(e){self.postMessage({id,error:e.message});}
};
