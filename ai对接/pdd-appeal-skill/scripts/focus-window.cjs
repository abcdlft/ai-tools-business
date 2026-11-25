#!/usr/bin/env node
/**
 * focus-window.cjs —— 把调试版 Edge 窗口恢复并激活到前台，指定页面设为活动标签
 * 用法： node focus-window.cjs [url关键字]
 */
const http = require('http');
const HOST = '127.0.0.1', PORT = Number(process.env.CDP_PORT || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function get(p) {
  return new Promise((res, rej) => {
    http.get({ host: HOST, port: PORT, path: p }, (r) => {
      let b = ''; r.setEncoding('utf8');
      r.on('data', (d) => b += d);
      r.on('end', () => { try { res(JSON.parse(b)); } catch { res(b); } });
    }).on('error', rej);
  });
}

class S {
  constructor(u) {
    this.id = 0; this.pending = new Map();
    this.ws = new WebSocket(u);
    this.ready = new Promise((a, b) => { this.ws.onopen = a; this.ws.onerror = () => b(new Error('ws fail')); });
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    };
  }
  send(method, params = {}, t = 20000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { this.pending.delete(id); rej(new Error('to ' + method)); }, t);
      this.pending.set(id, { resolve: (v) => { clearTimeout(tm); res(v); }, reject: (e) => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
}

(async () => {
  const key = process.argv[2] || 'aftersale/list';
  const ver = await get('/json/version');
  const b = new S(ver.webSocketDebuggerUrl);
  await b.ready;
  const { targetInfos } = await b.send('Target.getTargets');
  const t = targetInfos.find((x) => x.type === 'page' && (x.url || '').includes(key));
  if (!t) { console.log('NO_TARGET for ' + key); process.exit(1); }
  const { windowId } = await b.send('Browser.getWindowForTarget', { targetId: t.targetId });
  try {
    const before = await b.send('Browser.getWindowBounds', { windowId });
    console.log('BEFORE=' + JSON.stringify(before.bounds));
    await b.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await sleep(400);
    const after = await b.send('Browser.getWindowBounds', { windowId });
    console.log('AFTER=' + JSON.stringify(after.bounds));
    await b.send('Browser.setWindowBounds', {
      windowId,
      bounds: { left: Math.max(0, after.bounds.left), top: Math.max(0, after.bounds.top), width: after.bounds.width, height: after.bounds.height },
    });
  } catch (e) { console.log('BOUNDS_ERR=' + e.message); }
  await b.send('Target.activateTarget', { targetId: t.targetId });
  console.log('ACTIVATED ' + t.targetId + ' win=' + windowId);
  b.ws.close();
})().catch((e) => { console.log('ERR=' + e.message); process.exit(1); });
