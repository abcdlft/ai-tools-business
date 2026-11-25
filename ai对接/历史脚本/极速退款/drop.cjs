#!/usr/bin/env node
// 逐单点「暂不申诉」：每轮从第1页扫到末页，点掉第一个待办，再重扫，直到无待办
const http=require('http'),fs=require('fs');
const HOST='127.0.0.1',PORT=9222;
function httpGet(p){return new Promise((res,rej)=>{http.get({host:HOST,port:PORT,path:p},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(new Error(b.slice(0,100)))}})}).on('error',rej)})}
function httpPut(p){return new Promise((res)=>{const r=http.request({host:HOST,port:PORT,path:p,method:'PUT'},x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>res(b))});r.on('error',()=>res(''));r.end()})}
class S{constructor(u){this.i=0;this.p=new Map();this.ws=new WebSocket(u);this.ready=new Promise((a,b)=>{this.ws.onopen=a;this.ws.onerror=()=>b(new Error('ws'))});this.ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result)}}}send(method,params={},t=30000){const id=++this.i;return new Promise((a,b)=>{const tm=setTimeout(()=>{this.p.delete(id);b(new Error('timeout'))},t);this.p.set(id,{resolve:v=>{clearTimeout(tm);a(v)},reject:e=>{clearTimeout(tm);b(e)}});this.ws.send(JSON.stringify({id,method,params}))})}close(){try{this.ws.close()}catch{}}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ev(s,e){const r=await s.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text||'').slice(0,120));return r.result?.value}
async function click(s,x,y){await s.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',clickCount:0});await sleep(50);await s.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await sleep(50);await s.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
const LIST='https://mms.pinduoduo.com/orders/appeals/aftersale/order?from=list';
const TAB='\u6781\u901f\u9000\u6b3e\u7533\u8bc9',TUO='\u6682\u4e0d\u7533\u8bc9';
const ACTIVE=`(()=>{const li=[...document.querySelectorAll('li')].find(x=>/pageritemacti/i.test(x.className||''));return li?li.textContent.trim():null})()`;
const ROWS=`(()=>{const o=[];document.querySelectorAll('tr').forEach(tr=>{const td=[...tr.querySelectorAll('td')].map(x=>x.innerText.replace(/\\s+/g,' ').trim());if(td.length>=8&&/^\\d{6}-\\d+/.test(td[1]))o.push(td[1])});return o})()`;
async function waitRows(s){let last=[];for(let k=0;k<24;k++){await sleep(280);const n=await ev(s,ROWS).catch(()=>[]);if(n&&n.length){if(n.length===last.length)return n;last=n}}return last}
async function activate(s){await s.send('Page.bringToFront').catch(()=>{});await s.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});await s.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{});await sleep(110)}
async function clickTab(s){await activate(s);for(let a=0;a<4;a++){const p=await ev(s,`(function(){const e=[...document.querySelectorAll('span')].find(x=>x.children.length===0&&(x.textContent||'').indexOf(${JSON.stringify(TAB)})===0);if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);if(!p)return false;await click(s,p.x,p.y);await sleep(850);if(/activeIndex=2/.test(await ev(s,'location.href').catch(()=>'')))return true}return false}
async function gotoPage(s,n){await activate(s);for(let a=0;a<3;a++){const p=await ev(s,`(function(){const li=[...document.querySelectorAll('li')].find(x=>(x.textContent||'').trim()==='${n}');if(!li)return null;li.scrollIntoView({block:'center'});const b=li.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);if(!p)return false;await click(s,p.x,p.y);for(let k=0;k<12;k++){await sleep(230);if((await ev(s,ACTIVE).catch(()=>null))===String(n))return true}}return false}
// 扫所有页，返回第一个待办订单及其所在页
async function findTarget(s,pending){
  for(const pg of [1,2,3,4,5]){
    if(!(await gotoPage(s,String(pg))))break;
    const rows=await waitRows(s);
    const hit=rows.find(o=>pending.has(o));
    if(hit)return {order:hit,page:pg};
    const total=Number((await ev(s,`(document.body.innerText.match(/共有\\s*(\\d+)\\s*条/)||[])[1]`))||50);
    if(pg*10>=total)break;
  }
  return null;
}
(async()=>{
  const toDrop=JSON.parse(fs.readFileSync('F:\\减负\\auto\\appeal\\2026-11-17-运费复议\\to-drop.json','utf8'));
  const pending=new Set(toDrop);const done=[],fail=[];
  let pages=await httpGet('/json/list');
  let lt=pages.find(p=>p.type==='page'&&/activeIndex=2/.test(p.url||''));
  if(!lt){
    for(const p of pages.filter(p=>p.type==='page'&&/aftersales-ssr\/detail/.test(p.url||'')))await httpPut('/json/close/'+p.id);
    await httpPut('/json/new?'+encodeURIComponent(LIST));await sleep(2800);
    pages=await httpGet('/json/list');lt=pages.find(p=>p.type==='page'&&/orders\/appeals\/aftersale\/order/.test(p.url||''));
  }
  if(!lt)throw new Error('无列表页');
  const s=new S(lt.webSocketDebuggerUrl);await s.ready;await s.send('Page.enable').catch(()=>{});await activate(s);
  if(!/activeIndex=2/.test(await ev(s,'location.href')))await clickTab(s);
  await waitRows(s);
  console.error('START total='+(await ev(s,`(document.body.innerText.match(/共有\\s*(\\d+)\\s*条/)||[])[1]`))+' pending='+pending.size);
  let guard=0;
  while(pending.size>0 && guard<80){
    guard++;
    const found=await findTarget(s,pending);
    if(!found){console.error('NOT FOUND any pending, remain='+pending.size);break}
    // 关浮层
    await ev(s,`(function(){const c=document.querySelector('[class*=ImportantList_close]');if(c){['mousedown','mouseup','click'].forEach(t=>c.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window,button:0})))}return true})()`).catch(()=>{});
    await sleep(200);
    let p=null;
    for(let a=0;a<3;a++){
      p=await ev(s,`(function(){const tr=[...document.querySelectorAll('tr')].find(x=>{const a=[...x.querySelectorAll('td')].map(t=>t.innerText.trim());return a[1]===${JSON.stringify(found.order)}});if(!tr)return null;const sp=[...tr.querySelectorAll('span')].find(e=>(e.textContent||'').trim()===${JSON.stringify(TUO)});if(!sp)return null;sp.scrollIntoView({block:'center'});const b=sp.getBoundingClientRect();const x=Math.round(b.x+b.width/2),y=Math.round(b.y+b.height/2);const at=document.elementFromPoint(x,y);return{x,y,hit:!!(at&&(at.textContent||'').trim()===${JSON.stringify(TUO)})}})()`);
      if(p&&p.hit)break;await sleep(250);
    }
    if(!p||!p.hit){console.error('LOCATE FAIL '+found.order);fail.push(found.order);pending.delete(found.order);continue}
    await activate(s);await click(s,p.x,p.y);await sleep(1600);
    let nowRows=await ev(s,ROWS).catch(()=>[]);
    if(nowRows.includes(found.order)){await sleep(1200);nowRows=await ev(s,ROWS).catch(()=>[])}
    if(nowRows.includes(found.order)){console.error('CLICK FAIL '+found.order);fail.push(found.order)}
    else{done.push(found.order);console.error(`[DONE ${done.length}/${toDrop.length}] ${found.order} 剩${pending.size}`)}
    pending.delete(found.order);
  }
  const out='F:\\减负\\auto\\appeal\\2026-11-17-运费复议\\drop-result.json';
  fs.writeFileSync(out,JSON.stringify({done,fail,remaining:[...pending]},null,2),'utf8');
  console.log('RESULT done='+done.length+' fail='+fail.length+' remaining='+pending.size);
  s.close();
})().catch(e=>{console.error('FATAL='+e.message);process.exit(1)});
