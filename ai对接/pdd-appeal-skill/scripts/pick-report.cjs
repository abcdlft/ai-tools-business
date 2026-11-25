#!/usr/bin/env node
// pick-report.cjs —— 按订单商品标题自动匹配正确的检测报告（品牌+品类双匹配）
// 解决 2026-11-17 事故：【兔小贝】山茶花被错传成 MOODO BABY 山茶花报告。
// 用法:
//   node pick-report.cjs "【兔小贝】山茶花max轻薄双芯拉拉裤M码"
//   node pick-report.cjs --order ORD-XXXX-XXXXXX   # 从当前浏览器详情页读商品标题
//   node pick-report.cjs --file titles.txt                 # 每行一个标题
// 环境: 报告根目录自动探测（report-map.json 的 roots）；--root 可覆盖。
const fs=require('fs'),path=require('path'),http=require('http');
const MAP=path.join(__dirname,'..','references','report-map.json');
const CDP_PORT=Number(process.env.CDP_PORT||9222);

function loadMap(){return JSON.parse(fs.readFileSync(MAP,'utf8'))}
function norm(s){return String(s||'').toLowerCase().replace(/\s+/g,'')}
function findRoot(m,override){
  const drive=path.parse(__dirname).root;           // 脚本所在盘符根，如 F:\ —— U盘盘符漂移自动适配
  const home=process.env.USERPROFILE||'C:\\Users\\Administrator';
  const expand=d=>d.replace(/\{DRIVE\}/g,drive).replace(/\{USERPROFILE\}/g,home);
  const dirs=(override?[override]:m.roots).map(expand);
  for(const d of dirs){if(fs.existsSync(d))return d}
  return null;
}
// 返回 {brand, dir, expectSample, score, ambiguous}；score 越大越具体
function matchBrand(m,title){
  const t=norm(title);
  const hits=[];
  for(const b of m.brands){
    const kwHit=b.keywords.some(k=>t.includes(norm(k)));
    if(!kwHit)continue;
    // need 全部命中才成立（如 兔小贝+面膜裤）
    if(b.need.length && !b.need.every(k=>t.includes(norm(k))))continue;
    let score=b.keywords.reduce((a,k)=>a+(t.includes(norm(k))?norm(k).length:0),0);
    score+=b.need.length*6;
    hits.push({brand:b.brand,dir:b.dir,expectSample:b.expectSample,score});
  }
  if(hits.length===0){
    // 只命中泛词 → 人工确认
    const amb=m.ambiguousWords.filter(w=>t.includes(norm(w)));
    return {ambiguous:true,reason:'未匹配到明确品牌'+(amb.length?'，仅命中泛词: '+amb.join('/'):'')};
  }
  hits.sort((a,b)=>b.score-a.score);
  if(hits.length>1 && hits[0].score===hits[1].score){
    return {ambiguous:true,reason:'品牌命中并列，需人工确认: '+hits.slice(0,3).map(h=>h.brand).join(' / ')};
  }
  return hits[0];
}
function matchCategory(m,title){
  const t=norm(title);
  for(const c of m.category){if(c.patterns.some(p=>t.includes(norm(p))))return c}
  return null;
}
function pickFile(root,dir,category){
  const d=path.join(root,dir);
  if(!fs.existsSync(d))return {ok:false,error:'报告目录不存在: '+d};
  const files=fs.readdirSync(d).filter(f=>/\.(jpg|jpeg|png)$/i.test(f));
  if(category&&category.files.length){
    for(const want of category.files){const hit=files.find(f=>norm(f)===norm(want));if(hit)return {ok:true,file:path.join(d,hit),all:files}}
  }
  // 卫生巾/安心裤等无标准文件名：列目录让 AI/user 选，不猜
  return {ok:false,error:'无法唯一定位文件，候选: '+files.join(', '),dir:d,all:files};
}
function httpGet(p){return new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:CDP_PORT,path:p},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(new Error(b.slice(0,120)))}})}).on('error',rej)})}
async function titleFromOrder(order){
  const pages=await httpGet('/json/list');
  const p=pages.find(x=>x.type==='page'&&/detail|negativeExperience|aftersales/.test(x.url||''))||pages.find(x=>x.type==='page');
  if(!p)throw new Error('无可用页面，无法从订单读标题');
  // 用 cdp.cjs 读文本（子进程）
  const {execFileSync}=require('child_process');
  const js=`(function(){var t=document.body.innerText;var m=t.match(/[^\\n]{0,80}${order}[^\\n]{0,80}/);return m?m[0]:t.slice(0,600)})()`;
  try{return execFileSync(process.execPath,[path.join(__dirname,'cdp.cjs'),'eval','@active',js],{encoding:'utf8',env:{...process.env,CDP_PORT}}).trim()}
  catch(e){throw new Error('读订单标题失败: '+(e.stderr||e.message).slice(0,150))}
}
(async()=>{
  const argv=process.argv.slice(2);
  const m=loadMap();
  const rootIdx=argv.indexOf('--root');
  const root=findRoot(m,rootIdx>=0?argv[rootIdx+1]:null);
  if(!root){console.log(JSON.stringify({ok:false,error:'未找到报告根目录，用 --root 指定，或检查 report-map.json roots'},null,2));process.exit(1)}
  let titles=[];
  const orderIdx=argv.indexOf('--order');
  const fileIdx=argv.indexOf('--file');
  if(orderIdx>=0){titles.push(await titleFromOrder(argv[orderIdx+1]))}
  else if(fileIdx>=0){titles=fs.readFileSync(argv[fileIdx+1],'utf8').split(/\r?\n/).filter(x=>x.trim())}
  else{titles=[argv.filter(x=>!x.startsWith('--')).join(' ')]}
  const out=[];
  for(const title of titles){
    if(!title.trim())continue;
    const b=matchBrand(m,title);
    const c=matchCategory(m,title);
    const r={title:title.trim(),brand:b.ambiguous?null:b.brand,category:c?c.label:null,root};
    if(b.ambiguous){r.ok=false;r.error=b.reason;out.push(r);continue}
    if(!c){r.ok=false;r.error='未识别品类（拉拉裤/纸尿裤/卫生巾），需人工确认';out.push(r);continue}
    const f=pickFile(root,b.dir,c);
    if(!f.ok){r.ok=false;r.error=f.error;r.dir=b.dir;r.expectSample=b.expectSample;out.push(r);continue}
    r.ok=true;r.report=f.file;r.dir=b.dir;r.expectSample=b.expectSample;
    r.verifyHint=b.expectSample?('开图核对样品名称应含「'+b.expectSample+'」'):'开图核对品牌与商品标题一致';
    out.push(r);
  }
  console.log(JSON.stringify(out.length===1?out[0]:out,null,2));
})().catch(e=>{console.log(JSON.stringify({ok:false,error:e.message},null,2));process.exit(1)});
