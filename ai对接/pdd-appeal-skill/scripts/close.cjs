#!/usr/bin/env node
/**
 * close.cjs —— 关掉当前弹窗（优先点右上角 X）
 * 用法：node close.cjs
 */
const http = require('http');
const HOST = '127.0.0.1', PORT = Number(process.env.CDP_PORT || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(p) {
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
    this.ready = new Promise((a, b) => { this.ws.onopen = a; this.ws.onerror = () => b(new Error('ws')); });
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    };
  }
  send(m, p = {}, t = 20000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { this.pending.delete(id); rej(new Error('to')); }, t);
      this.pending.set(id, { resolve: (v) => { clearTimeout(tm); res(v); }, reject: (e) => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method: m, params: p }));
    });
  }
  async ev(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('JS ' + r.exceptionDetails.text);
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}
async function click(s, x, y) {
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await sleep(50);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(50);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(200);
}
const FIND = `(function(){
  const d=document.querySelector('[class*="MDL_outerWrapper"]');
  if(!d) return {state:'NONE'};
  const cs=Array.from(d.querySelectorAll('*')).filter(e=>{
    const c=(e.className&&e.className.baseVal!==undefined)?e.className.baseVal:(e.className||'');
    return typeof c==='string' && /close/i.test(c);
  }).map(e=>{const r=e.getBoundingClientRect();return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2),w:Math.round(r.width)};}).filter(o=>o.w>0);
  return cs.length?{state:'CLOSER',...cs[0]}:{state:'NO_CLOSER'};
})()`;
async function main() {
  const pages = await httpGet('/json/list');
  const list = pages.find((p) => p.type === 'page' && p.url.includes('/orders/appeals/aftersale/order'));
  if (!list) throw new Error('列表页未打开');
  const s = new S(list.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Page.enable');
  for (let i = 0; i < 3; i++) {
    const f = await s.ev(FIND);
    if (f.state === 'NONE') { console.log('CLOSED'); s.close(); return; }
    if (f.state === 'NO_CLOSER') { console.log('NO_CLOSER 弹窗无关闭图标'); s.close(); return; }
    await click(s, f.x, f.y);
    await sleep(900);
  }
  const f2 = await s.ev(FIND);
  console.log(f2.state === 'NONE' ? 'CLOSED' : 'STILL_OPEN');
  s.close();
}
main().catch((e) => { console.log('ERROR=' + e.message); process.exit(1); });
