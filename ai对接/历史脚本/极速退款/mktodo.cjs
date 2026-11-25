const fs=require('fs');
const notes=JSON.parse(fs.readFileSync('F:\\减负\\auto\\appeal\\2026-11-17-运费复议\\notes.json','utf8'));
const m={};notes.forEach(r=>{if(!m[r.order]||((!m[r.order].note||m[r.order].note==='(空)')&&r.note&&r.note!=='(空)'))m[r.order]=r});
const keep=new Set(['ORD-XXXX-XXXXXX','ORD-XXXX-XXXXXX','ORD-XXXX-XXXXXX','ORD-XXXX-XXXXXX','ORD-XXXX-XXXXXX','ORD-XXXX-XXXXXX']);
const toDrop=[];
Object.values(m).forEach(r=>{
  const packs=[...(r.note||'').matchAll(/\*\[(\d+)\]/g)].map(x=>Number(x[1]));
  const got=packs.reduce((a,b)=>a+b,0);
  if(got>0 && !keep.has(r.order)) toDrop.push(r.order);
});
fs.writeFileSync('F:\\减负\\auto\\appeal\\2026-11-17-运费复议\\to-drop.json',JSON.stringify(toDrop,null,2),'utf8');
console.log('to-drop='+toDrop.length);
console.log(toDrop.join('\n'));
