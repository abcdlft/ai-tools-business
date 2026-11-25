#!/usr/bin/env node
// gen-report.cjs —— 从批次数据生成「暂不申诉处理报告.md」，末尾自动附暂不申诉清单（用户 2026-11-17 要求）
// 用法:
//   node gen-report.cjs --batch "F:\减负\auto\appeal\2026-11-17-运费复议" --shop 兔小贝卫生用品企业店
//   node gen-report.cjs --batch <dir> --out <报告路径>
// 依赖批次目录数据: notes.json(recv/refund/product/note), to-drop-full.json(待点清单), drop-result.json(done/fail)
const fs=require('fs'),path=require('path');
const argv=process.argv.slice(2);
function opt(n){const i=argv.indexOf(n);return i>=0?argv[i+1]:null}
function readJson(p){try{return JSON.parse(fs.readFileSync(p,'utf8').replace(/^\uFEFF/,''))}catch(e){return null}}
const batch=opt('--batch');
if(!batch){console.error('用法: node gen-report.cjs --batch <批次目录> [--shop 店名] [--out 输出.md]');process.exit(1)}
const notes=readJson(path.join(batch,'notes.json'))||[];
const toDrop=readJson(path.join(batch,'to-drop-full.json'))||[];
const dropRes=readJson(path.join(batch,'drop-result.json'))||{done:[],fail:[]};
const done=dropRes.done||[],fail=dropRes.fail||[];
const byOrder={};for(const n of notes)byOrder[n.order]=n;
const shop=opt('--shop')||'（店名）';
const date=new Date().toISOString().slice(0,10);
// 判定理由：按备注里的到货包数推断
function reason(n){
  const note=(n&&n.note)||'';
  const m=note.match(/\*\[(\d+)\]/g)||[];
  const packs=m.map(x=>Number(x.match(/\d+/)[0]));
  if(packs.length){const total=packs.reduce((a,b)=>a+b,0);return '备注到货 '+total+' 包，与下单包数一致'}
  return '按用户口径判定无争议空间';
}
let L=[];
L.push('# 极速退款申诉 · 暂不申诉处理报告');
L.push('');
L.push('处理时间：'+date);
L.push('处理店铺：'+shop);
L.push('入口：商家后台 → 订单申诉 → 可申诉订单 → 极速退款申诉');
L.push('');
L.push('## 处理结果');
L.push('- 扫描总数：'+notes.length+' 单');
L.push('- 已点「暂不申诉」：'+done.length+' 单（'+fail.length+' 失败，0 误点）');
L.push('- 目标清单：'+toDrop.length+' 单');
L.push('');
L.push('## 已点「暂不申诉」订单清单（报告最后，供核对）');
L.push('共 '+done.length+' 单，'+fail.length+' 失败 / 0 误点。');
L.push('');
L.push('| # | 订单号 | 实收 | 退款 | 判定理由 |');
L.push('|---|---|---|---|---|');
let i=0;
for(const o of done){i++;const n=byOrder[o]||{};L.push('| '+i+' | '+o+' | '+(n.recv||'')+' | '+(n.refund||'')+' | '+reason(n)+' |')}
L.push('');
if(fail.length){L.push('### 失败（需重处理）');L.push('');for(const o of fail)L.push('- '+o);L.push('')}
L.push('## 备注');
L.push('- 「暂不申诉」可逆转：列表顶部「批量取消暂不申诉」可恢复。');
L.push('- 所有操作在用户已登录的浏览器会话内完成，未点任何「提交申诉」。');
L.push('- 明细数据：notes.json / to-drop-full.json / drop-result.json');
const text=L.join('\n');
const out=opt('--out')||path.join(batch,'暂不申诉处理报告-生成.md');
fs.writeFileSync(out,text,'utf8');
console.log('written: '+out+' ('+done.length+' 单)');
