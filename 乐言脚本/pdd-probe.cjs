// 探测拼多多商家后台售后列表的数据来源
// 用法：node pdd-probe.cjs [url] [秒数]
const http = require('http');

const PORT = Number(process.env.CDP_PORT || 9222);
const url = process.argv[2] || 'https://mms.pinduoduo.com/aftersales-ssr/list';
const secs = Number(process.argv[3] || 14);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (p) =>
  new Promise((res, rej) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p, method: 'GET' }, (r) => {
      let b = '';
      r.setEncoding('utf8');
      r.on('data', (d) => (b += d));
      r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
    }).on('error', rej);
  });

(async () => {
  const ver = await get('/json/version');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0;
  const waits = new Map();
  const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)) { const f = waits.get(m.id); waits.delete(m.id); f(m.result || m.error); }
    else if (m.method) events.push(m);
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}, sessionId) =>
    new Promise((res) => {
      const i = ++id;
      waits.set(i, res);
      ws.send(JSON.stringify({ id: i, method, params, sessionId }));
    });

  const t = await send('Target.createTarget', { url: 'about:blank', background: true });
  const targetId = t.targetId;
  const a = await send('Target.attachToTarget', { targetId, flatten: true });
  const sid = a.sessionId;
  console.log('新标签已建（后台），target=' + targetId.slice(0, 8));

  await send('Network.enable', { maxTotalBufferSize: ID-XXXX, maxResourceBufferSize: ID-XXXX }, sid);
  await send('Page.enable', {}, sid);
  await send('Runtime.enable', {}, sid);
  await send('Page.navigate', { url }, sid);

  const reqs = new Map();
  const done = [];
  const watch = setInterval(() => {
    while (events.length) {
      const m = events.shift();
      if (m.method === 'Network.requestWillBeSent') {
        reqs.set(m.params.requestId, {
          url: m.params.request.url,
          method: m.params.request.method,
          post: m.params.request.postData || '',
          type: m.params.type,
        });
      } else if (m.method === 'Network.responseReceived') {
        const r = reqs.get(m.params.requestId);
        if (r) { r.status = m.params.response.status; r.mime = m.params.response.mimeType; }
      } else if (m.method === 'Network.loadingFinished') {
        const r = reqs.get(m.params.requestId);
        if (r && !r.got) { r.got = true; done.push(r); }
      }
    }
  }, 100);

  await sleep(secs * 1000);
  clearInterval(watch);

  // 先看页面本身
  const info = await send('Runtime.evaluate', {
    expression: `JSON.stringify({url:location.href,title:document.title,body:(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,500)})`,
    returnByValue: true,
  }, sid);
  console.log('\n页面:', info.result && info.result.value);

  const hits = done.filter((r) => /aftersale|afterSale|refund|api\/.*(list|query)/i.test(r.url));
  console.log('\n候选接口 ' + hits.length + ' 个：');
  for (const h of hits.slice(0, 25)) {
    console.log(`  ${h.status} ${h.method} ${h.url.split('?')[0].slice(0, 110)}`);
    if (h.post) console.log('     入参: ' + h.post.replace(/\s+/g, ' ').slice(0, 200));
  }

  // 取最有希望那个的返回体
  const best = hits.filter((h) => /list|query/i.test(h.url) && h.method === 'POST').slice(-2);
  for (const b of best) {
    const body = await send('Network.getResponseBody', { requestId: [...reqs.keys()].find((k) => reqs.get(k) === b) }, sid);
    if (body && body.body) {
      console.log('\n=== 返回样本 ' + b.url.split('?')[0].slice(0, 90) + ' ===');
      console.log(body.body.slice(0, 1600));
    }
  }

  await send('Target.closeTarget', { targetId });
  ws.close();
  process.exit(0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
