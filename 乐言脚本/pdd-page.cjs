// 新开后台标签打开某页，等渲染完输出可见文本（只读）
// 用法：node pdd-page.cjs <url> [秒数] [截取长度]
const http = require('http');
const PORT = Number(process.env.CDP_PORT || 9222);
const url = process.argv[2];
const secs = Number(process.argv[3] || 12);
const cut = Number(process.argv[4] || 1500);
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
  let id = 0; const waits = new Map();
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); if (m.id && waits.has(m.id)) { const f = waits.get(m.id); waits.delete(m.id); f(m.result || m.error); } };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}, sessionId) => new Promise((res) => { const i = ++id; waits.set(i, res); ws.send(JSON.stringify({ id: i, method, params, sessionId })); });
  const t = await send('Target.createTarget', { url: 'about:blank', background: true });
  const a = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  await send('Runtime.enable', {}, sid);
  await send('Page.navigate', { url }, sid);
  await sleep(secs * 1000);
  const r = await send('Runtime.evaluate', {
    expression: `JSON.stringify({url:location.href,title:document.title,text:(document.body.innerText||'').replace(/\\s+/g,' ').slice(0,${cut}),rows:document.querySelectorAll('tr,[class*=table-row],[class*=list-item]').length})`,
    returnByValue: true,
  }, sid);
  console.log(r.result && r.result.value);
  await send('Target.closeTarget', { targetId: t.targetId });
  ws.close(); process.exit(0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
