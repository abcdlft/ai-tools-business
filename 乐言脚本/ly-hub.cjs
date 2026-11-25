// 乐言接待中枢 · 实时消息流读取器
// 用法:
//   node ly-hub.cjs snap                 读一次当前快照（JSON）
//   node ly-hub.cjs snap --tag NOT_REPLY 只看无人回复
//   node ly-hub.cjs watch 60             持续监听 60 秒，有新消息就打印
//   node ly-hub.cjs stop                 停止订阅
// 依赖: 乐言客户端 --remote-debugging-port=9223
const http = require('http');
const PORT = Number(process.env.CDP_PORT || 9223);
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
  send(method, params = {}, t = 30000) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const tm = setTimeout(() => { this.p.delete(id); rej(new Error('timeout ' + method)); }, t);
      this.p.set(id, { res: (v) => { clearTimeout(tm); res(v); }, rej: (e) => { clearTimeout(tm); rej(e); } });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  close() { try { this.ws.close(); } catch {} }
}

// 页面内安装：订阅 + 只在数据变化时把消息压成小对象
// HOOK_VER 改动后，旧钩子会在下次 install 时自动让位（解决改了代码却仍是旧逻辑的问题）
const HOOK_VER = 4;
// 全局对象名带版本号：旧匿名监听器移不掉，且它会先设置 sig 让新版跳过。
// 换对象名后新旧彻底隔离，旧订阅随页面生命周期自然消亡。
const HUB_KEY = '__HUB_V4';
const INSTALL = (subId) => `
(function(){
  var SUB = ${JSON.stringify(subId)};
  var VER = ${HOOK_VER};
  var KEY = ${JSON.stringify(HUB_KEY)};
  var p = window.__LY_CLIENT_PORT__;
  if (!p) return { ok:false, err:'no port' };
  if (window[KEY] && window[KEY].sub === SUB) {
    // 已装好，沿用
  } else {
    window[KEY] = { messages: [], history: {}, at: 0, ver: 0, sub: SUB };
    var hub = window[KEY];
    p.addEventListener('message', function(e){
      var d = e.data;
      if (!d || d.id !== SUB) return;
      var ms = d.result && d.result.type === 'data' && d.result.data && d.result.data.messages;
      if (!ms) return;
      var first = ms[0], tail = ms[ms.length-1];
      var sig = ms.length + '|' + (first && first.sentAt) + '|' + (tail && tail.sentAt) + '|' + (tail && tail.title || '').length;
      if (sig === hub.sig) return;
      hub.sig = sig;
      hub.ver++;
      hub.at = Date.now();
      // 每条会话只推最后一句，按 buyerId 累积历史，避免混搭/售后需求被后续短句盖掉
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
          if (arr.length > 30) arr.shift();
        }
      }
      hub.messages = ms.map(function(m){
        var f = m.features || {};
        var key = String(m.sellerId || '') + '|' + String(m.buyerId || '');
        return {
          store: m.storeTitle || '',
          buyer: m.buyerNick || '',
          buyerId: m.buyerId || '',
          sellerId: m.sellerId || '',
          assistant: m.assistantNick || m.assistant_nick || '',
          role: m.role || '',
          text: m.title || '',
          fmt: m.format || '',
          at: m.sentAt || '',
          tags: (f.receptionTags && f.receptionTags.value) || [],
          since: (f.countingTime && f.countingTime.startAt) || '',
          read: f.read === true,
          light: f.lighting === true,
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
  p.postMessage({ method:'subscription', id: SUB, params:{ path:'PlatformMessagesEvent' } });
  return { ok:true, sub: SUB };
})()`;

async function target() {
  const list = await get('/json/list');
  const pg = list.filter((x) => x.type === 'page').find((x) => (x.url || '').includes('reception-hub'));
  if (!pg) throw new Error('没找到接待中枢窗口（乐言是否在运行？调试口 ' + PORT + '）');
  return pg;
}

async function main() {
  const cmd = process.argv[2] || 'snap';
  const pg = await target();
  const s = new S(pg.webSocketDebuggerUrl);
  await s.ready;
  await s.send('Runtime.enable');
  const ev = async (expr, t = 20000) => {
    const r = await s.send('Runtime.evaluate', { expression: expr, returnByValue: true }, t);
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text || 'eval error');
    return r.result && r.result.value;
  };

  const subId = 'lyhub3'; // 换 ID：旧监听器是匿名函数移不掉，只能让旧订阅失效、新订阅走新监听器

  if (cmd === 'stop') {
    await ev(`(function(){ try{ window.__LY_CLIENT_PORT__.postMessage({method:'subscription.stop', id:${JSON.stringify(subId)}}); }catch(e){} return 1; })()`);
    console.log('已停止订阅');
    s.close(); return;
  }

  if (cmd === 'install') {
    console.log(await ev(INSTALL(subId)));
    s.close(); return;
  }

  // snap / watch：先确保已安装并订阅
  const state = await ev(`(function(){
    if (window[${JSON.stringify(HUB_KEY)}] && window[${JSON.stringify(HUB_KEY)}].sub === ${JSON.stringify(subId)}) return 'ok';
    return 'need';
  })()`);
  if (state !== 'ok') {
    const r = await ev(INSTALL(subId));
    if (!r || !r.ok) { console.log('安装失败: ' + JSON.stringify(r)); s.close(); return; }
    await sleep(2500);
  }

  const readAll = () => ev(`JSON.stringify(window[${JSON.stringify(HUB_KEY)}] ? window[${JSON.stringify(HUB_KEY)}].messages : [])`).then((x) => JSON.parse(x || '[]'));

  if (cmd === 'snap') {
    const tagIdx = process.argv.indexOf('--tag');
    const tag = tagIdx > 0 ? process.argv[tagIdx + 1] : null;
    let msgs = await readAll();
    if (!msgs.length) { await sleep(2500); msgs = await readAll(); }
    if (tag) msgs = msgs.filter((m) => (m.tags || []).includes(tag));
    const out = msgs.map((m) => ({
      店铺: m.store,
      买家: m.buyer,
      角色: m.role,
      内容: (m.text || '').replace(/\s+/g, ' ').slice(0, 80),
      标签: (m.tags || []).join('/'),
      时间: m.at,
    }));
    console.log(JSON.stringify({ count: out.length, at: new Date().toISOString(), rows: out }, null, 1));
    s.close(); return;
  }

  if (cmd === 'stat') {
    // 采样统计：跑 N 秒，量化消息量、标签分布、会话并发度
    const secs = Number(process.argv[3] || 180);
    const seen = new Set();
    const tagCount = {};
    let firstSnap = null;
    let maxSnap = 0;
    const perStore = {};
    const samples = [];
    const t0 = Date.now();
    let lastRefresh = Date.now();
    console.log('采样 ' + secs + ' 秒…（每 2 秒读一次）');
    while (Date.now() - t0 < secs * 1000) {
      const msgs = await readAll();
      if (msgs.length) {
        if (!firstSnap) firstSnap = msgs;
        maxSnap = Math.max(maxSnap, msgs.length);
        for (const m of msgs) {
          const key = m.store + '|' + m.buyer + '|' + m.at + '|' + (m.text || '').slice(0, 30);
          if (seen.has(key)) continue;
          seen.add(key);
          const t = (m.tags && m.tags[0]) || 'NONE';
          tagCount[t] = (tagCount[t] || 0) + 1;
          perStore[m.store] = (perStore[m.store] || 0) + 1;
          samples.push({ store: m.store, buyer: m.buyer, role: m.role, tag: t, text: (m.text || '').replace(/\s+/g, ' ').slice(0, 60) });
        }
      }
      if (Date.now() - lastRefresh > 30000) {
        await ev(`(function(){ var h=window[${JSON.stringify(HUB_KEY)}]; if(h&&h.refresh) h.refresh(); return 1; })()`);
        lastRefresh = Date.now();
      }
      await sleep(2000);
    }
    const mins = (Date.now() - t0) / 60000;
    console.log(JSON.stringify({
      采样分钟: Number(mins.toFixed(1)),
      新增或变化消息数: seen.size,
      按分钟: Number((seen.size / mins).toFixed(1)),
      同时在线的会话数: maxSnap,
      首帧旧消息数: firstSnap ? firstSnap.length : 0,
      标签分布: tagCount,
      店铺分布: Object.fromEntries(Object.entries(perStore).sort((a, b) => b[1] - a[1])),
      样本: samples.slice(-25),
    }, null, 1));
    s.close(); return;
  }

  if (cmd === 'after') {
    // 售后提醒：按店铺汇总当前"有售后动作"的会话，告诉你该去点哪几家店
    const { classify } = require(require('path').join(__dirname, 'ly-rules.cjs'));
    let msgs = await readAll();
    if (!msgs.length) { await sleep(2500); msgs = await readAll(); }
    const hits = [];
    for (const m of msgs) {
      const r = classify(m);
      if (r.kind === 'AFTERSALE') hits.push({ m, r });
    }
    const byStore = new Map();
    for (const h of hits) {
      const k = h.m.store || '(未知店铺)';
      if (!byStore.has(k)) byStore.set(k, []);
      byStore.get(k).push(h);
    }
    console.log(`\n售后提醒 · ${new Date().toLocaleTimeString('zh-CN')} · 快照 ${msgs.length} 条 · 命中 ${hits.length} 条 · 涉及 ${byStore.size} 家店\n`);
    if (!byStore.size) { console.log('（当前没有待处理的售后动作）'); s.close(); return; }
    let i = 0;
    for (const [store, arr] of byStore) {
      i++;
      console.log(`${i}. ${store}   ← 去这家店看（${arr.length} 条）`);
      for (const { m, r } of arr) {
        const who = m.buyer || m.buyerId || '(空)';
        console.log(`     · ${who}  ${(m.text || '').replace(/\s+/g, ' ').slice(0, 60)}`);
        console.log(`       ${r.reason}${r.hits && r.hits.length ? '(' + r.hits.join(',') + ')' : ''}`);
      }
      console.log('');
    }
    console.log('提示：门店顺序按首次出现排，未去重、未标记；处理完由人工在客户端操作。');
    s.close(); return;
  }

  if (cmd === 'triage') {
    // 分流：只输出判断结果，不动面板
    const { classify } = require(require('path').join(__dirname, 'ly-rules.cjs'));
    let msgs = await readAll();
    if (!msgs.length) { await sleep(2500); msgs = await readAll(); }
    const groups = { AFTERSALE: [], MIX: [], WAIT_REPLY: [], PENDING_ROBOT: [], UNSURE: [], CONSULT: [], DONE: [] };
    for (const m of msgs) {
      const r = classify(m);
      (groups[r.kind] || groups.UNSURE).push({ ...m, _reason: r.reason, _hits: r.hits });
    }
    const fmtRow = (m) => `${(m.store || '').slice(0, 12).padEnd(12)} | ${(m.buyer || '(空)').padEnd(10)} | ${(m.text || '').replace(/\s+/g, ' ').slice(0, 42).padEnd(42)} | ${m._reason}${m._hits && m._hits.length ? '(' + m._hits.join(',') + ')' : ''}`;
    console.log(`\n快照 ${msgs.length} 条 · ${new Date().toLocaleTimeString('zh-CN')}\n`);
    const show = (title, arr, hint) => {
      console.log(`===== ${title}（${arr.length}）${hint ? ' — ' + hint : ''} =====`);
      arr.forEach((m) => console.log('  ' + fmtRow(m)));
      if (!arr.length) console.log('  （无）');
      console.log('');
    };
    show('① 售后 / 改地址 · 必须人工', groups.AFTERSALE, '绝不自动标记已读');
    show('② 混搭需求 · 必须人工改单/备注', groups.MIX, 'BBT 不支持混搭，要回绝；其余要改备注');
    show('③ 买家提问 · 还没人答', groups.WAIT_REPLY, '最后一条是买家，标已读会漏，留给人工');
    show('④ 机器人敷衍 · 实际没解决', groups.PENDING_ROBOT, '标签可能是"仅机器人回复"，要看');
    show('⑤ 判不准 · 交 AI', groups.UNSURE, '约 100~150 token/条');
    show('⑥ 可标记已读 · 咨询/已回复/终态/签收', [...groups.CONSULT, ...groups.DONE], '只置已读，不删对话；人工复查后可一键清除');
    const judge = groups.AFTERSALE.length + groups.MIX.length + groups.WAIT_REPLY.length + groups.PENDING_ROBOT.length + groups.UNSURE.length;
    console.log(`汇总：售后+改地址 ${groups.AFTERSALE.length} / 混搭 ${groups.MIX.length} / 待回复 ${groups.WAIT_REPLY.length} / 机器人敷衍 ${groups.PENDING_ROBOT.length} / 判不准 ${groups.UNSURE.length} / 可标已读 ${groups.CONSULT.length + groups.DONE.length}`);
    console.log(`需要人工 ${judge} 条（原 ${msgs.length} 条，其余 ${msgs.length - judge} 条自动标记已读）· 判不准占比 ${msgs.length ? Math.round((groups.UNSURE.length / msgs.length) * 100) : 0}%`);
    s.close(); return;
  }

  if (cmd === 'read') {
    // 标记已读：只把会话置为已读（人工那个 √√），不删除、不移出面板，
    // 人工随时可复查，看完点「清除已读」一键还原
    // read --tag ASSISTANT_REPLY [--yes]   批量
    // read <buyerId> [sellerId] [--yes]    单条
    const yes = process.argv.includes('--yes');
    const tagIdx = process.argv.indexOf('--tag');
    const tag = tagIdx > 0 ? process.argv[tagIdx + 1] : null;
    const kindIdx = process.argv.indexOf('--kind');
    const kindArg = kindIdx > 0 ? process.argv[kindIdx + 1] : null;
    let msgs = await readAll();
    if (!msgs.length) { await sleep(2500); msgs = await readAll(); }
    let picks;
    if (kindArg) {
      const { classify } = require(require('path').join(__dirname, 'ly-rules.cjs'));
      const kinds = kindArg.split(',').map((x) => x.trim().toUpperCase());
      picks = msgs.filter((m) => kinds.includes(classify(m).kind));
    } else if (tag) {
      picks = msgs.filter((m) => (m.tags || []).includes(tag) && m.platform !== 'taobao');
    } else {
      const bid = process.argv[3];
      const sid = process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : null;
      picks = msgs.filter((m) => m.buyerId === bid && (!sid || String(m.sellerId) === String(sid)));
    }
    if (!picks.length) { console.log('没有匹配的会话'); s.close(); return; }
    const payload = picks.map((m) => ({ platform: m.platform || 'pinduoduo', sellerId: String(m.sellerId), buyerId: String(m.buyerId) }));
    console.log(JSON.stringify({ 将标记: payload.length, 明细: picks.map((m) => `${m.store} | ${m.buyer} | ${(m.tags || []).join('/')}`) }, null, 1));
    if (!yes) { console.log('\n以上为预演。加 --yes 才真正标记已读。'); s.close(); return; }
    const r = await ev(`(function(){
      try { window.__LY_CLIENT_PORT__.postMessage({ method:'mutation', id:'lymark', params:{ path:'reception-hub.MarkRead', input:${JSON.stringify(payload)} } }); return 'ok'; }
      catch(e){ return 'err:' + e.message; }
    })()`);
    console.log('发送: ' + r);
    await sleep(1500);
    s.close(); return;
  }

  if (cmd === 'clearead') {
    // 清除全部已读（等价于小窗上的「清除已读」）
    if (!process.argv.includes('--yes')) { console.log('这会清空当前所有已读条目，确认请加 --yes'); s.close(); return; }
    const r = await ev(`(function(){
      try { window.__LY_CLIENT_PORT__.postMessage({ method:'mutation', id:'lyclear', params:{ path:'reception-hub.RemoveAllRead' } }); return 'ok'; }
      catch(e){ return 'err:' + e.message; }
    })()`);
    console.log('发送: ' + r);
    await sleep(1500);
    s.close(); return;
  }

  if (cmd === 'watch') {
    const secs = Number(process.argv[3] || 60);
    const seen = new Set();
    let baseline = true;
    console.log('监听 ' + secs + ' 秒…');
    const t0 = Date.now();
    let lastRefresh = Date.now();
    let lastAt = 0;
    while (Date.now() - t0 < secs * 1000) {
      const msgs = await readAll();
      // 自愈：30 秒没新数据就重新订阅
      const atNow = Number(await ev(`(window[${JSON.stringify(HUB_KEY)}]||{}).at||0`)) || 0;
      if (atNow !== lastAt) lastAt = atNow;
      if (Date.now() - lastRefresh > 30000) {
        await ev(`(function(){ var h=window[${JSON.stringify(HUB_KEY)}]; if(h&&h.refresh) h.refresh(); return 1; })()`);
        lastRefresh = Date.now();
      }
      for (const m of msgs) {
        const key = m.store + '|' + m.buyer + '|' + m.at + '|' + (m.text || '').slice(0, 20);
        if (seen.has(key)) continue;
        seen.add(key);
        if (baseline) continue; // 第一轮只建基线，不打印
        console.log(`[${new Date().toLocaleTimeString('zh-CN')}] ${m.store} | ${m.buyer} | ${m.role} | ${(m.tags || []).join(',')} | ${(m.text || '').replace(/\s+/g, ' ').slice(0, 70)}`);
      }
      if (baseline) { baseline = false; console.log('基线 ' + msgs.length + ' 条，之后只打印新增'); }
      await sleep(1500);
    }
    s.close(); return;
  }

  console.log('未知命令: ' + cmd);
  s.close();
}

main().catch((e) => { console.log('ERR ' + e.message); process.exit(1); });
