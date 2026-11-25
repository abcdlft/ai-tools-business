// 页面加载前注入 RPC 监听：node ly-inject.cjs <urlKeyword> [seconds]
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

const INJECT = `
(function(){
  window.__RPC_LOG = [];
  window.__RPC_RES = [];
  function hex(u){
    const b = u instanceof Uint8Array ? u : new Uint8Array(u.buffer || u);
    let s = '';
    for (let i=0;i<b.length;i++) s += (b[i]<16?'0':'') + b[i].toString(16);
    return s;
  }
  function deep(v, d){
    if (d > 6) return '...';
    if (v == null) return v;
    const t = typeof v;
    if (t === 'string') return v.slice(0, 3000);
    if (t !== 'object') return v;
    if (v instanceof Uint8Array || v instanceof ArrayBuffer) return 'bytes:' + (v.byteLength ?? v.length);
    if (Array.isArray(v)) return '[' + v.length + ']' + (v.length ? JSON.stringify(deep(v[0], d+1)).slice(0, 300) : '');
    const o = {};
    let i = 0;
    for (const k of Object.keys(v)) { if (i++ > 18) { o['...'] = true; break; } o[k] = deep(v[k], d+1); }
    return o;
  }
  function desc(d, dir){
    const o = { dir: dir, t: typeof d };
    try {
      if (!d) return o;
      if (d instanceof Uint8Array || d instanceof ArrayBuffer) { o.bytes = d.byteLength ?? d.length; o.hex = hex(d).slice(0, 4000); return o; }
      o.keys = Object.keys(d);
      if (d.data) {
        if (d.data instanceof Uint8Array || d.data instanceof ArrayBuffer) { o.bytes = d.data.byteLength ?? d.data.length; o.hex = hex(d.data).slice(0, 4000); }
        else o.dataStr = String(d.data).slice(0, 600);
      }
      o.dump = deep(d, 0);
    } catch (e) { o.err = String(e); }
    return o;
  }
  function wrap(p){
    if (!p || p.__wrapped) return false;
    p.__wrapped = true;
    const orig = p.postMessage.bind(p);
    p.postMessage = function(d){ try { window.__RPC_LOG.push(desc(d,'out')); } catch(e){} return orig(d); };
    try {
      p.addEventListener('message', function(e){ try { if(window.__RPC_RES.length<80) window.__RPC_RES.push(desc(e.data,'in')); } catch(err){} });
    } catch(e){}
    return true;
  }
  try { if (window.__LY_CLIENT_PORT__) wrap(window.__LY_CLIENT_PORT__); } catch(e){}
  const iv = setInterval(function(){
    try { if (window.__LY_CLIENT_PORT__ && !window.__LY_CLIENT_PORT__.__wrapped) wrap(window.__LY_CLIENT_PORT__); } catch(e){}
  }, 5);
  setTimeout(function(){ clearInterval(iv); }, 45000);
})();
`;

function hexToAscii(hex) {
  let out = '';
  for (let i = 0; i < hex.length; i += 2) {
    const c = parseInt(hex.substr(i, 2), 16);
    out += c >= 32 && c < 127 ? String.fromCharCode(c) : '.';
  }
  return out;
}

(async () => {
  const kw = process.argv[2] || 'reception-hub';
  const secs = Number(process.argv[3] || 25);
  const list = await get('/json/list');
  const pg = list.filter((x) => x.type === 'page').find((x) => (x.url || '').includes(kw));
  if (!pg) { console.log('NO TARGET'); process.exit(1); }
  console.log('TARGET ' + pg.title);
  const s = new S(pg.webSocketDebuggerUrl); await s.ready;
  await s.send('Page.enable');
  await s.send('Runtime.enable');
  const { identifier } = await s.send('Page.addScriptToEvaluateOnNewDocument', { source: INJECT });
  console.log('injected ' + identifier);
  await s.send('Page.reload', { ignoreCache: false });
  await sleep(secs * 1000);
  const ev = async (expr) => {
    const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true }, 20000);
    return r.result && r.result.value;
  };
  const out = JSON.parse(await ev('JSON.stringify({log:(window.__RPC_LOG||[]),res:(window.__RPC_RES||[]),wrapped:!!(window.__LY_CLIENT_PORT__&&window.__LY_CLIENT_PORT__.__wrapped)})'));
  console.log('wrapped=' + out.wrapped + '  requests=' + out.log.length + '  responses=' + out.res.length);
  console.log('\n########## 请求 ##########');
  out.log.forEach((r, i) => {
    console.log(`\n[${i}] ${JSON.stringify(r.dump || r).slice(0, 600)}`);
    if (r.hex) console.log('  ASCII: ' + hexToAscii(r.hex).slice(0, 500));
  });
  console.log('\n########## 响应（按内容去重）##########');
  const seen = new Set();
  let shown = 0;
  out.res.forEach((r, i) => {
    const sig = JSON.stringify(r.dump || r).slice(0, 400);
    if (seen.has(sig)) return;
    seen.add(sig);
    if (shown++ >= 12) return;
    console.log(`\n[${i}] ${JSON.stringify(r.dump || r).slice(0, 6000)}`);
    if (r.hex) console.log('  ASCII: ' + hexToAscii(r.hex).slice(0, 700));
  });
  s.close(); process.exit(0);
})().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
