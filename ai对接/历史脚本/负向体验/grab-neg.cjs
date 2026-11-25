#!/usr/bin/env node
// 负向体验3元详情批量抓取（多标签模式，复用 grab3 验证过的骨架）
// 列表tab点"查看详情"→新标签customer_complain_appeal/detail→读描述→关标签→回列表下一单
const http = require('http');
const fs = require('fs');
const HOST='127.0.0.1',PORT=process.env.CDP_PORT||9222;
function httpGet(p){return new Promise((res,rej)=>{http.get({host:HOST,port:PORT,path:p},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(new Error(b.slice(0,200)))}})}).on('error',rej)})}
function httpPut(p){return new Promise((res)=>{const r=http.request({host:HOST,port:PORT,path:p,method:'PUT'},x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>res(b))});r.on('error',()=>res(''));r.end()})}
class Session{
  constructor(url){this.id=0;this.pending=new Map();this.ws=new WebSocket(url);this.ready=new Promise((res,rej)=>{this.ws.onopen=()=>res();this.ws.onerror=()=>rej(new Error('ws fail'))});this.ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data)}catch{return}if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result)}}}
  send(method,params={},timeout=30000){const id=++this.id;return new Promise((res,rej)=>{const t=setTimeout(()=>{this.pending.delete(id);rej(new Error('timeout '+method))},timeout);this.pending.set(id,{resolve:v=>{clearTimeout(t);res(v)},reject:e=>{clearTimeout(t);rej(e)}});this.ws.send(JSON.stringify({id,method,params}))})}
  close(){try{this.ws.close()}catch{}}
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ev(s,e){const r=await s.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text||'').slice(0,180));return r.result.value}
async function rawClick(s,x,y){await s.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',clickCount:0});await sleep(60);await s.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await sleep(60);await s.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
async function activate(s){await s.send('Page.bringToFront').catch(()=>{});await s.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});await s.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{})}

const LIST_URL='https://mms.pinduoduo.com/aftersales/customer_complain_appeal?from=list';
const LABEL='\u67e5\u770b\u8be6\u60c5'; // 查看详情

async function readDetailText(s){
  // 等到数据真正填充：出现"我要申诉"按钮 且 相关订单后有订单号（骨架里只有静态标签）
  for(let k=0;k<70;k++){
    await sleep(300);
    const t=await ev(s,'document.body.innerText').catch(()=>'');
    const loaded=(/\u6211\u8981\u7533\u8bc9|\u5982\u60a8\u5bf9\u5224\u5b9a\u5b58\u5728\u5f02\u8bae/.test(t)) && /\d{6}-\d{10,}/.test(t);
    if(loaded) return t;
  }
  return await ev(s,'document.body.innerText').catch(()=>'');
}
function parseDetail(t){
  // 具体反馈：在"商品问题\n"之后、"其他用户也曾反馈"或"上述问题基于"之前
  const marker='\u5546\u54c1\u95ee\u9898'; // 商品问题
  let feedback='';
  // 找第二次出现的"商品问题"（第一次在补偿原因模板里）
  let i=t.indexOf(marker);
  if(i>=0) i=t.indexOf(marker,i+marker.length);
  let end=t.length;
  for(const stop of ['\u5176\u4ed6\u7528\u6237\u4e5f\u66fe\u53cd\u9988','\u4e0a\u8ff0\u95ee\u9898\u57fa\u4e8e','\u76f8\u5173\u8ba2\u5355']){
    const k=t.indexOf(stop,i>=0?i:0);
    if(k>=0&&k<end)end=k;
  }
  if(i>=0&&end>i) feedback=t.slice(i+marker.length,end).replace(/\s+/g,' ').trim();
  const common=/其他用户也曾反馈过类似问题|\u5176\u4ed6\u7528\u6237\u4e5f\u66fe\u53cd\u9988\u8fc7\u7c7b\u4f3c\u95ee\u9898/.test(t);
  const m=t.match(/ticketSn=(MP\d+)/);
  const ticket=m?m[1]:'';
  return {feedback,common,ticket};
}

(async()=>{
  const argv=process.argv.slice(2);
  const start=Number(argv[0]||0), limit=Number(argv[1]||99);
  const batchDir='F:\\减负\\auto\\appeal\\2026-11-17-负向体验3元';
  const recs=JSON.parse(fs.readFileSync(batchDir+'\\records.json','utf8'));
  // 选一个干净的列表页：优先 from=list 且不是 detail（取第一个）
  let pages=await httpGet('/json/list');
  let listTab=pages.find(x=>x.type==='page'&&/customer_complain_appeal\?from=list$/.test(x.url||''));
  if(!listTab)listTab=pages.find(x=>x.type==='page'&&/customer_complain_appeal/.test(x.url||'')&&!/detail/.test(x.url||''));
  if(!listTab){console.error('NO LIST TAB');process.exit(1)}
  const s=new Session(listTab.webSocketDebuggerUrl);await s.ready;
  await s.send('Page.enable').catch(()=>{});
  // 确保列表渲染好
  let ready=false;
  for(let k=0;k<30;k++){await sleep(300);const has=await ev(s,`(document.body.innerText.indexOf('${LABEL}')>=0)`).catch(()=>false);if(has){ready=true;break}}
  if(!ready){await s.send('Page.navigate',{url:LIST_URL});await sleep(3000)}
  const existingIds=new Set((await httpGet('/json/list')).map(x=>x.id));
  const results=[];
  let done=0;
  for(const r of recs){
    if(done<start){done++;continue}
    if(done>=start+limit)break;
    if(r.status!=='可申诉'){results.push({...r,skippedReason:r.status});done++;continue}
    await activate(s);
    // 关消息浮层
    await ev(s,`(function(){const c=document.querySelector('[class*=ImportantList_close]');if(c){['mousedown','mouseup','click'].forEach(t=>c.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window,button:0})))}return true})()`).catch(()=>{});
    await sleep(200);
    let p=null;
    for(let a=0;a<3;a++){
      p=await ev(s,`(function(){var trs=[].slice.call(document.querySelectorAll('tr'));var tr=trs.filter(function(x){var td=x.querySelector('td');return td&&td.innerText.trim()===${JSON.stringify(r.order)}})[0];if(!tr)return null;var sp=[].slice.call(tr.querySelectorAll('span')).filter(function(e){return e.textContent.trim()===${JSON.stringify(LABEL)}})[0];if(!sp)return null;sp.scrollIntoView({block:'center'});var b=sp.getBoundingClientRect();var x=Math.round(b.x+b.width/2),y=Math.round(b.y+b.height/2);var at=document.elementFromPoint(x,y);return{x:x,y:y,hit:!!(at&&at.textContent.trim()===${JSON.stringify(LABEL)})}})()`).catch(()=>null);
      if(p&&p.hit)break;
      await sleep(300);
    }
    if(!p){console.error('['+(done+1)+'] '+r.order+' 行/按钮未找到');results.push({...r,error:'row not found'});done++;continue}
    await activate(s);
    await rawClick(s,p.x,p.y);
    // 找新开的 detail tab
    let detail=null;
    for(let k=0;k<24;k++){
      await sleep(280);
      const pages=await httpGet('/json/list');
      detail=pages.find(x=>x.type==='page'&&/customer_complain_appeal\/detail/.test(x.url||'')&&!existingIds.has(x.id));
      if(detail)break;
    }
    if(!detail){console.error('['+(done+1)+'] '+r.order+' 未开详情');results.push({...r,error:'detail not opened'});done++;continue}
    existingIds.add(detail.id);
    const ds=new Session(detail.webSocketDebuggerUrl);await ds.ready;
    await ds.send('Page.enable').catch(()=>{});
    await ds.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});
    await ds.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{});
    let txt='';
    try{ txt=await readDetailText(ds); }catch(e){ txt=''; }
    const d=parseDetail(txt);
    results.push({...r,...d,detailText:txt});
    console.error('['+(done+1)+'/'+recs.length+'] '+r.order+' common='+d.common+' fb='+d.feedback.slice(0,46));
    done++;
    await httpPut('/json/close/'+detail.id).catch(()=>{});
    ds.close();
    await sleep(200);
  }
  fs.writeFileSync(batchDir+'\\neg-detail.json',JSON.stringify(results,null,2),'utf8');
  console.error('DONE total='+results.length);
  s.close();
})().catch(e=>{console.error('FATAL '+e.stack);process.exit(1)});
