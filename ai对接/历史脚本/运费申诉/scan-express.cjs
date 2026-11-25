#!/usr/bin/env node
// 稳健扫描「可申诉订单 → 极速退款申诉」全部页
const http = require('http');
const fs = require('fs');
const HOST = '127.0.0.1', PORT = 9222;
function httpGet(p){return new Promise((res,rej)=>{http.get({host:HOST,port:PORT,path:p},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(new Error(b.slice(0,200)))}})}).on('error',rej)})}
class Session{
  constructor(url){this.id=0;this.pending=new Map();this.ws=new WebSocket(url);this.ready=new Promise((res,rej)=>{this.ws.onopen=()=>res();this.ws.onerror=()=>rej(new Error('ws fail'))});this.ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data)}catch{return}if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result)}}}
  send(method,params={},timeout=30000){const id=++this.id;return new Promise((res,rej)=>{const t=setTimeout(()=>{this.pending.delete(id);rej(new Error('timeout '+method))},timeout);this.pending.set(id,{resolve:v=>{clearTimeout(t);res(v)},reject:e=>{clearTimeout(t);rej(e)}});this.ws.send(JSON.stringify({id,method,params}))})}
  close(){try{this.ws.close()}catch{}}
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ev(s,expr){const r=await s.send('Runtime.evaluate',{expression:expr,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
const CLICK_TEXT=`(txt)=>{const els=[...document.querySelectorAll('span,li,a,div')].filter(e=>e.children.length===0&&(e.textContent||'').trim()===txt);if(!els.length)return false;const e=els[0];e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();['mouseover','mousedown','mouseup','click'].forEach(tp=>e.dispatchEvent(new MouseEvent(tp,{bubbles:true,cancelable:true,view:window,button:0})));return true}`;
const READ_ROWS=`(()=>{const rows=[];document.querySelectorAll('tr').forEach(tr=>{const td=[...tr.querySelectorAll('td')].map(x=>x.innerText.replace(/\\s+/g,' ').trim());if(td.length>=8&&/^\\d{6}-\\d+/.test(td[1]))rows.push({order:td[1],product:td[2],ship:td[3],recv:td[4],refund:td[5],rtime:td[6],cd:td[7],ops:td[8]});});return rows})()`;
const ACTIVE_PAGE=`(()=>{const li=[...document.querySelectorAll('li')].find(x=>/pageritemacti/i.test(x.className||''));return li?(li.textContent||'').trim():null})()`;
const TOTAL=`(()=>{const m=document.body.innerText.match(/共有\\s*(\\d+)\\s*条/);return m?Number(m[1]):null})()`;
async function realClickSel(s,sel){
  const r=await ev(s,`(function(){const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;e.scrollIntoView({block:'center'});return true})()`);
  if(!r)return false;await sleep(250);
  const pos=await ev(s,`(function(){const e=document.querySelector(${JSON.stringify(sel)});const b=e.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
  for(const type of ['mouseMoved','mousePressed','mouseReleased'])await s.send('Input.dispatchMouseEvent',{type,x:pos.x,y:pos.y,button:type==='mouseMoved'?'none':'left',clickCount:type==='mouseMoved'?0:1});
  return true;
}
async function gotoPage(s,n){
  // 真实坐标点击（第一版实测可靠翻完5页）；失败再退回事件派发
  for(let attempt=0;attempt<2;attempt++){
    const pos=await ev(s,`(function(){const li=[...document.querySelectorAll('li')].find(x=>(x.textContent||'').trim()==='${n}');if(!li)return null;li.scrollIntoView({block:'center'});const b=li.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
    if(!pos)break;await sleep(220);
    for(const type of ['mouseMoved','mousePressed','mouseReleased'])await s.send('Input.dispatchMouseEvent',{type,x:pos.x,y:pos.y,button:type==='mouseMoved'?'none':'left',clickCount:type==='mouseMoved'?0:1});
    for(let k=0;k<16;k++){await sleep(280);const a=await ev(s,ACTIVE_PAGE);if(a===String(n))return true}
    await ev(s,`(${CLICK_TEXT})('${n}')`);
    for(let k=0;k<12;k++){await sleep(280);const a=await ev(s,ACTIVE_PAGE);if(a===String(n))return true}
  }
  return false;
}
(async()=>{
  const pages=await httpGet('/json/list');
  const page=pages.find(p=>p.type==='page'&&/orders\/appeals/.test(p.url));
  if(!page)throw new Error('未找到订单申诉页');
  const s=new Session(page.webSocketDebuggerUrl);await s.ready;
  await s.send('Page.enable').catch(()=>{});
  await s.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});
  await s.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{});
  await sleep(200);
  // 从头导航
  await s.send('Page.navigate',{url:'https://mms.pinduoduo.com/orders/appeals/aftersale/order?from=list'});
  for(let k=0;k<24;k++){await sleep(400);if(await ev(s,ACTIVE_PAGE))break}
  // 点极速退款申诉页签
  await ev(s,`(${CLICK_TEXT})('极速退款申诉(50)')`);
  await sleep(600);
  if(!(await ev(s,ACTIVE_PAGE))){await ev(s,`(${CLICK_TEXT})('极速退款申诉(49)')`);await sleep(600)}
  let tabTxt=await ev(s,`(function(){const e=[...document.querySelectorAll('span,div,li')].find(x=>x.children.length===0&&/极速退款申诉\\(/.test(x.textContent||''));return e?e.textContent.trim():null})()`);
  console.error('TAB='+tabTxt+' ACTIVE='+(await ev(s,ACTIVE_PAGE)));
  const total=await ev(s,TOTAL);console.error('TOTAL_LIST='+total);
  const all=[];const seen=new Set();
  const pagesN=Math.ceil((total||50)/10);
  for(let pg=1;pg<=pagesN;pg++){
    if(pg>1){const ok=await gotoPage(s,pg);console.error('goto '+pg+'='+ok);if(!ok)break}
    let rows=[];
    for(let k=0;k<14;k++){rows=await ev(s,READ_ROWS);if(rows.length>=Math.min(10,(total||50)-(pg-1)*10))break;await sleep(400)}
    const fresh=rows.filter(r=>!seen.has(r.order));fresh.forEach(r=>seen.add(r.order));
    all.push(...fresh.map(r=>({...r,page:pg})));
    console.error(`page ${pg}: ${rows.length} rows, ${fresh.length} new, seen ${seen.size}`);
  }
  fs.writeFileSync('F:\\减负\\auto\\appeal\\2026-11-17-运费复议\\express-scan.json',JSON.stringify({total,tab:tabTxt,orders:all},null,2),'utf8');
  console.log('TOTAL='+all.length);
  s.close();
})().catch(e=>{console.error('ERR='+e.message);process.exit(1)});
