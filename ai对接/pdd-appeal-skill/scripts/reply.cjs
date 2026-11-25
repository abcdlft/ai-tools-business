#!/usr/bin/env node
// reply.cjs —— 话术库检索（从 reply-library.json 按申诉类型/场景/关键词找话术）
// 用法:
//   node reply.cjs --type 运费                 # 按申诉类型列
//   node reply.cjs --type 负向体验3元            # 负向3元话术
//   node reply.cjs --kw 漏尿                   # 全文关键词
//   node reply.cjs --type 货款/仅退款 --kw 过敏  # 组合筛选
//   node reply.cjs --id prod-freight-1          # 按 id 精确取
const fs=require('fs'),path=require('path');
const LIB=path.join(__dirname,'..','references','reply-library.json');
const lib=JSON.parse(fs.readFileSync(LIB,'utf8'));
const argv=process.argv.slice(2);
function opt(n){const i=argv.indexOf(n);return i>=0?argv[i+1]:null}
const id=opt('--id'),type=opt('--type'),kw=opt('--kw');
let rows=lib.entries||[];
if(id)rows=rows.filter(e=>e.id===id);
if(type)rows=rows.filter(e=>(e.appealType||'').includes(type));
if(kw)rows=rows.filter(e=>((e.text||'')+' '+(e.scene||'')+' '+(e.id||'')).toLowerCase().includes(kw.toLowerCase()));
const out={query:{id,type,kw},total:rows.length,entries:rows.map(e=>({id:e.id,appealType:e.appealType,scene:e.scene,text:e.text,evidence:e.evidence,source:e.source}))};
console.log(JSON.stringify(out,null,2));
