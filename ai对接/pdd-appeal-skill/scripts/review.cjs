#!/usr/bin/env node
/**
 * review.cjs —— 在「申诉记录」页对失败订单发起复议并填表（默认不提交）
 *
 * 用法： node review.cjs --task task.json
 *        task.json: { order, amount, reason2?, desc, submit? }
 *
 * 复议弹窗字段：复议原因（两级级联，必选）/ 复议金额（必填，有上限）/ 复议描述（必填，200 字）
 * 实测该弹窗**没有凭证上传区**，全靠文字论证。
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

async function move(s, x, y) {
  await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
  await sleep(120);
}
async function click(s, x, y) {
  await move(s, x, y);
  await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await sleep(60);
  await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
  await sleep(250);
}

const MODAL = `document.querySelector('[class*="MDL_inner"]')`;
const HAS_MODAL = `!!${MODAL}`;

const READ = `(function(){
  const m=${MODAL};
  if(!m) return null;
  const t=m.innerText;
  const max=(t.match(/\u6700\u591a\u53ef\u7533[\u8bf7\u8bc9][^\d]{0,12}([\d.]+)/)||[])[1]||'';
  const inputs=Array.from(m.querySelectorAll('input')).map(i=>({ph:i.placeholder,v:i.value}));
  const tas=Array.from(m.querySelectorAll('textarea')).map(x=>x.value);
  const btn=(name)=>{const b=Array.from(m.querySelectorAll('button')).find(x=>(x.innerText||'').trim()===name);if(!b)return null;const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};};
  return {
    max, inputs, textareas:tas,
    files: m.querySelectorAll('input[type=file]').length,
    fileInfo: Array.from(m.querySelectorAll('input[type=file]')).map((f,i)=>{const r=f.getBoundingClientRect();return i+':'+(f.accept||'-')+':y'+Math.round(r.y);}).join(' '),
    submit: btn('\u63d0\u4ea4\u7533\u8bc9'),
    cancel: btn('\u53d6\u6d88'),
    text: t.replace(/\\n+/g,' | ')
  };
})()`;

const FIND_ROW = (sn) => `(function(){
  const tr=Array.from(document.querySelectorAll('tr')).find(t=>t.innerText.includes(${JSON.stringify(sn)}));
  if(!tr) return null;
  const a=Array.from(tr.querySelectorAll('a')).find(x=>(x.innerText||'').trim()==='\u53d1\u8d77\u590d\u8bae');
  if(!a) return null;
  a.scrollIntoView({block:'center'});
  const r=a.getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
})()`;

const CENTER = (sel) => `(function(){
  const m=${MODAL};
  if(!m) return null;
  const el=${sel};
  if(!el) return null;
  el.scrollIntoView({block:'center'});
  const r=el.getBoundingClientRect();
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
})()`;

const OPT = (txt) => `(function(){
  const t=${JSON.stringify(txt)};
  const els=Array.from(document.querySelectorAll('[class*="CSD_menuItem"]')).filter(e=>(e.innerText||'').trim()===t);
  const e=els[els.length-1];
  if(!e) return null;
  const r=e.getBoundingClientRect();
  if(r.width===0) return null;
  return {x:Math.round(r.x+r.width/2), y:Math.round(r.y+r.height/2)};
})()`;

async function typeInto(s, sel, text) {
  const pos = await s.ev(CENTER(sel));
  if (!pos) throw new Error('找不到输入框: ' + sel);
  await click(s, pos.x, pos.y);
  await sleep(200);
  await s.ev(`(function(){const m=${MODAL};const el=${sel};if(el){el.focus();el.select&&el.select();}return 1})()`);
  await sleep(100);
  await s.send('Input.insertText', { text });
  await sleep(350);
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== '--task' || !args[1]) { console.log('用法: node review.cjs --task task.json'); process.exit(2); }
  const task = JSON.parse(fs.readFileSync(args[1], 'utf8').replace(/^\uFEFF/, ''));
  const sn = task.order, amount = String(task.amount), desc = task.desc;
  const reason2 = task.reason2 || '消费者无理由退货，退货运费不应商家承担';
  const doSubmit = task.submit === true;
  if (!sn || !amount || !desc) throw new Error('task.json 缺字段');

  const pages = await httpGet('/json/list');
  const list = pages.find((p) => p.type === 'page' && /aftersale\/list/.test(p.url));
  if (!list) throw new Error('申诉记录列表页未打开');
  const s = new S(list.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Page.enable');
  // 后台标签会被节流：点击不生效、弹窗还会被关掉，必须先激活
  try { await httpGet('/json/activate/' + list.id); } catch {}
  await sleep(600);
  const vis = await s.ev('document.visibilityState');
  if (vis !== 'visible') {
    await s.send('Page.bringToFront').catch(() => {});
    await sleep(800);
  }
  const vis2 = await s.ev('document.visibilityState');
  console.log('VIS=' + vis2);

  // 清掉残留弹窗（复议表单用「取消」，结果弹窗用右上角关闭图标）
  for (let round = 0; round < 3; round++) {
    if (!(await s.ev(HAS_MODAL))) break;
    const d = await s.ev(READ);
    let hit = null;
    if (d && d.cancel) hit = d.cancel;
    if (!hit) {
      hit = await s.ev(`(function(){
        const m=${MODAL};
        const ic=Array.from(m.querySelectorAll('svg,[class*="close"],[class*="Close"]')).find(e=>{
          const r=e.getBoundingClientRect(); return r.width>0 && r.width<40;
        });
        if(ic){const r=ic.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}
        const b=Array.from(m.querySelectorAll('button')).find(x=>/^\u77e5\u9053\u4e86$|\u5173\u95ed|\u786e\u5b9a/.test((x.innerText||'').trim()));
        if(b){const r=b.getBoundingClientRect();return{x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};}
        return null;
      })()`);
    }
    if (!hit) { await s.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await sleep(400); }
    else await click(s, hit.x, hit.y);
    await sleep(700);
  }

  let pos = await s.ev(FIND_ROW(sn));
  if (!pos) {
    // 试翻页
    for (let pg = 1; pg <= 6 && !pos; pg++) {
      const t = await s.ev(`(function(){
        const ul=document.querySelector('[data-testid="beast-core-pagination"]');
        if(!ul) return null;
        const li=Array.from(ul.children).find(x=>(x.innerText||'').trim()===${JSON.stringify(String(pg))});
        if(!li) return null;
        li.scrollIntoView({block:'center'});
        const r=li.getBoundingClientRect();
        return {x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};
      })()`);
      if (!t) continue;
      await click(s, t.x, t.y);
      await sleep(2200);
      pos = await s.ev(FIND_ROW(sn));
    }
  }
  if (!pos) throw new Error('找不到该订单的「发起复议」: ' + sn);
  await click(s, pos.x, pos.y);

  let form = null;
  for (let i = 0; i < 25; i++) {
    await sleep(300);
    form = await s.ev(READ);
    if (form) break;
  }
  if (!form) throw new Error('复议弹窗没出来');
  console.log('OPEN max=' + form.max + ' files=' + form.files);
  if (form.max && Number(amount) > Number(form.max) + 1e-9) {
    throw new Error('金额超上限：填 ' + amount + '，上限 ' + form.max);
  }

  // 1. 复议原因：点开 → 悬停一级 → 点二级
  const selSel = `Array.from(m.querySelectorAll('input')).find(i=>i.placeholder==='\u8bf7\u9009\u62e9')`;
  let p = await s.ev(CENTER(selSel));
  if (!p) throw new Error('找不到复议原因下拉');
  await click(s, p.x, p.y);
  await sleep(1000);

  const l1 = await s.ev(OPT('退货运费'));
  if (!l1) throw new Error('一级「退货运费」没出现');

  // 级联面板：点一级只展开不选中（与申诉表单同一套控件）
  let l2 = await s.ev(OPT(reason2));
  if (!l2) {
    await click(s, l1.x, l1.y);
    await sleep(900);
    l2 = await s.ev(OPT(reason2));
  }
  if (!l2) {
    await move(s, l1.x, l1.y);
    await sleep(1200);
    l2 = await s.ev(OPT(reason2));
  }
  if (!l2) {
    const dump = await s.ev(`Array.from(document.querySelectorAll('[class*="CSD_menuItem"]')).filter(e=>e.getBoundingClientRect().width>0).map(e=>{const r=e.getBoundingClientRect();return (e.innerText||'').trim().replace(/\\n/g,' / ')+' @'+Math.round(r.x+r.width/2)+','+Math.round(r.y+r.height/2);}).join(' || ')`);
    console.log('L1=' + JSON.stringify(l1) + ' OPTIONS=' + dump);
    throw new Error('二级「' + reason2 + '」没出现');
  }
  await move(s, l2.x, l2.y);
  await sleep(300);
  await click(s, l2.x, l2.y);
  await sleep(1200);

  const afterReason = await s.ev(READ);
  console.log('AFTER_REASON files=' + afterReason.files + ' [' + afterReason.fileInfo + '] | ' + String(afterReason.text).slice(-260));

  // 2. 复议金额
  const amtSel = `Array.from(m.querySelectorAll('input')).find(i=>i.placeholder==='\u8bf7\u8f93\u5165')`;
  await typeInto(s, amtSel, amount);

  // 3. 复议描述
  await typeInto(s, `m.querySelector('textarea')`, desc);

  // 2.5 凭证上传：选完原因才出现 4 个 file input（必填图片/必填视频/选填图片/选填视频）
  const evReq = (task.evidenceRequired || []).filter((f) => fs.existsSync(f)).slice(0, 3);
  const evOpt = (task.evidenceOptional || []).filter((f) => fs.existsSync(f)).slice(0, 3);
  if (evReq.length || evOpt.length) {
    await s.send('DOM.enable');
    const doc = await s.send('DOM.getDocument', { depth: 0 });
    const nodes = await s.send('DOM.querySelectorAll', { nodeId: doc.root.nodeId, selector: 'input[type=file]' });
    const ids = (nodes && nodes.nodeIds) || [];
    const img = [];
    for (const nid of ids) {
      const dn = await s.send('DOM.describeNode', { nodeId: nid });
      const acc = ((dn.node && dn.node.attributes) || []).join(' ');
      if (/\.jpe?g/i.test(acc)) img.push(nid);
    }
    console.log('FILE_INPUTS total=' + ids.length + ' image=' + img.length);
    if (evReq.length) {
      if (!img[0]) throw new Error('找不到必填图片上传框');
      await s.send('DOM.setFileInputFiles', { nodeId: img[0], files: evReq });
      await sleep(3000);
      console.log('EVIDENCE_REQUIRED 已传 ' + evReq.length + ' 张');
    }
    if (evOpt.length) {
      if (!img[1]) throw new Error('找不到选填图片上传框');
      await s.send('DOM.setFileInputFiles', { nodeId: img[1], files: evOpt });
      await sleep(3000);
      console.log('EVIDENCE_OPTIONAL 已传 ' + evOpt.length + ' 张');
    }
  }

  await sleep(400);
  const after = await s.ev(READ);
  console.log('--- 回读 ---');
  console.log('上限=' + after.max + ' files=' + after.files);
  console.log('原因=' + JSON.stringify((after.inputs.find((i) => i.ph === '请选择') || {}).v));
  console.log('金额=' + JSON.stringify((after.inputs.find((i) => i.ph === '请输入') || {}).v));
  console.log('描述长度=' + (after.textareas[0] || '').length + ' / 期望 ' + String(desc).length);
  console.log('描述=' + JSON.stringify(after.textareas[0] || ''));

  if (task.shot) {
    const r = await s.send('Page.captureScreenshot', { format: 'png' });
    fs.mkdirSync(path.dirname(path.resolve(task.shot)), { recursive: true });
    fs.writeFileSync(task.shot, Buffer.from(r.data, 'base64'));
    console.log('SHOT=' + task.shot);
  }

  if (doSubmit) {
    // 按钮可能在滚动区外，先滚进视口再取坐标；并校验该点确实是按钮
    const sb = await s.ev(`(function(){
      const m=${MODAL};
      if(!m) return null;
      const b=Array.from(m.querySelectorAll('button')).find(x=>(x.innerText||'').trim()==='\u63d0\u4ea4\u7533\u8bc9');
      if(!b) return null;
      b.scrollIntoView({block:'center'});
      const r=b.getBoundingClientRect();
      const x=Math.round(r.x+r.width/2), y=Math.round(r.y+r.height/2);
      const hit=document.elementFromPoint(x,y);
      const ok = hit && (hit===b || b.contains(hit));
      return {x, y, ok, vh: window.innerHeight, dis: b.disabled};
    })()`);
    if (!sb) throw new Error('找不到提交按钮');
    console.log('SUBMIT_BTN=' + JSON.stringify(sb));
    if (!sb.ok) throw new Error('提交按钮坐标处不是按钮（可能被遮挡或超出视口）');
    if (sb.dis) throw new Error('提交按钮处于禁用状态');
    await click(s, sb.x, sb.y);
    let verdict = 'UNKNOWN', evd = '';
    for (let i = 0; i < 26; i++) {
      await sleep(500);
      const st = await s.ev(`(function(){
        const m=${MODAL};
        return {open: !!m, txt: (m?m.innerText:'') , body: (document.body.innerText||'').slice(0,600)};
      })()`);
      const blob = (st.txt || '') + ' ' + (st.body || '');
      if (/\u5df2\u53d1\u8d77\u590d\u8bae|\u63d0\u4ea4\u6210\u529f|\u590d\u8bae\u6210\u529f|\u5df2\u63d0\u4ea4|\u8bf7\u8010\u5fc3\u7b49\u5f85/.test(blob)) { verdict = 'SUCCESS'; evd = (st.txt || '').replace(/\s+/g, ' ').slice(0, 160); break; }
      if (/\u4e0d\u80fd\u4e3a\u7a7a|\u8bf7\u4e0a\u4f20|\u8bf7\u9009\u62e9|\u8d85\u8fc7|\u5931\u8d25/.test(st.txt || '')) { verdict = 'FAILED'; evd = (st.txt || '').replace(/\s+/g, ' ').slice(0, 200); break; }
      if (!st.open) { verdict = 'SUCCESS'; evd = '弹窗已关闭'; break; }
    }
    console.log('SUBMIT=' + verdict + (evd ? ' | ' + evd : ''));
    if (verdict !== 'SUCCESS') console.log('BODY=' + (await s.ev('document.body.innerText')).slice(0, 500).replace(/\n+/g, ' | '));
    if (task.shot2) {
      const r2 = await s.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(task.shot2, Buffer.from(r2.data, 'base64'));
      console.log('SHOT2=' + task.shot2);
    }
  } else {
    console.log('FILLED_ONLY 未提交');
  }
  s.close();
}
main().catch((e) => { console.log('ERROR=' + e.message); process.exit(1); });
