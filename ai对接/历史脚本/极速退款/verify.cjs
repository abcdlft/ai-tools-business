const fs=require('fs');
const notes=JSON.parse(fs.readFileSync('F:\\减负\\auto\\appeal\\2026-11-17-运费复议\\notes.json','utf8'));
const m={};notes.forEach(r=>{if(!m[r.order]||((!m[r.order].note||m[r.order].note==='(空)')&&r.note&&r.note!=='(空)'))m[r.order]=r});
const keep=new Set(['ORD-XXXX-XXXXXX','ORD-XXXX-XXXXXX','ORD-XXXX-XXXXXX','ORD-XXXX-XXXXXX','ORD-XXXX-XXXXXX','ORD-XXXX-XXXXXX']);
const remain=[];
Object.values(m).forEach(r=>{
  const packs=[...(r.note||'').matchAll(/\*\[(\d+)\]/g)].map(x=>Number(x[1]));
  const got=packs.reduce((a,b)=>a+b,0);
  if(got===0||keep.has(r.order))remain.push({order:r.order,recv:r.recv,refund:r.refund,cat:keep.has(r.order)?'少件-留存申诉':'待定-人工核',note:(r.note||'').slice(0,40)});
});
console.log('expected remain='+remain.length);
remain.forEach(r=>console.log(`  ${r.cat} | ${r.order} 收${r.recv}/退${r.refund} | ${r.note}`));
