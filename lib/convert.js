'use strict';
/* 格式转换：Office → PDF（本机 Word/Excel/PPT），PDF → PNG（Windows 自带渲染）。
 * 全部用异步 spawn，避免卡住服务；PowerShell 脚本放在 tools/ 下。 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { pdfText } = require('./pdftext');
const { buildDocx, buildDocxFromImages } = require('./docxwrite');
const { buildXlsx } = require('./sheetwrite');
const EX = require('./extract');
const WPS = require('./wpscli');

const APP_DIR = path.resolve(__dirname, '..');
const TOOLS = path.join(APP_DIR, 'tools');
const PS = 'powershell.exe';

const KIND = { docx: 'word', doc: 'word', rtf: 'word', xlsx: 'excel', xls: 'excel', csv: 'excel', pptx: 'ppt', ppt: 'ppt' };

function psFile(script, args, timeout) {
  return new Promise((resolve) => {
    const child = spawn(PS, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', path.join(TOOLS, script), ...args], {
      windowsHide: true,
    });
    let out = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], { windowsHide: true }); } catch (_) {}
      try { child.kill(); } catch (_) {}
      resolve({ ok: false, out: out + '\n[超时]', code: -1 });
    }, timeout || 240000);
    child.stdout.on('data', (b) => { out += b.toString('utf8'); });
    child.stderr.on('data', (b) => { out += b.toString('utf8'); });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, out: out + '\n' + e.message, code: -1 });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: /^ok\b/m.test(out), out, code });
    });
  });
}

async function officeToPdf(inAbs, outAbs) {
  const ext = path.extname(inAbs).slice(1).toLowerCase();
  const kind = KIND[ext];
  if (!kind) throw new Error('不支持把 .' + ext + ' 转成 PDF');
  const r = await psFile('office2pdf.ps1', ['-In', inAbs, '-Out', outAbs, '-Kind', kind]);
  if (!r.ok || !fs.existsSync(outAbs)) {
    const last = (r.out || '').split(/\r?\n/).filter(Boolean).pop() || '未知错误';
    throw new Error('转换失败：' + last.replace(/^FAIL\s*/, ''));
  }
  return outAbs;
}

async function pdfToPng(pdfAbs, outDir, width) {
  fs.mkdirSync(outDir, { recursive: true });
  const r = await psFile('pdf2png.ps1', ['-Pdf', pdfAbs, '-OutDir', outDir, '-Width', String(width || 1600)], 180000);
  const files = fs.existsSync(outDir) ? fs.readdirSync(outDir).filter((f) => /\.png$/i.test(f)).sort() : [];
  if (!files.length) {
    const last = (r.out || '').split(/\r?\n/).filter(Boolean).pop() || '未知错误';
    throw new Error('PDF 渲染失败：' + last);
  }
  return files.map((f) => path.join(outDir, f));
}

async function pdfToDocOrTxt(pdfAbs, outAbs, format) {
  const buf = fs.readFileSync(pdfAbs);
  const r = pdfText(buf);
  if (!r.hadText) throw new Error('这个 PDF 是扫描件（没有文字层），转 Word/文本没有内容，建议转成图片');
  if (format === 'docx') {
    fs.writeFileSync(outAbs, buildDocx(r.pages));
  } else {
    const text = r.pages.map((p, i) => (r.pages.length > 1 ? '【第 ' + (i + 1) + ' 页】\n' + p : p)).join('\n\n');
    fs.writeFileSync(outAbs, text, 'utf8');
  }
  return outAbs;
}

function extOf(rel) { return path.extname(rel).slice(1).toLowerCase(); }
function baseOf(rel) { return path.basename(rel, path.extname(rel)); }

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']);
const TEXT_EXT = new Set(['txt', 'md', 'csv', 'json', 'log', 'ini', 'xml', 'html', 'htm', 'py', 'js', 'ts', 'c', 'h', 'java', 'css', 'sql', 'yml', 'yaml']);

function kindOf(rel) {
  const e = extOf(rel);
  if (e === 'pdf') return 'pdf';
  if (TEXT_EXT.has(e)) return 'text';
  if (KIND[e]) return 'office';
  if (IMG_EXT.has(e)) return 'image';
  if (TEXT_EXT.has(e)) return 'text';
  return 'other';
}
function targetsFor(rel) {
  const k = kindOf(rel);
  const e = extOf(rel);
  const wps = WPS.available();
  if (k === 'pdf') return ['png', 'docx', 'txt'].concat(wps ? ['xlsx', 'pptx'] : []);
  if (k === 'image') return ['docx', 'pdf', 'png'].concat(wps ? ['xlsx', 'pptx'] : []);
  if (k === 'office') {
    const out = ['pdf', 'png'];
    if (e === 'pptx' || e === 'ppt') out.push('docx');
    if (e === 'xlsx' || e === 'xls') out.push('csv');
    if (e === 'docx' || e === 'doc') out.push('txt');
    return out;
  }
  if (k === 'text') return e === 'csv' ? ['xlsx', 'docx', 'pdf'] : ['docx', 'pdf', 'xlsx', 'png'];
  return [];
}

function tmpFile(ext) {
  return path.join(os.tmpdir(), 'cl-conv-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.' + ext);
}

/** 文本类文件读成行（自动识别编码） */
function readTextLines(abs) {
  const buf = fs.readFileSync(abs);
  const text = EX.decodeTextBuffer(buf);
  return String(text || '').split(/\r?\n/);
}

async function convertOne(rootAbs, rel, to, opts) {
  const o = opts || {};
  const inAbs = path.join(rootAbs, rel);
  if (!fs.existsSync(inAbs)) throw new Error('文件不存在：' + rel);
  const outRoot = o.outDir || path.join(APP_DIR, '导出');
  fs.mkdirSync(outRoot, { recursive: true });
  const base = baseOf(rel);
  const kind = kindOf(rel);
  const ext = extOf(rel);
  const t = targetsFor(rel);
  const tmpList = [];
  const mkTmp = (x) => { const p = tmpFile(x); tmpList.push(p); return p; };

  try {
    // ① 能用 WPS 自带引擎的目标，优先走 WPS（还原度最高，就是 WPS 界面里那套）
    const wpsSub = WPS.available() ? WPS.subFor(kind, ext, to, KIND[ext]) : null;
    if (wpsSub) {
      const outAbs = uniquePath(path.join(outRoot, base + '.' + (to === 'img' ? 'png' : to)));
      try {
        await WPS.convert(wpsSub, inAbs, outAbs);
        return [outAbs];
      } catch (e) {
        // 交给下面的本地实现兜底
        if (o.strictWps) throw e;
      }
    }

    if (to === 'pdf') {
      if (!t.includes('pdf')) throw new Error('这个格式不能转成 PDF');
      if (kind === 'office') return [await officeToPdf(inAbs, uniquePath(path.join(outRoot, base + '.pdf')))];
      // 图片 / 文本 先做成 docx，再用 Word 转 PDF
      const docxTmp = mkTmp('docx');
      if (kind === 'image') fs.writeFileSync(docxTmp, buildDocxFromImages([{ buf: fs.readFileSync(inAbs), name: path.basename(inAbs) }]));
      else fs.writeFileSync(docxTmp, buildDocx([readTextLines(inAbs).join('\n')]));
      return [await officeToPdf(docxTmp, uniquePath(path.join(outRoot, base + '.pdf')))];
    }

    if (to === 'png' || to === 'img') {
      if (!t.includes('png')) throw new Error('这个格式不能转成图片');
      let pdf = inAbs;
      if (kind !== 'pdf') {
        if (kind === 'office') { pdf = mkTmp('pdf'); await officeToPdf(inAbs, pdf); }
        else {
          const docxTmp = mkTmp('docx');
          if (kind === 'image') fs.writeFileSync(docxTmp, buildDocxFromImages([{ buf: fs.readFileSync(inAbs) }]));
          else fs.writeFileSync(docxTmp, buildDocx([readTextLines(inAbs).join('\n')]));
          pdf = mkTmp('pdf');
          await officeToPdf(docxTmp, pdf);
        }
      }
      const dir = uniqueDir(path.join(outRoot, base));
      const raws = await pdfToPng(pdf, dir, o.width || 1600);
      return raws.map((f) => {
        const m = /_(\d+)\.png$/i.exec(path.basename(f));
        if (!m) return f;
        const target = path.join(path.dirname(f), base + '_' + m[1] + '.png');
        try { if (target !== f) fs.renameSync(f, target); return target; } catch (_) { return f; }
      });
    }

    if (to === 'docx') {
      if (!t.includes('docx')) throw new Error('这个格式不能转成 Word');
      const outAbs = uniquePath(path.join(outRoot, base + '.docx'));
      if (kind === 'pdf') {
        const r = pdfText(fs.readFileSync(inAbs));
        if (!r.hadText) throw new Error('这个 PDF 是扫描件（没有文字层），转 Word 没有内容，建议转成图片');
        fs.writeFileSync(outAbs, buildDocx(r.pages));
      } else if (kind === 'image') {
        fs.writeFileSync(outAbs, buildDocxFromImages([{ buf: fs.readFileSync(inAbs) }]));
      } else if (kind === 'text') {
        fs.writeFileSync(outAbs, buildDocx([readTextLines(inAbs).join('\n')]));
      } else if (ext === 'pptx' || ext === 'ppt') {
        if (ext !== 'pptx') throw new Error('.ppt 旧格式请先在 Office 里另存为 .pptx');
        const slides = EX.pptxSlides(fs.readFileSync(inAbs));
        const pages = slides.map((sl) => sl.lines.join('\n'));
        fs.writeFileSync(outAbs, buildDocx(pages.length ? pages : ['（这个 PPT 没有可提取的文字）']));
      } else {
        throw new Error('这个格式不能转成 Word');
      }
      return [outAbs];
    }

    if (to === 'txt') {
      if (!t.includes('txt')) throw new Error('这个格式不能转成纯文本');
      const outAbs = uniquePath(path.join(outRoot, base + '.txt'));
      let text = '';
      if (kind === 'pdf') {
        const r = pdfText(fs.readFileSync(inAbs));
        if (!r.hadText) throw new Error('这个 PDF 是扫描件（没有文字层），转文本没有内容');
        text = r.pages.map((p, i) => (r.pages.length > 1 ? '【第 ' + (i + 1) + ' 页】\n' + p : p)).join('\n\n');
      } else if (kind === 'text') {
        text = readTextLines(inAbs).join('\n');
      } else if (ext === 'docx') {
        const d = EX.docxParagraphs(fs.readFileSync(inAbs));
        text = (d.paragraphs || []).map((p) => p.text).join('\n');
      } else if (ext === 'pptx') {
        text = EX.pptxSlides(fs.readFileSync(inAbs)).map((s, i) => '【第 ' + (i + 1) + ' 页】\n' + s.lines.join('\n')).join('\n\n');
      } else {
        throw new Error('这个格式不能转成纯文本');
      }
      fs.writeFileSync(outAbs, text, 'utf8');
      return [outAbs];
    }

    if (to === 'xlsx') {
      if (!t.includes('xlsx')) throw new Error('这个格式不能转成 Excel');
      const outAbs = uniquePath(path.join(outRoot, base + '.xlsx'));
      let rows;
      if (ext === 'csv') rows = splitCsv(fs.readFileSync(inAbs));
      else rows = readTextLines(inAbs).map((l) => [l]);
      fs.writeFileSync(outAbs, buildXlsx(rows.length ? rows : [['']], 'Sheet1'));
      return [outAbs];
    }

    if (to === 'csv') {
      if (!t.includes('csv')) throw new Error('这个格式不能转成 CSV');
      const outAbs = uniquePath(path.join(outRoot, base + '.csv'));
      const buf = fs.readFileSync(inAbs);
      const read = EX.xlsxRead(buf, { grid: true });
      const sheet = read.sheets[0];
      const rows = (sheet && sheet.grid) || [];
      const csv = rows.map((r) => r.map((c) => {
        const v = c == null ? '' : (typeof c === 'object' ? (c.formula ? '=' + c.formula : (c.text == null ? '' : String(c.text))) : String(c));
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',')).join('\r\n');
      fs.writeFileSync(outAbs, '\ufeff' + csv, 'utf8');
      return [outAbs];
    }

    throw new Error('未知目标格式：' + to);
  } finally {
    for (const p of tmpList) { try { fs.unlinkSync(p); } catch (_) {} }
  }
}

/** CSV → 二维数组（简易解析，带引号） */
function splitCsv(buf) {
  let text = EX.decodeTextBuffer(buf).replace(/^\ufeff/, '');
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') { q = true; continue; }
    if (ch === ',') { row.push(cell); cell = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const base = path.basename(p, ext);
  for (let i = 2; i < 999; i++) {
    const q = path.join(dir, base + '(' + i + ')' + ext);
    if (!fs.existsSync(q)) return q;
  }
  return p;
}
function uniqueDir(p) {
  if (!fs.existsSync(p)) return p;
  for (let i = 2; i < 999; i++) {
    const q = p + '(' + i + ')';
    if (!fs.existsSync(q)) return q;
  }
  return p;
}

module.exports = { officeToPdf, pdfToPng, convertOne, targetsFor, kindOf, KIND };
