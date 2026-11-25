#!/usr/bin/env node
/**
 * cdp.cjs —— 直连 Edge 原生调试协议（CDP）的最小客户端
 *
 * 为什么需要它：
 *   browser-mcp 的坐标点击是合成事件，点不开 Ant Design 的下拉；
 *   MCP 也没有给 <input type=file> 设文件的能力（凭证上传卡在这里）。
 *   CDP 的 Input.dispatchMouseEvent 是内核级真实事件，
 *   DOM.setFileInputFiles 可以绕过系统文件对话框直接塞文件。
 *
 * 不依赖任何 npm 包：端口信息走 http，页面控制走 Node 22 内置的 WebSocket。
 *
 * 用法：
 *   node cdp.cjs tabs
 *   node cdp.cjs eval  <target> "<js表达式>" [--await]
 *   node cdp.cjs nav   <target> <url>
 *   node cdp.cjs shot  <target> --out x.png [--full]
 *   node cdp.cjs mouse <target> <x> <y> [--double] [--wait ms]
 *   node cdp.cjs click <target> "<css选择器>" [--text "可见文字"]
 *   node cdp.cjs upload <target> "<css选择器>" <文件路径> [更多文件...]
 *   node cdp.cjs frames <target>          # 列出 iframe
 *   node cdp.cjs evalIn <target> <frameIndex> "<js>"
 *
 * <target> 支持：序号(0/1)、标题/URL 关键字、@active
 */

const http = require('http');
const fs = require('fs');
const path = require('path');

const HOST = process.env.CDP_HOST || '127.0.0.1';
const PORT = Number(process.env.CDP_PORT || 9222);

function httpGet(p) {
  return new Promise((resolve, reject) => {
    http.get({ host: HOST, port: PORT, path: p }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (b += d));
      res.on('end', () => {
        try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('JSON 解析失败: ' + b.slice(0, 200))); }
      });
    }).on('error', reject);
  });
}

function httpPut(p) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: HOST, port: PORT, path: p, method: 'PUT' }, (res) => {
      let b = '';
      res.setEncoding('utf8');
      res.on('data', (d) => (b += d));
      res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { resolve(b); } });
    });
    req.on('error', reject);
    req.end();
  });
}

class Session {
  constructor(wsUrl) {
    this.id = 0;
    this.pending = new Map();
    this.ws = new WebSocket(wsUrl);
    this.ready = new Promise((resolve, reject) => {
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error('WebSocket 连接失败'));
    });
    this.ws.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message + ' :: ' + JSON.stringify(msg.error).slice(0, 200)));
        else resolve(msg.result);
      }
    };
  }
  send(method, params = {}, timeout = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('CDP 超时: ' + method)); }, timeout);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function pickPage(pages, key) {
  if (key === undefined || key === '@active') {
    return pages.find((p) => p.type === 'page') || pages[0];
  }
  if (/^\d+$/.test(String(key))) {
    const list = pages.filter((p) => p.type === 'page');
    const p = list[Number(key)];
    if (!p) throw new Error('没有第 ' + key + ' 个页面，现有 ' + list.length + ' 个');
    return p;
  }
  const k = String(key).toLowerCase();
  const p = pages.find((x) => (x.title || '').toLowerCase().includes(k) || (x.url || '').toLowerCase().includes(k));
  if (!p) throw new Error('找不到标题/URL 含「' + key + '」的页面。现有：\n' + pages.map((x) => '  - ' + x.title + ' | ' + x.url).join('\n'));
  return p;
}

async function main() {
  const cmd = process.argv[2];
  if (!cmd) { console.log('用法见文件头注释'); process.exit(2); }

  const rest = process.argv.slice(3);
  const opt = {};
  const pos = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const nxt = rest[i + 1];
      if (nxt !== undefined && !nxt.startsWith('--') && k !== 'double' && k !== 'full' && k !== 'await') { opt[k] = nxt; i++; }
      else opt[k] = true;
    } else pos.push(a);
  }

  const pages = await httpGet('/json/list');
  if (cmd === 'tabs') {
    console.log('PAGES=' + pages.length);
    pages.forEach((p, i) => console.log(`  [${i}] ${p.type} | ${p.title} | ${p.url.slice(0, 110)}`));
    return;
  }
  if (cmd === 'new') {
    const url = pos[0] || 'about:blank';
    const r = await httpPut('/json/new?' + encodeURIComponent(url));
    console.log('NEW=' + (r.id || JSON.stringify(r).slice(0, 200)));
    return;
  }

  const page = pickPage(pages, pos[0]);
  const s = new Session(page.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Page.enable').catch(() => {});
  // 窗口被遮挡时标签页是 hidden：渲染停摆、点击不生效、弹窗还会被关掉。
  // 聚焦模拟 + 生命周期激活能把它拉回 visible（会话级开关，每次连接都要设）。
  await s.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  await s.send('Page.setWebLifecycleState', { state: 'active' }).catch(() => {});
  await sleep(120);

  if (cmd === 'eval' || cmd === 'evalIn') {
    let ctx;
    if (cmd === 'evalIn') {
      const tree = await s.send('Page.getFrameTree');
      const frames = [];
      (function walk(n) { frames.push(n.frame); (n.childFrames || []).forEach(walk); })(tree.frameTree);
      const f = frames[Number(pos[1])];
      if (!f) throw new Error('没有第 ' + pos[1] + ' 个 frame，共 ' + frames.length + ' 个');
      const w = await s.send('Page.createIsolatedWorld', { frameId: f.id, worldName: 'pdd' }).catch(() => null);
      ctx = w && w.executionContextId;
    }
    const expr = pos[cmd === 'evalIn' ? 2 : 1];
    const params = { expression: expr, returnByValue: true, awaitPromise: !!opt.await, userGesture: true };
    if (ctx) params.contextId = ctx;
    const r = await s.send('Runtime.evaluate', params);
    if (r.exceptionDetails) {
      console.log('JS_ERROR=' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    } else {
      const v = r.result;
      console.log('TYPE=' + v.type);
      console.log(typeof v.value === 'string' ? v.value : JSON.stringify(v.value, null, 2));
    }
  } else if (cmd === 'nav') {
    await s.send('Page.navigate', { url: pos[1] });
    await sleep(Number(opt.wait || 3000));
    const t = await s.send('Runtime.evaluate', { expression: 'document.title + " || " + location.href', returnByValue: true });
    console.log('NAV=' + (t.result && t.result.value));
  } else if (cmd === 'shot') {
    const params = { format: 'png' };
    if (opt.full) {
      const m = await s.send('Page.getLayoutMetrics');
      const cs = m.cssContentSize || m.contentSize;
      params.clip = { x: 0, y: 0, width: Math.ceil(cs.width), height: Math.ceil(cs.height), scale: 1 };
      params.captureBeyondViewport = true;
    }
    const r = await s.send('Page.captureScreenshot', params, 60000);
    const p = opt.out || 'cdp-shot.png';
    fs.mkdirSync(path.dirname(path.resolve(p)), { recursive: true });
    fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
    const buf = fs.readFileSync(p);
    console.log('OUT=' + p + ' (' + buf.length + 'B) ' + buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20));
  } else if (cmd === 'mouse') {
    const x = Number(pos[1]), y = Number(pos[2]);
    const seq = opt.double ? 2 : 1;
    for (let i = 0; i < seq; i++) {
      await s.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', clickCount: 0 });
      await sleep(60);
      await s.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: i + 1 });
      await sleep(60);
      await s.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: i + 1 });
      await sleep(120);
    }
    await sleep(Number(opt.wait || 600));
    const t = await s.send('Runtime.evaluate', { expression: '1', returnByValue: true }).catch(() => null);
    console.log('MOUSE=' + x + ',' + y + (opt.double ? ' x2' : ''));
  } else if (cmd === 'click') {
    const sel = pos[1];
    const text = opt.text;
    const js = `(function(){
      const nodes = Array.from(document.querySelectorAll(${JSON.stringify(sel)}));
      let t = nodes;
      ${text ? `t = nodes.filter(n => (n.innerText||n.textContent||'').includes(${JSON.stringify(text)}));` : ''}
      if (!t.length) return 'NOT_FOUND';
      const el = t[0];
      const r = el.getBoundingClientRect();
      el.scrollIntoView({block:'center'});
      for (const type of ['mouseover','mousedown','mouseup','click']) {
        el.dispatchEvent(new MouseEvent(type, {bubbles:true, cancelable:true, view:window, button:0}));
      }
      return 'CLICKED ' + Math.round(r.x) + ',' + Math.round(r.y) + ' | ' + (el.innerText||'').slice(0,40);
    })()`;
    const r = await s.send('Runtime.evaluate', { expression: js, returnByValue: true, userGesture: true });
    console.log('CLICK=' + (r.result && r.result.value));
  } else if (cmd === 'upload') {
    const sel = pos[1];
    const files = pos.slice(2).map((f) => path.resolve(f));
    for (const f of files) if (!fs.existsSync(f)) throw new Error('文件不存在: ' + f);
    await s.send('DOM.enable');
    const doc = await s.send('DOM.getDocument', { depth: 0 });
    const q = await s.send('DOM.querySelector', { nodeId: doc.root.nodeId, selector: sel });
    if (!q.nodeId) throw new Error('页面上找不到选择器: ' + sel);
    await s.send('DOM.setFileInputFiles', { nodeId: q.nodeId, files });
    console.log('UPLOADED ' + files.length + ' file(s) -> ' + sel);
    for (const f of files) console.log('  ' + f);
  } else if (cmd === 'frames') {
    const tree = await s.send('Page.getFrameTree');
    const out = [];
    (function walk(n, d) { out.push({ d, f: n.frame }); (n.childFrames || []).forEach((c) => walk(c, d + 1)); })(tree.frameTree, 0);
    out.forEach((o, i) => console.log(`  [${i}]${'  '.repeat(o.d)} ${o.f.name || '(unnamed)'} | ${o.f.url.slice(0, 100)}`));
  } else {
    console.log('未知命令: ' + cmd);
  }

  s.close();
}

main().catch((e) => { console.log('ERROR=' + e.message); process.exit(1); });
