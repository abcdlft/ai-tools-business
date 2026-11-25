const http=require('http');
const PORT=Number(process.env.CDP_PORT||9223);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const get=p=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path:p},r=>{let b='';r.setEncoding('utf8');r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej)});
class S{constructor(u){this.id=0;this.p=new Map();this.h=[];this.ws=new WebSocket(u);this.ready=new Promise((a,b)=>{this.ws.onopen=a;this.ws.onerror=b});this.ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return};if(m.id&&this.p.has(m.id)){const{resolve,reject}=this.p.get(m.id);this.p.delete(m.id);m.error?reject(new Error(m.error.message)):resolve(m.result)}else if(m.method)this.h.forEach(f=>f(m))}}
 send(method,params={},t=20000){const id=++this.id;return new Promise((res,rej)=>{const tm=setTimeout(()=>{this.p.delete(id);rej(new Error('timeout '+method))},t);this.p.set(id,{resolve:v=>{clearTimeout(tm);res(v)},reject:e=>{clearTimeout(tm);rej(e)}});this.ws.send(JSON.stringify({id,method,params}))})}
 close(){try{this.ws.close()}catch{}}}
(async()=>{
const kw=process.argv[2]||'reception-hub'; const secs=Number(process.argv[3]||25);
const list=await get('/json/list'); const pages=list.filter(x=>x.type==='page');
const pg=pages.find(x=>(x.url||'').includes(kw))||pages[0];
console.log('TARGET='+pg.title+' '+pg.url);
const s=new S(pg.webSocketDebuggerUrl); await s.ready; await s.send('Network.enable');
const urls=new Map(); const frames=[];
s.h.push(m=>{
  if(m.method==='Network.webSocketCreated'){urls.set(m.params.requestId,m.params.url);console.log('[WS OPEN] '+m.params.url)}
  else if(m.method==='Network.webSocketFrameReceived'){frames.push({dir:'R',id:m.params.requestId,data:m.params.response.payloadData})}
  else if(m.method==='Network.webSocketFrameSent'){frames.push({dir:'S',id:m.params.requestId,data:m.params.response.payloadData})}
});
await sleep(secs*1000);
console.log('wss='+urls.size+' frames='+frames.length);
for(const f of frames.slice(-40)) console.log(f.dir+' '+f.data.replace(/\s+/g,' ').slice(0,400));
s.close();
})().catch(e=>{console.log('ERR '+e.message);process.exit(1)});
