const http=require('http');
const PORT=Number(process.env.CDP_PORT||9223);
const get=p=>new Promise((res,rej)=>{http.get({host:'127.0.0.1',port:PORT,path:p},r=>{let b='';r.on('data',d=>b+=d);r.on('end',()=>{try{res(JSON.parse(b))}catch(e){rej(e)}})}).on('error',rej)});
(async()=>{
  const list=await get('/json/list');
  const pg=list.filter(x=>x.type==='page').find(x=>(x.url||'').includes('reception-hub'));
  if(!pg){console.log('NO TARGET');return;}
  const ws=new WebSocket(pg.webSocketDebuggerUrl);
  await new Promise(r=>{ws.onopen=r});
  ws.send(JSON.stringify({id:1,method:'Page.stopLoading'}));
  ws.send(JSON.stringify({id:2,method:'Page.navigate',params:{url:'https://fission.leyantech.com/v11/#/section/reception-hub'}}));
  console.log('NAV SENT');
  setTimeout(()=>{ws.close();process.exit(0)},2000);
})();
