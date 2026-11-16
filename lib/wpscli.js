'use strict';
/* WPS 自带转换引擎的封装。
 * WPS 12 装了 kwpsconvert.exe（内部转 wpscli），支持：
 *   pdf2word / pdf2excel / pdf2ppt / pdf2txt / pdf2photo
 *   word2pdf / excel2pdf / ppt2pdf / txt2pdf / photo2pdf
 *   photo2word / photo2excel / photo2ppt / word2photo / excel2photo / ppt2photo
 * 这些就是 WPS 界面里「PDF 转 Word」那套引擎，成功率与还原度最高。
 * 首次跑某个子命令时 WPS 会顺手下载对应插件，可能要十几秒，代码里带一次重试。 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

let cached = null;

function findCli() {
  if (cached !== null) return cached;
  const roots = [
    'C:\\Program Files (x86)\\WPS Office',
    'C:\\Program Files\\WPS Office',
    path.join(process.env.LOCALAPPDATA || '', 'Kingsoft', 'WPS Office'),
    path.join(process.env.LOCALAPPDATA || '', 'Kingsoft', 'WPS Office', '12.1.0.29690'),
  ];
  const found = [];
  for (const root of roots) {
    let dirs = [];
    try { dirs = fs.readdirSync(root); } catch (_) { continue; }
    // 版本目录直接就是 office6 的父目录时也要试
    if (fs.existsSync(path.join(root, 'office6', 'kwpsconvert.exe'))) {
      found.push(path.join(root, 'office6', 'kwpsconvert.exe'));
    }
    for (const d of dirs) {
      const cli = path.join(root, d, 'office6', 'kwpsconvert.exe');
      if (fs.existsSync(cli)) found.push(cli);
    }
  }
  // 版本号大的排前面
  found.sort((a, b) => {
    const na = (a.match(/(\d+\.\d+\.\d+\.\d+)/) || [])[1] || '';
    const nb = (b.match(/(\d+\.\d+\.\d+\.\d+)/) || [])[1] || '';
    return nb.localeCompare(na, undefined, { numeric: true });
  });
  cached = found[0] || '';
  return cached;
}

function available() {
  return !!findCli();
}

function runOnce(cli, sub, inputAbs, outPath) {
  return new Promise((resolve) => {
    const child = spawn(cli, [sub, inputAbs, '-o', outPath], { windowsHide: true });
    let out = '';
    const timer = setTimeout(() => {
      try { spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true }); } catch (_) {}
      resolve({ ok: false, msg: '超时（' + sub + '）' });
    }, 240000);
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { out += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, msg: e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      const ok = code === 0 && fs.existsSync(outPath);
      resolve({ ok, msg: ok ? '' : (out.trim().split(/\r?\n/).filter(Boolean).slice(-2).join(' ') || 'exit ' + code) });
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 执行一条 WPS 转换命令；首次失败（插件下载中）会自动重试一次 */
async function convert(sub, inputAbs, outPath) {
  const cli = findCli();
  if (!cli) throw new Error('这台电脑上没找到 WPS 转换组件');
  let r = await runOnce(cli, sub, inputAbs, outPath);
  if (!r.ok && /Failed to initialize|Error\(5\)/i.test(r.msg)) {
    await sleep(6000);
    r = await runOnce(cli, sub, inputAbs, outPath);
  }
  if (!r.ok) throw new Error('WPS 转换失败：' + r.msg);
  return outPath;
}

/** 子命令表：kind + to → wpscli 子命令 */
const SUB = {
  'pdf>docx': 'pdf2word',
  'pdf>txt': 'pdf2txt',
  'pdf>xlsx': 'pdf2excel',
  'pdf>pptx': 'pdf2ppt',
  'office>pdf': null, // 由调用方按扩展名细分
  'image>docx': 'photo2word',
  'image>xlsx': 'photo2excel',
  'image>pptx': 'photo2ppt',
  'image>pdf': 'photo2pdf',
  'text>pdf': 'txt2pdf',
};
const OFFICE_PDF = { word: 'word2pdf', excel: 'excel2pdf', ppt: 'ppt2pdf' };

function subFor(kind, ext, to, officeKind) {
  if (kind === 'office' && to === 'pdf') return OFFICE_PDF[officeKind] || null;
  return SUB[kind + '>' + to] || null;
}

module.exports = { available, convert, subFor, findCli };
