#!/usr/bin/env node
// 抓每单详情页的「备注详情」到货包数 + 实收 + 退款
const http=require('http'),fs=require('fs');
const HOST='127.0.0.1',PORT=9222;
function httpGet(p){return new Promise((res,rej)=>{http.get({host:HOST,port:PORT,path:p},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(new Error(b.slice(0,100)))}})}).on('error',rej)})}
function httpPut(p){return new Promise((res)=>{const r=http.request({host:HOST,port:PORT,path:p,method:'PUT'},x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>res(b))});r.on('error',()=>res(''));r.end()})}
class S{constructor(u){this.i=0;this.p=new Map();this.ws=new WebSocket(u);this.ready=new Promise((a,b)=>{this.ws.onopen=a;this.ws.onerror=()=>b(new Error('ws'))});this.ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result)}}}send(method,params={},t=30000){const id=++this.i;return new Promise((a,b)=>{const tm=setTimeout(()=>{this.p.delete(id);b(new Error('timeout'))},t);this.p.set(id,{resolve:v=>{clearTimeout(tm);a(v)},reject:e=>{clearTimeout(tm);b(e)}});this.ws.send(JSON.stringify({id,method,params}))})}close(){try{this.ws.close()}catch{}}}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ev(s,e){const r=await s.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error((r.exceptionDetails.exception?.description||r.exceptionDetails.text||'').slice(0,120));return r.result?.value}
async function click(s,x,y){await s.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',clickCount:0});await sleep(50);await s.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await sleep(50);await s.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1})}
const LIST='https://mms.pinduoduo.com/orders/appeals/aftersale/order?from=list';
const TAB='\u6781\u901f\u9000\u6b3e\u7533\u8bc9',DETAIL='\u552e\u540e\u8be6\u60c5',CODE='\u552e\u540e\u7f16\u7801';
const ACTIVE=`(()=>{const li=[...document.querySelectorAll('li')].find(x=>/pageritemacti/i.test(x.className||''));return li?li.textContent.trim():null})()`;
const ROWS=`(()=>{const o=[];document.querySelectorAll('tr').forEach(tr=>{const td=[...tr.querySelectorAll('td')].map(x=>x.innerText.replace(/\\s+/g,' ').trim());if(td.length>=8&&/^\\d{6}-\\d+/.test(td[1]))o.push({order:td[1],recv:td[4],refund:td[5],product:td[2]})});return o})()`;
async function waitRows(s){let last=[];for(let k=0;k<40;k++){await sleep(300);const n=await ev(s,ROWS).catch(()=>[]);if(n&&n.length){if(n.length===last.length)return n;last=n}}return last}
async function activate(s){await s.send('Page.bringToFront').catch(()=>{});await s.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});await s.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{});await sleep(120)}
async function clickTab(s){await activate(s);for(let a=0;a<4;a++){const p=await ev(s,`(function(){const e=[...document.querySelectorAll('span')].find(x=>x.children.length===0&&(x.textContent||'').indexOf(${JSON.stringify(TAB)})===0);if(!e)return null;e.scrollIntoView({block:'center'});const b=e.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);if(!p)return false;await click(s,p.x,p.y);await sleep(900);if(/activeIndex=2/.test(await ev(s,'location.href').catch(()=>'')))return true}return false}
async function gotoPage(s,n){await activate(s);for(let a=0;a<3;a++){const p=await ev(s,`(function(){const li=[...document.querySelectorAll('li')].find(x=>(x.textContent||'').trim()==='${n}');if(!li)return null;li.scrollIntoView({block:'center'});const b=li.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);if(!p)break;await click(s,p.x,p.y);for(let k=0;k<14;k++){await sleep(250);if((await ev(s,ACTIVE))===String(n))return true}}return false}
async function openDetail(s,order,ids){
  await ev(s,`(function(){const c=document.querySelector('[class*=ImportantList_close]');if(c){['mousedown','mouseup','click'].forEach(t=>c.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,view:window,button:0})))}return true})()`);
  await sleep(200);
  let p=null;
  for(let a=0;a<3;a++){p=await ev(s,`(function(){const tr=[...document.querySelectorAll('tr')].find(x=>{const a=[...x.querySelectorAll('td')].map(t=>t.innerText.trim());return a[1]===${JSON.stringify(order)}});if(!tr)return null;const sp=[...tr.querySelectorAll('span')].find(e=>(e.textContent||'').trim()===${JSON.stringify(DETAIL)});if(!sp)return null;sp.scrollIntoView({block:'center'});const b=sp.getBoundingClientRect();const x=Math.round(b.x+b.width/2),y=Math.round(b.y+b.height/2);const at=document.elementFromPoint(x,y);return{x,y,hit:!!(at&&(at.textContent||'').trim()===${JSON.stringify(DETAIL)})}})()`);if(!p)throw new Error('行未找到');if(p.hit)break;await sleep(200)}
  await activate(s);await click(s,p.x,p.y);
  let d=null;for(let k=0;k<22;k++){await sleep(280);const pg=await httpGet('/json/list');d=pg.find(x=>x.type==='page'&&/aftersales-ssr\/detail/.test(x.url||'')&&!ids.has(x.id));if(d)break}
  if(!d)throw new Error('未打开详情 hit='+p.hit);
  ids.add(d.id);const ds=new S(d.webSocketDebuggerUrl);await ds.ready;await ds.send('Page.enable').catch(()=>{});await ds.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});await ds.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{});
  return {ds,id:d.id};
}
(async()=>{
  const start=Number(process.argv[2]||0),limit=Number(process.argv[3]||999);
  let pages=await httpGet('/json/list');
  let lt=pages.find(p=>p.type==='page'&&/activeIndex=2/.test(p.url||''));
  if(!lt){await httpPut('/json/new?'+encodeURIComponent(LIST));await sleep(2600);pages=await httpGet('/json/list');lt=pages.find(p=>p.type==='page'&&/orders\/appeals/.test(p.url||''))}
  if(!lt)throw new Error('无列表页');
  const ids=new Set((await httpGet('/json/list')).map(p=>p.id));
  const s=new S(lt.webSocketDebuggerUrl);await s.ready;await s.send('Page.enable').catch(()=>{});await activate(s);
  if(!/activeIndex=2/.test(await ev(s,'location.href')))await clickTab(s);
  let rows=await waitRows(s);if(!rows.length){await clickTab(s);rows=await waitRows(s)}
  const results=[];let done=0;
  for(const pg of [1,2,3,4,5]){
    if(pg>1){if(!(await gotoPage(s,pg)))continue;rows=await waitRows(s)}
    console.error('page '+pg+': '+rows.length);
    for(const r of rows){
      if(done<start){done++;continue}if(done>=start+limit)break;
      const order=r.order;let d=null;
      try{
        d=await openDetail(s,order,ids);
        let txt='';for(let k=0;k<24;k++){await sleep(280);txt=await ev(d.ds,'document.body.innerText').catch(()=>'');if(txt.indexOf(CODE)>=0&&txt.indexOf(order)>=0)break}
        const noteM=txt.match(/备注详情([^\n]*)/);
        const recvM=txt.match(/实收：\s*¥?\s*([\d.]+)/);
        const refM=txt.match(/退款金额：\s*\n\s*¥?\s*([\d.]+)/);
        const specLines=txt.split('\n').filter(x=>/到手|片|包/.test(x)).slice(0,4);
        results.push({...r,note:noteM?noteM[1].trim():'',recvD:recvM?recvM[1]:'',refundD:refM?refM[1]:'',spec:specLines,stype:(txt.match(/售后类型：\s*\n\s*([^\n]*)/)||[])[1]||'',ship:(txt.match(/发货状态：\s*\n\s*([^\n]*)/)||[])[1]||''});
        console.error(`[${done+1}] ${order} recv=${r.recv} ref=${r.refund} note=${(noteM?noteM[1]:'').trim().slice(0,60)}`);
        done++;
      }catch(e){console.error('ERR '+order+': '+e.message);results.push({...r,error:e.message});done++}
      finally{if(d){await httpPut('/json/close/'+d.id).catch(()=>{});d.ds.close()}}
      await activate(s);if(!/activeIndex=2/.test(await ev(s,'location.href').catch(()=>'')))await clickTab(s);
    }
    if(done>=start+limit)break;
  }
  fs.writeFileSync('F:\\减负\\auto\\appeal\\2026-11-17-运费复议\\notes.json',JSON.stringify(results,null,2),'utf8');
  console.log('N='+results.length);s.close();
})().catch(e=>{console.error('FATAL='+e.message);process.exit(1)});
