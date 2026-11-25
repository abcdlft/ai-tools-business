#!/usr/bin/env node
'use strict';
/*
 * edge.cjs — 通过 WorkBuddy 浏览器 MCP 驱动本机 Edge（已登录会话），零第三方依赖。
 *
 * 为什么是它：WorkBuddy 会话内可能没有注入 mcp__browser__* 工具（设置里的安装链会漏写
 * mcp.json）。本脚本直接跟同一个 browser-mcp 服务说 MCP 协议，拿到的是同一套 32 个工具，
 * 不碰 CDP、不碰键鼠、不碰剪贴板。
 *
 * 关键约束（踩过的坑，别绕）：
 *   1. tab_id 只在「同一个进程」内有效。所以列表→认领→操作必须一次跑完，
 *      不能 list 完退出再开另一个进程去点。本脚本每条命令都自己走完这一串。
 *   2. dom_cua_get_visible_dom 只覆盖顶层文档。iframe 内的表格（聚水潭 order/list.aspx）
 *      抓不到，只能截图后用 view_image 读。
 *   3. 这套工具没有 evaluate，无法执行 JS。要数据只能 DOM 快照或截图。
 *
 * 用法：
 *   node edge.cjs list
 *   node edge.cjs find <关键字|@active>
 *   node edge.cjs dom  <tab> [--out file]
 *   node edge.cjs shot <tab> --out file.png [--clip x,y,w,h]
 *   node edge.cjs click <tab> <node_id|文本#第几个> [--out prefix]
 *   node edge.cjs type <tab> --text "..." | <tab> "文本"
 *   node edge.cjs key  <tab> --keys ctrl,a | <tab> Enter
 *   node edge.cjs goto <tab|@new> --url https://...
 *   node edge.cjs hover <tab> --at x,y --out file.png
 *   node edge.cjs eval        # 不存在，仅提示；保留占位避免误用
 *
 * 公共选项：--browser <browser_id>  --json  --timeout <ms>
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// ---------- 1. 找 browser-mcp 可执行文件 ----------
function findExe() {
  const home = os.homedir();
  const cands = [];
  if (process.env.BROWSER_MCP_EXE) cands.push(process.env.BROWSER_MCP_EXE);
  cands.push(path.join(home, '.workbuddy', 'native-runtimes', 'browser-use', 'browser-use', 'bin', 'browser-mcp.exe'));
  cands.push(path.join(home, '.workbuddy', 'native-runtimes', 'browser-use', 'browser-use', 'bin', 'browser-mcp'));
  // 从 mcp.json 里捞
  for (const cfg of [
    path.join(home, '.workbuddy', 'mcp.json'),
    path.join(process.env.APPDATA || '', '..', 'Local', 'WorkBuddy', 'mcp.json'),
  ]) {
    try {
      const j = JSON.parse(fs.readFileSync(cfg, 'utf8'));
      for (const s of Object.values(j.mcpServers || {})) {
        if (s && typeof s.command === 'string' && /browser-mcp/i.test(s.command)) cands.push(s.command);
      }
    } catch { /* ignore */ }
  }
  for (const c of cands) {
    try { if (c && fs.statSync(c).isFile()) return c; } catch { /* next */ }
  }
  throw new Error(
    '没找到 browser-mcp 可执行文件。请确认已安装 WorkBuddy 浏览器扩展，' +
    '或设置环境变量 BROWSER_MCP_EXE 指向 browser-mcp.exe。已尝试：\n  ' + cands.join('\n  ')
  );
}

// ---------- 2. MCP stdio 客户端 ----------
class Mcp {
  constructor(exe) {
    this.child = spawn(exe, [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.seq = 0;
    this.pending = new Map();
    this.buf = '';
    this.err = '';
    this.child.stderr.on('data', (d) => { this.err += d.toString('utf8'); });
    this.child.stdout.on('data', (d) => {
      this.buf += d.toString('utf8');
      let i;
      while ((i = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, i).trim();
        this.buf = this.buf.slice(i + 1);
        if (!line) continue;
        let m;
        try { m = JSON.parse(line); } catch { continue; }
        if (m.id !== undefined && this.pending.has(m.id)) {
          const p = this.pending.get(m.id);
          this.pending.delete(m.id);
          if (m.error) p.reject(new Error(JSON.stringify(m.error)));
          else p.resolve(m.result);
        }
      }
    });
  }
  call(method, params, timeoutMs = 30000) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => { this.pending.delete(id); reject(new Error('timeout: ' + method)); }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => { clearTimeout(t); resolve(v); },
        reject: (e) => { clearTimeout(t); reject(e); },
      });
      this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params: params || {} }) + '\n');
    });
  }
  notify(method, params) {
    this.child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params: params || {} }) + '\n');
  }
  tool(name, args, timeoutMs = 60000) {
    return this.call('tools/call', { name, arguments: args || {} }, timeoutMs);
  }
  close() {
    try { this.child.stdin.end(); } catch { /* ignore */ }
    try { this.child.kill(); } catch { /* ignore */ }
  }
}

function textOf(res) {
  if (!res) return '';
  if (typeof res === 'string') return res;
  if (Array.isArray(res.content)) {
    const t = res.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
    if (t) return t;
  }
  return JSON.stringify(res);
}
// 工具返回 {ok:true,result:{snapshot,url,title}} 的 JSON 信封
function envelope(res) {
  const t = textOf(res);
  try {
    const j = JSON.parse(t);
    if (j && typeof j === 'object' && j.result && typeof j.result === 'object') return j.result;
  } catch { /* not json */ }
  return { snapshot: t };
}
function snapshotOf(res) {
  const e = envelope(res);
  return typeof e.snapshot === 'string' ? e.snapshot : textOf(res);
}
function imageOf(res) {
  if (res && Array.isArray(res.content)) {
    const img = res.content.find((c) => c.type === 'image');
    if (img && img.data) return Buffer.from(img.data, 'base64');
  }
  return null;
}

// ---------- 3. 参数解析 ----------
function parseArgs(argv) {
  const pos = [];
  const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { opt[k] = true; }
      else { opt[k] = next; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function ensureDir(p) {
  const d = path.dirname(p);
  if (d && !fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
}
function writeOut(outPath, data) {
  ensureDir(outPath);
  fs.writeFileSync(outPath, data);
  return outPath;
}

// 找标签页：关键字匹配标题或 URL；@active 取当前选中；@N 取第 N 个
function pickTab(tabs, want) {
  if (!want) throw new Error('缺少标签页参数');
  if (want === '@active') {
    const t = tabs.find((x) => x.selected);
    if (!t) throw new Error('没有选中标签页，改用标题关键字');
    return t;
  }
  if (/^@\d+$/.test(want)) {
    const t = tabs[Number(want.slice(1))];
    if (!t) throw new Error('标签页序号越界，共 ' + tabs.length + ' 个');
    return t;
  }
  const kw = want.toLowerCase();
  const hit = tabs.find((t) => (t.title || '').toLowerCase().includes(kw))
    || tabs.find((t) => (t.url || '').toLowerCase().includes(kw));
  if (!hit) {
    throw new Error('没找到含「' + want + '」的标签页。现有：\n' +
      tabs.map((t, i) => `  @${i} ${t.title} — ${t.url}`).join('\n'));
  }
  return hit;
}

// ---------- 4. 主流程 ----------
(async () => {
  const { pos, opt } = parseArgs(process.argv.slice(2));
  const cmd = (pos.shift() || 'list').toLowerCase();
  const out = { cmd, at: new Date().toISOString(), steps: [] };
  let code = 0;
  let mcp = null;

  try {
    if (cmd === 'eval') {
      throw new Error('浏览器通道没有 evaluate / 页面 JS 求值。读数据用 dom（顶层文档）或 shot/clip（含 iframe 时）。');
    }

    mcp = new Mcp(findExe());
    const timeout = Number(opt.timeout || ID-XXXX);
    await mcp.call('initialize', {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'pdd-appeal-edge', version: '1.0.0' },
    }, timeout);
    mcp.notify('notifications/initialized');

    const browsersRaw = await mcp.tool('browsers_list', {}, timeout);
    const browsers = (envelope(browsersRaw).browsers) || (Array.isArray(envelope(browsersRaw)) ? envelope(browsersRaw) : [])
      || JSON.parse(textOf(browsersRaw)).result || [];
    const blist = Array.isArray(browsers) ? browsers : [];
    out.browsers = blist;
    if (!blist.length) throw new Error('没有已连接的浏览器：确认 Edge 已打开且 WorkBuddy 扩展已连接');

    const wantB = opt.browser ? Number(opt.browser) : null;
    const browser = (wantB && blist.find((b) => b.browser_id === wantB)) || blist[0];
    const bid = browser.browser_id;

    const tabsRaw = await mcp.tool('user_open_tabs', { browser_id: bid }, timeout);
    const tEnv = envelope(tabsRaw);
    let tabs = Array.isArray(tEnv) ? tEnv : (tEnv.tabs || JSON.parse(textOf(tabsRaw)).result || []);
    out.tabs = tabs.map((t, i) => ({ i, tab_id: t.tab_id, title: t.title, url: t.url, selected: !!t.selected }));

    if (cmd === 'list') {
      out.ok = true;
    } else if (cmd === 'find') {
      const t = pickTab(tabs, pos[0]);
      out.tab = { tab_id: t.tab_id, title: t.title, url: t.url, selected: !!t.selected };
      out.ok = true;
    } else if (cmd === 'goto') {
      const want = pos[0];
      const url = opt.url || pos[1];
      if (!url) throw new Error('用法: goto <tab|@new> --url <url>');
      if (want === '@new') {
        const r = await mcp.tool('tabs_new', { browser_id: bid, url }, timeout);
        out.steps.push({ tool: 'tabs_new', raw: textOf(r).slice(0, 300) });
      } else {
        const t = pickTab(tabs, want);
        await mcp.tool('tabs_claim', { browser_id: bid, tab_id: t.tab_id }, timeout);
        const r = await mcp.tool('tab_goto', { browser_id: bid, tab_id: t.tab_id, url }, timeout);
        out.steps.push({ tool: 'tab_goto', raw: textOf(r).slice(0, 300) });
      }
      await sleep(Number(opt.wait || 2500));
      const tl = await mcp.tool('user_open_tabs', { browser_id: bid }, timeout);
      const e2 = envelope(tl);
      tabs = Array.isArray(e2) ? e2 : (e2.tabs || []);
      out.tabs = tabs.map((t, i) => ({ i, tab_id: t.tab_id, title: t.title, url: t.url, selected: !!t.selected }));
      out.ok = true;
    } else {
      // 其余命令都需要先认领目标标签页
      const t = pickTab(tabs, pos[0]);
      const tid = t.tab_id;
      out.tab = { tab_id: tid, title: t.title, url: t.url };
      await mcp.tool('tabs_claim', { browser_id: bid, tab_id: tid }, timeout);

      if (cmd === 'close') {
        // 关掉详情页前先核对它是目标页：关错标签会丢用户正在看的页面
        out.closing = { tab_id: tid, title: t.title, url: t.url };
        const r = await mcp.tool('tabs_close', { browser_id: bid, tab_id: tid }, timeout).catch((e) => ({ error: e.message }));
        out.steps.push({ tool: 'tabs_close', raw: textOf(r).slice(0, 300) });
        const tl = await mcp.tool('user_open_tabs', { browser_id: bid }, timeout);
        const e2 = envelope(tl);
        tabs = Array.isArray(e2) ? e2 : (e2.tabs || []);
        out.tabs = tabs.map((x, i) => ({ i, tab_id: x.tab_id, title: x.title, url: x.url, selected: !!x.selected }));
        out.closed = !tabs.some((x) => x.tab_id === tid);
        if (!out.closed) throw new Error('标签关闭未确认，可能仍在：' + t.title);
        out.ok = true;
      } else if (cmd === 'dom') {
        const snap = snapshotOf(await mcp.tool('dom_cua_get_visible_dom', { browser_id: bid, tab_id: tid }, timeout));
        out.length = snap.length;
        if (opt.out) out.out = writeOut(opt.out, snap);
        else out.snapshot = snap;
        out.ok = true;
      } else if (cmd === 'shot' || cmd === 'viewport') {
        const args = { browser_id: bid, tab_id: tid, format: 'png' };
        if (cmd === 'viewport') args.clip = { x: 0, y: 0, width: 4000, height: 4000 };
        if (opt.clip) {
          const [x, y, w, h] = String(opt.clip).split(',').map(Number);
          args.clip = { x, y, width: w, height: h };
        }
        const res = await mcp.tool('tab_screenshot', args, timeout);
        const buf = imageOf(res);
        if (!buf) throw new Error('截图未返回图像数据：' + JSON.stringify(res).slice(0, 300));
        const p = opt.out || 'shot.png';
        writeOut(p, buf);
        out.out = p;
        out.bytes = buf.length;
        // PNG 头取宽高，便于换算 clip 坐标
        if (buf.length > 24) {
          out.width = buf.readUInt32BE(16);
          out.height = buf.readUInt32BE(20);
        }
        out.ok = true;
      } else if (cmd === 'click') {
        let node = pos[1];
        if (!node) throw new Error('用法: click <tab> <node_id|文本#第几个>');
        if (!/^\d+$/.test(String(node))) {
          const snap = snapshotOf(await mcp.tool('dom_cua_get_visible_dom', { browser_id: bid, tab_id: tid }, timeout));
          const [label, nRaw] = String(node).split('#');
          const nth = Math.max(0, parseInt(nRaw || '1', 10) - 1);
          const hits = snap.split('\n').filter((l) => l.includes(label) && /node_id=(\d+)/.test(l));
          if (!hits[nth]) throw new Error(`快照里没找到第 ${nth + 1} 个含「${label}」的节点（共 ${hits.length} 个）`);
          node = /node_id=(\d+)/.exec(hits[nth])[1];
          out.matched_line = hits[nth].slice(0, 200);
        }
        out.node = String(node);
        await mcp.tool('dom_cua_click', { browser_id: bid, tab_id: tid, node_id: String(node) }, timeout);
        await sleep(Number(opt.wait || 3000));
        // 点击可能开新标签，重新取一遍
        const tl = await mcp.tool('user_open_tabs', { browser_id: bid }, timeout);
        const e2 = envelope(tl);
        tabs = Array.isArray(e2) ? e2 : (e2.tabs || []);
        out.tabs = tabs.map((x, i) => ({ i, tab_id: x.tab_id, title: x.title, url: x.url, selected: !!x.selected }));
        const cur = tabs.find((x) => x.selected) || tabs.find((x) => x.tab_id === tid) || t;
        if (cur && cur.tab_id !== tid) await mcp.tool('tabs_claim', { browser_id: bid, tab_id: cur.tab_id }, timeout).catch(() => {});
        out.current = { tab_id: cur.tab_id, title: cur.title, url: cur.url };
        if (opt.out) {
          const snap = snapshotOf(await mcp.tool('dom_cua_get_visible_dom', { browser_id: bid, tab_id: cur.tab_id }, timeout));
          out.out = writeOut(opt.out + '-dom.txt', snap);
          const res = await mcp.tool('tab_screenshot', { browser_id: bid, tab_id: cur.tab_id, format: 'png' }, timeout);
          const buf = imageOf(res);
          if (buf) out.png = writeOut(opt.out + '.png', buf);
        }
        out.ok = true;
      } else if (cmd === 'type') {
        const txt = opt.text !== undefined ? String(opt.text) : pos[1];
        if (txt === undefined) throw new Error('用法: type <tab> --text "..."');
        await mcp.tool('dom_cua_type', { browser_id: bid, tab_id: tid, text: txt }, timeout);
        out.typed = txt.length;
        out.ok = true;
      } else if (cmd === 'key') {
        const raw = opt.keys !== undefined ? String(opt.keys) : pos[1];
        if (!raw) throw new Error('用法: key <tab> --keys ctrl,a  /  --keys Enter');
        const keys = raw.includes(',') && !/^[\w+]+$/.test(raw) ? raw.split(',') : raw;
        // --page 用页面级按键（cua_keypress），Tab 时能遍历焦点；默认用聚焦元素级
        if (opt.page) await mcp.tool('cua_keypress', { browser_id: bid, tab_id: tid, keys }, timeout);
        else await mcp.tool('dom_cua_keypress', { browser_id: bid, tab_id: tid, keys }, timeout);
        out.keys = keys;
        out.ok = true;
      } else if (cmd === 'focus') {
        // 把标签页拉到前台，坐标级 CUA 点击依赖窗口激活
        await mcp.tool('tab_focus', { browser_id: bid, tab_id: tid }, timeout);
        await sleep(Number(opt.wait || 800));
        out.focused = tid;
        out.ok = true;
      } else if (cmd === 'dblclick') {
        let node = pos[1];
        if (!node) throw new Error('用法: dblclick <tab> <node_id>');
        if (!/^\d+$/.test(String(node))) {
          const snap = snapshotOf(await mcp.tool('dom_cua_get_visible_dom', { browser_id: bid, tab_id: tid }, timeout));
          const [label, nRaw] = String(node).split('#');
          const nth = Math.max(0, parseInt(nRaw || '1', 10) - 1);
          const hits = snap.split('\n').filter((l) => l.includes(label) && /node_id=(\d+)/.test(l));
          if (hits.length <= nth) throw new Error('快照里找不到第 ' + (nth + 1) + ' 个含「' + label + '」的节点');
          node = (hits[nth].match(/node_id=(\d+)/) || [])[1];
        }
        await mcp.tool('dom_cua_double_click', { browser_id: bid, tab_id: tid, node_id: String(node) }, timeout);
        await sleep(Number(opt.wait || 800));
        if (opt.out) {
          const res = await mcp.tool('tab_screenshot', { browser_id: bid, tab_id: tid, format: 'png' }, timeout);
          const buf = imageOf(res);
          if (buf) { writeOut(opt.out, buf); out.out = opt.out; out.bytes = buf.length; }
        }
        out.dblclicked = String(node);
        out.ok = true;
      } else if (cmd === 'fullpage') {
        // 整页截图（含滚动区），用于一次读完详情页
        const res = await mcp.tool('cua_execute', {
          browser_id: bid, tab_id: tid,
          actions: [{ type: 'screenshot', format: 'png', full_page: true }],
        }, timeout);
        const buf = imageOf(res);
        if (!buf) throw new Error('整页截图未返回图像：' + JSON.stringify(res).slice(0, 300));
        const p = opt.out || 'fullpage.png';
        writeOut(p, buf);
        out.out = p;
        out.bytes = buf.length;
        out.ok = true;
      } else if (cmd === 'scroll') {
        // cua_scroll 用 CSS 像素坐标；--dy 正数向下，--dx 正数向右
        const at = String(opt.at || '500,300').split(',').map(Number);
        if (at.length !== 2 || at.some(Number.isNaN)) throw new Error('用法: scroll <tab> --at x,y --dy 600');
        const dx = Number(opt.dx || 0);
        const dy = Number(opt.dy === undefined ? 600 : opt.dy);
        await mcp.tool('cua_scroll', { browser_id: bid, tab_id: tid, x: at[0], y: at[1], scroll_x: dx, scroll_y: dy }, timeout);
        await sleep(Number(opt.wait || 700));
        if (opt.out) {
          const res = await mcp.tool('tab_screenshot', { browser_id: bid, tab_id: tid, format: 'png' }, timeout);
          const buf = imageOf(res);
          if (buf) { writeOut(opt.out, buf); out.out = opt.out; out.bytes = buf.length; }
        }
        out.scrolled = { dx, dy };
        out.ok = true;
      } else if (cmd === 'tap') {
        // 坐标点击（CSS 像素），用于分页、下拉箭头等没有 node_id 的控件
        const at = String(opt.at || '').split(',').map(Number);
        if (at.length !== 2 || at.some(Number.isNaN)) throw new Error('用法: tap <tab> --at x,y [--double]');
        if (opt.double) {
          await mcp.tool('cua_execute', {
            browser_id: bid, tab_id: tid,
            actions: [{ type: 'double_click', x: at[0], y: at[1] }],
          }, timeout);
        } else {
          await mcp.tool('cua_click', { browser_id: bid, tab_id: tid, x: at[0], y: at[1] }, timeout);
        }
        await sleep(Number(opt.wait || 900));
        if (opt.out) {
          const res = await mcp.tool('tab_screenshot', { browser_id: bid, tab_id: tid, format: 'png' }, timeout);
          const buf = imageOf(res);
          if (buf) { writeOut(opt.out, buf); out.out = opt.out; out.bytes = buf.length; }
        }
        out.tapped = at;
        out.ok = true;
      } else if (cmd === 'hover') {
        const at = String(opt.at || '').split(',').map(Number);
        if (at.length !== 2 || at.some(Number.isNaN)) throw new Error('用法: hover <tab> --at x,y --out file.png');
        await mcp.tool('cua_move', { browser_id: bid, tab_id: tid, x: at[0], y: at[1] }, timeout);
        await sleep(Number(opt.wait || 1200));
        const res = await mcp.tool('tab_screenshot', { browser_id: bid, tab_id: tid, format: 'png' }, timeout);
        const buf = imageOf(res);
        if (buf) out.out = writeOut(opt.out || 'hover.png', buf);
        out.ok = true;
      } else {
        throw new Error('未知命令: ' + cmd);
      }
    }
  } catch (e) {
    out.ok = false;
    out.error = e.message;
    code = 1;
  } finally {
    if (mcp) { out.stderr = mcp.err.slice(0, 1500); mcp.close(); }
    if (opt.json) {
      console.log(JSON.stringify(out, null, 2));
    } else {
      console.log('OK=' + out.ok);
      if (out.error) console.log('ERROR=' + out.error);
      if (out.tabs) console.log('TABS=' + out.tabs.map((t) => `@${t.i}${t.selected ? '*' : ''} ${t.title}`).join(' | '));
      if (out.tab) console.log('TAB=' + out.tab.tab_id + ' ' + out.tab.title);
      if (out.current) console.log('CURRENT=' + out.current.tab_id + ' ' + out.current.title);
      if (out.out) console.log('OUT=' + out.out + (out.bytes ? ' (' + out.bytes + 'B)' : '') + (out.length ? ' LEN=' + out.length : ''));
      if (out.width) console.log('PNG=' + out.width + 'x' + out.height);
      if (out.snapshot) console.log('---SNAPSHOT---\n' + out.snapshot);
    }
    process.exit(code);
  }
})();
