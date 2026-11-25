#!/usr/bin/env node
/**
 * run-all.cjs —— 批量跑复议任务（默认只填不提交）
 *
 * 用法：
 *   node run-all.cjs --dir <任务目录> [--submit] [--only 订单号1,订单号2]
 *
 * 每单：关闭残留弹窗 → 打开复议 → 填原因/金额/描述 → 传必填+选填凭证 → 回读校验
 * 只有 --submit 才点提交；提交后按页面文本判定 SUCCESS/UNKNOWN。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const dir = args[args.indexOf('--dir') + 1];
const doSubmit = args.includes('--submit');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx > -1 ? args[onlyIdx + 1].split(',').map((s) => s.trim()) : null;
if (!dir) { console.log('用法: node run-all.cjs --dir <任务目录> [--submit] [--only a,b]'); process.exit(2); }

const files = fs.readdirSync(dir).filter((f) => /^t-.*\.json$/.test(f)).sort();
const log = [];
const say = (s) => { console.log(s); log.push(s); };

for (const f of files) {
  const task = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, ''));
  if (only && !only.includes(task.order)) continue;
  say('\n========== ' + task.order + '  金额 ' + task.amount);
  const t = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, ''));
  if (doSubmit) t.submit = true;
  const tmp = path.join(dir, '_run.json');
  fs.writeFileSync(tmp, JSON.stringify(t, null, 2), 'utf8');
  let out = '';
  try {
    out = execFileSync(process.execPath, [path.join(__dirname, '..', 'review.cjs'), '--task', tmp], {
      encoding: 'utf8', timeout: ID-XXXX,
    });
  } catch (e) {
    out = (e.stdout || '') + '\nEXEC_ERR=' + (e.stderr || e.message);
  }
  for (const line of out.split('\n')) {
    if (/OPEN|AFTER_REASON|FILE_INPUTS|EVIDENCE|上限=|原因=|金额=|描述长度|SUBMIT|ERROR|EXEC_ERR|BODY|FILLED/.test(line)) say('  ' + line.trim());
  }
  if (doSubmit && /SUBMIT=SUCCESS/.test(out)) say('  >>> 已提交成功');
  else if (doSubmit && /SUBMIT=UNKNOWN|ERROR/.test(out)) { say('  >>> 结果不明，停止'); break; }
}

fs.writeFileSync(path.join(dir, doSubmit ? 'submit.log' : 'fill.log'), log.join('\n'), 'utf8');
say('\nDONE=' + files.length);
