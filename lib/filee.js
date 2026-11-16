'use strict';
/* Filee 命令行引擎封装（https://github.com/KnifeLemon/Filee，MIT）。
 * 它自带 279 种格式的转换器（图片/PDF/Office/HWP/电子书/音视频/压缩包/字体/CAD/3D/地图），
 * 不需要装 Office 也不需要装 LibreOffice。这里只当它的命令行使用者。 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const APP_DIR = path.resolve(__dirname, '..');
const CLI = path.join(APP_DIR, 'tools', 'filee', 'filee-cli.exe');
const CACHE = path.join(os.tmpdir(), 'cl-filee-formats.json');

function available() {
  return fs.existsSync(CLI);
}

function run(args, timeoutMs) {
  return new Promise((resolve) => {
    if (!available()) return resolve({ code: -1, out: '没有找到 Filee 引擎' });
    const child = spawn(CLI, args, { windowsHide: true, cwd: path.dirname(CLI) });
    let out = '';
    const timer = setTimeout(() => {
      try { spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true }); } catch (_) {}
      resolve({ code: -9, out: out + '\n（超时）' });
    }, timeoutMs || 240000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ code: -1, out: e.message }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

let memo = null;

/** 可用输出格式（只留 writable），带类别 */
async function formats() {
  if (memo) return memo;
  const r = await run(['formats', '--json'], 60000);
  let list = [];
  try {
    const start = r.out.indexOf('{');
    const data = JSON.parse(r.out.slice(start));
    list = (data.formats || []).filter((f) => f.writable).map((f) => ({
      id: f.id, name: f.name || f.id, category: f.category || 'other',
    }));
  } catch (_) {
    list = [];
  }
  memo = list;
  return list;
}

const CAT_LABEL = {
  image: '图片', pdf: 'PDF', document: '文档', spreadsheet: '表格', presentation: '演示',
  text: '文本', data: '数据', ebook: '电子书', hwp: '韩文办公文档', video: '视频', audio: '音频',
  archive: '压缩包', font: '字体', vector: '矢量图', cad: 'CAD', subtitle: '字幕',
  model3d: '3D 模型', geo: '地图数据', other: '其它',
};

const EXT_OF_FMT = {
  jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif', bmp: 'bmp', tiff: 'tiff', pdf: 'pdf',
  docx: 'docx', doc: 'doc', odt: 'odt', rtf: 'rtf', txt: 'txt', md: 'md', html: 'html', epub: 'epub',
  xlsx: 'xlsx', xls: 'xls', csv: 'csv', ods: 'ods', pptx: 'pptx', ppt: 'ppt', mp3: 'mp3', wav: 'wav',
  mp4: 'mp4', mkv: 'mkv', webm: 'webm', gif2: 'gif', ico: 'ico', zip: 'zip', '7z': '7z', tar: 'tar',
};

/** 转一个文件到指定格式；结果落在 outDir（重名由 Filee 自己加 (2)） */
async function convertOne(inputAbs, fmt, outDir) {
  if (!available()) throw new Error('这台电脑上没有安装 Filee 引擎（tools\\filee）');
  const before = new Set(safeList(outDir));
  const r = await run(['convert', inputAbs, '--to', fmt, '-o', outDir], 300000);
  const after = safeList(outDir).filter((n) => !before.has(n));
  if (!after.length) {
    const tail = r.out.trim().split(/\r?\n/).slice(-2).join(' ');
    throw new Error('Filee 转换失败：' + (tail || '没有生成文件'));
  }
  // 多页文件会生成多个（xxx_p1.webp 这种），全部返回
  const want = (EXT_OF_FMT[fmt] || fmt).toLowerCase();
  const hits = after.filter((n) => n.toLowerCase().endsWith('.' + want));
  return (hits.length ? hits : after).sort().map((n) => path.join(outDir, n));
}

function safeList(dir) {
  try { return fs.readdirSync(dir); } catch (_) { return []; }
}

module.exports = { available, formats, convertOne, CAT_LABEL, cliPath: () => CLI };
