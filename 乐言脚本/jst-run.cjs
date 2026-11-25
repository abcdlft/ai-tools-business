#!/usr/bin/env node
/**
 * jst-run.cjs —— 聚水潭售后扫描「批量预检 + 快速收货」
 *
 * 提速要点（实测 2026-11-21，本机 360 + CDP 9223）：
 *  1) 「哪单能收」不走界面，直接在页面里调后端接口（单次 197ms，并发后平均 40ms/单）：
 *     POST https://api.erp321.com/erp/webapi/afterSaleApi/scanning/search/v2?owner_co_id=…&authorize_co_id=…
 *     body {"data":{"value":"<单号>","type":"l_id","isPromptMessage":false},"uid":"","coid":""}
 *     返回直接带 售后单号 / 商品明细 / 申请数量。
 *  2) **绝对不要用 CDP 鼠标事件**：本机 360 上一次 Input.dispatchMouseEvent 要 5000ms，是最大的坑。
 *     键盘事件、insertText、JS focus/click 都是 2~20ms。全程只用键盘 + JS。
 *  3) 常驻一个进程内跑完 N 单，避免每次 node 冷启动（约 300ms）+ 重连。
 *
 * 用法（CDP_PORT 默认 9224，360 浏览器；9223 归乐言占用）：
 *   node jst-run.cjs check <单号...>                          # 批量预检
 *   node jst-run.cjs recv <单号> <本次数量> <次品数量> [--dry]  # 收货一单
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

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

async function attach() {
  const list = await httpGet('/json/list');
  const p = list.filter((x) => x.type === 'page').find((x) => (x.url || '').includes('erp321.com'));
  if (!p) throw new Error('没找到聚水潭页面');
  const s = new Sess(p.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Page.enable');
  const tree = await s.send('Page.getFrameTree');
  let fid = null;
  (function walk(n) {
    if (/aftersalescan/i.test(n.frame.url)) fid = n.frame.id;
    (n.childFrames || []).forEach(walk);
  })(tree.frameTree);
  if (!fid) throw new Error('没找到售后扫描帧');
  const w = await s.send('Page.createIsolatedWorld', { frameId: fid, worldName: 'run' });
  return { s, ctx: w.executionContextId };
}

async function ev(s, ctx, expr, awaitPromise = false) {
  const r = await s.send('Runtime.evaluate', { expression: expr, contextId: ctx, returnByValue: true, awaitPromise, userGesture: true });
  if (r.exceptionDetails) throw new Error('JS: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}

async function key(s, k, code, vk, text, mod) {
  const b = { key: k, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk };
  if (mod) b.modifiers = mod;
  await s.send('Input.dispatchKeyEvent', { ...b, type: 'rawKeyDown' });
  if (text) await s.send('Input.dispatchKeyEvent', { ...b, type: 'char', text, unmodifiedText: text });
  await s.send('Input.dispatchKeyEvent', { ...b, type: 'keyUp' });
}

function checkExpr(nos, conc) {
  return `(async()=>{
    const NOS = ${JSON.stringify(nos)};
    const q = new URL(location.href).searchParams;
    const u = 'https://api.erp321.com/erp/webapi/afterSaleApi/scanning/search/v2?owner_co_id='+q.get('owner_co_id')+'&authorize_co_id='+q.get('authorize_co_id');
    const one = async (no) => {
      const t0 = performance.now();
      try {
        const r = await fetch(u, { method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json; charset=utf-8','Accept':'application/json'},
          body: JSON.stringify({data:{value:no,type:'l_id',isPromptMessage:false},uid:'',coid:''}) });
        const j = await r.json();
        const list = (j.data && j.data.list) || [];
        const details = [];
        let qty = 0;
        for (const x of list) for (const g of (x.items||[])) {
          qty += Number(g.qty||0);
          details.push({ asId:x.afterSale.asId, sku:g.skuId, name:(g.name||'').slice(0,16), qty:g.qty });
        }
        return { no, code:j.code, ms:Math.round(performance.now()-t0), qty, n:list.length, details,
                 shop:(list[0]&&list[0].order.shopName)||'', soId:(list[0]&&list[0].order.soId)||'', msg:j.msg||'' };
      } catch(e) { return { no, err:String(e).slice(0,80) }; }
    };
    const out = []; let i = 0;
    const worker = async () => { while (i < NOS.length) { const no = NOS[i++]; out.push(await one(no)); } };
    await Promise.all(Array.from({length:Math.min(${conc}, NOS.length)}, worker));
    return JSON.stringify(out);
  })()`;
}

/** 收货一单：全键盘 + JS 点击 */
async function recv(s, ctx, no, qty, dqty, dry) {
  const t0 = Date.now();
  const marks = [];
  const mk = (k) => marks.push(k + '=' + (Date.now() - t0));

  // 0) 先清场：上一单若没提交，界面会留着旧行，必须先重置，否则会填到旧行上
  const dirty = await ev(s, ctx, `document.querySelectorAll('input.ant-input-number-input').length`);
  if (dirty > 0) {
    await ev(s, ctx, `(function(){const b=[...document.querySelectorAll('button')].find(e=>e.innerText.replace(/\\s/g,'')==='重置');if(b)b.click();return 1;})()`);
    for (let i = 0; i < 25; i++) {
      const n = await ev(s, ctx, `document.querySelectorAll('input.ant-input-number-input').length`);
      if (n === 0) break;
      await sleep(40);
    }
  }
  mk('clean');

  await ev(s, ctx, `(function(){const i=[...document.querySelectorAll('input.ant-input-borderless')][0];i.focus();i.select();return 1;})()`);
  await key(s, 'a', 'KeyA', 65, null, 2);
  await s.send('Input.insertText', { text: no });
  await key(s, 'Enter', 'Enter', 13, '\r');
  mk('typed');

  let nIn = 0;
  for (let i = 0; i < 40; i++) {
    nIn = await ev(s, ctx, `document.querySelectorAll('input.ant-input-number-input').length`);
    if (nIn >= 2) break;
    await sleep(40);
  }
  mk('rows');
  if (nIn < 2) return { ok: false, no, reason: '未出现数量框', rows: 0, marks };

  const info = JSON.parse(await ev(s, ctx, `(function(){
    const ins=[...document.querySelectorAll('input.ant-input-number-input')];
    return JSON.stringify(ins.map((e,i)=>{const r=e.getBoundingClientRect();return {i,x:Math.round(r.left),y:Math.round(r.top),v:e.value,ph:e.placeholder||''};}));
  })()`));

  const main = info.filter((o) => o.ph !== '次品' && o.x >= 1300);
  const dft = info.filter((o) => o.ph === '次品');
  if (!main.length) return { ok: false, no, reason: '没识别到本次数量框', marks };

  const fill = async (o, val) => {
    // 先清空再输入：值相同时 insertText 不触发 onChange，React 状态会停在旧值
    await ev(s, ctx, `(function(){const i=[...document.querySelectorAll('input.ant-input-number-input')][${o.i}];i.focus();i.select();return 1;})()`);
    await key(s, 'a', 'KeyA', 65, null, 2);
    await key(s, 'Backspace', 'Backspace', 8);
    await sleep(40);
    await s.send('Input.insertText', { text: String(val) });
    await sleep(60);
  };
  await fill(main[0], qty);
  if (dft.length) await fill(dft[0], dqty);
  mk('filled');

  const filled = JSON.parse(await ev(s, ctx, `JSON.stringify([...document.querySelectorAll('input.ant-input-number-input')].map(e=>e.value))`));
  const foot = await ev(s, ctx, `(document.body.innerText.match(/本次总退数[:：]\\s*(\\d+)/)||[])[1]||''`);
  if (dry) return { ok: true, dry: true, no, filled, foot, rows: main.length, ms: Date.now() - t0, marks };

  // 提交前硬校验：合计必须等于预期，否则不点（防 React 状态没跟上，提交成 0）
  if (Number(foot) !== Number(qty)) {
    return { ok: false, no, reason: `合计 ${foot} ≠ 预期 ${qty}，未提交`, filled, foot, marks };
  }

  // 提交前先记下屏上已有的 toast（上一单可能还没消失，避免读串）
  const prevToast = await ev(s, ctx, `(function(){const e=document.querySelector('.ant-message-notice-content,.ant-message-custom-content');return e?(e.innerText||'').replace(/\\s+/g,' ').trim():'';})()`);

  const clicked = await ev(s, ctx, `(function(){
    const b=[...document.querySelectorAll('button')].find(e=>e.innerText.replace(/\\s/g,'').indexOf('确认收货')>=0 && !e.disabled);
    if(!b) return 'NO_BTN';
    b.click(); return 'OK';
  })()`);
  mk('clicked');
  if (clicked !== 'OK') return { ok: false, no, reason: '确认收货按钮不可点', filled, marks };

  // toast 有时要 1.5~3s 才出来，窗口给到 5s；只认含本单号的那条
  let toast = '';
  for (let i = 0; i < 100; i++) {
    const t = await ev(s, ctx, `(function(){return [...document.querySelectorAll('.ant-message-notice-content,.ant-message-custom-content')].map(e=>(e.innerText||'').replace(/\\s+/g,' ').trim()).join(' || ');})()`);
    if (t && t.includes(no)) { toast = t; break; }
    if (t && !toast) toast = t;
    await sleep(50);
  }
  mk('toast');
  const ok = toast.includes(no) && /退货成功/.test(toast);
  return { ok, no, toast, filled, foot, rows: main.length, ms: Date.now() - t0, marks };
}

(async () => {
  const cmd = process.argv[2];
  const args = process.argv.slice(3);
  const { s, ctx } = await attach();
  try {
    if (cmd === 'check') {
      const nos = args.flatMap((a) => a.split(/[,\s]+/)).filter(Boolean);
      const t0 = Date.now();
      const arr = JSON.parse(await ev(s, ctx, checkExpr(nos, 6), true));
      const ms = Date.now() - t0;
      arr.sort((a, b) => nos.indexOf(a.no) - nos.indexOf(b.no));
      let hit = 0;
      for (const r of arr) {
        if (r.err) { console.log(`✗ ${r.no}  错误 ${r.err}`); continue; }
        const ok = r.code === 0 && r.n > 0;
        if (ok) hit++;
        console.log(`${ok ? '✔' : '·'} ${r.no}  售后单${r.n}  申请${r.qty}  ${(r.details.map((d) => d.sku + '×' + d.qty).join(' ')) || r.msg.slice(0, 40)}`);
      }
      console.log(`\n共 ${arr.length} 单，命中 ${hit}，耗时 ${ms}ms（平均 ${Math.round(ms / arr.length)}ms/单）`);
      fs.writeFileSync(path.join(require('os').tmpdir(), 'jst-last-check.json'), JSON.stringify(arr, null, 1), 'utf8');
    } else if (cmd === 'run') {
      // run <json文件>  —— 批量收货，一个进程跑完
      const items = JSON.parse(fs.readFileSync(args[0], 'utf8'));
      const dryRun = args.includes('--dry');
      const res = [];
      for (const it of items) {
        const r = await recv(s, ctx, it.no, it.qty, it.dqty, dryRun);
        r.row = it.row; r.sku = it.sku;
        res.push(r);
        console.log(`${r.ok ? (dryRun ? '○' : '✔') : '✗'} ${it.row || ''} ${it.no} ${dryRun ? JSON.stringify(r.filled) + ' foot=' + r.foot : (r.toast || r.reason || '')} (${r.ms}ms)`);
        await sleep(150);
      }
      fs.writeFileSync(path.join(require('os').tmpdir(), 'jst-last-run.json'), JSON.stringify(res, null, 1), 'utf8');
      console.log(`\n完成 ${res.filter((x) => x.ok).length}/${res.length}`);
    } else if (cmd === 'recv') {
      const dry = args.includes('--dry');
      const a = args.filter((x) => x !== '--dry');
      const [no, qty, dqty] = a;
      const r = await recv(s, ctx, no, qty, dqty, dry);
      console.log(JSON.stringify(r));
    } else {
      console.log('用法: check <单号...> | recv <单号> <本次数量> <次品数量> [--dry]');
    }
  } finally { s.close(); }
})().catch((e) => { console.log('ERROR=' + e.message); process.exit(1); });
