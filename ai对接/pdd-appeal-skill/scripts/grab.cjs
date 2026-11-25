#!/usr/bin/env node
/**
 * grab.cjs —— 批量取证：列表页逐单点「售后详情」，抓正文 + 整页截图，然后关页
 *
 * 用法：
 *   node grab.cjs <输出目录> <订单号1> [订单号2 ...]
 *   node grab.cjs <输出目录> --file orders.txt
 *
 * 每单产出：
 *   <输出目录>/<订单号>.txt   详情页 innerText
 *   <输出目录>/<订单号>.png   整页截图
 * 汇总写到 <输出目录>/_summary.json
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = '127.0.0.1';
const PORT = Number(process.env.CDP_PORT || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function httpGet(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path: p }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch { resolve(b); } });
    }).on('error', reject);
  });
}

class Session {
  constructor(wsUrl) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = () => res();
      this.ws.onerror = () => rej(new Error('WebSocket 连接失败'));
    });
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        if (m.error) reject(new Error(m.error.message));
        else resolve(m.result);
      }
    };
  }
  send(method, params = {}, timeout = 45000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时 ' + method)); }, timeout);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  async ev(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, userGesture: true });
    if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    return r.result && r.result.value;
  }
  close() { try { this.ws.close(); } catch {} }
}

async function clickAt(s, x, y) {
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await sleep(50);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(50);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

const ROW_JS = (sn) => `(function(){
  const trs = Array.from(document.querySelectorAll('tr'));
  const hit = trs.find(tr => tr.innerText.indexOf(${JSON.stringify(sn)}) >= 0);
  if (!hit) return {ok:false, why:'ROW_NOT_FOUND'};
  const btn = Array.from(hit.querySelectorAll('a')).find(a => (a.innerText||'').trim() === '售后详情');
  if (!btn) return {ok:false, why:'NO_DETAIL_BTN'};
  btn.scrollIntoView({block:'center'});
  const r = btn.getBoundingClientRect();
  return {ok:true, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
})()`;

const PAGE_JS = (n) => `(function(){
  const ul = document.querySelector('[data-testid="beast-core-pagination"]');
  if (!ul) return {ok:false, why:'NO_PAGINATION'};
  const li = Array.from(ul.children).find(x => (x.innerText||'').trim() === ${JSON.stringify(String(n))});
  if (!li) return {ok:false, why:'NO_PAGE_'+${JSON.stringify(String(n))}};
  const r = li.getBoundingClientRect();
  return {ok:true, x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2)};
})()`;

const HEADERS = (typeof document !== 'undefined') ? null : null;

async function main() {
  const outDir = process.argv[2];
  if (!outDir) { console.log('用法: node grab.cjs <输出目录> <订单号...>'); process.exit(2); }
  let orders = process.argv.slice(3);
  if (orders[0] === '--file') {
    orders = fs.readFileSync(orders[1], 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  }
  fs.mkdirSync(outDir, { recursive: true });

  // 清掉遗留的详情页标签
  let pages = await httpGet('/json/list');
  for (const p of pages) {
    if (p.type === 'page' && p.url.includes('aftersales-ssr/detail')) {
      await httpGet('/json/close/' + p.id);
      console.log('closed stale detail tab');
    }
  }

  pages = await httpGet('/json/list');
  const listPage = pages.find((p) => p.type === 'page' && p.url.includes('/orders/appeals/aftersale/order'));
  if (!listPage) throw new Error('找不到申诉列表页，请确认列表页已打开');

  const s = new Session(listPage.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Page.enable');

  const summary = [];

  for (const sn of orders) {
    const rec = { order: sn, ok: false };
    try {
      // 1. 找行；找不到就翻页
      let pos = await s.ev(ROW_JS(sn));
      if (!pos.ok) {
        for (const pg of [1, 2, 3]) {
          const t = await s.ev(PAGE_JS(pg));
          if (!t.ok) continue;
          await clickAt(s, t.x, t.y);
          await sleep(1800);
          pos = await s.ev(ROW_JS(sn));
          if (pos.ok) break;
        }
      }
      if (!pos.ok) { rec.why = pos.why; summary.push(rec); console.log(sn + ' :: ' + pos.why); continue; }

      // 2. 记下已有 detail 标签 id
      const before = new Set((await httpGet('/json/list')).map((p) => p.id));

      // 3. 点售后详情
      await clickAt(s, pos.x, pos.y);

      // 4. 等新标签
      let detail = null;
      for (let i = 0; i < 40; i++) {
        await sleep(400);
        const now = await httpGet('/json/list');
        detail = now.find((p) => p.type === 'page' && p.url.includes('aftersales-ssr/detail') && !before.has(p.id));
        if (detail) break;
      }
      if (!detail) { rec.why = 'NO_DETAIL_TAB'; summary.push(rec); console.log(sn + ' :: NO_DETAIL_TAB'); continue; }

      // 5. 读正文（等聊天区也加载完：不能出现“加载中”，且文本连续稳定）
      const s2 = new Session(detail.webSocketDebuggerUrl);
      await s2.ready;
      await s2.send('Page.enable');
      let txt = '', prev = '', stab = 0;
      for (let i = 0; i < 70; i++) {
        await sleep(400);
        try { await s2.ev('(function(){const s=document.scrollingElement||document.documentElement;s.scrollTop=s.scrollHeight;return 1})()'); } catch {}
        try { txt = await s2.ev('document.body ? document.body.innerText : ""') || ''; } catch { txt = ''; }
        const ready = txt.includes('售后编码') && !txt.includes('加载中');
        if (ready) {
          if (txt === prev) { stab++; if (stab >= 3) break; } else { stab = 0; }
        }
        prev = txt;
      }
      fs.writeFileSync(path.join(outDir, sn + '.txt'), txt, 'utf8');
      rec.bytes = txt.length;
      rec.hasCode = txt.includes('售后编码');

      // 6. 抓关键字段
      const pick = (label) => {
        const i = txt.indexOf(label);
        if (i < 0) return '';
        const lines = txt.slice(i + label.length).split('\n').slice(0, 4);
        for (const line of lines) {
          const t = line.trim();
          if (t) return t.slice(0, 40);
        }
        return '';
      };
      rec.aftersaleId = (detail.url.match(/id=(\d+)/) || [])[1] || '';
      rec.type = pick('售后类型：');
      rec.applyReason = pick('申请原因：');
      rec.freight = pick('退货包运费：');
      rec.status = pick('售后状态');
      const m = txt.match(/已补偿运费金额([\d.]+)元/);
      rec.freightAmt = m ? m[1] : '';
      const paid = txt.match(/实收：¥([\d.]+)/);
      rec.paid = paid ? paid[1] : '';
      const cd = txt.match(/(\d+)\s*天\s*(\d+)\s*:\s*(\d+)\s*:\s*(\d+)/);
      rec.countdown = cd ? cd[1] + '天' + cd[2] + ':' + cd[3] : '';

      // 7. 整页截图
      try {
        const met = await s2.send('Page.getLayoutMetrics');
        const cs = met.cssContentSize || met.contentSize;
        const shot = await s2.send('Page.captureScreenshot', {
          format: 'png',
          clip: { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.min(Math.ceil(cs.height), 4000), scale: 1 },
          captureBeyondViewport: true,
        }, 60000);
        fs.writeFileSync(path.join(outDir, sn + '.png'), Buffer.from(shot.data, 'base64'));
        rec.shot = true;
      } catch (e) { rec.shot = false; }

      s2.close();
      await httpGet('/json/close/' + detail.id);
      rec.ok = true;
    } catch (e) {
      rec.why = e.message;
    }
    summary.push(rec);
    console.log(sn + ' :: ' + (rec.ok ? 'OK ' + rec.type + ' / ' + rec.applyReason + ' / ' + rec.freight + ' / 退' + rec.freightAmt : 'FAIL ' + rec.why));
    await sleep(600);
  }

  fs.writeFileSync(path.join(outDir, '_summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log('\nDONE ' + summary.filter((r) => r.ok).length + '/' + summary.length + ' -> ' + path.resolve(outDir));
  s.close();
}

main().catch((e) => { console.log('ERROR=' + e.message); process.exit(1); });
