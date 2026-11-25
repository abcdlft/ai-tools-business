// 最小 asar 解包器（无依赖）: node asar-extract.cjs <app.asar> <outDir> [--list]
const fs = require('fs');
const path = require('path');

const src = process.argv[2];
const out = process.argv[3] || path.join(process.cwd(), 'asar-out');
const listOnly = process.argv.includes('--list');

const fd = fs.openSync(src, 'r');
const sizeBuf = Buffer.alloc(8);
fs.readSync(fd, sizeBuf, 0, 8, 0);
const headerPickleSize = sizeBuf.readUInt32LE(4); // payload size of size pickle
const headerBuf = Buffer.alloc(headerPickleSize);
fs.readSync(fd, headerBuf, 0, headerPickleSize, 8);
const jsonSize = headerBuf.readUInt32LE(4);
const jsonStr = headerBuf.slice(8, 8 + jsonSize).toString('utf8');
const header = JSON.parse(jsonStr);
const dataStart = 8 + headerPickleSize;

let nFiles = 0, nBytes = 0;
const rows = [];

function walk(node, prefix) {
  for (const [name, v] of Object.entries(node.files || {})) {
    const p = prefix ? prefix + '/' + name : name;
    if (v.files) { walk(v, p); continue; }
    nFiles++; nBytes += (v.size || 0);
    rows.push({ p, size: v.size || 0, off: v.offset === undefined ? null : Number(v.offset), unpacked: !!v.unpacked });
    if (listOnly || v.unpacked || v.offset === undefined) continue;
    const dst = path.join(out, p);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const b = Buffer.alloc(v.size);
    fs.readSync(fd, b, 0, v.size, dataStart + Number(v.offset));
    fs.writeFileSync(dst, b);
  }
}
walk(header, '');
fs.closeSync(fd);

rows.sort((a, b) => b.size - a.size);
console.log(`files=${nFiles} bytes=${nBytes} (${(nBytes / ID-XXXX).toFixed(1)} MB) dataStart=${dataStart}`);
if (listOnly) {
  rows.slice(0, 60).forEach((r) => console.log(String(r.size).padStart(9), r.p + (r.unpacked ? '  [unpacked]' : '')));
} else {
  console.log('extracted to ' + out);
}
