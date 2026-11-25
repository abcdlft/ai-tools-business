#!/usr/bin/env node
/**
 * reasons.cjs —— 批量读取「申诉记录」里每单的审核结论与驳回理由
 *
 * 用法： node reasons.cjs <outDir> <订单号...>
 *
 * 做法：在申诉记录页点每行的「详情」→ 新标签页 → 读 innerText → 关掉标签页。
 * 全程读文本，不截图。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.CDP_PORT || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function req(method, p) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: HOST, port: PORT, path: p, method }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
    });
    r.on('error', reject);
    r.end();
  });
}
const list = () => req('GET', '/json/list');

class Session {
  constructor(wsUrl) {
    this.id = 0; this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('ws fail'));
    });
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message)); else resolve(m.result);
      }
    };
  }
  send(method, params = {}, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout ' + method)); }, timeout);
      this.pending.set(id, { resolve: (v) => { clearTimeout(t); resolve(v); }, reject: (e) => { clearTimeout(t); reject(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' :: ' + (r.result && r.result.description || '').slice(0, 300));
    return r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

const FIND_DETAIL = (sn) => `(function(){
  const sn=${JSON.stringify(sn)};
  const tr=Array.from(document.querySelectorAll('tr')).find(t=>t.innerText.includes(sn));
  if(!tr) return null;
  const a=Array.from(tr.querySelectorAll('a')).find(x=>(x.innerText||'').trim()==='\u8be6\u60c5');
  if(!a) return null;
  a.scrollIntoView({block:'center'});
  const r=a.getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
})()`;

const READ_DETAIL = `(function(){
  const t=(document.body?document.body.innerText:'').replace(/\\u00a0/g,' ').replace(/\\n{2,}/g,'\\n');
  return t;
})()`;

function parse(txt) {
  const out = {};
  const grab = (label, nextLabels) => {
    const i = txt.indexOf(label);
    if (i < 0) return '';
    let seg = txt.slice(i + label.length);
    seg = seg.replace(/^\n/, '');
    for (const n of nextLabels) {
      const j = seg.indexOf('\n' + n);
      if (j > 0) seg = seg.slice(0, j);
    }
    return seg.split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
  };
  const verdict = (txt.match(/申诉(失败|成功)/) || [])[1] || '';
  out.verdict = verdict;
  // 驳回理由：位于「申诉失败/申诉成功」之后、「您对本次」之前
  const v = txt.indexOf('申诉' + verdict);
  if (v >= 0) {
    let seg = txt.slice(v + 4);
    const end = seg.indexOf('您对本次');
    if (end > 0) seg = seg.slice(0, end);
    seg = seg.split('\n').map((s) => s.trim()).filter(Boolean).join(' ');
    // 去掉页面重复片段
    out.reason = seg.slice(0, 400);
  }
  const labels = ['申诉订单号', '申诉类型', '申诉时间', '申诉项', '申诉原因', '申诉金额', '申诉描述', '申诉凭证'];
  for (let i = 0; i < labels.length; i++) {
    out[labels[i]] = grab(labels[i], labels.slice(i + 1));
  }
  return out;
}

async function main() {
  const args = process.argv.slice(2);
  const outDir = args[0];
  const orders = args.slice(1);
  if (!outDir || !orders.length) { console.log('用法: node reasons.cjs <outDir> <订单号...>'); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });

  const pages = await list();
  const listPage = pages.find((p) => p.type === 'page' && /aftersale\/list/.test(p.url));
  if (!listPage) throw new Error('找不到申诉记录列表页，请先切到「申诉记录」页签');
  const ls = new Session(listPage.webSocketDebuggerUrl);
  await ls.ready;
  await ls.send('Page.enable').catch(() => {});

  const results = [];
  for (const sn of orders) {
    console.log('\n===== ' + sn);
    let pos = await ls.ev(FIND_DETAIL(sn));
    for (let k = 0; k < 2 && !pos; k++) {
      // 翻页找
      const pg = await ls.ev(`(function(){
        const ul=document.querySelector('[data-testid="beast-core-pagination"]');
        if(!ul) return null;
        for(const li of Array.from(ul.children)){
          const n=(li.innerText||'').trim();
          if(/^[1-9]$/.test(n)){
            const r=li.getBoundingClientRect();
            if(r.y>0 && r.y<window.innerHeight){ return {n:Number(n),x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)}; }
          }
        }
        return null;
      })()`);
      if (!pg) break;
      await ls.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pg.x, y: pg.y, button: 'left', clickCount: 1 });
      await ls.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pg.x, y: pg.y, button: 'left', clickCount: 1 });
      await sleep(2500);
      pos = await ls.ev(FIND_DETAIL(sn));
    }
    if (!pos) { console.log('ROW_NOT_FOUND'); results.push({ sn, error: 'ROW_NOT_FOUND' }); continue; }

    const before = new Set((await list()).filter((p) => p.type === 'page').map((p) => p.id));
    await ls.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });
    await ls.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pos.x, y: pos.y, button: 'left', clickCount: 1 });

    let detail = null;
    for (let i = 0; i < 30; i++) {
      await sleep(500);
      const ps = (await list()).filter((p) => p.type === 'page' && /aftersale\/detail/.test(p.url) && !before.has(p.id));
      if (ps.length) { detail = ps[0]; break; }
    }
    if (!detail) { console.log('DETAIL_NOT_OPEN'); results.push({ sn, error: 'DETAIL_NOT_OPEN' }); continue; }

    const ds = new Session(detail.webSocketDebuggerUrl);
    await ds.ready;
    await ds.send('Page.enable').catch(() => {});
    let txt = '';
    for (let i = 0; i < 40; i++) {
      await sleep(400);
      try { txt = await ds.ev(READ_DETAIL) || ''; } catch { txt = ''; }
      if (txt.includes('申诉描述') && /申诉(失败|成功)/.test(txt)) break;
    }
    ds.close();
    await req('GET', '/json/close/' + detail.id);

    fs.writeFileSync(path.join(outDir, sn + '.detail.txt'), txt, 'utf8');
    const info = parse(txt);
    info.sn = sn;
    console.log('VERDICT=' + info.verdict);
    console.log('REASON=' + (info.reason || '').slice(0, 200));
    console.log('原因=' + info['申诉原因'] + ' | 金额=' + info['申诉金额']);
    results.push(info);
    await sleep(600);
  }
  ls.close();
  fs.writeFileSync(path.join(outDir, '_reasons.json'), JSON.stringify(results, null, 2), 'utf8');
  console.log('\nSAVED=' + path.join(outDir, '_reasons.json'));
}
main().catch((e) => { console.error('FATAL: ' + e.message); process.exit(1); });
