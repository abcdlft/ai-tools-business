#!/usr/bin/env node
// which-shop.cjs —— 开跑前自检：确认当前 CDP_PORT 连的是哪家店、哪个浏览器、登录态是否正常
// 多 AI 各管一个浏览器店铺时，先跑这个防止串店。
// 用法: node which-shop.cjs [--expect 兔小贝]   （--expect 时校验页面是否含该关键字）
const http=require('http');
const HOST='127.0.0.1',PORT=Number(process.env.CDP_PORT||9222);
function get(p){return new Promise((res,rej)=>{http.get({host:HOST,port:PORT,path:p},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(new Error(b.slice(0,100)))}})}).on('error',rej)})}
class S{constructor(u){this.id=0;this.p=new Map();this.ws=new WebSocket(u);this.ready=new Promise((a,b)=>{this.ws.onopen=a;this.ws.onerror=()=>b(new Error('ws'))});this.ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result)}}}send(method,params={}){const id=++this.id;return new Promise((a,b)=>{const tm=setTimeout(()=>{this.p.delete(id);b(new Error('to'))},15000);this.p.set(id,{resolve:v=>{clearTimeout(tm);a(v)},reject:e=>{clearTimeout(tm);b(e)}});this.ws.send(JSON.stringify({id,method,params}))})}close(){try{this.ws.close()}catch{}}}
(async()=>{
  let ver,pages;
  try{ver=await get('/json/version');pages=await get('/json/list')}
  catch(e){console.log(JSON.stringify({ok:false,port:PORT,error:'CDP 端口连不上（'+e.message+'）。确认浏览器已用对应 bat 启动、端口正确。'},null,2));process.exit(1)}
  const browser=ver.Browser||'unknown';
  const tabs=pages.filter(p=>p.type==='page').map(p=>({title:p.title,url:p.url}));
  const mms=tabs.filter(t=>/mms\.pinduoduo\.com/.test(t.url||''));
  const login=mms.length>0 && !mms.some(t=>/login|passport/.test(t.url||''));
  // 取一个 mms 页面读正文，提取店铺名线索
  let shopHint='';
  const target=pages.find(p=>p.type==='page'&&/mms\.pinduoduo\.com/.test(p.url||''));
  if(target){
    const s=new S(target.webSocketDebuggerUrl);
    try{
      await s.ready;
      const r=await s.send('Runtime.evaluate',{expression:`(function(){var t=document.body?document.body.innerText:'';var ps=[/([\\u4e00-\\u9fa5A-Za-z0-9]{2,16}(?:\\u65d7\\u823d\\u5e97|\\u4f01\\u4e1a\\u5e97|\\u4e13\\u5356\\u5e97|\\u4e13\\u8425\\u5e97|\\u5546\\u884c))/,(?:\\u5e97\\u94fa\\u540d\\u79f0|\\u5e97\\u540d)[:\\uff1a]\\s*([^\\s\\n]{2,20})/];for(var i=0;i<ps.length;i++){var m=t.match(ps[i]);if(m)return m[1]||m[0]}return ''})()`,returnByValue:true});
      shopHint=(r.result&&r.result.value)||'';
    }catch(e){shopHint='(读取失败:'+e.message+')'}
    s.close();
  }
  const expectIdx=process.argv.indexOf('--expect');
  const expect=expectIdx>=0?process.argv[expectIdx+1]:null;
  let expectOk=null;
  if(expect){const hay=(shopHint+' '+tabs.map(t=>t.title).join(' '));expectOk=hay.includes(expect)}
  const out={ok:true,port:PORT,browser,loggedInToMms:login,mmsTabCount:mms.length,shopHint,tabs,
    warning:!mms.length?'当前端口没有拼多多商家后台页面，可能没登录或开错浏览器':null,
    expect,expectOk,expectWarning:expect&&!expectOk?'⚠ 页面未发现「'+expect+'」，疑似串店，务必人工确认后再操作':null};
  console.log(JSON.stringify(out,null,2));
})().catch(e=>{console.log(JSON.stringify({ok:false,error:e.message},null,2));process.exit(1)});
