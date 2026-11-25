#!/usr/bin/env node
/**
 * probe.cjs —— 逐个订单打开「发起申诉」弹窗，读「最多可申诉」金额与表单字段，然后取消
 *
 * 用法：node probe.cjs <订单号...>
 * 输出：每行 `订单号 :: 最多可申诉=xx 元 | 申诉项=运费申诉 | 原因默认=空`
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
    this.ready = new Promise((a, b) => { this.ws.onopen = a; this.ws.onerror = () => b(new Error('ws fail')); });
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result);
      }
    };
  }
  send(method, params = {}, t = 30000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { this.pending.delete(id); rej(new Error('to ' + method)); }, t);
      this.pending.set(id, { resolve: (v) => { clearTimeout(tm); res(v); }, reject: (e) => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(e) {
    const r = await this.send('Runtime.evaluate', { expression: e, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('JS ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
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
  await sleep(150);
}

const FIND_ROW = (sn) => `(function(){
  const tr=Array.from(document.querySelectorAll('tr')).find(t=>t.innerText.includes(${JSON.stringify(sn)}));
  if(!tr) return null;
  const b=tr.querySelector('button[data-testid="beast-core-button"]');
  if(!b) return null;
  b.scrollIntoView({block:'center'});
  const r=b.getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
})()`;

const FIND_PAGE = (n) => `(function(){
  const ul=document.querySelector('[data-testid="beast-core-pagination"]');
  if(!ul) return null;
  const li=Array.from(ul.children).find(x=>(x.innerText||'').trim()===${JSON.stringify(String(n))});
  if(!li) return null;
  const r=li.getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
})()`;

const READ_DLG = `(function(){
  const d=document.querySelector('[class*="MDL_outerWrapper"]');
  if(!d) return null;
  const t=d.innerText;
  const m=t.match(/最多可申诉\\s*\\n?\\s*([\\d.]+)/);
  const inp=Array.from(d.querySelectorAll('input')).map(i=>({ph:i.placeholder,v:i.value}));
  return {
    text:t.replace(/\\n+/g,' | '),
    max:m?m[1]:'',
    inputs:inp,
    cancel:(function(){
      const b=Array.from(d.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='\\u53d6\\u6d88');
      if(!b) return null;
      const r=b.getBoundingClientRect();
      return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
    })()
  };
})()`;

const HAS_DLG = `!!document.querySelector('[class*="MDL_outerWrapper"]')`;

async function main() {
  const orders = process.argv.slice(2);
  if (!orders.length) { console.log('用法: node probe.cjs <订单号...>'); process.exit(2); }
  const pages = await httpGet('/json/list');
  const list = pages.find((p) => p.type === 'page' && p.url.includes('/orders/appeals/aftersale/order'));
  if (!list) throw new Error('列表页未打开');
  const s = new S(list.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Page.enable');

  for (const sn of orders) {
    // 关掉可能残留的弹窗
    if (await s.ev(HAS_DLG)) {
      const d = await s.ev(READ_DLG);
      if (d && d.cancel) await click(s, d.cancel.x, d.cancel.y);
      await sleep(500);
    }
    let pos = await s.ev(FIND_ROW(sn));
    if (!pos && (await s.ev(HAS_DLG)) === false) {
      for (const pg of [1, 2, 3]) {
        const t = await s.ev(FIND_PAGE(pg));
        if (!t) continue;
        await click(s, t.x, t.y);
        await sleep(1800);
        pos = await s.ev(FIND_ROW(sn));
        if (pos) break;
      }
    }
    if (!pos) { console.log(sn + ' :: ROW_NOT_FOUND'); continue; }

    await click(s, pos.x, pos.y);
    let d = null;
    for (let i = 0; i < 25; i++) {
      await sleep(300);
      d = await s.ev(READ_DLG);
      if (d) break;
    }
    if (!d) { console.log(sn + ' :: NO_DIALOG'); continue; }

    const item = (d.text.match(/\u7533\u8bc9\u9879\s*\|\s*([^|]+)/) || [])[1] || '';
    const reasonVal = d.inputs.find((i) => i.ph && i.ph.includes('\u8bf7\u9009'))?.v || '';
    console.log(sn + ' :: \u6700\u591a\u53ef\u7533\u8bc9=' + d.max + ' \u5143 | \u7533\u8bc9\u9879=' + item.trim() + ' | \u539f\u56e0\u9ed8\u8ba4=' + (reasonVal || '\u7a7a'));

    if (d.cancel) { await click(s, d.cancel.x, d.cancel.y); await sleep(600); }
  }
  s.close();
}
main().catch((e) => { console.log('ERROR=' + e.message); process.exit(1); });
