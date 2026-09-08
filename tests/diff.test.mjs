import {test} from 'node:test';
import assert from 'node:assert/strict';
import {diffLines,selectChanges,displayRows,patch,splitConflict,layoutGraph} from '../web/core/diff.js';

test('diff preserves exact input bytes across edge cases',()=>{
  const cases=[['',''],['','hello\n'],['hello\n',''],['x','x\n'],['x\n','x'],['x\r\n','x\n'],['a\nb\nc\n','a\nz\nc\n'],['α\n🦋\n','α\n風\n'],['a\na\na\n','a\nb\na\n']];
  for(const [a,b]of cases){const result=diffLines(a,b);assert.equal(result.filter(e=>e.type!=='add').map(e=>e.text).join(''),a);assert.equal(result.filter(e=>e.type!=='del').map(e=>e.text).join(''),b);const ids=result.filter(e=>e.type!=='equal').map(e=>e.id);assert.equal(selectChanges(a,b,[]),a);assert.equal(selectChanges(a,b,ids),b);assert.equal(selectChanges(a,b,ids,true),a);assert.equal(selectChanges(a,b,[],true),b);}
});
test('deterministic randomized diff reconstruction: 1,500 pairs',()=>{
  let seed=927413;const rand=()=>((seed=(Math.imul(seed,1664525)+1013904223)>>>0)/2**32);const text=()=>Array.from({length:Math.floor(rand()*65)},()=>['alpha\n','b\n','same\n','\n','κ\n'][Math.floor(rand()*5)]).join('')+(rand()<.2?'tail':'');
  for(let i=0;i<1500;i++){const a=text(),b=text(),edits=diffLines(a,b);assert.equal(edits.filter(e=>e.type!=='add').map(e=>e.text).join(''),a,'old '+i);assert.equal(edits.filter(e=>e.type!=='del').map(e=>e.text).join(''),b,'new '+i);}
});
test('partial selection removes/adds exactly selected edit lines',()=>{const a='A\nB\nC\n',b='A\nX\nY\nC\n',edits=diffLines(a,b);const add=edits.find(e=>e.type==='add'&&e.text==='X\n');const del=edits.find(e=>e.type==='del');assert.equal(selectChanges(a,b,[add.id]),'A\nB\nX\nC\n');assert.equal(selectChanges(a,b,[add.id,del.id]),'A\nX\nC\n');});
test('split and unified presentation preserve all changed line IDs',()=>{const edits=diffLines('a\nb\n','a\nc\nd\n');for(const split of [true,false]){const rows=displayRows(edits,{split});assert.deepEqual(rows.filter(r=>r.type==='hunk').flatMap(r=>r.ids),edits.filter(e=>e.type!=='equal').map(e=>e.id));}});
test('bounded fallback returns an exact replacement',()=>{const a=Array.from({length:1800},(_,i)=>'A'+i+'\n').join(''),b=a.replaceAll('A','B');const edits=diffLines(a,b,{maxCells:100});assert.equal(edits.filter(e=>e.type!=='add').map(e=>e.text).join(''),a);assert.equal(edits.filter(e=>e.type!=='del').map(e=>e.text).join(''),b);});
test('diff3 conflict parsing preserves plain regions and alternatives',()=>{const text='before\n<<<<<<< HEAD\nours\n||||||| ancestor\nbase\n=======\ntheirs\n>>>>>>> feature\nafter\n';const blocks=splitConflict(text);assert.equal(blocks.length,3);assert.equal(blocks[1].ours,'ours\n');assert.equal(blocks[1].base,'base\n');assert.equal(blocks[1].theirs,'theirs\n');assert.equal(blocks[2].text,'after\n');assert.deepEqual(splitConflict('<<<<<<< HEAD\nunclosed'),[{type:'text',text:'<<<<<<< HEAD\nunclosed'}]);});
test('graph edges follow real parents, including merge and missing tails',()=>{const commits=[{oid:'A',parents:['B','C']},{oid:'B',parents:['D']},{oid:'C',parents:['D']},{oid:'D',parents:['missing']}];const graph=layoutGraph(commits);assert.equal(graph.nodes.length,4);assert.equal(graph.edges.length,5);assert.ok(graph.nodes[0].merge);assert.ok(graph.lanes>=2);for(const e of graph.edges)if(!e.truncated)assert.ok(commits[e.from].parents.includes(commits[e.to].oid));});
test('unified patch records final-newline changes',()=>{const output=patch('hello','hello\n','a file.txt');assert.match(output,/No newline at end of file/);assert.match(output,/a file.txt/);});
