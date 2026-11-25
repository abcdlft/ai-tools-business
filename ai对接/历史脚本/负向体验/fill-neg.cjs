#!/usr/bin/env node
// 负向体验3元 填表脚本（默认不提交）
// task.json: [{order, ticketSn, reason, description, evidence:[路径...]}]
// 用法: node fill-neg.cjs <task.json> [index] [--submit]
const http=require('http'),fs=require('fs');
const HOST='127.0.0.1',PORT=process.env.CDP_PORT||9222;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function httpGet(p){return new Promise((res,rej)=>{http.get({host:HOST,port:PORT,path:p},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch{res(b)}})}).on('error',rej)})}
class S{
  constructor(u){this.id=0;this.pending=new Map();this.ws=new WebSocket(u);this.ready=new Promise((a,b)=>{this.ws.onopen=a;this.ws.onerror=()=>b(new Error('ws fail'))});this.ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data)}catch{return}if(m.id&&this.pending.has(m.id)){const p=this.pending.get(m.id);this.pending.delete(m.id);m.error?p.reject(new Error(m.error.message)):p.resolve(m.result)}}}
  send(method,params={},t=30000){const id=++this.id;return new Promise((res,rej)=>{const tm=setTimeout(()=>{this.pending.delete(id);rej(new Error('to '+method))},t);this.pending.set(id,{resolve:v=>{clearTimeout(tm);res(v)},reject:e=>{clearTimeout(tm);rej(e)}});this.ws.send(JSON.stringify({id,method,params}))})}
  async ev(e){const r=await this.send('Runtime.evaluate',{expression:e,returnByValue:true,awaitPromise:true,userGesture:true});if(r.exceptionDetails)throw new Error('JS '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text).slice(0,200));return r.result&&r.result.value}
  async activate(){await this.send('Page.bringToFront').catch(()=>{});await this.send('Emulation.setFocusEmulationEnabled',{enabled:true}).catch(()=>{});await this.send('Page.setWebLifecycleState',{state:'active'}).catch(()=>{})}
  close(){try{this.ws.close()}catch{}}
}
async function click(s,x,y){await s.send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,button:'none',clickCount:0});await sleep(50);await s.send('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',clickCount:1});await sleep(50);await s.send('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});await sleep(200)}
const FORM=o=>'https://mms.pinduoduo.com/orders/appeals/negativeExperience?orderSn='+encodeURIComponent(o.order)+'&ticketSn='+encodeURIComponent(o.ticketSn);

// 选原因：点下拉→点浮层里精确文字的选项
async function pickReason(s,reason){
  await s.activate();
  let p=await s.ev(`(function(){var e=[].slice.call(document.querySelectorAll('input')).filter(function(x){return (x.placeholder||'')==='\\u8bf7\\u9009\\u62e9\\u7533\\u8bc9\\u539f\\u56e0'})[0];if(!e)return null;e.scrollIntoView({block:'center'});var b=e.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
  if(!p)throw new Error('未找到申诉原因下拉');
  await click(s,p.x,p.y);
  await sleep(600);
  // 找浮层里文字===reason且可点击的元素，真实坐标点
  const pos=await s.ev(`(function(){var all=[].slice.call(document.querySelectorAll('*')).filter(function(e){return e.children.length===0&&(e.textContent||'').trim()===${JSON.stringify(reason)}});for(var i=0;i<all.length;i++){var b=all[i].getBoundingClientRect();if(b.width>0&&b.height>0&&b.y>0&&b.x>200&&b.x<900){var x=Math.round(b.x+b.width/2),y=Math.round(b.y+b.height/2);var at=document.elementFromPoint(x,y);if(at&&(at.textContent||'').trim()===${JSON.stringify(reason)})return{x:x,y:y}}}return null})()`);
  if(!pos)throw new Error('未找到选项:'+reason);
  await click(s,pos.x,pos.y);
  await sleep(600);
  const val=await s.ev(`[].slice.call(document.querySelectorAll('input')).filter(function(x){return (x.placeholder||'')==='\\u8bf7\\u9009\\u62e9\\u7533\\u8bc9\\u539f\\u56e0'})[0]?.value||''`);
  return val;
}
// 填描述：选完原因后出现textarea，用native setter
async function fillDesc(s,text){
  return await s.ev(`(function(){var tas=[].slice.call(document.querySelectorAll('textarea')).filter(function(e){var b=e.getBoundingClientRect();return b.width>100&&b.height>40});if(!tas.length)return 'no textarea';var ta=tas[0];var setter=Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set;setter.call(ta,${JSON.stringify(text)});ta.dispatchEvent(new Event('input',{bubbles:true}));ta.dispatchEvent(new Event('change',{bubbles:true}));return ta.value.slice(0,60)})()`);
}
// 上传图片：找file input，用DOM.setFileInputFiles
async function upload(s,files){
  const r=await s.send('DOM.getDocument',{depth:0,pierce:true});
  const root=r.root.nodeId;
  const q=await s.send('DOM.querySelectorAll',{nodeId:root,selector:'input[type=file]'});
  const ids=q.nodeIds||[];
  if(!ids.length)throw new Error('无 file input');
  // 第一个file input是图片(accept image)
  let target=ids[0];
  for(const id of ids){
    const attrs=await s.send('DOM.getAttributes',{nodeId:id});
    const a=attrs.attributes||[];
    const ai=a.indexOf('accept');
    if(ai>=0&&/image/i.test(a[ai+1])){target=id;break}
  }
  await s.send('DOM.setFileInputFiles',{nodeId:target,files:files});
  await sleep(500);
  return ids.length;
}

(async()=>{
  const argv=process.argv.slice(2);
  const taskFile=argv[0];
  const idx=Number(argv[1]||0);
  const submit=argv.includes('--submit');
  const tasks=JSON.parse(fs.readFileSync(taskFile,'utf8'));
  const o=tasks[idx];
  if(!o){console.error('no task at '+idx);process.exit(1)}
  const outDir='F:\\减负\\auto\\appeal\\2026-11-17-负向体验3元\\shots';
  if(!fs.existsSync(outDir))fs.mkdirSync(outDir,{recursive:true});
  // 找或开一个tab导航到表单
  let pages=await httpGet('/json/list');
  let tab=pages.find(x=>x.type==='page'&&/negativeExperience/.test(x.url||''));
  let s;
  if(tab){s=new S(tab.webSocketDebuggerUrl);await s.ready;await s.send('Page.navigate',{url:FORM(o)})}
  else{
    pages=await httpGet('/json/list');
    const any=pages.find(x=>x.type==='page'&&/pinduoduo/.test(x.url||''));
    s=new S(any.webSocketDebuggerUrl);await s.ready;await s.send('Page.navigate',{url:FORM(o)});
  }
  await s.send('Page.enable').catch(()=>{});
  await sleep(3500);
  await s.activate();
  // 确认在表单页
  let url=await s.ev('location.href');
  if(!/negativeExperience/.test(url)){console.error('NOT ON FORM: '+url);process.exit(1)}
  console.error('order='+o.order+' url ok');
  // 1. 选原因
  const reasonVal=await pickReason(s,o.reason||'其他');
  console.error('reason='+reasonVal);
  if(reasonVal!==o.reason){console.error('REASON MISMATCH');}
  // 2. 填描述
  const descVal=await fillDesc(s,o.description);
  console.error('desc='+descVal);
  // 3. 上传凭证
  let up='-';
  if(o.evidence&&o.evidence.length){up=await upload(s,o.evidence);console.error('upload fileInputs='+up)}
  await sleep(800);
  // 4. 回读核对
  const check=await s.ev(`(function(){var sel=[].slice.call(document.querySelectorAll('input')).filter(function(x){return (x.placeholder||'')==='\\u8bf7\\u9009\\u62e9\\u7533\\u8bc9\\u539f\\u56e0'})[0];var tas=[].slice.call(document.querySelectorAll('textarea')).filter(function(e){var b=e.getBoundingClientRect();return b.width>100&&b.height>40});return JSON.stringify({reason:sel?sel.value:null,desc:tas[0]?tas[0].value.slice(0,120):null,imgHint:document.body.innerText.match(/上传图片\\s*\\((\\d)\\/3\\)/)?.[1]||null})})()`);
  console.error('CHECK='+check);
  // 5. 截图
  const shotPath=outDir+'\\'+o.order+'.png';
  await s.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false}).then(r=>fs.writeFileSync(shotPath,Buffer.from(r.data,'base64'))).catch(()=>{});
  console.error('SHOT='+shotPath);
  if(submit){
    const btn=await s.ev(`(function(){var e=[].slice.call(document.querySelectorAll('*')).filter(function(x){return x.children.length===0&&(x.textContent||'').trim()==='\\u63d0\\u4ea4\\u7533\\u8bf7'})[0];if(!e)return null;var b=e.getBoundingClientRect();return{x:Math.round(b.x+b.width/2),y:Math.round(b.y+b.height/2)}})()`);
    if(btn){await click(s,btn.x,btn.y);await sleep(1800);const t=await s.ev('document.body.innerText').catch(()=>'');const u=await s.ev('location.href').catch(()=>'');
      const ok=/\u63d0\u4ea4\u7533\u8bc9\u6210\u529f|\u7533\u8bc9\u63d0\u4ea4\u6210\u529f|\u63d0\u4ea4\u6210\u529f|\u5df2\u53d1\u8d77/.test(t) || /negativeExperience\/detail/.test(u);
      console.error('SUBMIT result='+(ok?'SUCCESS':'UNKNOWN: '+t.slice(-160)))}
    else console.error('no submit button');
  }else{
    console.error('NOT SUBMITTED (default). Review screenshot first.');
  }
  s.close();
})().catch(e=>{console.error('FATAL '+e.stack);process.exit(1)});
