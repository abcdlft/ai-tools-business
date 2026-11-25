#!/usr/bin/env node
/**
 * jst-scan.cjs —— 聚水潭「售后扫描」页专用操控器（360 / 任意 Chromium 调试口）
 *
 * 页面结构（实测 2026-11-21）：
 *   www.erp321.com/epaas
 *     └ iframe-556   [60,36,1812,923]  scanningv3.aspx
 *         └ AfterSaleScan [0,0,1812,923]  erp-oms-aftersalescan  ← 真正的 UI
 *
 * 所有坐标都按「AfterSaleScan 帧内 CSS 像素」给，脚本自动加 (60,36) 偏移。
 *
 * 用法（CDP_PORT 默认 9223）：
 *   node jst-scan.cjs probe                     # 列输入框 / 按钮 / 商品行
 *   node jst-scan.cjs fill <单号> [--wait 1500] # 点主查询框 → 全选 → 输入 → 回车
 *   node jst-scan.cjs type <帧内x> <帧内y> <文本> [--enter]
 *   node jst-scan.cjs click <帧内x> <帧内y> [--wait 800]
 *   node jst-scan.cjs js "<表达式>"             # 在 AfterSaleScan 帧执行
 *   node jst-scan.cjs shot <path>
 *   node jst-scan.cjs state                     # 商品行 + toast + 按钮态 快照
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.CDP_HOST || '127.0.0.1';
const PORT = Number(process.env.CDP_PORT || 9224);
const KEYWORD = process.env.JST_KEYWORD || 'erp321.com';
const OFFSET = { x: 60, y: 36 };

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
    this.id = 0; this.pending = new Map();
    this.ws = new WebSocket(url);
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    };
  }
  send(method, params = {}, timeout = 20000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('超时 ' + method)); }, timeout);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

async function attach() {
  const list = await httpGet('/json/list');
  const pages = list.filter((x) => x.type === 'page');
  const p = pages.find((x) => (x.url || '').includes(KEYWORD)) || pages.find((x) => (x.title || '').includes('聚水潭')) || pages[0];
  if (!p) throw new Error('没找到页面 target');
  const s = new Sess(p.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Page.enable');
  await s.send('Runtime.enable').catch(() => {});
  return { s, page: p };
}

/** 找到 AfterSaleScan 帧（名字匹配），返回 frameId */
async function findFrame(s) {
  const tree = await s.send('Page.getFrameTree');
  const hits = [];
  (function walk(n) {
    if (/aftersalescan/i.test(n.frame.url) || /AfterSaleScan/i.test(n.frame.name || '')) hits.push(n.frame);
    (n.childFrames || []).forEach(walk);
  })(tree.frameTree);
  if (!hits.length) throw new Error('没找到售后扫描帧');
  return hits[hits.length - 1];
}

async function frameCtx(s) {
  const f = await findFrame(s);
  const w = await s.send('Page.createIsolatedWorld', { frameId: f.id, worldName: 'jst' });
  return w.executionContextId;
}

async function evalIn(s, ctx, expr, awaitPromise = false) {
  const r = await s.send('Runtime.evaluate', {
    expression: expr, contextId: ctx, returnByValue: true, awaitPromise, userGesture: true,
  });
  if (r.exceptionDetails) throw new Error('JS 异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

async function click(s, x, y, wait = 700) {
  const px = x + OFFSET.x, py = y + OFFSET.y;
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none', clickCount: 0 });
  await sleep(50);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
  await sleep(50);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
  await sleep(wait);
  return `CLICK ${px},${py}`;
}

async function keyPress(s, key) {
  const map = {
    Enter: { code: 'Enter', keyCode: 13, text: '\r' },
    Tab: { code: 'Tab', keyCode: 9, text: '\t' },
    Escape: { code: 'Escape', keyCode: 27 },
    Backspace: { code: 'Backspace', keyCode: 8 },
  };
  const m = map[key];
  if (!m) throw new Error('未支持的按键: ' + key);
  const base = {
    key, code: m.code, windowsVirtualKeyCode: m.keyCode, nativeVirtualKeyCode: m.keyCode,
  };
  await s.send('Input.dispatchKeyEvent', { ...base, type: 'rawKeyDown' });
  if (m.text) await s.send('Input.dispatchKeyEvent', { ...base, type: 'char', text: m.text, unmodifiedText: m.text });
  await s.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  await sleep(120);
}

async function selectAll(s) {
  const base = { key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, nativeVirtualKeyCode: 65, modifiers: 2 };
  await s.send('Input.dispatchKeyEvent', { ...base, type: 'rawKeyDown' });
  await s.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  await sleep(80);
}

async function insertText(s, text) {
  await s.send('Input.insertText', { text });
  await sleep(120);
}

async function shot(s, out, clip) {
  const params = { format: 'png' };
  if (clip) params.clip = { x: clip[0], y: clip[1], width: clip[2], height: clip[3], scale: Number(clip[4] || 1) };
  const r = await s.send('Page.captureScreenshot', params, 60000);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  fs.writeFileSync(out, Buffer.from(r.data, 'base64'));
  const buf = fs.readFileSync(out);
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  return `OUT=${out} ${w}x${h} ${buf.length}B`;
}

const PROBE_JS = `(function(){
  const vis = (e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  const rr = (e)=>{const r=e.getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)];};
  const inputs=[...document.querySelectorAll('input,textarea')].filter(vis).map((e,i)=>({
    i, tag:e.tagName, type:e.type, id:e.id, ph:e.placeholder||'', val:(e.value||'').slice(0,30),
    cls:(e.className||'').toString().slice(0,70), r:rr(e), ro:e.readOnly, dis:e.disabled
  }));
  const btns=[...document.querySelectorAll('button,.ant-btn,[role=button]')].filter(vis).map(e=>({
    t:(e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,24), cls:(e.className||'').toString().slice(0,60), r:rr(e), dis:e.disabled
  })).filter(b=>b.t);
  return JSON.stringify({inputs, btns});
})()`;

const STATE_JS = `(function(){
  const vis = (e)=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0;};
  const rr = (e)=>{const r=e.getBoundingClientRect();return [Math.round(r.left+${OFFSET.x}),Math.round(r.top+${OFFSET.y}),Math.round(r.width),Math.round(r.height)];};
  // toast：Ant message / notification
  const toast=[...document.querySelectorAll('.ant-message-notice-content,.ant-notification-notice-message,.ant-notification-notice-description,.ant-message-custom-content')]
    .filter(vis).map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim());
  // 表格行
  const rows=[...document.querySelectorAll('tbody tr.ant-table-row, .ant-table-tbody > tr')].filter(vis).map(tr=>{
    const cells=[...tr.querySelectorAll('td')].map(td=>{
      const inp=td.querySelector('input');
      return {t:(td.innerText||'').replace(/\\s+/g,' ').trim().slice(0,40), val: inp?inp.value:null,
              r: rr(td), inpR: inp?rr(inp):null};
    });
    return {r:rr(tr), cells};
  });
  // 可见输入框
  const inputs=[...document.querySelectorAll('input')].filter(vis).filter(e=>!['checkbox','search'].includes(e.type)).map(e=>({
    id:e.id, ph:e.placeholder||'', val:e.value, r:rr(e), dis:e.disabled, ro:e.readOnly
  }));
  const btns=[...document.querySelectorAll('button')].filter(vis).map(e=>({
    t:(e.innerText||'').replace(/\\s+/g,' ').trim().slice(0,20), r:rr(e), dis:e.disabled
  })).filter(b=>b.t);
  const bodyH=document.body.innerText.replace(/\\s+/g,' ').slice(0,600);
  return JSON.stringify({toast, rows, inputs, btns, bodyH});
})()`;

(async () => {
  const cmd = process.argv[2];
  const argv = process.argv.slice(3);
  const opt = (name, def) => { const i = argv.indexOf('--' + name); return i >= 0 ? argv[i + 1] : def; };
  const flag = (name) => argv.includes('--' + name);

  const { s, page } = await attach();
  try {
    const ctx = await frameCtx(s);

    if (cmd === 'probe') {
      console.log(JSON.stringify(JSON.parse(await evalIn(s, ctx, PROBE_JS)), null, 1));
    } else if (cmd === 'state') {
      console.log(JSON.stringify(JSON.parse(await evalIn(s, ctx, STATE_JS)), null, 1));
    } else if (cmd === 'js') {
      const r = await evalIn(s, ctx, argv[0]);
      console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
    } else if (cmd === 'jsaw') {
      const r = await evalIn(s, ctx, argv[0], true);
      console.log(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
    } else if (cmd === 'click') {
      console.log(await click(s, Number(argv[0]), Number(argv[1]), Number(opt('wait', 700))));
    } else if (cmd === 'pclick') {
      const px = Number(argv[0]), py = Number(argv[1]);
      await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: px, y: py, button: 'none', clickCount: 0 });
      await sleep(50);
      await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 });
      await sleep(50);
      await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 });
      await sleep(Number(opt('wait', 700)));
      console.log(`PCLICK ${px},${py}`);
    } else if (cmd === 'type') {
      const x = Number(argv[0]), y = Number(argv[1]), text = argv[2];
      console.log(await click(s, x, y, 400));
      if (flag('clear')) { await selectAll(s); }
      await insertText(s, text);
      if (flag('enter')) await keyPress(s, 'Enter');
      await sleep(Number(opt('wait', 500)));
      console.log('TYPED=' + text);
    } else if (cmd === 'fill') {
      const no = argv[0];
      console.log(await click(s, 250, 41, 350));
      await selectAll(s);
      await insertText(s, no);
      await sleep(150);
      await keyPress(s, 'Enter');
      await sleep(Number(opt('wait', 1500)));
      console.log('FILL=' + no);
    } else if (cmd === 'watch') {
      const ms = Number(argv[0] || 3000);
      const seen = new Set();
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        const st = JSON.parse(await evalIn(s, ctx, STATE_JS));
        for (const t of st.toast) if (t && !seen.has(t)) { seen.add(t); console.log('[toast] ' + t); }
        if (st.rows.length && !seen.has('__rows__')) { seen.add('__rows__'); console.log('[rows] ' + st.rows.length); }
        await sleep(250);
      }
      if (!seen.size) console.log('[watch] 无 toast');
    } else if (cmd === 'batch') {
      // 批量只读核对：重置 → 查单 → 读 toast / 商品行
      const list = argv.filter((a) => /^[A-Za-z0-9]{6,}$/.test(a));
      const out = [];
      for (const no of list) {
        await click(s, 263, 88, 500); // 重置（帧内）
        await click(s, 250, 41, 350);
        await selectAll(s);
        await insertText(s, no);
        await sleep(150);
        await keyPress(s, 'Enter');
        const t0 = Date.now();
        const toasts = new Set();
        let rows = [];
        while (Date.now() - t0 < 2600) {
          const st = JSON.parse(await evalIn(s, ctx, STATE_JS));
          st.toast.forEach((t) => t && toasts.add(t));
          if (st.rows.length > rows.length) rows = st.rows;
          if (rows.length && Date.now() - t0 > 1200) break;
          await sleep(250);
        }
        const tArr = [...toasts].map((t) => t.replace(/\(\d+S\)$/, ''));
        const rec = {
          no,
          toast: tArr,
          done: tArr.some((t) => t.includes('已全部商品完成入库')),
          rows: rows.map((r) => r.cells.map((c) => ({ t: c.t, val: c.val, inp: c.inpR }))),
        };
        out.push(rec);
        console.log('### ' + no + ' | rows=' + rows.length + ' | ' + (tArr.join(' / ') || '无提示'));
      }
      fs.writeFileSync(path.join(require('os').tmpdir(), 'jst-batch-check.json'), JSON.stringify(out, null, 1), 'utf8');
      console.log('WROTE ' + path.join(require('os').tmpdir(), 'jst-batch-check.json'));
    } else if (cmd === 'shot') {
      const clip = opt('clip');
      console.log(await shot(s, argv[0], clip ? clip.split(',').map(Number) : null));
    } else {
      console.log('未知命令');
    }
  } finally {
    s.close();
  }
})().catch((e) => { console.log('ERROR=' + e.message); process.exit(1); });
