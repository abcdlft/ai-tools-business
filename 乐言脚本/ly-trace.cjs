// 抓目标页面加载全过程网络流量：node ly-trace.cjs <urlKeyword> [seconds]
const http = require('http');
const PORT = Number(process.env.CDP_PORT || 9223);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.setEncoding('utf8'); r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});
class S {
  constructor(u) { this.id = 0; this.p = new Map(); this.h = []; this.ws = new WebSocket(u);
    this.ready = new Promise((a, b) => { this.ws.onopen = a; this.ws.onerror = b; });
    this.ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.id && this.p.has(m.id)) { const f = this.p.get(m.id); this.p.delete(m.id); m.error ? f.rej(new Error(m.error.message)) : f.res(m.result); }
      else if (m.method) this.h.forEach((f) => f(m)); }; }
  send(method, params = {}, t = 30000) { const id = ++this.id; return new Promise((res, rej) => {
    const tm = setTimeout(() => { this.p.delete(id); rej(new Error('timeout ' + method)); }, t);
    this.p.set(id, { res: (v) => { clearTimeout(tm); res(v); }, rej: (e) => { clearTimeout(tm); rej(e); } });
    this.ws.send(JSON.stringify({ id, method, params })); }); }
  close() { try { this.ws.close(); } catch {} }
}
(async () => {
  const kw = process.argv[2] || 'reception-hub';
  const secs = Number(process.argv[3] || 25);
  const list = await get('/json/list');
  const pg = list.filter((x) => x.type === 'page').find((x) => (x.url || '').includes(kw));
  if (!pg) { console.log('NO TARGET for ' + kw); process.exit(1); }
  console.log('TARGET ' + pg.title + ' | ' + pg.url);
  const s = new S(pg.webSocketDebuggerUrl); await s.ready;
  const reqs = new Map();
  s.h.push(async (m) => {
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      if (/^(https?:|wss?:)/i.test(r.url) && !/\.(png|jpg|jpeg|svg|woff2?|css|mp4)(\?|$)/i.test(r.url)) {
        reqs.set(m.params.requestId, { url: r.url, method: r.method, type: m.params.type, headers: r.headers, postData: r.postData || '', status: 0, body: '' });
      }
    } else if (m.method === 'Network.responseReceived') {
      const q = reqs.get(m.params.requestId); if (q) { q.status = m.params.response.status; q.mime = m.params.response.mimeType; }
    }
  });
  await s.send('Network.enable');
  await s.send('Page.reload', { ignoreCache: false });
  await sleep(secs * 1000);
  // 拉响应体
  for (const [id, q] of reqs) {
    if (!q.status || q.status >= 400) continue;
    try {
      const b = await s.send('Network.getResponseBody', { requestId: id }, 8000);
      q.body = (b.body || '').slice(0, 1200);
    } catch {}
  }
  console.log('captured=' + reqs.size);
  for (const [id, q] of reqs) {
    console.log('\n--- ' + q.method + ' ' + q.status + ' [' + q.type + '] ' + q.url.slice(0, 150));
    const h = q.headers || {};
    const auth = h.Authorization || h.authorization || h['x-token'] || h.cookie || '';
    if (auth) console.log('  AUTH: ' + String(auth).slice(0, 220));
    const sid = q.url.match(/sellerId=[^&]*/);
    if (sid) console.log('  ' + sid[0]);
    if (q.postData) console.log('  IN: ' + q.postData.slice(0, 300));
    if (q.body) console.log('  OUT: ' + q.body.replace(/\s+/g, ' ').slice(0, 500));
  }
  s.close(); process.exit(0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
