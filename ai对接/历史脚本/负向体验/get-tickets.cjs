#!/usr/bin/env node
// 从列表点"查看详情"抓指定订单的 ticketSn（新标签 URL 里）
const http=require('http'),fs=require('fs');
const HOST='127.0.0.1',PORT=process.env.CDP_PORT||9222;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function httpGet(p){return new Promise((res,rej)=>{http.get({host:HOST,port:PORT,path:p},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch{res(b)}})}).on('error',rej)})}
function httpPut(p){return new Promise(r=>{const q=http.request({host:HOST,port:PORT,path:p,method:'PUT'},x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>r(b))});q.on('error',()=>r(''));q.end()})}
class S{constructor(u){this.id=0;this.pending=new Map();this.ws=new WebSocket(u);this.ready=new Promise((a,b)=>{this.ws.onopen=a;this.ws.onerror=()=>b(new Error('ws fail'))});this.ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data)}catch{return}if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}}
send(method,params={},t=30000){const id=++this.id;return new Promise((res,rej)=>{const tm=setTimeout(()=>{this.pending.delete(id);rej(new Error('to '+method))},t);this.pending.set(id,{resolve:v=>{clearTimeout(tm);res(v)},reject:e=>{clearTimeout(tm);rej(e)}});this.ws.send(JSON.stringify({id,method,params}))})}
async ev(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text).slice(0,150));return r.result&&r.result.value}
async activate(){await this.send('Page.bringToFront').catch(()=>{});await this.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});await this.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{})}
close(){try{this.ws.close()}catch{}}}
async function click(s,x,y){await s.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',clickCount:0});await sleep(50);await s.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await sleep(50);await s.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
const LIST='https://mms.pinduoduo.com/aftersales/customer_complain_appeal?from=list';
(async()=>{
  const batch='F:\\减负\\auto\\appeal\\2026-11-17-负向体验3元';
  const picks=JSON.parse(fs.readFileSync(batch+'\\to-appeal.json','utf8'));
  const map=JSON.parse(fs.readFileSync(batch+'\\ticket-map.json','utf8').toString()===''?'{}':fs.readFileSync(batch+'\\ticket-map.json','utf8'));
  let pages=await httpGet('/json/list');
  // 用干净的列表页
  let tab=pages.find(x=>x.type==='page'&&/customer_complain_appeal\?from=list/.test(x.url||''));
  if(!tab){console.error('NO LIST');process.exit(1)}
  console.error('LIST TAB='+tab.url);
  const s=new S(tab.webSocketDebuggerUrl);await s.ready;await s.send('Page.enable').catch(()=>{});
  // 确保列表渲染
  await s.activate();
  for(let k=0;k<30;k++){await sleep(300);if(await s.ev("document.body.innerText.indexOf('"+'\\u67e5\\u770b\\u8be6\\u60c5'+"')>=0").catch(()=>false))break}
  const dbg=await s.ev(`(function(){var trs=[].slice.call(document.querySelectorAll('tr'));return JSON.stringify(trs.map(function(x){var td=x.querySelector('td');return td?td.innerText.trim():''}).filter(function(s){return /^\\d{6}-\\d+/.test(s)}))})()`).catch(()=>'ERR');
  console.error('ROWS IN SESSION='+dbg);
  for(const p of picks){
    if(map[p.order]){console.error(p.order+' already '+map[p.order]);continue}
    await s.activate();
    const LBL=String.fromCharCode(26597,30475,35814,24773); // 查看详情
    const pos=await s.ev(`(function(){var trs=[].slice.call(document.querySelectorAll('tr'));var tr=trs.filter(function(x){var td=x.querySelector('td');return td&&td.innerText.trim().indexOf(${JSON.stringify(p.order)})>=0})[0];if(!tr)return null;var sp=[].slice.call(tr.querySelectorAll('span')).filter(function(e){return e.textContent.trim()===${JSON.stringify(LBL)}})[0];if(!sp)return null;sp.scrollIntoView({block:'center'});var b=sp.getBoundingClientRect();var x=Math.round(b.x+b.width/2),y=Math.round(b.y+b.height/2);var at=document.elementFromPoint(x,y);return{x:x,y:y,hit:at?at.textContent.trim().indexOf(${JSON.stringify(LBL)})>=0:false}})()`).catch(e=>{console.error('EVAL ERR '+e.message);return null});
    if(!pos){console.error(p.order+' no row');continue}
    if(!pos.hit){
      // 关消息浮层后重取坐标
      await s.ev(`(function(){var c=document.querySelector('[class*=ImportantList_close]');if(c){['mousedown','mouseup','click'].forEach(function(t){c.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window,button:0})))}return true})()`).catch(()=>{});
      await sleep(300);
      pos=await s.ev(`(function(){var trs=[].slice.call(document.querySelectorAll('tr'));var tr=trs.filter(function(x){var td=x.querySelector('td');return td&&td.innerText.trim()===${JSON.stringify(p.order)}})[0];if(!tr)return null;var sp=[].slice.call(tr.querySelectorAll('span')).filter(function(e){return e.textContent.trim()==='\\u67e5\\u770b\\u8be6\\u60c5'})[0];if(!sp)return null;sp.scrollIntoView({block:'center'});var b=sp.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2),hit:true}})()`).catch(()=>null);
      await s.activate();
    }
    const before=new Set((await httpGet('/json/list')).map(x=>x.id));
    await click(s,pos.x,pos.y);
    let detail=null;
    for(let k=0;k<24;k++){await sleep(250);const ps=await httpGet('/json/list');detail=ps.find(x=>x.type==='page'&&/customer_complain_appeal\/detail/.test(x.url||'')&&!before.has(x.id));if(detail)break}
    if(!detail){console.error(p.order+' no detail tab');continue}
    const m=(detail.url||'').match(/ticketSn=(MP\d+)/);
    map[p.order]=m?m[1]:'';
    console.error(p.order+' → '+map[p.order]);
    await httpPut('/json/close/'+detail.id);
    await sleep(200);
  }
  fs.writeFileSync(batch+'\\ticket-map.json',JSON.stringify(map,null,2),'utf8');
  console.error('DONE');
  s.close();
})().catch(e=>{console.error('FATAL '+e.stack);process.exit(1)});
