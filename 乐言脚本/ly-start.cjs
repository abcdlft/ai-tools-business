// 以脱离方式启动守护进程（父进程退出后仍存活）
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const DAEMON = path.join(__dirname, 'ly-daemon.cjs');
const LOCK = path.join(__dirname, 'ly-daemon.lock');
const interval = process.argv[2] || '300';

// 已在运行则不重复启动
if (fs.existsSync(LOCK)) {
  const pid = Number(fs.readFileSync(LOCK, 'utf8').trim());
  let alive = false;
  try { process.kill(pid, 0); alive = true; } catch {}
  if (alive) { console.log('守护已在运行 PID=' + pid); process.exit(0); }
  try { fs.unlinkSync(LOCK); } catch {}
}

const child = spawn(process.execPath, [DAEMON, interval], {
  cwd: __dirname,
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
});
child.unref();
console.log('已启动守护 PID=' + child.pid + ' 间隔=' + interval + 's');
