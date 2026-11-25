// 在已登录的拼多多商家后台页面里执行 JS（只读，不点击）
// 用法：node pdd-mms.cjs "<js 表达式，可返回 Promise>"
const http = require('http');
const PORT = Number(process.env.CDP_PORT || 9222);
const expr = process.argv.slice(2).join(' ');

const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.setEncoding('utf8'); r.on('data', (d) => (b += d));
    r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

(async () => {
  const list = await get('/json/list');
  const pages = list.filter((x) => x.type === 'page' && /mms\.pinduoduo\.com/.test(x.url || ''));
  if (!pages.length) { console.log('ERR 没有已登录的 mms 页面'); process.exit(1); }
  const pg = pages[0];
  const ws = new WebSocket(pg.webSocketDebuggerUrl);
  let id = 0; const waits = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && waits.has(m.id)) { const f = waits.get(m.id); waits.delete(m.id); f(m); }
  };
  await new Promise((r) => (ws.onopen = r));
  const send = (method, params = {}) => new Promise((res) => {
    const i = ++id; waits.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  const r = await send('Runtime.evaluate', {
    expression: expr,
    awaitPromise: true,
    returnByValue: true,
    userGesture: false,
  });
  if (r.result && r.result.exceptionDetails) {
    console.log('JS_ERR ' + (r.result.exceptionDetails.text || ''));
  }
  const v = r.result && r.result.result && r.result.result.value;
  console.log(typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  ws.close(); process.exit(0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
