#!/usr/bin/env node
/**
 * submit.cjs —— 点击当前弹窗的「提交申诉」，判定结果并截图
 *
 * 用法：node submit.cjs [--shot out.png]
 * 输出：SUBMIT=SUCCESS / UNKNOWN / FAILED，附页面提示原文
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
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
  await sleep(60);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(200);
}

const BTN = `(function(){
  const d=document.querySelector('[class*="MDL_outerWrapper"]');
  if(!d) return {err:'NO_DLG'};
  const b=Array.from(d.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='\\u63d0\\u4ea4\\u7533\\u8bc9');
  if(!b) return {err:'NO_SUBMIT_BTN'};
  const r=b.getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2), disabled: !!b.disabled};
})()`;

async function main() {
  const args = process.argv.slice(2);
  const si = args.indexOf('--shot');
  const shot = si > -1 ? args[si + 1] : null;

  const pages = await httpGet('/json/list');
  const list = pages.find((p) => p.type === 'page' && p.url.includes('/orders/appeals/aftersale/order'));
  if (!list) throw new Error('列表页未打开');
  const s = new S(list.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Page.enable');

  const b = await s.ev(BTN);
  if (!b || b.err) throw new Error('找不到提交按钮：' + JSON.stringify(b));
  if (b.disabled) { console.log('SUBMIT=BLOCKED 按钮处于禁用状态'); process.exit(3); }

  await click(s, b.x, b.y);

  let verdict = 'UNKNOWN', evidence = '';
  for (let i = 0; i < 20; i++) {
    await sleep(300);
    const st = await s.ev(`(function(){
      const d=document.querySelector('[class*="MDL_outerWrapper"]');
      const t=document.body.innerText||'';
      const toastEl=document.querySelector('[class*="toast"],[class*="Toast"],[class*="MSG_"]');
      return {dlg: !!d, toast: toastEl?(toastEl.innerText||'').trim():'', body: t, ok: /\\u7533\\u8bc9\\u63d0\\u4ea4\\u6210\\u529f|\\u63d0\\u4ea4\\u6210\\u529f/.test(t)};
    })()`);
    if (st.ok) { verdict = 'SUCCESS'; evidence = '页面出现「申诉提交成功」'; break; }
    if (st.toast && /成功/.test(st.toast)) { verdict = 'SUCCESS'; evidence = st.toast; break; }
    if (!st.dlg) { verdict = 'SUCCESS'; evidence = '弹窗已关闭'; break; }
    if (/提交失败|请填写|请选择|不能为空|超过/.test(st.toast)) { verdict = 'FAILED'; evidence = st.toast; break; }
  }

  if (shot) {
    const r = await s.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(path.resolve(shot)), { recursive: true });
    fs.writeFileSync(shot, Buffer.from(r.data, 'base64'));
    console.log('SHOT=' + shot);
  }
  console.log('SUBMIT=' + verdict);
  console.log('EVIDENCE=' + evidence.replace(/\n+/g, ' | ').slice(0, 300));
  s.close();
}
main().catch((e) => { console.log('ERROR=' + e.message); process.exit(1); });
