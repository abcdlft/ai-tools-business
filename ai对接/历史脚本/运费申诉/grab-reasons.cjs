#!/usr/bin/env node
// 逐单打开"售后详情"，抓取售后类型/申请原因/说明/退款金额/聊天
const http = require('http');
const fs = require('fs');
const HOST='127.0.0.1',PORT=9222;
function httpGet(p){return new Promise((res,rej)=>{http.get({host:HOST,port:PORT,path:p},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(new Error(b.slice(0,200)))}})}).on('error',rej)})}
function httpPut(p){return new Promise((res)=>{const r=http.request({host:HOST,port:PORT,path:p,method:'PUT'},x=>{let b='';x.on('data',d=>b+=d);x.on('end',()=>res(b))});r.on('error',()=>res(''));r.end()})}
class Session{
  constructor(url){this.id=0;this.pending=new Map();this.ws=new WebSocket(url);this.ready=new Promise((res,rej)=>{this.ws.onopen=()=>res();this.ws.onerror=()=>rej(new Error('ws fail'))});this.ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data)}catch{return}if(m.id&&this.pending.has(m.id)){const{resolve,reject}=this.pending.get(m.id);this.pending.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result)}}}
  send(method,params={},timeout=30000){const id=++this.id;return new Promise((res,rej)=>{const t=setTimeout(()=>{this.pending.delete(id);rej(new Error('timeout '+method))},timeout);this.pending.set(id,{resolve:v=>{clearTimeout(t);res(v)},reject:e=>{clearTimeout(t);rej(e)}});this.ws.send(JSON.stringify({id,method,params}))})}
  close(){try{this.ws.close()}catch{}}
}
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function ev(s,e){const r=await s.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value}
async function rawClick(s,x,y){for(const type of ['mouseMoved','mousePressed','mouseReleased'])await s.send('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'?'none':'left',clickCount:type==='mouseMoved'?0:1})}
const ACTIVE_PAGE=`(()=>{const li=[...document.querySelectorAll('li')].find(x=>/pageritemacti/i.test(x.className||''));return li?(li.textContent||'').trim():null})()`;
const READ_ORDERS=`(()=>{const out=[];document.querySelectorAll('tr').forEach(tr=>{const td=[...tr.querySelectorAll('td')].map(x=>x.innerText.replace(/\\s+/g,' ').trim());if(td.length>=8&&/^\\d{6}-\\d+/.test(td[1]))out.push(td[1]);});return out})()`;
async function gotoPage(s,n){
  for(let a=0;a<2;a++){
    const pos=await ev(s,`(function(){const li=[...document.querySelectorAll('li')].find(x=>(x.textContent||'').trim()==='${n}');if(!li)return null;li.scrollIntoView({block:'center'});const b=li.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
    if(!pos)break;await sleep(200);await rawClick(s,pos.x,pos.y);
    for(let k=0;k<14;k++){await sleep(260);if((await ev(s,ACTIVE_PAGE))===String(n))return true}
  }
  return false;
}
// 在当前列表页，点某订单行的"售后详情"，返回新开的 detail 页 Session
async function openDetail(listS,order,existingIds){
  // 定位该行的"售后详情" span 坐标
  const pos=await ev(listS,`(function(){const trs=[...document.querySelectorAll('tr')];const tr=trs.find(x=>{const a=[...x.querySelectorAll('td')].map(t=>t.innerText.trim());return a[1]==='${order}'});if(!tr)return null;const sp=[...tr.querySelectorAll('span')].find(e=>(e.textContent||'').trim()==='售后详情');if(!sp)return null;sp.scrollIntoView({block:'center'});const b=sp.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
  if(!pos)throw new Error('行未找到 '+order);
  await sleep(250);
  // 重新取坐标（scrollIntoView 后）
  const pos2=await ev(listS,`(function(){const trs=[...document.querySelectorAll('tr')];const tr=trs.find(x=>{const a=[...x.querySelectorAll('td')].map(t=>t.innerText.trim());return a[1]==='${order}'});const sp=[...tr.querySelectorAll('span')].find(e=>(e.textContent||'').trim()==='售后详情');if(!sp)return null;sp.scrollIntoView({block:'center'});const b=sp.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
  if(!pos2)throw new Error('坐标未找到 '+order);
  // 关掉「消息盒子」浮层，它盖住操作列（skill 已知坑）
  const top=await ev(listS,`(function(){const b=${JSON.stringify(pos2)};const at=document.elementFromPoint(b.x,b.y);return at?(at.id||at.className||'').toString():''})()`);
  if(/ImportantList|msgbox|msgBox/i.test(top)){
    await ev(listS,`(function(){const c=document.querySelector('[class*=ImportantList_close]');if(c){['mousedown','mouseup','click'].forEach(tp=>c.dispatchEvent(new MouseEvent(tp,{bubbles:true,cancelable:true,view:window,button:0})))}return !!c})()`);
    await sleep(300);
  }
  // 关闭详情标签后列表页失焦，点击前重新激活
  await listS.send('Page.bringToFront').catch(()=>{});
  await listS.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});
  await listS.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{});
  await sleep(150);
  // 关浮层后重取坐标
  const pos3=await ev(listS,`(function(){const trs=[...document.querySelectorAll('tr')];const tr=trs.find(x=>{const a=[...x.querySelectorAll('td')].map(t=>t.innerText.trim());return a[1]==='${order}'});if(!tr)return null;const sp=[...tr.querySelectorAll('span')].find(e=>(e.textContent||'').trim()==='售后详情');if(!sp)return null;sp.scrollIntoView({block:'center'});const b=sp.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
  await rawClick(listS,pos3.x,pos3.y);
  // 轮询新 detail tab
  let detail=null;
  for(let k=0;k<24;k++){
    await sleep(300);
    const pages=await httpGet('/json/list');
    detail=pages.find(p=>p.type==='page'&&/aftersales-ssr\/detail/.test(p.url||'')&&!existingIds.has(p.id));
    if(detail)break;
  }
  if(!detail)throw new Error('未打开详情 '+order);
  existingIds.add(detail.id);
  const s=new Session(detail.webSocketDebuggerUrl);await s.ready;
  await s.send('Page.enable').catch(()=>{});
  await s.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});
  await s.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{});
  return {s,id:detail.id,url:detail.url};
}
(async()=>{
  const start=Number(process.argv[2]||0),limit=Number(process.argv[3]||999);
  const scan=JSON.parse(fs.readFileSync('F:\\减负\\auto\\appeal\\2026-11-17-运费复议\\express-scan.json','utf8'));
  const orders=scan.orders;
  const pages=await httpGet('/json/list');
  // 关掉残留 detail
  for(const p of pages.filter(p=>p.type==='page'&&/aftersales-ssr\/detail/.test(p.url||'')))await httpPut('/json/close/'+p.id);
  await sleep(400);
  const allPages=await httpGet('/json/list');
  let listTab=allPages.find(p=>p.type==='page'&&/activeIndex=2/.test(p.url||''));
  if(!listTab)listTab=allPages.find(p=>p.type==='page'&&/orders\/appeals\/aftersale\/order\?from=list/.test(p.url||''));
  if(!listTab)throw new Error('未找到列表页');
  const existingIds=new Set(allPages.map(p=>p.id));
  const listS=new Session(listTab.webSocketDebuggerUrl);await listS.ready;
  await listS.send('Page.enable').catch(()=>{});
  await listS.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});
  await listS.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{});
  await sleep(200);
  // 定位到极速退款页签
  const CLICK_TEXT=`(txt)=>{const els=[...document.querySelectorAll('span,li,a,div')].filter(e=>e.children.length===0&&(e.textContent||'').trim()===txt);if(!els.length)return false;const e=els[0];e.scrollIntoView({block:'center'});['mouseover','mousedown','mouseup','click'].forEach(tp=>e.dispatchEvent(new MouseEvent(tp,{bubbles:true,cancelable:true,view:window,button:0})));return true}`;
  await ev(listS,`(${CLICK_TEXT})([...document.querySelectorAll('span')].map(x=>x.textContent.trim()).find(t=>/^极速退款申诉\\(/.test(t)))`);
  await sleep(600);
  const results=[];
  const seen=new Set();
  const scanMap={};orders.forEach(o=>scanMap[o.order]=o);
  let done=0;
  for(const pg of [1,2,3,4,5]){
    if(pg>1){const ok=await gotoPage(listS,pg);console.error('goto '+pg+'='+ok);if(!ok)continue}
    // 实时读当前页订单号（点掉一单后列表顺序会变，不能用 scan 的 page 分组）
    let pageOrders=[];
    for(let k=0;k<12;k++){pageOrders=await ev(listS,READ_ORDERS);if(pageOrders.length)break;await sleep(400)}
    console.error('page '+pg+': '+pageOrders.length+' orders');
    for(const order of pageOrders){
      if(seen.has(order))continue;
      seen.add(order);
      const o=scanMap[order]||{order};
      if(done<start){done++;continue}
      if(done>=start+limit)break;
      let d=null;
      try{
        d=await openDetail(listS,order,existingIds);
        let txt='';
        for(let k=0;k<20;k++){await sleep(300);txt=await ev(d.s,'document.body.innerText').catch(()=>'');if(/售后编码：\s*\n\s*\d+/.test(txt))break}
        const g=(re)=>{const m=txt.match(re);return m?m[1].trim():''};
        const code=g(/售后编码：\s*\n\s*(\d+)/);
        const stype=g(/售后类型：\s*\n\s*([^\n]+)/);
        const ship=g(/发货状态：\s*\n\s*([^\n]+)/);
        const ramt=g(/退款金额：\s*\n\s*¥?\s*([\d.]+)/);
        const reason=g(/申请原因：\s*\n\s*([^\n]+)/);
        const expl=g(/售后申请说明：\s*\n\s*([^\n]+)/);
        const hasChat=/暂无售后聊天记录/.test(txt)?false:(/聊天记录/.test(txt)?true:null);
        results.push({...o,code,stype,ship,ramt,reason,expl,hasChat});
        console.error(`[${done+1}] ${order} ${stype}|${reason}|${ramt}|chat=${hasChat}`);
        done++;
      }catch(e){console.error('ERR '+order+': '+e.message);results.push({...o,error:e.message});done++}
      finally{
        if(d){await httpPut('/json/close/'+d.id).catch(()=>{});d.s.close()}
      }
    }
    if(done>=start+limit)break;
  }
  const out='F:\\减负\\auto\\appeal\\2026-11-17-运费复议\\detail-reasons'+(start?('_'+start):'')+'.json';
  fs.writeFileSync(out,JSON.stringify(results,null,2),'utf8');
  console.log('OUT='+out+' N='+results.length);
  listS.close();
})().catch(e=>{console.error('FATAL='+e.message);process.exit(1)});
