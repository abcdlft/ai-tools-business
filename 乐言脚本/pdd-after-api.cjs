// 专门抓 mercury/afterSales 系列接口
const http = require('http');
const PORT = Number(process.env.CDP_PORT || 9222);
const url = process.argv[2] || 'https://mms.pinduoduo.com/aftersales/aftersale_list?searchType=7';
const secs = Number(process.argv[3] || 18);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.setEncoding('utf8'); r.on('data', (d) => (b += d));
    r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const ver = await get('/json/version');
  const ws = new WebSocket(ver.webSocketDebuggerUrl);
  let id = 0; const waits = new Map(); const events = [];
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)) { const f = waits.get(m.id); waits.delete(m.id); f(m.result || m.error); }
    else if (m.method) events.push(m);
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}, sessionId) => new Promise((res) => {
    const i = ++id; waits.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId }));
  });

  const t = await send('Target.createTarget', { url: 'about:blank', background: true });
  const a = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  await send('Network.enable', { maxTotalBufferSize: ID-XXXX, maxResourceBufferSize: ID-XXXX }, sid);
  await send('Page.enable', {}, sid);
  await send('Page.navigate', { url }, sid);

  const reqs = new Map();
  const keep = [];
  const timer = setInterval(() => {
    while (events.length) {
      const m = events.shift();
      if (m.method === 'Network.requestWillBeSent') {
        const u = m.params.request.url;
        if (/mercury|afterSales|refund/i.test(u)) {
          reqs.set(m.params.requestId, { id: m.params.requestId, url: u, method: m.params.request.method, post: m.params.request.postData || '' });
        }
      } else if (m.method === 'Network.loadingFinished') {
        const r = reqs.get(m.params.requestId);
        if (r && !r.done) { r.done = true; keep.push(r); }
      }
    }
  }, 80);
  await sleep(secs * 1000);
  clearInterval(timer);

  console.log('命中接口 ' + keep.length + ' 个\n');
  for (const r of keep) {
    console.log('### ' + r.method + ' ' + r.url.split('?')[0].replace('https://mms.pinduoduo.com', ''));
    if (r.post) console.log('  入参 ' + r.post.replace(/\s+/g, ' ').slice(0, 300));
    if (/query.*(List|Count|Params|Group)/i.test(r.url) || /afterSales/i.test(r.url)) {
      const b = await send('Network.getResponseBody', { requestId: r.id }, sid);
      if (b && b.body) console.log('  返回 ' + b.body.replace(/\s+/g, ' ').slice(0, 900));
    }
    console.log('');
  }
  await send('Target.closeTarget', { targetId: t.targetId });
  ws.close(); process.exit(0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
