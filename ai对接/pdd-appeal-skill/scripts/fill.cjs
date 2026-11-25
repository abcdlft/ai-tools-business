#!/usr/bin/env node
/**
 * fill.cjs —— 在「维权申诉」弹窗里填一单运费申诉（默认不提交）
 *
 * 用法：
 *   node fill.cjs "<订单号>" <金额> "<描述文本>" [--shot out.png] [--submit]
 *
 * 固定路径：申诉原因 = 退货运费 / 消费者无理由退货，退货运费不应商家承担
 * 填完会回读表单值并打印，--submit 才会点提交（默认不点）。
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
  await sleep(50);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(50);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(200);
}

const CENTER = (sel, extra = '') => `(function(){
  const d=document.querySelector('[class*="MDL_outerWrapper"]');
  if(!d) return null;
  const el=${sel};
  if(!el) return null;
  ${extra}
  el.scrollIntoView({block:'center'});
  const r=el.getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
})()`;

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
  li.scrollIntoView({block:'center'});
  const r=li.getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
})()`;

const READ_FORM = `(function(){
  const d=document.querySelector('[class*="MDL_outerWrapper"]');
  if(!d) return null;
  const t=d.innerText;
  const m=t.match(/最多可申诉\\s*\\n?\\s*([\\d.]+)/);
  const inputs=Array.from(d.querySelectorAll('input')).map(i=>({ph:i.placeholder,v:i.value}));
  const tas=Array.from(d.querySelectorAll('textarea')).map(x=>x.value);
  const item=(t.match(/申诉项\\s*\\n([^\\n]+)/)||[])[1]||'';
  const submit=(function(){
    const b=Array.from(d.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='\\u63d0\\u4ea4\\u7533\\u8bc9');
    if(!b) return null; const r=b.getBoundingClientRect();
    return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
  })();
  const cancel=(function(){
    const b=Array.from(d.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='\\u53d6\\u6d88');
    if(!b) return null; const r=b.getBoundingClientRect();
    return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
  })();
  return {max:m?m[1]:'', inputs, textareas:tas, item:item.trim(), text:t.replace(/\\n+/g,' | '), submit, cancel};
})()`;

const HAS_DLG = `!!document.querySelector('[class*="MDL_outerWrapper"]')`;

const CLICK_ITEM = (txt) => `(function(){
  const t=${JSON.stringify(txt)};
  const els=Array.from(document.querySelectorAll('[class*="CSD_menuItem"]')).filter(e=>(e.innerText||'').trim()===t);
  const e=els[els.length-1];
  if(!e) return null;
  const r=e.getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
})()`;

async function typeInto(s, sel, text) {
  const pos = await s.ev(CENTER(sel));
  if (!pos) throw new Error('找不到输入框: ' + sel);
  await click(s, pos.x, pos.y);
  await sleep(200);
  await s.ev(`(function(){const d=document.querySelector('[class*="MDL_outerWrapper"]');const el=${sel};if(el){el.focus();el.select&&el.select();}return 1})()`);
  await sleep(100);
  await s.send('Input.insertText', { text });
  await sleep(300);
}

async function main() {
  const args = process.argv.slice(2);
  let sn, amount, desc, shotPath = null, doSubmit = args.includes('--submit'), taskEvidence = [];

  if (args[0] === '--task') {
    const task = JSON.parse(fs.readFileSync(args[1], 'utf8'));
    sn = task.order; amount = String(task.amount); desc = task.desc;
    shotPath = task.shot || null;
    taskEvidence = task.evidence || [];
    if (task.submit === true) doSubmit = true;
  } else {
    sn = args[0]; amount = args[1]; desc = args[2];
    const shotIdx = args.indexOf('--shot');
    shotPath = shotIdx > -1 ? args[shotIdx + 1] : null;
  }
  if (!sn || !amount || !desc) { console.log('用法: node fill.cjs --task task.json  或  node fill.cjs "<订单号>" <金额> "<描述>"'); process.exit(2); }

  const pages = await httpGet('/json/list');
  const list = pages.find((p) => p.type === 'page' && p.url.includes('/orders/appeals/aftersale/order'));
  if (!list) throw new Error('列表页未打开');
  const s = new S(list.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Page.enable');

  if (await s.ev(HAS_DLG)) {
    const d = await s.ev(READ_FORM);
    if (d && d.cancel) await click(s, d.cancel.x, d.cancel.y);
    await sleep(500);
  }

  // 关掉右侧「消息」面板：它会盖住操作列和分页，导致点击落空
  for (let i = 0; i < 2; i++) {
    const mc = await s.ev(`(function(){
      const e=Array.from(document.querySelectorAll('*')).find(x=>{
        const c=(x.className&&x.className.baseVal!==undefined)?x.className.baseVal:(x.className||'');
        return typeof c==='string' && /(ImportantList_close|MessageBox_close|msg.*_close)/i.test(c);
      });
      if(!e) return null;
      const r=e.getBoundingClientRect();
      if(r.width===0) return null;
      return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
    })()`);
    if (!mc) break;
    await click(s, mc.x, mc.y);
    await sleep(700);
  }

  // 打开弹窗
  let pos = await s.ev(FIND_ROW(sn));
  if (!pos) {
    for (const pg of [1, 2, 3]) {
      const t = await s.ev(FIND_PAGE(pg));
      if (!t) continue;
      await click(s, t.x, t.y);
      // 翻页后轮询等渲染，最多 4 秒
      for (let k = 0; k < 8; k++) {
        await sleep(500);
        pos = await s.ev(FIND_ROW(sn));
        if (pos) break;
      }
      if (pos) break;
    }
  }
  if (!pos) throw new Error('列表找不到该订单: ' + sn);
  await click(s, pos.x, pos.y);

  let form = null;
  for (let i = 0; i < 25; i++) {
    await sleep(300);
    form = await s.ev(READ_FORM);
    if (form) break;
  }
  if (!form) throw new Error('弹窗没出来');

  // 双申诉项订单（货款 + 运费）：只保留运费，取消货款勾选
  const cbs = await s.ev(`(function(){
    const d=document.querySelector('[class*="MDL_outerWrapper"]');
    if(!d) return null;
    return Array.from(d.querySelectorAll('input[type=checkbox]')).map((c,i)=>{
      const r=c.getBoundingClientRect();
      return {i, checked:c.checked, x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
    });
  })()`);
  if (cbs && cbs.length === 2 && cbs[0].checked && cbs[1].checked) {
    await click(s, cbs[0].x, cbs[0].y);   // 取消「货款申诉」
    await sleep(900);
    form = await s.ev(READ_FORM);
    console.log('DUAL_ITEM 已取消货款勾选，仅保留运费');
  }
  console.log('OPEN item=' + form.item + ' max=' + form.max +
    (cbs && cbs.length ? ' checkbox=' + JSON.stringify(cbs.map((c) => c.checked)) : ''));

  // 申诉项校验：双项订单看复选框状态，单项订单看文本
  if (cbs && cbs.length === 2) {
    const now = await s.ev(`(function(){
      const d=document.querySelector('[class*="MDL_outerWrapper"]');
      return Array.from(d.querySelectorAll('input[type=checkbox]')).map(c=>c.checked);
    })()`);
    if (!now[1]) throw new Error('运费申诉没有勾选：' + JSON.stringify(now));
    if (now[0]) throw new Error('货款申诉没有取消：' + JSON.stringify(now));
  } else if (form.item && !form.item.includes('运费')) {
    throw new Error('申诉项不是运费申诉：' + form.item);
  }
  console.log('OPEN item=' + form.item + ' max=' + form.max);
  if (form.max && Number(amount) > Number(form.max) + 1e-9) {
    throw new Error('金额超上限：填 ' + amount + '，上限 ' + form.max);
  }

  // 1. 申诉原因：一级 退货运费
  const reasonSel = `Array.from(d.querySelectorAll('input')).find(i=>i.placeholder&&i.placeholder.includes('\\u8bf7\\u9009\\u62e9'))`;
  let p = await s.ev(CENTER(reasonSel));
  if (!p) throw new Error('找不到申诉原因输入框');
  await click(s, p.x, p.y);
  await sleep(900);

  let l1 = await s.ev(CLICK_ITEM('退货运费'));
  if (!l1) throw new Error('一级选项「退货运费」没出现');
  await click(s, l1.x, l1.y + 0);   // 点击一级只展开，不选中
  await sleep(900);

  let l2 = await s.ev(CLICK_ITEM('消费者无理由退货，退货运费不应商家承担'));
  if (!l2) throw new Error('二级选项没出现');
  await click(s, l2.x, l2.y);
  await sleep(700);

  // 2. 申诉金额
  const amtSel = `Array.from(d.querySelectorAll('input')).find(i=>i.placeholder&&i.placeholder.includes('\\u8bf7\\u8f93\\u5165'))`;
  await typeInto(s, amtSel, String(amount));

  // 3. 申诉描述
  const descSel = `(d.querySelector('textarea')||Array.from(d.querySelectorAll('[contenteditable="true"]'))[0])`;
  await typeInto(s, descSel, String(desc));

  // 4. 必填凭证（≤3 张）
  const evidence = (taskEvidence || []).filter((f) => fs.existsSync(f));
  if (evidence.length) {
    await s.send('DOM.enable');
    const doc = await s.send('DOM.getDocument', { depth: 0 });
    const q = await s.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    if (!q.nodeId) throw new Error('页面上找不到图片上传框');
    await s.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files: evidence.slice(0, 3) });
    await sleep(2500);
    console.log('EVIDENCE 已上传 ' + Math.min(evidence.length, 3) + ' 张');
  }

  await sleep(500);
  const after = await s.ev(READ_FORM);
  console.log('--- 回读 ---');
  console.log('申诉项=' + after.item + ' | 上限=' + after.max);
  console.log('原因=' + JSON.stringify((after.inputs.find((i) => i.ph && i.ph.includes('请选择')) || {}).v));
  console.log('金额=' + JSON.stringify((after.inputs.find((i) => i.ph && i.ph.includes('请输入')) || {}).v));
  console.log('描述=' + JSON.stringify(after.textareas));
  console.log('描述长度=' + (after.textareas[0] || '').length + ' / 期望 ' + String(desc).length);
  console.log('凭证计数=' + JSON.stringify((after.text.match(/\(\d+\/\d+\)/g) || [])));

  if (shotPath) {
    const r = await s.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(path.resolve(shotPath)), { recursive: true });
    fs.writeFileSync(shotPath, Buffer.from(r.data, 'base64'));
    console.log('SHOT=' + shotPath);
  }

  if (doSubmit) {
    if (!after.submit) throw new Error('找不到提交按钮');
    await click(s, after.submit.x, after.submit.y);
    await sleep(2500);
    const txt = await s.ev('document.body.innerText');
    const ok = /提交成功|申诉成功|已提交/.test(txt);
    console.log('SUBMIT=' + (ok ? 'SUCCESS' : 'UNKNOWN'));
    if (!ok) console.log('BODY_TAIL=' + txt.slice(0, 400).replace(/\n+/g, ' | '));
  } else {
    console.log('FILLED_ONLY 未提交');
  }
  s.close();
}
main().catch((e) => { console.log('ERROR=' + e.message); process.exit(1); });
