#!/usr/bin/env node
/**
 * ly-net.cjs —— 抓乐言客户端（Electron）某个页面的 XHR/Fetch
 * 用法：CDP_PORT=9223 node ly-net.cjs <页面关键字> [秒数] [--body]
 *   页面关键字：reception-hub / lobby / pdd/sidebar / bottombar …
 *   --body 额外拉返回体（默认只打 URL + 请求体）
 */
const http = require('http');

const HOST = '127.0.0.1';
const PORT = Number(process.env.CDP_PORT || 9223);
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
      } else if (m.method) this.handlers.forEach((h) => h(m));
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
  const kw = process.argv[2] || 'reception-hub';
  const secs = Number(process.argv[3] || 12);
  const wantBody = process.argv.includes('--body');

  const list = await httpGet('/json/list');
  const pages = list.filter((x) => x.type === 'page');
  const p = pages.find((x) => (x.url || '').includes(kw) || (x.title || '').includes(kw)) || pages[0];
  if (!p) throw new Error('没找到页面');
  console.log('TARGET=' + p.title + ' ' + p.url);

  const s = new Sess(p.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Network.enable');

  const reqs = new Map();
  s.handlers.push((m) => {
    if (m.method === 'Network.requestWillBeSent') {
      const r = m.params.request;
      if (m.params.type !== 'XHR' && m.params.type !== 'Fetch') return;
      reqs.set(m.params.requestId, {
        url: r.url, method: r.method, postData: r.postData || '',
        headers: r.headers || {}, status: 0, body: '',
      });
    } else if (m.method === 'Network.responseReceived') {
      const q = reqs.get(m.params.requestId);
      if (q) q.status = m.params.response.status;
    }
  });

  await sleep(secs * 1000);

  if (wantBody) {
    for (const [id, q] of reqs) {
      try {
        const b = await s.send('Network.getResponseBody', { requestId: id }, 8000);
        q.body = b.base64Encoded ? Buffer.from(b.body, 'base64').toString('utf8') : b.body;
      } catch (e) { q.body = '(' + e.message + ')'; }
    }
  }

  console.log('=== 抓到 ' + reqs.size + ' 条 XHR/Fetch ===');
  for (const q of reqs.values()) {
    const u = q.url.length > 130 ? q.url.slice(0, 130) + '…' : q.url;
    console.log('\n--- ' + q.method + ' ' + q.status + ' ' + u);
    if (q.postData) console.log('IN : ' + q.postData.slice(0, 400));
    if (q.body) console.log('OUT: ' + q.body.replace(/\s+/g, ' ').slice(0, 900));
  }
  s.close();
})().catch((e) => { console.log('ERROR=' + e.message); process.exit(1); });
