// 乐言会话清理守护进程
// 作用：定时读快照 → 分流 → 把「可自动处理」的会话标记已读 → 其余留在面板上
// 注意：只置已读（那个 √√），不删除对话、不移出面板；人工可随时复查，看完点「清除已读」一键还原
// 用法：node ly-daemon.cjs [间隔秒数，默认取配置 300] [--once]
// 停止：双击「关闭-消息守护.vbs」或删掉 ly-daemon.lock
//
// 日志（默认）：D:\log\ly-daemon\YYYY-MM-DD.log   每轮汇总 + 待办明细 + 每条会话的已读状态
//              D:\log\ly-daemon\latest.json       最近一轮的机器可读快照
// 配置：E:\减负\_tools\daemon.config.json（不存在会自动生成）
//   intervalSec    每轮间隔秒数
//   markRead       true=真的标记已读；false=只统计不提交（演练）
//   showReadStatus true=日志里逐条打印已读/未读
//   logDir         日志根目录
const http = require('http');
const fs = require('fs');
const path = require('path');

const RULES_PATH = path.join(__dirname, 'ly-rules.cjs');
let classify = require(RULES_PATH).classify;
let rulesMtime = 0;
try { rulesMtime = fs.statSync(RULES_PATH).mtimeMs; } catch {}

// ---------------- 配置 ----------------
const CONFIG_PATH = path.join(__dirname, 'daemon.config.json');
const DEFAULT_CFG = {
  intervalSec: 300,
  markRead: true,
  showReadStatus: true,
  logDir: 'D:\\log',
  logKeepDays: 30,
  note: 'markRead=true 才真的标记已读；showReadStatus=true 日志逐条打印已读状态；改完下一轮生效',
};
let cfg = { ...DEFAULT_CFG };
function loadConfig(first) {
  try {
    if (!fs.existsSync(CONFIG_PATH)) {
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULT_CFG, null, 2), 'utf8');
    } else {
      const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      cfg = { ...DEFAULT_CFG, ...raw };
    }
  } catch (e) {
    if (first) console.log('配置读取失败，用默认值：' + e.message);
    cfg = { ...DEFAULT_CFG };
  }
}
loadConfig(true);

const PORT = Number(process.env.CDP_PORT || 9223);
const ARGS = process.argv.slice(2);
const ONCE = ARGS.includes('--once');
const intervalArg = ARGS.find((a) => /^\d+$/.test(a));
const INTERVAL = Number(intervalArg || cfg.intervalSec || 300) * 1000;
const LOCK = path.join(__dirname, 'ly-daemon.lock');
const TODO = path.join(__dirname, 'ly-todo.json');

// ---------------- 日志 ----------------
const LOG_ROOT = (cfg.logDir ? path.resolve(cfg.logDir) : 'D:\\log');
const LOG_DIR = path.join(LOG_ROOT, 'ly-daemon');
function ensureDir(d) { try { fs.mkdirSync(d, { recursive: true }); } catch {} }
ensureDir(LOG_DIR);

const today = () => new Date().toLocaleDateString('sv-SE'); // YYYY-MM-DD
const LOG = () => path.join(LOG_DIR, today() + '.log');
const LATEST = path.join(LOG_DIR, 'latest.json');

function log(msg) {
  const line = `[${new Date().toLocaleString('zh-CN')}] ${msg}`;
  console.log(line);
  try { fs.appendFileSync(LOG(), line + '\n', 'utf8'); } catch {}
}

// 清理过期日志
function pruneLogs() {
  try {
    const keep = Number(cfg.logKeepDays || 30);
    if (!keep) return;
    const cut = Date.now() - keep * ID-XXXX;
    for (const f of fs.readdirSync(LOG_DIR)) {
      if (!/^\d{4}-\d{2}-\d{2}\.log$/.test(f)) continue;
      const p = path.join(LOG_DIR, f);
      if (fs.statSync(p).mtimeMs < cut) fs.unlinkSync(p);
    }
  } catch {}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = (p) => new Promise((res, rej) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p }, (r) => {
    let b = ''; r.setEncoding('utf8'); r.on('data', (d) => (b += d)); r.on('end', () => { try { res(JSON.parse(b)); } catch (e) { rej(e); } });
  }).on('error', rej);
});

class S {
  constructor(u) {
    this.id = 0; this.p = new Map(); this.ws = new WebSocket(u);
    this.ready = new Promise((a, b) => { this.ws.onopen = a; this.ws.onerror = b; });
    this.ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.id && this.p.has(m.id)) { const f = this.p.get(m.id); this.p.delete(m.id); m.error ? f.rej(new Error(m.error.message)) : f.res(m.result); }
    };
  }
  send(method, params = {}, t = 20000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { this.p.delete(id); rej(new Error('timeout ' + method)); }, t);
      this.p.set(id, { res: (v) => { clearTimeout(tm); res(v); }, rej: (e) => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

const SUB_ID = 'lydaemon3'; // 换 ID：旧匿名监听器无法移除，让旧订阅失效、新订阅走新监听器
const HOOK_VER = 4;
const HUB_KEY = '__DAEMON_HUB_V4'; // 换对象名隔离旧匿名监听器，避免 sig 被旧钩子抢先设置

const INSTALL = `
(function(){
  var SUB = ${JSON.stringify(SUB_ID)};
  var KEY = ${JSON.stringify(HUB_KEY)};
  var p = window.__LY_CLIENT_PORT__;
  if (!p) return { ok:false, err:'no port' };
  if (!(window[KEY] && window[KEY].sub === SUB)) {
    window[KEY] = { messages: [], history: {}, at: 0, ver: 0, sub: SUB };
    var hub = window[KEY];
    p.addEventListener('message', function(e){
      var d = e.data;
      if (!d || d.id !== SUB) return;
      var ms = d.result && d.result.type === 'data' && d.result.data && d.result.data.messages;
      if (!ms) return;
      var first = ms[0], tail = ms[ms.length-1];
      var sig = ms.length + '|' + (first && first.sentAt) + '|' + (tail && tail.sentAt) + '|' + ((tail && tail.title) || '').length;
      if (sig === hub.sig) return;
      hub.sig = sig;
      hub.ver++;
      hub.at = Date.now();
      // 接口每条会话只给最后一句。这里按 buyerId 把每次新出现的句子累积成历史，
      // 否则买家先说「NB和S各一包」、最后补一句「在」时，前面的需求就被盖掉了。
      var hist = hub.history;
      // 对话历史只留 24 小时：每轮推送先清掉过期句子，空闲会话也一起清
      var cutoff = Date.now() - 24 * 60 * 60 * 1000;
      for (var k in hist) {
        var ca = hist[k];
        while (ca.length && Date.parse(ca[0].at) && Date.parse(ca[0].at) < cutoff) ca.shift();
        if (!ca.length) delete hist[k];
      }
      for (var i = 0; i < ms.length; i++) {
        var mm = ms[i];
        var key = String(mm.sellerId || '') + '|' + String(mm.buyerId || '');
        var arr = hist[key] || (hist[key] = []);
        var txt = String(mm.title || '');
        var last = arr[arr.length - 1];
        if (!last || last.text !== txt || last.role !== mm.role) {
          arr.push({ text: txt, role: mm.role || '', at: mm.sentAt || '' });
          if (arr.length > 30) arr.shift(); // 每会话最多 30 句，防止长聊把页面内存撑爆
        }
      }
      hub.messages = ms.map(function(m){
        var f = m.features || {};
        var key = String(m.sellerId || '') + '|' + String(m.buyerId || '');
        return {
          store: m.storeTitle || '', buyer: m.buyerNick || '', buyerId: m.buyerId || '',
          sellerId: m.sellerId || '', platform: m.platform || 'pinduoduo',
          assistant: m.assistantNick || m.assistant_nick || '',
          role: m.role || '', text: m.title || '', fmt: m.format || '', at: m.sentAt || '',
          tags: (f.receptionTags && f.receptionTags.value) || [],
          since: (f.countingTime && f.countingTime.startAt) || '',
          read: f.read === true,
          history: hist[key] ? hist[key].slice(0, -1) : []
        };
      });
    });
  }
  var hub = window[KEY];
  hub.refresh = function(){
    hub.sig = null;
    try { p.postMessage({ method:'subscription', id: SUB, params:{ path:'PlatformMessagesEvent' } }); } catch(e){}
  };
  hub.read = function(list){
    try { p.postMessage({ method:'mutation', id:'dmark'+Date.now(), params:{ path:'reception-hub.MarkRead', input: list } }); return true; }
    catch(e){ return false; }
  };
  hub.refresh();
  return { ok:true };
})()`;

async function connect() {
  const list = await get('/json/list');
  const pg = list.filter((x) => x.type === 'page').find((x) => (x.url || '').includes('reception-hub'));
  if (!pg) throw new Error('接待中枢窗口不存在（乐言关了吗？）');
  const s = new S(pg.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Runtime.enable');
  return s;
}

async function ev(s, expr, t = 20000) {
  const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true }, t);
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval error');
  return r.result && r.result.value;
}

// 规则热更新：改完 ly-rules.cjs 不用重启守护，下一轮自动加载
function reloadRules() {
  try {
    const m = fs.statSync(RULES_PATH).mtimeMs;
    if (m === rulesMtime) return false;
    delete require.cache[require.resolve(RULES_PATH)];
    classify = require(RULES_PATH).classify;
    rulesMtime = m;
    log('规则已热更新（' + new Date().toLocaleTimeString('zh-CN') + '）');
    return true;
  } catch (e) {
    log('规则热更新失败：' + e.message);
    return false;
  }
}

const keyOf = (m) => String(m.sellerId) + '|' + String(m.buyerId);
const short = (t, n = 60) => (t || '').replace(/\s+/g, ' ').slice(0, n);
const tagStr = (m) => (m.tags && m.tags.length ? m.tags.join('/') : '-');

function writeTodo(items, extra) {
  const byKind = { AFTERSALE: [], MIX: [], WAIT_REPLY: [], PENDING_ROBOT: [], UNSURE: [] };
  for (const it of items) if (byKind[it.kind]) byKind[it.kind].push(it);
  const summary = {
    afterSale: byKind.AFTERSALE.length, mix: byKind.MIX.length, waitReply: byKind.WAIT_REPLY.length,
    robotBrush: byKind.PENDING_ROBOT.length, unsure: byKind.UNSURE.length,
  };
  const payload = { at: new Date().toISOString(), summary, todo: byKind, ...(extra || {}) };
  const txt = JSON.stringify(payload, null, 1);
  try { fs.writeFileSync(TODO, txt, 'utf8'); } catch {}
  try { fs.writeFileSync(LATEST, txt, 'utf8'); } catch {}
  return byKind;
}

async function readMsgs(s) {
  return JSON.parse(await ev(s, `JSON.stringify(window[${JSON.stringify(HUB_KEY)}] && window[${JSON.stringify(HUB_KEY)}].messages || [])`) || '[]');
}

async function refresh(s) {
  await ev(s, `(function(){ var h=window[${JSON.stringify(HUB_KEY)}]; if(h&&h.refresh) h.refresh(); return 1; })()`);
}

// 重新订阅后服务端是分批推送的，等条数够且稳定再取，避免拿到半截快照
async function waitMsgs(s, minCount, ms = 9000) {
  const t0 = Date.now();
  let best = [], last = -1, stable = 0;
  while (Date.now() - t0 < ms) {
    await sleep(800);
    const cur = await readMsgs(s);
    if (cur.length > best.length) best = cur;
    if (cur.length >= Math.max(1, minCount)) {
      if (cur.length === last) { if (++stable >= 1) return cur; } else stable = 0;
      best = cur;
    }
    last = cur.length;
  }
  return best;
}

let tickNo = 0;

async function tick(state) {
  reloadRules();
  loadConfig();
  const { s } = state;
  tickNo++;

  // 优先读订阅累积的快照（完整）；明显偏小时才重新订阅并等它推全
  let msgs = await readMsgs(s);
  if (msgs.length < 3) {
    await refresh(s);
    msgs = await waitMsgs(s, 3, 9000);
  }
  if (!msgs.length) { log(`第 ${tickNo} 轮：快照为空（乐言页面可能没加载完），跳过`); return; }

  const baseCount = msgs.length;
  if (state.lastCount && baseCount < state.lastCount * 0.6) {
    log(`   · 注意：快照从上轮 ${state.lastCount} 条掉到 ${baseCount} 条，数据可能不完整`);
  }
  state.lastCount = baseCount;

  const pointable = [];
  const todo = [];
  for (const m of msgs) {
    const r = classify(m);
    if (r.kind === 'DONE' || r.kind === 'CONSULT') {
      if (!m.read && m.buyerId) pointable.push({ platform: m.platform, sellerId: String(m.sellerId), buyerId: String(m.buyerId) });
    } else {
      todo.push({ kind: r.kind, reason: r.reason, store: m.store, buyer: m.buyer, buyerId: String(m.buyerId || ''), sellerId: String(m.sellerId || ''), text: (m.text || '').slice(0, 80), tags: m.tags, at: m.at, read: m.read === true });
    }
  }

  const unreadAll = msgs.filter((m) => m.read !== true);
  log(`第 ${tickNo} 轮 | 快照 ${msgs.length} 条（未读 ${unreadAll.length} / 已读 ${msgs.length - unreadAll.length}）| 可标已读 ${pointable.length} 条`);

  // 逐条已读状态（showReadStatus）
  if (cfg.showReadStatus) {
    if (!unreadAll.length) log('   · 当前没有未读会话');
    for (const m of unreadAll) {
      const r = classify(m);
      log(`   · [未读] ${m.store || '(空店)'}｜${m.buyer || '(空)'}｜${m.role || '-'}｜${r.kind}｜${tagStr(m)}｜${short(m.text, 50)}`);
    }
  }

  // 标记已读
  let marked = 0, confirmed = 0, attempted = 0;
  if (pointable.length) {
    attempted = pointable.length;
    if (!cfg.markRead) {
      log(`   · 演练模式（markRead=false）：本次应标记 ${attempted} 条，未提交`);
    } else {
      const ok = await ev(s, `window[${JSON.stringify(HUB_KEY)}].read(${JSON.stringify(pointable)})`);
      if (ok) marked = pointable.length;
      if (ok) {
        const nameOf = new Map(msgs.map((m) => [keyOf(m), `${m.store || '(空店)'}｜${m.buyer || '(空)'}`]));
        log(`   · 本次标记已读：` + pointable.map((p) => nameOf.get(String(p.sellerId) + '|' + String(p.buyerId)) || '?').join(' / '));
        await sleep(1200);
        // MarkRead 后服务端会推新状态；等快照回到同等规模再核对，避免拿半截数据误判
        const after = await waitMsgs(s, baseCount, 7000);
        const nowRead = new Set(after.filter((m) => m.read === true).map(keyOf));
        confirmed = pointable.filter((p) => nowRead.has(String(p.sellerId) + '|' + String(p.buyerId))).length;
        if (after.length < baseCount * 0.6) {
          log(`   · 已提交标记 ${marked} 条；回读快照只回来 ${after.length}/${baseCount} 条，本轮回读不作数，下轮再看`);
        } else {
          log(`   · 已提交标记 ${marked} 条，回读确认已变已读 ${confirmed}/${marked} 条`);
          if (confirmed < marked) log(`   · 未确认的 ${marked - confirmed} 条下一轮会重试（多半是消息流还没推送新状态）`);
        }
      } else {
        log('   · 标记已读调用失败（页面端口异常），下一轮重试');
      }
    }
  }

  const byKind = writeTodo(todo, {
    tick: tickNo,
    snapshot: msgs.length,
    unread: unreadAll.length,
    read: msgs.length - unreadAll.length,
    pointable: attempted,
    marked: cfg.markRead ? confirmed : 0,
    markRead: cfg.markRead,
  });

  if (todo.length) {
    log(`   待办：售后${byKind.AFTERSALE.length} 混搭${byKind.MIX.length} 待回复${byKind.WAIT_REPLY.length} 机器人敷衍${byKind.PENDING_ROBOT.length} 判不准${byKind.UNSURE.length}`);
    for (const it of todo) log(`     - [${it.kind}] ${it.store}｜${it.buyer}｜${short(it.text, 40)}｜${it.reason}`);
  } else {
    log('   待办：无（全部可放过）');
  }
}

async function main() {
  // 单实例保护：已有活实例就退出，避免双击多次跑出多个副本
  if (!ONCE && fs.existsSync(LOCK)) {
    const pid = Number(String(fs.readFileSync(LOCK, 'utf8')).trim());
    let alive = false;
    try { if (pid) { process.kill(pid, 0); alive = true; } } catch {}
    if (alive && pid !== process.pid) {
      console.log('已有实例在运行 PID=' + pid + '，本实例退出');
      return;
    }
  }
  fs.writeFileSync(LOCK, String(process.pid), 'utf8');
  pruneLogs();
  log('======== 守护启动 ========');
  log(`间隔 ${INTERVAL / 1000} 秒 | markRead=${cfg.markRead}（${cfg.markRead ? '真标记' : '只统计不标记'}）| showReadStatus=${cfg.showReadStatus} | 日志 ${LOG_DIR}`);
  let state = null;
  while (true) {
    if (fs.existsSync(LOCK) === false && !ONCE) { log('lock 被删除，退出'); break; }
    try {
      if (!state || state.dead) state = { s: await connect(), dead: false };
      const installed = await ev(state.s, `(function(){ var h=window[${JSON.stringify(HUB_KEY)}]; return (h && h.sub === ${JSON.stringify(SUB_ID)}) ? 'ok' : 'need'; })()`);
      if (installed !== 'ok') { await ev(state.s, INSTALL); await sleep(2500); }
      await tick(state);
      if (ONCE) { log('单轮完成，退出'); try { state.s.close(); } catch {} try { fs.unlinkSync(LOCK); } catch {} process.exit(0); }
    } catch (e) {
      log('异常：' + e.message + '，稍后重连');
      if (state && state.s) state.s.close();
      state = null;
    }
    await sleep(INTERVAL);
  }
  try { fs.unlinkSync(LOCK); } catch {}
}

process.on('SIGINT', () => { try { fs.unlinkSync(LOCK); } catch {} log('手动停止'); process.exit(0); });
main().catch((e) => { log('致命：' + e.message); process.exit(1); });
