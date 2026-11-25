#!/usr/bin/env node
/**
 * jst-net.cjs —— 抓售后扫描页发单号查询时打了哪些后端接口
 * 目的：找到可以脱离 UI 批量调用的接口，把「哪些单号有售后单」一次问完，
 *       只对命中的单子驱动界面收货，从而把 N 单的成本从 O(N次UI) 降到 O(1次接口 + 命中数)。
 *
 * 用法：CDP_PORT=<端口> node jst-net.cjs <单号>（端口由用户提供；9223 归乐言占用，别用）
 */
const http = require('http');

const HOST = '127.0.0.1';
const PORT = Number(process.env.CDP_PORT || 9224);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path: p }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('JSON: ' + b.slice(0, 200))); } });
    }).on('error', reject);
  });
}

class Sess {
  constructor(url) {
    this.id = 0; this.pending = new Map(); this.handlers = [];
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      } else if (m.method) {
        this.handlers.forEach((h) => h(m));
      }
    };
  }
  send(method, params = {}, timeout = 25000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('超时 ' + method)); }, timeout);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

(async () => {
  const no = process.argv[2] || 'JT5549187962339';
  const list = await httpGet('/json/list');
  const p = list.filter((x) => x.type === 'page').find((x) => (x.url || '').includes('erp321.com'));
  const s = new Sess(p.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Page.enable');
  await s.send('Network.enable');

  const reqs = new Map();
  s.handlers.push((m) => {
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      if (!/\.(js|css|png|jpg|svg|woff2?|gif|ico)(\?|$)/i.test(r.url)) {
        reqs.set(m.params.requestId, { url: r.url, method: r.method, type: m.params.type, postData: r.postData || '', status: 0, body: '', headers: r.headers });
      }
    } else if (m.method === 'Network.responseReceived') {
      const q = reqs.get(m.params.requestId);
      if (q) q.status = m.params.response.status;
    }
  });

  const tree = await s.send('Page.getFrameTree');
  let fid = null;
  (function walk(n) {
    if (/aftersalescan/i.test(n.frame.url)) fid = n.frame.id;
    (n.childFrames || []).forEach(walk);
  })(tree.frameTree);
  const w = await s.send('Page.createIsolatedWorld', { frameId: fid, worldName: 'net' });
  const ctx = w.executionContextId;

  const ev = async (expr) => {
    const r = await s.send('Runtime.evaluate', { expression: expr, contextId: ctx, returnByValue: true, userGesture: true });
    return r.result && r.result.value;
  };

  // 点主查询框 → 全选 → 输入 → 回车
  const click = async (x, y) => {
    const px = x + 60, py = y + 36;
    await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none', clickCount: 0 });
    await sleep(40);
    await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
    await sleep(40);
    await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
    await sleep(200);
  };
  const key = async (k, code, vk, text, mod) => {
    const base = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
    if (mod) base.modifiers = mod;
    await s.send('Input.dispatchKeyEvent', { ...base, type: 'rawKeyDown' });
    if (text) await s.send('Input.dispatchKeyEvent', { ...base, type: 'char', text, unmodifiedText: text });
    await s.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
    await sleep(60);
  };

  await click(250, 41);
  await key('a', 'KeyA', 65, null, 2);
  await s.send('Input.insertText', { text: no });
  await sleep(120);
  const t0 = Date.now();
  await key('Enter', 'Enter', 13, '\r');
  await sleep(1800);
  console.log('响应窗口 ' + (Date.now() - t0) + 'ms');

  // 拉 response body
  for (const [id, q] of reqs) {
    if (q.type !== 'XHR' && q.type !== 'Fetch') continue;
    try {
      const b = await s.send('Network.getResponseBody', { requestId: id }, 8000);
      q.body = (b.body || '').slice(0, 1200);
      q.b64 = !!b.base64Encoded;
    } catch (e) { q.body = '(' + e.message + ')'; }
  }

  const arr = [...reqs.values()].filter((q) => q.type === 'XHR' || q.type === 'Fetch' || /aspx|ashx|api/i.test(q.url));
  console.log('=== XHR/Fetch 共 ' + arr.length + ' 条 ===');
  for (const q of arr) {
    console.log('\n--- ' + q.method + ' ' + q.status + ' ' + q.url);
    if (q.postData) console.log('BODY_IN: ' + q.postData.slice(0, 500));
    if (q.headers) console.log('HEADERS: ' + JSON.stringify(q.headers));
    if (q.body) console.log('BODY_OUT: ' + q.body.slice(0, 700).replace(/\s+/g, ' '));
  }
  s.close();
})().catch((e) => { console.log('ERROR=' + e.message); process.exit(1); });
