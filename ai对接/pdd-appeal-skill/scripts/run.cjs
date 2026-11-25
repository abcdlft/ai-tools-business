#!/usr/bin/env node
'use strict';
/*
 * run.cjs — 申诉批次账本。纯 Node，零依赖。
 *
 * 它只管三件事：**别重复提交、别超授权数量、结果不明就停下**。
 * 判定和文案由模型负责，页面操作用 edge.cjs，账本记在这里。
 *
 * 命令：
 *   init    --run <目录> --quota <整数> [--note 批次说明]
 *   records --run <目录> --file <扫描结果.json>     # 合并去重
 *   list    --run <目录> [--status <状态>] [--json]
 *   decide  --run <目录> --file <decision.json>     # 校验后落盘
 *   skip    --run <目录> --key <key> --note "理由"
 *   begin   --run <目录> --key <key>                # 提交前 guard，标 submitting
 *   finish  --run <目录> --key <key> --result submitted|failed|unknown [--note] [--amount]
 *   resolve --run <目录> --key <key> --result submitted|not-submitted --note "核查依据"
 *   guard   --run <目录>
 *   status  --run <目录>
 *
 * 状态机：pending → decided → submitting → submitted | failed
 *                              pending_review（待补查） / skipped / unknown
 * 只要有 submitting 或 unknown 未消解，begin 一律拒绝；submitted 数达到 quota 也拒绝。
 */

const fs = require('fs');
const path = require('path');

function die(msg) { console.error('ERROR=' + msg); process.exit(1); }

function parseArgs(argv) {
  const pos = []; const opt = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const nx = argv[i + 1];
      if (nx === undefined || nx.startsWith('--')) opt[k] = true;
      else { opt[k] = nx; i++; }
    } else pos.push(a);
  }
  return { pos, opt };
}

const cmd = (process.argv[2] || '').toLowerCase();
const { opt } = parseArgs(process.argv.slice(3));
if (!cmd) die('缺少命令。可用: init/records/list/decide/skip/begin/finish/resolve/guard/status');
if (!opt.run) die('缺少 --run <运行目录>');

const ROOT = path.resolve(String(opt.run));
const STATE = path.join(ROOT, 'state.json');
const LOG = path.join(ROOT, 'ledger.jsonl');

// Windows 上用 PowerShell 写的 UTF-8 文件常带 BOM，JSON.parse 会直接报 Unexpected token
function readJson(p) {
  let t = fs.readFileSync(p, 'utf8');
  if (t.charCodeAt(0) === 0xFEFF) t = t.slice(1);
  return JSON.parse(t);
}
function load() {
  if (!fs.existsSync(STATE)) return null;
  return readJson(STATE);
}
function save(s) {
  fs.mkdirSync(ROOT, { recursive: true });
  const tmp = STATE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2), 'utf8');
  fs.renameSync(tmp, STATE);
}
function need() {
  const s = load();
  if (!s) die('运行目录还没 init: ' + ROOT);
  return s;
}
function logEvent(ev) {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.appendFileSync(LOG, JSON.stringify(Object.assign({ at: new Date().toISOString() }, ev)) + '\n', 'utf8');
}
function keyOf(r) {
  if (r.key) return String(r.key);
  if (!r.order) throw new Error('记录缺少 order 字段');
  return [r.order, r.refund_time || '', r.appeal || ''].join('|');
}
// 允许调用方只给订单号：唯一匹配时自动补全组合 key；多义时要求显式指定
function resolveKey(s, input) {
  const raw = String(input || '');
  if (!raw) throw new Error('缺少 key 或 order');
  if (s.records[raw]) return raw;
  const hits = Object.keys(s.records).filter((k) => s.records[k].order === raw);
  if (hits.length === 1) return hits[0];
  if (hits.length > 1) throw new Error('该订单有多条独立申诉记录，请用 --key 指定：\n  ' + hits.join('\n  '));
  throw new Error('该订单不在扫描记录中，先 records 合并扫描结果: ' + raw);
}

function guard(s) {
  const entries = Object.entries(s.ledger || {});
  const blocked = entries.filter(([, e]) => e.status === 'submitting' || e.status === 'unknown');
  if (blocked.length) {
    throw new Error('存在未消解的提交结果，先去平台核对再 resolve：' + blocked.map(([k]) => k).join(' ; '));
  }
  const done = entries.filter(([, e]) => e.status === 'submitted').length;
  if (done >= (s.quota || 0)) {
    throw new Error(`授权额度已用完（${done}/${s.quota}）。新批次请新建运行目录。`);
  }
  return { done, quota: s.quota || 0, remaining: (s.quota || 0) - done };
}

// 决策校验 —— 门槛：固定原因仍有可如实陈述的争议空间即可，但依据必须落到具体事实
function validateDecision(d) {
  const bad = [];
  if (d.supports_no_reason !== true) bad.push('supports_no_reason 必须为 true（表示固定原因仍有可如实陈述的争议空间）');
  const basis = String(d.basis || '').trim();
  if (basis.length < 12) bad.push('basis 太短：必须写出具体事实，不能写「证据不足」「请求复核」这类空话');
  if (/^(证据不足|未附图|买家无证据|请求复核|把握低)/.test(basis)) bad.push('basis 以空话开头，必须落到本单具体事实');
  if (d.images_reviewed !== true) bad.push('images_reviewed 必须为 true：必须先看过图再看结论');
  const c = d.merchant_issue_check;
  if (!c || typeof c !== 'object') bad.push('缺少 merchant_issue_check');
  else {
    if (!['clear', 'unresolved', 'confirmed_conflict'].includes(c.status)) bad.push('merchant_issue_check.status 只能是 clear/unresolved/confirmed_conflict');
    if (!String(c.source || '').trim()) bad.push('merchant_issue_check.source 必填（核查范围）');
    if (!String(c.finding || '').trim()) bad.push('merchant_issue_check.finding 必填（事实与不确定性）');
    if (c.status !== 'clear' && !String(c.dispute_basis || '').trim()) {
      bad.push('已知问题场景（status 非 clear）必须写 dispute_basis：承认已知问题后，哪条已核查事实仍支持固定原因');
    }
  }
  if (!String(d.description || '').trim()) bad.push('缺少 description（提交正文）');
  if (String(d.description || '').includes('其他')) bad.push('正文出现「其他」字样，检查是否误选了「其他申诉原因」');
  if (bad.length) throw new Error('决策校验未通过：\n  - ' + bad.join('\n  - '));
  return true;
}

const s = cmd === 'init' ? null : need();

try {
  if (cmd === 'init') {
    if (fs.existsSync(STATE)) die('该目录已有 state.json，直接用它恢复，不要重新 init');
    const quota = Number(opt.quota === undefined ? 0 : opt.quota);
    if (!Number.isInteger(quota) || quota < 0) die('--quota 必须是非负整数');
    const st = {
      version: 1, created: new Date().toISOString(), note: opt.note ? String(opt.note) : '',
      quota, records: {}, ledger: {},
    };
    save(st);
    logEvent({ event: 'init', quota, note: st.note });
    console.log(`OK=true RUN=${ROOT} QUOTA=${quota}`);
    console.log('说明：quota=0 表示只扫描不提交。');
  } else if (cmd === 'records') {
    if (!opt.file) die('缺少 --file');
    const arr = readJson(String(opt.file));
    if (!Array.isArray(arr)) die('--file 必须是记录数组');
    let added = 0, merged = 0;
    for (const r of arr) {
      let k;
      try { k = keyOf(r); } catch (e) { die(e.message); }
      if (s.records[k]) { merged++; } else { added++; }
      s.records[k] = Object.assign({}, s.records[k] || {}, r, { key: k, seen: new Date().toISOString() });
      if (!s.ledger[k]) s.ledger[k] = { status: 'pending', events: [] };
    }
    save(s);
    logEvent({ event: 'records', added, merged });
    console.log(`OK=true ADDED=${added} MERGED=${merged} TOTAL=${Object.keys(s.records).length}`);
  } else if (cmd === 'list') {
    const want = opt.status ? String(opt.status) : null;
    const rows = Object.entries(s.records)
      .filter(([k]) => !want || (s.ledger[k] || {}).status === want)
      .map(([k, r]) => ({
        key: k, status: (s.ledger[k] || {}).status,
        order: r.order, product: r.product, refund: r.refund, refund_time: r.refund_time,
        appeal: r.appeal, countdown: r.countdown, page: r.page,
      }));
    if (opt.json) console.log(JSON.stringify(rows, null, 2));
    else {
      console.log(`OK=true TOTAL=${rows.length} QUOTA=${s.quota}`);
      for (const r of rows) console.log(`  [${r.status}] ${r.key} | ${r.refund || ''} | ${r.appeal || ''} | ${r.countdown || ''}`);
    }
  } else if (cmd === 'decide') {
    if (!opt.file) die('缺少 --file');
    const d = readJson(String(opt.file));
    if (!d.key && !d.order) die('decision 必须有 key 或 order');
    const k = resolveKey(s, d.key || d.order);
    validateDecision(d);
    s.ledger[k] = s.ledger[k] || { status: 'pending', events: [] };
    if (['submitting', 'submitted', 'unknown'].includes(s.ledger[k].status)) {
      die('该单状态为 ' + s.ledger[k].status + '，不可覆盖');
    }
    s.ledger[k].status = 'decided';
    s.ledger[k].decision = d;
    s.ledger[k].decided_at = new Date().toISOString();
    save(s);
    logEvent({ event: 'decide', key: k, amount: d.amount || null, reason: d.reason || null });
    console.log(`OK=true KEY=${k} STATUS=decided`);
  } else if (cmd === 'skip') {
    const k = resolveKey(s, opt.key);
    const st = (s.ledger[k] || {}).status;
    if (['submitting', 'submitted', 'unknown'].includes(st)) die('该单已是 ' + st + '，不能用 skip 覆盖');
    const note = String(opt.note || '').trim();
    if (note.length < 8) die('--note 必须说明为何该单已无可如实陈述的争议空间');
    s.ledger[k] = Object.assign(s.ledger[k] || {}, {
      status: opt.pending ? 'pending_review' : 'skipped',
      note, at: new Date().toISOString(),
    });
    save(s);
    logEvent({ event: opt.pending ? 'pending_review' : 'skip', key: k, note });
    console.log(`OK=true KEY=${k} STATUS=${s.ledger[k].status}`);
  } else if (cmd === 'guard') {
    const g = guard(s);
    console.log(`OK=true DONE=${g.done} QUOTA=${g.quota} REMAINING=${g.remaining}`);
  } else if (cmd === 'begin') {
    const k = resolveKey(s, opt.key);
    const e = s.ledger[k] || {};
    if (e.status === 'submitted') die('该单已提交，不重复提交');
    if (e.status === 'submitting' || e.status === 'unknown') die('该单结果未明，先去平台核对并 resolve');
    const g = guard(s);
    s.ledger[k] = Object.assign(e, {
      status: 'submitting', begin_at: new Date().toISOString(),
      decision: e.decision || null,
    });
    save(s);
    logEvent({ event: 'begin', key: k, remaining_before: g.remaining });
    console.log(`OK=true KEY=${k} STATUS=submitting REMAINING=${g.remaining}`);
  } else if (cmd === 'finish') {
    const k = resolveKey(s, opt.key);
    const res = String(opt.result || '');
    if (!['submitted', 'failed', 'unknown'].includes(res)) die('--result 只能是 submitted/failed/unknown');
    if (!s.ledger[k]) die('未知 key: ' + k);
    if (s.ledger[k].status === 'submitted' && res === 'submitted') die('已记录过提交成功');
    s.ledger[k].status = res;
    s.ledger[k].finished_at = new Date().toISOString();
    if (opt.note) s.ledger[k].note = String(opt.note);
    if (opt.amount) s.ledger[k].amount = String(opt.amount);
    save(s);
    logEvent({ event: 'finish', key: k, result: res, note: opt.note || null, amount: opt.amount || null });
    console.log(`OK=true KEY=${k} STATUS=${res}`);
    if (res === 'unknown') console.log('提醒：状态不明会阻断后续提交。去平台申诉记录核对后再 resolve。');
  } else if (cmd === 'resolve') {
    const k = resolveKey(s, opt.key);
    const res = String(opt.result || '');
    if (!['submitted', 'not-submitted'].includes(res)) die('--result 只能是 submitted / not-submitted');
    const note = String(opt.note || '').trim();
    if (note.length < 8) die('--note 必须写平台核查依据（申诉记录里的订单、时间、金额）');
    const e = s.ledger[k];
    if (!e) die('未知 key: ' + k);
    e.status = res === 'submitted' ? 'submitted' : 'pending';
    e.resolved_at = new Date().toISOString();
    e.resolve_note = note;
    save(s);
    logEvent({ event: 'resolve', key: k, result: res, note });
    console.log(`OK=true KEY=${k} STATUS=${e.status}`);
  } else if (cmd === 'status') {
    const entries = Object.entries(s.ledger);
    const tally = {};
    for (const [, e] of entries) tally[e.status] = (tally[e.status] || 0) + 1;
    console.log(`RUN=${ROOT}`);
    console.log(`NOTE=${s.note || '-'}`);
    console.log(`QUOTA=${s.quota} SUBMITTED=${tally.submitted || 0} REMAINING=${(s.quota || 0) - (tally.submitted || 0)}`);
    console.log('TALLY=' + Object.entries(tally).map(([k, v]) => `${k}:${v}`).join(' '));
    if (tally.unknown || tally.submitting) console.log('⚠ 有未消解结果，begin 会被拒绝。先 resolve。');
  } else {
    die('未知命令: ' + cmd);
  }
} catch (e) {
  die(e.message);
}
