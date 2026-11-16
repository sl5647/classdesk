'use strict';
/* 课程文件库 · 本地服务（零依赖，只监听 127.0.0.1） */

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const APP_DIR = __dirname;
const PUBLIC_DIR = path.join(APP_DIR, 'public');
const CONFIG_PATH = path.join(APP_DIR, 'config.json');
const PORT_FILE = path.join(APP_DIR, 'port.txt');

const ZW = require('./lib/zip');
const EX = require('./lib/extract');
const { Store, isTempName } = require('./lib/store');
const { autoTagList } = require('./lib/autotag');
const { findDuplicates, findSeries } = require('./lib/analyse');
const { buildXlsx } = require('./lib/sheetwrite');
const CV = require('./lib/convert');
const FE = require('./lib/filee');
const AT = require('./lib/attendance');
const EDU = require('./lib/edustore');
const AP = require('./lib/attpl');
const WPS = require('./lib/wpscli');
const PX = require('./lib/pdftext');

/* ------------------------------ 配置 ------------------------------ */

function defaultRoot() {
  return path.join(os.homedir(), 'Documents', '课程文件库资料');
}

let config = { port: 7788, root: defaultRoot(), source: '' };

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, '');
    const c = JSON.parse(raw);
    if (c && typeof c === 'object') {
      if (Number(c.port)) config.port = Number(c.port);
      if (c.root) config.root = String(c.root);
      if (typeof c.source === 'string') config.source = c.source;
    }
  } catch (e) {
    if (e && e.code !== 'ENOENT') console.warn('[config] 读取 config.json 失败，使用默认配置：' + e.message);
  }
  if (process.env.CL_PORT) config.port = Number(process.env.CL_PORT) || config.port;
  if (process.env.CL_ROOT) config.root = process.env.CL_ROOT;
  if (process.env.CL_SOURCE) config.source = process.env.CL_SOURCE;
}

function saveConfig() {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  } catch (e) {
    console.warn('[config] 保存失败：' + e.message);
  }
}

/* ------------------------------ 库状态 ------------------------------ */

let store = null;
let scanState = { running: false, total: 0, done: 0, last: null };
let libRev = 0;
let libWatcher = null;
let watchTimer = null;
let watchPending = false;

function openStore() {
  store = new Store(config.root);
  if (store.error) console.error('[store] ' + store.error);
}

/* ------------------------------ 小工具 ------------------------------ */

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}
function ok(res, payload) { sendJson(res, 200, Object.assign({ ok: true }, payload || {})); }
function fail(res, code, msg) { sendJson(res, code, { ok: false, error: msg }); }

function formatSize(n) {
  if (!n) return '0 B';
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}

function stamp(d) {
  const t = d || new Date();
  const p = (x) => String(x).padStart(2, '0');
  return t.getFullYear() + p(t.getMonth() + 1) + p(t.getDate()) + '-' + p(t.getHours()) + p(t.getMinutes());
}

function safeFileName(name) {
  return String(name || '').replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
}

function exportDir() {
  const d = path.join(config.root, '导出');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const ext = path.extname(p);
  const base = p.slice(0, p.length - ext.length);
  let n = 2;
  while (fs.existsSync(base + '(' + n + ')' + ext)) n += 1;
  return base + '(' + n + ')' + ext;
}

function psFile(script, args, timeoutMs) {
  return new Promise((resolve) => {
    const abs = path.join(APP_DIR, script);
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', abs].concat(args || []), { windowsHide: true });
    let out = '', err = '';
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      try { spawn('taskkill', ['/T', '/F', '/PID', String(ps.pid)], { windowsHide: true }); } catch (e) {}
      resolve({ code: -1, out, err: err + ' (timeout)' });
    }, timeoutMs || 60000);
    ps.stdout.on('data', (d) => { out += d.toString('utf8'); });
    ps.stderr.on('data', (d) => { err += d.toString('utf8'); });
    ps.on('close', (code) => {
      if (done) return;
      done = true; clearTimeout(timer);
      resolve({ code, out, err });
    });
    ps.on('error', (e) => { if (done) return; done = true; clearTimeout(timer); resolve({ code: -1, out, err: err + e.message }); });
  });
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (limit && size > limit) { reject(new Error('内容太大了')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req, 8 * 1024 * 1024);
  if (!buf.length) return {};
  try {
    return JSON.parse(buf.toString('utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error('JSON 解析失败');
  }
}

function exploreFolder(dir) {
  // 用 Shell.Application.Explore 打开（COM 会把窗口激活），比 explorer.exe 参数更可靠
  const ps1 = path.join(os.tmpdir(), 'courselib-explore-' + process.pid + '.ps1');
  const code = [
    '$ErrorActionPreference = "Stop"',
    'try {',
    '  $sh = New-Object -ComObject Shell.Application',
    '  $sh.Explore($env:CL_DIR)',
    '  Start-Sleep -Milliseconds 600',
    "  Write-Output 'OK'",
    '} catch {',
    "  Write-Output ('ERR ' + $_.Exception.Message)",
    '}',
  ].join('\n');
  try { fs.writeFileSync(ps1, code, 'utf8'); } catch (e) { return false; }
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
      encoding: 'utf8', timeout: 8000, windowsHide: true,
      env: Object.assign({}, process.env, { CL_DIR: dir }),
    });
    return /OK/.test(out);
  } catch (e) { return false; }
}

function auditOpen(dir, result) {
  try {
    const log = path.join(config.root, '.edu', 'open.log');
    fs.mkdirSync(path.dirname(log), { recursive: true });
    fs.appendFileSync(log, stamp() + '\t' + result + '\t' + dir + '\n', 'utf8');
  } catch (e) {}
}

function focusFolderWindow(dir) {
  // 资源管理器常把新窗口开在主程序后面，用户以为「没反应」，这里把它提到最前
  const leaf = String(dir || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';
  if (!leaf) return;
  const cache = path.join(os.tmpdir(), 'courselib-focus.ps1');
  const code = [
    'Add-Type -Namespace W -Name U -MemberDefinition \'[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);\'',
    'Start-Sleep -Milliseconds 700',
    '$name = $env:CL_LEAF',
    'try {',
    '  $sh = New-Object -ComObject Shell.Application',
    '  foreach ($w in $sh.Windows()) {',
    '    try { if ($w.LocationName -eq $name) { [W.U]::SetForegroundWindow([intptr]$w.HWND) | Out-Null } } catch {}',
    '  }',
    '} catch {}',
  ].join('\n');
  const ps1 = path.join(os.tmpdir(), 'courselib-focus-' + process.pid + '.ps1');
  try {
    fs.writeFileSync(ps1, code, 'utf8');
  } catch (e) { return; }
  try {
    const cp = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ps1], {
      detached: true, stdio: 'ignore', windowsHide: true,
      env: Object.assign({}, process.env, { CL_LEAF: leaf }),
    });
    cp.unref();
  } catch (e) {}
}

function shellOpen(target, extraArgs) {
  try {
    if (fs.statSync(target).isDirectory()) {
      spawn('explorer.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
      focusFolderWindow(target);
      return;
    }
  } catch (_) {}
  const p = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', target].concat(extraArgs || []), {
    detached: true, stdio: 'ignore', windowsHide: true,
  });
  p.on('error', () => {
    try { spawn('explorer.exe', [target], { detached: true, stdio: 'ignore' }); } catch (_) {}
  });
  p.unref();
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.txt': 'text/plain; charset=utf-8',
};

function mimeOf(p) { return MIME[path.extname(p).toLowerCase()] || 'application/octet-stream'; }

function sendFile(req, res, abs, opts) {
  const o = opts || {};
  let st;
  try { st = fs.statSync(abs); } catch (_) { return fail(res, 404, '文件不存在'); }
  const type = mimeOf(abs);
  const disposition = o.download
    ? "attachment; filename*=UTF-8''" + encodeURIComponent(path.basename(abs))
    : 'inline';
  const range = req.headers.range;
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start = m && m[1] ? Number(m[1]) : 0;
    let end = m && m[2] ? Number(m[2]) : st.size - 1;
    if (start >= st.size) { res.writeHead(416, { 'Content-Range': 'bytes */' + st.size }); return res.end(); }
    if (end >= st.size) end = st.size - 1;
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': end - start + 1,
      'Content-Range': 'bytes ' + start + '-' + end + '/' + st.size,
      'Accept-Ranges': 'bytes',
      'Content-Disposition': disposition,
      'Cache-Control': 'no-store',
    });
    return fs.createReadStream(abs, { start, end }).pipe(res);
  }
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Accept-Ranges': 'bytes',
    'Content-Disposition': disposition,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(abs).pipe(res);
}

/* ------------------------------ 自动索引（资源管理器里改了也同步） ------------------------------ */

function startWatch() {
  try {
    libWatcher = fs.watch(config.root, { recursive: true }, (evt, filename) => {
      const rel = String(filename || '').replace(/\\/g, '/');
      if (!rel || rel.startsWith('.lib') || rel.startsWith('导出')) return;
      watchPending = true;
      scheduleScan();
    });
    libWatcher.on('error', () => {});
  } catch (e) {
    console.warn('[watch] 无法监听库目录：' + e.message);
  }
}

function scheduleScan() {
  if (watchTimer) clearTimeout(watchTimer);
  watchTimer = setTimeout(async () => {
    watchTimer = null;
    if (scanState.running) { scheduleScan(); return; }
    if (!watchPending) return;
    watchPending = false;
    scanState.running = true;
    try {
      const r = await store.scan((p) => Object.assign(scanState, p));
      scanState.last = r;
      libRev += 1;
      console.log('[watch] 自动索引 +' + (r.added || 0) + ' ~' + (r.updated || 0) + ' -' + (r.removed || 0));
    } catch (e) {
      scanState.last = { error: e.message };
      console.warn('[watch] 自动索引失败：' + e.message);
    } finally {
      scanState.running = false;
    }
  }, 1200);
}

/* ------------------------------ 导入 ------------------------------ */

const JUNK_EXT = new Set(['dll', 'qm', 'pyd', 'node', 'so', 'dylib', 'exe', 'msi', 'pak', 'dat', 'bin', 'lib', 'obj', 'pdb']);

let importState = { running: false, total: 0, done: 0, skipped: 0, errors: [], src: '', mode: 'copy', started: 0, ended: 0 };

function walkFiles(root) {
  const out = [];
  (function walk(dir, relBase) {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
    for (const it of items) {
      if (isTempName(it.name) || it.name === '.lib' || it.name === '导出') continue;
      const abs = path.join(dir, it.name);
      const rel = relBase ? relBase + '/' + it.name : it.name;
      if (it.isDirectory()) walk(abs, rel);
      else if (it.isFile()) out.push({ abs, rel, name: it.name });
    }
  })(root, '');
  return out;
}

function uniqueRel(rel) {
  if (!fs.existsSync(path.join(config.root, rel))) return rel;
  const dir = path.dirname(rel);
  const ext = path.extname(rel);
  const base = path.basename(rel, ext);
  let n = 2;
  let cand;
  do {
    cand = path.join(dir === '.' ? '' : dir, base + '(' + n + ')' + ext).replace(/\\/g, '/');
    n += 1;
  } while (fs.existsSync(path.join(config.root, cand)));
  return cand;
}

async function runImport(src, mode, skipJunk, skipBigZip) {
  importState = { running: true, total: 0, done: 0, skipped: 0, errors: [], src, mode, started: Date.now(), ended: 0 };
  const files = walkFiles(src);
  importState.total = files.length;
  let i = 0;
  for (const f of files) {
    i += 1;
    try {
      const ext = path.extname(f.name).slice(1).toLowerCase();
      if (skipJunk && JUNK_EXT.has(ext)) { importState.skipped += 1; continue; }
      let size = 0;
      try { size = fs.statSync(f.abs).size; } catch (_) {}
      if (skipBigZip && /^(zip|rar|7z)$/.test(ext) && size > 50 * 1024 * 1024) { importState.skipped += 1; continue; }
      const rel = uniqueRel(f.rel);
      const dest = path.join(config.root, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      if (mode === 'move') {
        try { fs.renameSync(f.abs, dest); }
        catch (_) { fs.copyFileSync(f.abs, dest); try { fs.unlinkSync(f.abs); } catch (e2) {} }
      } else {
        fs.copyFileSync(f.abs, dest);
      }
      store.indexOne(dest);
      importState.done += 1;
    } catch (e) {
      importState.errors.push({ rel: f.rel, msg: e.message });
    }
    if (i % 100 === 0) { store.dirty(); await new Promise((r) => setImmediate(r)); }
  }
  store.dirty();
  store.flush();
  libRev += 1;
  importState.running = false;
  importState.ended = Date.now();
}

/* ------------------------------ 转换任务 ------------------------------ */

let convState = { running: false, done: 0, total: 0, files: [], errors: [], to: '', startedAt: 0, endedAt: 0 };
let feState = { running: false, done: 0, total: 0, files: [], errors: [], fmt: '', startedAt: 0, endedAt: 0 };


function registerOutputs(files) {
  let n = 0;
  for (const f of files) {
    try {
      if (!f || !fs.existsSync(f)) continue;
      const e = store.indexOne(f);
      if (e) n += 1;
    } catch (err) {}
  }
  if (n) { store.dirty(); libRev += 1; }
  return n;
}

async function runConvert(rels, to, width) {
  convState = { running: true, done: 0, total: rels.length, files: [], errors: [], to, startedAt: Date.now(), endedAt: 0 };
  for (const rel of rels) {
    try {
      const out = await CV.convertOne(config.root, rel, to, { width: Number(width) || 1600 });
      for (const f of (Array.isArray(out) ? out : [out])) convState.files.push(f);
    } catch (e) {
      convState.errors.push({ rel, msg: e.message });
    }
    convState.done += 1;
  }
  convState.running = false;
  convState.endedAt = Date.now();
  convState.registered = registerOutputs(convState.files);
}

async function runFileeConvert(rels, fmt) {
  const outRoot = exportDir();
  feState = { running: true, done: 0, total: rels.length, files: [], errors: [], fmt, startedAt: Date.now(), endedAt: 0 };
  for (const rel of rels) {
    try {
      const out = await FE.convertOne(path.join(config.root, rel), fmt, outRoot);
      for (const f of (Array.isArray(out) ? out : [out])) feState.files.push(f);
    } catch (e) {
      feState.errors.push({ rel, msg: e.message });
    }
    feState.done += 1;
  }
  feState.running = false;
  feState.endedAt = Date.now();
  feState.registered = registerOutputs(feState.files);
}

/* ------------------------------ 静态资源 ------------------------------ */

let eduCache = null;
function eduStore() {
  // 每次都用磁盘最新内容，避免多进程/多窗口各持内存副本互相覆盖
  return new EDU.EduStore(config.root);
}

function csvCell(v) {
  const t = String(v == null ? '' : v);
  return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (!rel || rel === '/') rel = '/hub.html';
  if (rel === '/files') rel = '/files.html';
  if (rel === '/students') rel = '/students.html';
  const abs = path.join(PUBLIC_DIR, rel.replace(/^\/+/, ''));
  if (!abs.startsWith(PUBLIC_DIR)) return fail(res, 403, '不允许');
  let st;
  try { st = fs.statSync(abs); } catch (_) { return fail(res, 404, '找不到页面'); }
  if (st.isDirectory()) return fail(res, 404, '找不到页面');
  res.writeHead(200, {
    'Content-Type': mimeOf(abs),
    'Content-Length': st.size,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(abs).pipe(res);
}

/* ------------------------------ 导出辅助 ------------------------------ */

const LIST_HEAD = ['文件名', '所在文件夹', '类型', '大小(MB)', '修改时间', '智能标签', '标签', '备注', '相对路径'];

function buildExportRows(items) {
  const tagName = (id) => {
    const t = (store.tags || []).find((x) => x.id === id);
    return t ? t.name : '';
  };
  const rows = [LIST_HEAD];
  for (const f of items) {
    rows.push([
      f.name,
      f.dir || '库根目录',
      f.ext,
      Number(((f.size || 0) / 1048576).toFixed(2)),
      new Date(f.mtime).toLocaleString('zh-CN', { hour12: false }),
      (f.auto || []).map((a) => a.v).join(' / '),
      (f.tags || []).map(tagName).filter(Boolean).join(' / '),
      f.note || '',
      f.rel,
    ]);
  }
  return rows;
}

/* 保存前自动备份（docx / xlsx） */
function backupBeforeSave(rel, buf) {
  try {
    const dir = path.join(config.root, '.lib', 'backup');
    fs.mkdirSync(dir, { recursive: true });
    const d = new Date();
    const p = (x) => String(x).padStart(2, '0');
    const ts = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    const base = path.basename(rel).replace(/[\\/:*?"<>|]/g, '_');
    fs.writeFileSync(path.join(dir, ts + '__' + base), buf);
    const files = fs.readdirSync(dir).sort();
    if (files.length > 200) {
      for (const f of files.slice(0, files.length - 200)) {
        try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
      }
    }
  } catch (e) {
    console.warn('[backup] 备份失败：' + e.message);
  }
}

/* ------------------------------ 路由 ------------------------------ */

const LNK_CACHE = new Map();

function execFileSyncPowerShell(ps, timeout) {
  const { execFileSync } = require('child_process');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], { encoding: 'utf8', windowsHide: true, timeout: timeout || 15000 });
}

function resolveShortcut(p) {
  const key = String(p).toLowerCase();
  const hit = LNK_CACHE.get(key);
  if (hit && Date.now() - hit.at < 60000) return hit.val;
  let out;
  try {
    if (!fs.existsSync(p)) out = { error: '快捷方式不存在', code: 404 };
    else {
      let target = '';
      if (/\.url$/i.test(p)) {
        const txt = fs.readFileSync(p, 'utf8');
        const m = /^URL=(.+)$/im.exec(txt);
        target = m ? m[1].trim() : '';
      } else {
        const { execFileSync } = require('child_process');
        const ps = '$s=(New-Object -ComObject WScript.Shell).CreateShortcut(' + "'" + p.replace(/'/g, "''") + "'" + ').TargetPath; Write-Output $s';
        target = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
          encoding: 'utf8', windowsHide: true, timeout: 8000,
        }).trim();
      }
      if (!target) out = { error: '这个快捷方式没有指向有效位置', code: 404 };
      else {
        let isDir = false;
        let exists = false;
        try { const st = fs.statSync(target); exists = true; isDir = st.isDirectory(); } catch (_) {}
        out = { target, isDir, exists };
      }
    }
  } catch (e) {
    out = { error: '读取快捷方式失败：' + e.message, code: 500 };
  }
  LNK_CACHE.set(key, { at: Date.now(), val: out });
  return out;
}

async function handleApi(req, res, pathname, url) {
  const q = url.searchParams;

  if (pathname === '/api/lnks' && req.method === 'POST') {
    const body = await readJson(req).catch(() => ({}));
    const list = Array.isArray(body.paths) ? body.paths.filter((x) => typeof x === 'string' && /\.(lnk|url)$/i.test(x)).slice(0, 200) : [];
    if (!list.length) return ok(res, { items: [] });
    const need = list.filter((p) => {
      const hit = LNK_CACHE.get(String(p).toLowerCase());
      return !(hit && Date.now() - hit.at < 60000);
    });
    if (need.length) {
      const lnks = need.filter((p) => !/\.url$/i.test(p));
      const urls = need.filter((p) => /\.url$/i.test(p));
      urls.forEach((p) => { resolveShortcut(p); });
      if (lnks.length) {
        const arr = lnks.map((p) => "'" + p.replace(/'/g, "''") + "'").join(',');
        const ps = '$sh=New-Object -ComObject WScript.Shell;foreach($p in @(' + arr + ')){$t="";try{$t=$sh.CreateShortcut($p).TargetPath}catch{};Write-Output ($p + [char]9 + $t)}';
        try {
          const out = execFileSyncPowerShell(ps, 20000);
          out.split(/\r?\n/).forEach((line) => {
            if (!line) return;
            const i = line.indexOf('\t');
            if (i < 0) return;
            const p = line.slice(0, i).trim();
            const target = line.slice(i + 1).trim();
            let isDir = false;
            let exists = false;
            try { const st = fs.statSync(target); exists = true; isDir = st.isDirectory(); } catch (_) {}
            LNK_CACHE.set(String(p).toLowerCase(), { at: Date.now(), val: target ? { target, isDir, exists } : { error: '这个快捷方式没有指向有效位置', code: 404 } });
          });
        } catch (_) {}
      }
    }
    const items = list.map((p) => resolveShortcut(p));
    return ok(res, { items });
  }

  if (pathname === '/api/lnk' && req.method === 'GET') {    const p = String(q.get('path') || '').trim();
    if (!p) return fail(res, 400, '缺少路径');
    if (!/\.(lnk|url)$/i.test(p)) return fail(res, 400, '不是快捷方式');
    const r = resolveShortcut(p);
    if (r.error) return fail(res, r.code || 500, r.error);
    return ok(res, { target: r.target, isDir: r.isDir, exists: r.exists });
  }

  if (pathname === '/api/browse' && req.method === 'GET') {
    const p = String(q.get('path') || '').trim();
    const ext = String(q.get('ext') || '').toLowerCase().replace(/[^a-z0-9,]/g, '');
    const places = [
      { name: '桌面', path: path.join(os.homedir(), 'Desktop') },
      { name: '下载', path: path.join(os.homedir(), 'Downloads') },
      { name: '文档', path: path.join(os.homedir(), 'Documents') },
      { name: '图片', path: path.join(os.homedir(), 'Pictures') },
    ].filter((x) => { try { return fs.statSync(x.path).isDirectory(); } catch (_) { return false; } });
    const drives = [];
    for (let c = 67; c <= 90; c++) {
      const root = String.fromCharCode(c) + ':\\';
      try { if (fs.statSync(root).isDirectory()) drives.push({ name: String.fromCharCode(c) + ':', path: root }); } catch (_) {}
    }
    if (!p) return ok(res, { path: '', parent: '', places, drives, dirs: [], files: [], links: [], ext });
    let real = p;
    try { real = fs.realpathSync(p); } catch (_) {}
    let pickFile = '';
    try { if (fs.statSync(real).isFile()) { pickFile = path.basename(real); real = path.dirname(real); } } catch (_) {}
    let ents = [];
    try { ents = fs.readdirSync(real, { withFileTypes: true }); } catch (e) { return fail(res, 400, '打不开这个文件夹'); }
    const wantExt = ext ? new Set(ext.split(',')) : null;
    const dirs = [];
    const files = [];
    const links = [];
    for (const it of ents) {
      if (it.name[0] === '.' || it.name[0] === '$') continue;
      if (it.name === 'System Volume Information') continue;
      const full = path.join(real, it.name);
      if (it.isDirectory()) {
        let mt = 0;
        try { mt = fs.statSync(full).mtimeMs; } catch (_) {}
        dirs.push({ name: it.name, path: full, mtime: Math.round(mt) });
        continue;
      }
      if (/\.lnk$/i.test(it.name) || /\.url$/i.test(it.name)) { links.push({ name: it.name.replace(/\.(lnk|url)$/i, ''), path: full }); continue; }
      if (!wantExt) continue;
      const e = it.name.split('.').pop().toLowerCase();
      if (!wantExt.has(e)) continue;
      let size = 0;
      try { size = fs.statSync(full).size; } catch (_) {}
      let mt = 0;
      try { mt = fs.statSync(full).mtimeMs; } catch (_) {}
      files.push({ name: it.name, path: full, size, mtime: Math.round(mt) });
    }
    dirs.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    files.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    links.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
    const up = path.dirname(real);
    return ok(res, {
      path: real,
      parent: up && up !== real ? up : '',
      places, drives,
      dirs: dirs.slice(0, 600),
      files: files.slice(0, 600),
      links: links.slice(0, 200),
      ext,
      pickFile,
    });
  }

  if (pathname === '/api/status' && req.method === 'GET') {
    let bytes = 0;
    try { for (const e of store.entries.values()) bytes += e.size || 0; } catch (err) {}
    return ok(res, {
      root: config.root,
      source: config.source,
      port: config.port,
      count: store.entries.size,
      sizeText: formatSize(bytes),
      exportDir: exportDir(),
      rev: libRev,
      scanning: scanState.running,
      error: store.error || null,
    });
  }

  if (pathname === '/api/config' && req.method === 'POST') {
    const b = await readJson(req);
    let changed = false;
    if (b.source !== undefined) { config.source = String(b.source || ''); changed = true; }
    if (b.root) {
      const next = path.resolve(String(b.root));
      if (next !== path.resolve(config.root)) {
        try { store.flush(); } catch (_) {}
        config.root = next;
        openStore();
        changed = true;
        libRev += 1;
      }
    }
    if (changed) saveConfig();
    return ok(res, { root: config.root, source: config.source });
  }

  /* ---- 列表 ---- */
  if (pathname === '/api/files') {
    const r = store.query({
      q: q.get('q') || '',
      groups: q.get('groups') || '',
      exts: q.get('exts') || '',
      tags: q.get('tags') || '',
      auto: q.get('auto') || '',
      rels: q.get('rels') || '',
      dir: q.get('dir') || '',
      direct: q.get('direct') || '',
      sizeMin: q.get('sizeMin') || '',
      sizeMax: q.get('sizeMax') || '',
      dateFrom: q.get('dateFrom') || '',
      dateTo: q.get('dateTo') || '',
      sort: q.get('sort') || '',
      order: q.get('order') || 'desc',
      page: q.get('page') || 1,
      pageSize: q.get('pageSize') || 100,
    });
    return ok(res, r);
  }
  if (pathname === '/api/facets') {
    return ok(res, {
      facets: store.facets(),
      tags: store.tags,
      folders: store.folders(),
      prefs: store.getPrefs(),
    });
  }
  if (pathname === '/api/folders') {
    const r = store.folderList({
      q: q.get('q') || '',
      dir: q.get('dir') || '',
      sort: q.get('sort') || 'name',
      order: q.get('order') || 'asc',
    });
    return ok(res, r);
  }
  if (pathname === '/api/file') {
    const rel = q.get('rel') || '';
    const e = store.get(rel);
    if (!e) return fail(res, 404, '找不到这个文件（可能已被移动或删除）');
    return ok(res, {
      file: Object.assign({}, e, {
        sizeText: formatSize(e.size),
        auto: autoTagList(e),
      }),
    });
  }

  /* ---- 原始文件 ---- */
  if (pathname === '/api/preview' || pathname === '/api/raw') {
    const rel = q.get('rel') || '';
    if (!store.get(rel)) return fail(res, 404, '找不到这个文件');
    return sendFile(req, res, store.abs(rel), { download: pathname === '/api/raw' });
  }

  /* ---- 回收站 ---- */
  if (pathname === '/api/trash/list') return ok(res, { items: store.trashList() });
  if (pathname === '/api/trash' && req.method === 'POST') {
    const b = await readJson(req);
    const rels = b.rels || [];
    let n = 0;
    const errors = [];
    for (const rel of rels) {
      try { store.trash(rel); n += 1; } catch (e) { errors.push({ rel, msg: e.message }); }
    }
    if (n) { store.flush(); libRev += 1; }
    return ok(res, { trashed: n, errors });
  }
  if (pathname === '/api/trash/restore' && req.method === 'POST') {
    const b = await readJson(req);
    const r = store.restore(b.id);
    store.flush();
    libRev += 1;
    return ok(res, { rel: r.rel });
  }
  if (pathname === '/api/trash/purge' && req.method === 'POST') {
    const b = await readJson(req);
    store.purge(b.id);
    return ok(res, {});
  }

  /* ---- 标签 ---- */
  if (pathname === '/api/tags' && req.method === 'POST') {
    const b = await readJson(req);
    return ok(res, { tag: store.addTag(b.name, b.color) });
  }
  if (pathname === '/api/tags/delete' && req.method === 'POST') {
    const b = await readJson(req);
    store.removeTag(b.id);
    store.flush();
    return ok(res, {});
  }
  if (pathname === '/api/tags/assign' && req.method === 'POST') {
    const b = await readJson(req);
    const rels = b.rels || [];
    const tags = b.tags || [];
    const mode = b.mode || 'add';
    let n = 0;
    for (const rel of rels) {
      const e = store.get(rel);
      if (!e) continue;
      let next = (e.tags || []).slice();
      if (mode === 'replace') next = tags.slice();
      else if (mode === 'remove') next = next.filter((t) => !tags.includes(t));
      else { for (const t of tags) if (!next.includes(t)) next.push(t); }
      store.setTags(rel, next);
      n += 1;
    }
    store.flush();
    return ok(res, { count: n });
  }

  /* ---- 备注 / 改名 / 移动 ---- */
  if (pathname === '/api/note' && req.method === 'POST') {
    const b = await readJson(req);
    store.setNote(b.rel, b.note || '');
    store.flush();
    return ok(res, {});
  }
  if (pathname === '/api/rename' && req.method === 'POST') {
    const b = await readJson(req);
    const e = store.rename(b.rel, b.name);
    store.flush();
    libRev += 1;
    return ok(res, { rel: e.rel, name: e.name });
  }
  if (pathname === '/api/rename/batch' && req.method === 'POST') {
    const b = await readJson(req);
    const items = b.items || [];
    let renamed = 0;
    const done = [];
    const errors = [];
    for (const it of items) {
      try { const e = store.rename(it.rel, it.name); done.push(e.rel); renamed += 1; }
      catch (e) { errors.push({ rel: it.rel, msg: e.message }); }
    }
    store.flush();
    if (renamed) libRev += 1;
    return ok(res, { renamed, done, errors });
  }
  if (pathname === '/api/move' && req.method === 'POST') {
    const b = await readJson(req);
    const rels = b.rels || [];
    let moved = 0;
    const errors = [];
    for (const rel of rels) {
      try { store.move(rel, b.dir || ''); moved += 1; }
      catch (e) { errors.push({ rel, msg: e.message }); }
    }
    store.flush();
    if (moved) libRev += 1;
    return ok(res, { moved, errors });
  }

  /* ---- 打开 / 定位 ---- */
  if (pathname === '/api/open' && req.method === 'POST') {
    const b = await readJson(req);
    if (!store.get(b.rel)) return fail(res, 404, '找不到这个文件');
    shellOpen(store.abs(b.rel));
    try { store.addRecent(b.rel); } catch (_) {}
    return ok(res, {});
  }
  if (pathname === '/api/reveal' && req.method === 'POST') {
    const b = await readJson(req);
    spawn('explorer.exe', ['/select,' + store.abs(b.rel)], { detached: true, stdio: 'ignore' }).unref();
    return ok(res, {});
  }
  if (pathname === '/api/openPath' && req.method === 'POST') {
    const b = await readJson(req);
    const target = b.path || '';
    if (!target || !fs.existsSync(target)) return fail(res, 404, '路径不存在：' + target);
    let isDir = false;
    try { isDir = fs.statSync(target).isDirectory(); } catch (e) {}
    if (isDir && !b.reveal) {
      const okExplore = exploreFolder(target);
      auditOpen(target, okExplore ? 'explore-ok' : 'explore-fail');
      if (!okExplore) shellOpen(target);
      return ok(res, { via: okExplore ? 'explore' : 'explorer' });
    }
    if (b.reveal) {
      try { spawn('explorer.exe', ['/select,' + target], { detached: true, stdio: 'ignore' }); } catch (e) { shellOpen(target); }
    } else {
      shellOpen(target);
    }
    return ok(res, {});
  }
  if (pathname === '/api/folders/reveal' && req.method === 'POST') {
    const b = await readJson(req);
    const rel = String(b.path || '').replace(/\\/g, '/');
    const rootAbs = path.resolve(config.root);
    const abs = path.resolve(rootAbs, rel);
    if (!abs.startsWith(rootAbs)) return fail(res, 400, '路径不合法');
    if (!fs.existsSync(abs)) return fail(res, 404, '文件夹不存在');
    spawn('explorer.exe', [abs], { detached: true, stdio: 'ignore' }).unref();
    return ok(res, {});
  }

  /* ---- 索引 ---- */
  if (pathname === '/api/scan' && req.method === 'POST') {
    if (!scanState.running) {
      scanState.running = true;
      setImmediate(async () => {
        try {
          scanState.last = await store.scan((p) => Object.assign(scanState, p));
          libRev += 1;
        } catch (e) {
          scanState.last = { error: e.message };
        } finally {
          scanState.running = false;
        }
      });
    }
    return ok(res, { started: true });
  }
  if (pathname === '/api/scan/status') return ok(res, scanState);

  /* ---- 导入 / 上传 ---- */
  if (pathname === '/api/import' && req.method === 'POST') {
    const b = await readJson(req);
    const src = String(b.src || '').trim();
    if (!src) return fail(res, 400, '请先选要导入的文件夹');
    let isDir = false;
    try { isDir = fs.statSync(src).isDirectory(); } catch (_) {}
    if (!isDir) return fail(res, 400, '这个文件夹不存在：' + src);
    if (importState.running) return fail(res, 429, '上一批还在导入，稍等');
    runImport(src, b.mode === 'move' ? 'move' : 'copy', b.skipJunk !== false, b.skipBigZip !== false)
      .catch((e) => { importState.running = false; importState.errors.push({ rel: '', msg: e.message }); });
    return ok(res, { started: true });
  }
  if (pathname === '/api/import/status') return ok(res, importState);

  if (pathname === '/api/upload' && req.method === 'POST') {
    const name = safeFileName(q.get('name') || '');
    const dir = String(q.get('dir') || '').replace(/\\/g, '/').replace(/^\/|\/$/g, '');
    if (!name) return fail(res, 400, '缺少文件名');
    const buf = await readBody(req, 2048 * 1024 * 1024);
    const rel = uniqueRel((dir ? dir + '/' : '') + name);
    const abs = path.join(config.root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    const entry = store.indexOne(abs);
    store.dirty();
    libRev += 1;
    return ok(res, { rel: entry ? entry.rel : rel, size: buf.length });
  }

  /* ---- 文本 / Office ---- */
  if (pathname === '/api/text/get') {
    const rel = q.get('rel') || '';
    const e = store.get(rel);
    if (!e) return fail(res, 404, '找不到这个文件');
    let text = '';
    try { text = EX.decodeTextBuffer(store.fileBuffer(rel)); } catch (err) { return fail(res, 500, err.message); }
    return ok(res, { text, ext: e.ext });
  }
  if (pathname === '/api/text/save' && req.method === 'POST') {
    const b = await readJson(req);
    const rel = b.rel;
    if (!store.get(rel)) return fail(res, 404, '找不到这个文件');
    store.writeFile(rel, Buffer.from(String(b.text == null ? '' : b.text), 'utf8'));
    store.indexOne(store.abs(rel));
    store.dirty();
    libRev += 1;
    return ok(res, { saved: true });
  }
  if (pathname === '/api/docx/paragraphs') {
    const rel = q.get('rel') || '';
    if (!store.get(rel)) return fail(res, 404, '找不到这个文件');
    const d = EX.docxParagraphs(store.fileBuffer(rel));
    return ok(res, { paragraphs: d.paragraphs, blocks: d.blocks });
  }
  if (pathname === '/api/docx/save' && req.method === 'POST') {
    const b = await readJson(req);
    const rel = b.rel;
    if (!store.get(rel)) return fail(res, 404, '找不到这个文件');
    const before = store.fileBuffer(rel);
    backupBeforeSave(rel, before);
    const out = EX.docxApplyParagraphs(before, b.paragraphs || []);
    store.writeFile(rel, out);
    store.indexOne(store.abs(rel));
    store.dirty();
    libRev += 1;
    return ok(res, { saved: true });
  }
  if (pathname === '/api/xlsx/sheets') {
    const rel = q.get('rel') || '';
    if (!store.get(rel)) return fail(res, 404, '找不到这个文件');
    const r = EX.xlsxRead(store.fileBuffer(rel), { grid: true });
    return ok(res, { sheets: r.sheets });
  }
  if (pathname === '/api/xlsx/save' && req.method === 'POST') {
    const b = await readJson(req);
    const rel = b.rel;
    if (!store.get(rel)) return fail(res, 404, '找不到这个文件');
    const before = store.fileBuffer(rel);
    backupBeforeSave(rel, before);
    const out = EX.xlsxApplyEdits(before, b.sheets || {});
    store.writeFile(rel, out);
    store.indexOne(store.abs(rel));
    store.dirty();
    libRev += 1;
    return ok(res, { saved: true });
  }
  if (pathname === '/api/pptx/slides') {
    const rel = q.get('rel') || '';
    if (!store.get(rel)) return fail(res, 404, '找不到这个文件');
    const slides = EX.pptxSlides(store.fileBuffer(rel)).map((sl, i) => Object.assign({ no: i + 1 }, sl));
    return ok(res, { slides });
  }

  /* ---- 分析工具 ---- */
  if (pathname === '/api/dups') {
    return ok(res, findDuplicates(config.root, [...store.entries.values()]));
  }
  if (pathname === '/api/series') {
    const list = findSeries([...store.entries.values()], {
      dir: q.get('dir') || '',
      minCount: Number(q.get('minCount')) || 2,
    });
    return ok(res, { series: list, total: list.length });
  }

  /* ---- 偏好 ---- */
  if (pathname === '/api/prefs') return ok(res, { prefs: store.getPrefs() });
  if (pathname === '/api/favs' && req.method === 'POST') {
    const b = await readJson(req);
    return ok(res, store.toggleFav(b.rel));
  }
  if (pathname === '/api/recents' && req.method === 'POST') {
    const b = await readJson(req);
    store.addRecent(b.rel);
    return ok(res, {});
  }
  if (pathname === '/api/views' && req.method === 'POST') {
    const b = await readJson(req);
    const view = store.saveView(b.name, b.query || '');
    return ok(res, { view, views: store.getPrefs().views });
  }
  if (pathname === '/api/views/delete' && req.method === 'POST') {
    const b = await readJson(req);
    store.delView(b.id);
    return ok(res, { views: store.getPrefs().views });
  }

  /* ---- 导出 ---- */
  if (pathname === '/api/export/list' && req.method === 'POST') {
    const b = await readJson(req);
    const r = store.query(Object.assign({}, b.query || {}, { all: true }));
    const buf = buildXlsx(buildExportRows(r.items), '资料清单');
    const abs = uniquePath(path.join(exportDir(), '资料清单-' + stamp() + '.xlsx'));
    fs.writeFileSync(abs, buf);
    try { store.indexOne(abs); store.dirty(); libRev += 1; } catch (e) {}
    return ok(res, { path: abs, name: path.basename(abs), count: r.items.length });
  }
  if (pathname === '/api/export/zip' && req.method === 'POST') {
    const b = await readJson(req);
    const rels = b.rels || [];
    if (!rels.length) return fail(res, 400, '没有选中文件');
    const items = [];
    let total = 0;
    for (const rel of rels) {
      const e = store.get(rel);
      if (!e) continue;
      total += e.size || 0;
      if (total > 600 * 1024 * 1024) return fail(res, 400, '选中的文件太大了（超过 600MB），分几批打包');
      try { items.push({ name: rel, data: store.fileBuffer(rel) }); } catch (_) {}
    }
    if (!items.length) return fail(res, 404, '一个文件都没读到');
    const buf = ZW.writeZip(items);
    const base = safeFileName(b.name || '课程资料') || '课程资料';
    const abs = uniquePath(path.join(exportDir(), base + '.zip'));
    fs.writeFileSync(abs, buf);
    try { store.indexOne(abs); store.dirty(); libRev += 1; } catch (e) {}
    return ok(res, { path: abs, name: path.basename(abs), count: items.length, size: buf.length });
  }

  /* ---- 转换 ---- */
  if (pathname === '/api/convert/targets') {
    const rels = String(q.get('rels') || '').split(',').map((s) => s.trim()).filter(Boolean);
    const set = new Set();
    let mixed = false;
    let prev = null;
    for (const rel of rels) {
      const list = CV.targetsFor(rel);
      const sig = list.slice().sort().join(',');
      if (prev !== null && prev !== sig) mixed = true;
      prev = sig;
      for (const x of list) set.add(x);
    }
    const LABEL = {
      pdf: 'PDF', png: '图片', img: '图片', docx: 'Word 文档', txt: '纯文本',
      xlsx: 'Excel 表格', csv: 'CSV（表格文本）', pptx: 'PPT 演示',
    };
    const NOTE = {
      pdf: '排版按原样，适合发出去或打印',
      png: '每页一张 PNG，放在同文件夹里',
      img: '每页一张 PNG，放在同文件夹里',
      docx: '带图片和版式，跟原文件接近',
      txt: '只留文字，最干净',
      xlsx: '表格还原成可编辑的单元格',
      csv: '每行一条记录，Excel 能直接打开',
      pptx: '还原成可编辑的幻灯片',
    };
    const order = ['pdf', 'png', 'docx', 'txt', 'xlsx', 'csv', 'pptx'];
    const options = [...set]
      .sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((v) => ({ value: v, label: LABEL[v] || v, note: NOTE[v] || '' }));
    return ok(res, {
      options, mixed,
      hasWps: !!WPS.available(),
      exts: rels.map((r) => path.extname(r).slice(1).toLowerCase()),
    });
  }
  if (pathname === '/api/convert' && req.method === 'POST') {
    const b = await readJson(req);
    const rels = b.rels || [];
    if (!rels.length) return fail(res, 400, '没有选中文件');
    if (convState.running) return fail(res, 429, '上一批还在转换，稍等');
    runConvert(rels, b.to || 'pdf', b.width).catch(() => { convState.running = false; });
    return ok(res, { started: true, total: rels.length, to: b.to || 'pdf' });
  }
  if (pathname === '/api/convert/status') return ok(res, convState);

  if (pathname === '/api/filee/formats') {
    if (!FE.available()) return ok(res, { available: false, total: 0, formats: [], groups: [], labels: {} });
    let list = [];
    try { list = await FE.formats(); } catch (e) { return fail(res, 500, e.message); }
    const byCat = {};
    for (const f of list) {
      const cat = f.category || '其它';
      (byCat[cat] = byCat[cat] || []).push(f);
    }
    const groups = byCat; // 客户端按类别取数组：groups[cat] = [...]
    return ok(res, { available: true, total: list.length, formats: list, groups, labels: FE.CAT_LABEL || {} });
  }
  if (pathname === '/api/filee/convert' && req.method === 'POST') {
    const b = await readJson(req);
    const rels = b.rels || [];
    if (!rels.length) return fail(res, 400, '没有选中文件');
    if (!b.to) return fail(res, 400, '没有选目标格式');
    if (feState.running) return fail(res, 429, '上一批还在转换，稍等');
    runFileeConvert(rels, b.to).catch(() => { feState.running = false; });
    return ok(res, { started: true, total: rels.length, to: b.to });
  }
  if (pathname === '/api/filee/status') return ok(res, { state: feState });

  /* ---- 考勤表 ---- */

// ---------- 名单识别（Excel / PDF / 图片 OCR）----------
const NAME_SURNAME_RE = /^(测|张|李|王|赵|陈|刘|杨|黄|周|吴|徐|孙|马|朱|胡|郭|何|高|林|罗|郑|梁|谢|宋|唐|许|韩|冯|邓|曹|彭|曾|肖|田|董|袁|潘|于|蒋|蔡|余|杜|叶|程|苏|魏|吕|丁|任|沈|姚|卢|姜|崔|钟|谭|陆|汪|范|金|石|廖|贾|夏|韦|付|方|白|邹|孟|熊|秦|邱|江|尹|薛|闫|段|雷|侯|龙|史|陶|黎|贺|顾|毛|郝|龚|邵|万|钱|严|覃|武|戴|莫|孔|向|汤)$/;
const IMG_EXT_ROSTER = new Set(['png', 'jpg', 'jpeg', 'bmp', 'webp', 'gif', 'tif', 'tiff']);

function stripCjk(t) {
  return String(t || '').replace(/[\s\u00a0]+/g, '').trim();
}

function isNameToken(t) {
  const v = stripCjk(t);
  if (!/^[\u4e00-\u9fa5]{2,4}$/.test(v)) return false;
  return !/^(姓名|学生|学员|序号|编号|电话|手机|性别|班级|项目|日期|次数|合计|总计|备注|课程|老师|班主任|上课|时间|地点|女|男|年级|签名|科目)$/.test(v);
}

function isPhoneToken(t) {
  return /^1\d{10}$/.test(stripCjk(t));
}

/** 从二维网格里猜姓名列，并尽量带上电话/班级 */
function rosterFromGrid(grid) {
  const rows = grid || [];
  let nameCol = -1;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const t = stripCjk(row[c] && row[c].text);
      if (/^(姓名|学生|学员|名字|学生姓名)$/.test(t)) { nameCol = c; break; }
    }
    if (nameCol >= 0) break;
  }
  if (nameCol < 0) {
    let best = -1, bestScore = 0;
    const width = rows.slice(0, 80).reduce((a, r) => Math.max(a, (r || []).length), 0);
    for (let c = 0; c < width; c++) {
      let score = 0;
      for (let r = 0; r < Math.min(rows.length, 200); r++) {
        const cell = (rows[r] || [])[c];
        if (cell && isNameToken(cell.text)) score += 1;
      }
      if (score > bestScore) { bestScore = score; best = c; }
    }
    if (bestScore >= 2) nameCol = best;
  }
  if (nameCol < 0) return { names: [], rows: [] };

  let phoneCol = -1, clsCol = -1;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const t = stripCjk(row[c] && row[c].text);
      if (phoneCol < 0 && /电话|手机|联系方式|联络/.test(t)) phoneCol = c;
      if (clsCol < 0 && /^(班级|级别|班别|班组)$/.test(t)) clsCol = c;
    }
  }
  const out = [];
  for (let r = 0; r < rows.length; r++) {
    const cell = (rows[r] || [])[nameCol];
    const name = stripCjk(cell && cell.text);
    if (!isNameToken(name)) continue;
    const pick = (c) => (c >= 0 && (rows[r] || [])[c] && (rows[r] || [])[c].text ? stripCjk((rows[r] || [])[c].text) : '');
    let phone = pick(phoneCol);
    if (!isPhoneToken(phone)) {
      phone = '';
      for (const cc of rows[r] || []) if (cc && isPhoneToken(cc.text)) { phone = stripCjk(cc.text); break; }
    }
    out.push({ name, phone, cls: pick(clsCol) });
    if (out.length >= 200) break;
  }
  return { names: out.map((x) => x.name), rows: out };
}

/** 从纯文本（PDF 提取 / OCR）里捞名字：优先「名字 + 手机号」配对，其次短行里的 2-4 字中文 */
function rosterFromOcr(tsv) {
  const words = String(tsv || '').split(/\r?\n/).map((line) => {
    const p = line.split('\t');
    if (p.length < 5) return null;
    const t = String(p[0] || '').trim();
    if (!t) return null;
    return { t, x: Number(p[1]) || 0, y: Number(p[2]) || 0, w: Number(p[3]) || 0, h: Number(p[4]) || 0 };
  }).filter(Boolean);
  if (!words.length) return { names: [], rows: [] };

  // 按 y 聚成行（同一格子里上下两行字会被拆开，这里用 h 的一半做容差并合并相邻）
  words.sort((a, b) => a.y - b.y || a.x - b.x);
  const tol = Math.max(8, Math.round((words.reduce((n, w) => n + w.h, 0) / words.length) * 0.7));
  const lines = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(w.y - last.y) <= tol) { last.words.push(w); last.y = (last.y * (last.words.length - 1) + w.y) / last.words.length; }
    else lines.push({ y: w.y, words: [w] });
  }
  lines.forEach((l) => l.words.sort((a, b) => a.x - b.x));

  // 把一行里的词按 x 间距合并成"格子"
  const cellsOf = (line) => {
    const out = [];
    let cur = null;
    for (const w of line.words) {
      if (cur && w.x - (cur.x + cur.w) <= Math.max(14, w.h * 1.2)) {
        cur.t += w.t; cur.w = w.x + w.w - cur.x;
      } else {
        if (cur) out.push(cur);
        cur = { t: w.t, x: w.x, w: w.w };
      }
    }
    if (cur) out.push(cur);
    return out.map((c) => String(c.t).replace(/\s+/g, ''));
  };

  const STOP = /^(姓名|学生姓名|学员姓名|学生|学员|班级|行政班|年级|联系方式|联系电话|手机|手机号|电话|序号|项目|性别|课程|课程名称|课时费|缴费状态|实缴费用|备注|合计)$/;
  const rows = [];
  for (const line of lines) {
    const cells = cellsOf(line).filter(Boolean);
    if (!cells.length) continue;
    if (cells.some((c) => /^(姓名|学生姓名|学员姓名)$/.test(c))) continue;   // 表头
    let name = '', phone = '', cls = '';
    for (const c of cells) {
      const digits = c.replace(/\D/g, '');
      if (!phone && /^1[3-9]\d{9}$/.test(digits)) { phone = digits; continue; }
      const mCls = /^([一二三四五六七八九])年级(\d{1,2})班?/.exec(c) || /^([一二三四五六七八九])(\d{1,2})班$/.exec(c);
      if (!cls && mCls) {
        const g = '一二三四五六七八九'.indexOf(mCls[1]) + 1;
        cls = String(g) + String(mCls[2]).padStart(2, '0');
        continue;
      }
      if (!name && /^[\u4e00-\u9fa5·]{2,4}$/.test(c) && !STOP.test(c) && !/^(一年级|二年级|三年级|四年级|五年级|六年级|人工智能|机器人)/.test(c)) name = c;
    }
    if (!name) {
      const frags = cells.filter((c) => /^[\u4e00-\u9fa5]{1,2}$/.test(c) && !STOP.test(c));
      if (frags.length) name = frags.join('').slice(0, 4);
    }
    const headerish = /^(学生|行政|课程|课时|缴费|实缴|手机|电话|序号|项目|性别|备注|合计|金额|状态|名称|姓|名|行|政|班|级)/.test(name);
    const noisy = !phone && !cls && name.length <= 2;
    if ((name || phone) && !headerish && !noisy) rows.push({ name, phone, cls });
  }
  const names = rows.map((r) => r.name).filter(Boolean);
  return { names, rows };
}

function rosterFromText(text) {
  const raw = String(text || '');
  const CN = '[\\u4e00-\\u9fa5]';
  const lines = raw.split(/\r?\n/).map((l) => l.replace(/[\u3000\t]/g, ' ').trim()).filter(Boolean);
  const STOP = new Set(['学生姓名','学生姓','姓名','行政班','行政','课程名称','课程名','课程','课时费','缴费状态','缴费','实缴费用','手机号','手机','联系方式','联系电话','已缴费','未缴费','人工智能','机器人','合计','总计','备注','序号','班级','性别','金额','女','男']);
  const names = [];
  const clss = [];
  const phones = [];
  const seen = new Set();
  const noSpace = (t) => t.replace(/\s+/g, '');
  for (const line of lines) {
    const ns = noSpace(line);
    // 手机号：去掉空格后再判断（OCR 常在数字间插空格）
    const ph = ns.match(/1[3-9]\d{9}/);
    if (ph) {
      const v = ph[0];
      if (phones.indexOf(v) < 0) phones.push(v);
      continue;
    }
    // 班级：一年级2班 → 102
    const cm = ns.match(/^([一二三四五六七八九])年级(\d{1,2})班/);
    if (cm) {
      const g = '一二三四五六七八九'.indexOf(cm[1]) + 1;
      const code = String(g) + String(Number(cm[2])).padStart(2, '0');
      clss.push(code);
      continue;
    }
    // 姓名：整行去掉空格后是 2–4 个汉字
    const nm = ns.match(new RegExp('^' + CN + '{2,4}$'));
    if (nm && !STOP.has(ns) && !/年级|班$/.test(ns)) {
      if (seen.has(ns)) continue;
      seen.add(ns);
      names.push(ns);
    }
  }
  // OCR 常按「列」输出：先所有姓名、再所有班级、再所有手机号 → 按序号对齐
  const rows = [];
  for (let i = 0; i < names.length; i++) {
    rows.push({ name: names[i], phone: phones[i] || '', cls: clss[i] || '' });
  }
  return { names: rows.map((r) => r.name), rows };
}

const SNIFF = [
  { kind: 'jpg',  test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { kind: 'png',  test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { kind: 'bmp',  test: (b) => b.length > 2 && b[0] === 0x42 && b[1] === 0x4d },
  { kind: 'webp', test: (b) => b.length > 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP' },
  { kind: 'gif',  test: (b) => b.length > 6 && b.toString('ascii', 0, 3) === 'GIF' },
  { kind: 'pdf',  test: (b) => b.length > 4 && b.toString('ascii', 0, 4) === '%PDF' },
  { kind: 'zip',  test: (b) => b.length > 4 && b[0] === 0x50 && b[1] === 0x4b },
];

function sniffKind(abs) {
  let fd = null;
  try {
    fd = fs.openSync(abs, 'r');
    const buf = Buffer.alloc(16);
    const n = fs.readSync(fd, buf, 0, 16, 0);
    const b = buf.slice(0, n);
    for (const s of SNIFF) { try { if (s.test(b)) return s.kind; } catch (e) {} }
  } catch (e) {
  } finally { if (fd !== null) { try { fs.closeSync(fd); } catch (e) {} } }
  return '';
}

async function parseRosterAbs(abs) {
  let ext = path.extname(abs).slice(1).toLowerCase();
  const KNOWN = new Set(['xlsx', 'xlsm', 'xls', 'csv', 'pdf', 'png', 'jpg', 'jpeg', 'bmp', 'webp']);
  if (!KNOWN.has(ext)) {
    const kind = sniffKind(abs);
    if (kind === 'zip') ext = 'xlsx';
    else if (kind === 'webp') ext = 'webp';
    else if (kind === 'gif') ext = 'gif';
    else if (kind) ext = kind;
  }
  if (ext === 'xlsx' || ext === 'xlsm') {
    const sheets = EX.xlsxRead(fs.readFileSync(abs), { grid: true }).sheets || [];
    let best = { source: 'excel', names: [], rows: [] };
    for (const sh of sheets) {
      const r = rosterFromGrid(sh.grid || []);
      if (r.names.length > best.names.length) best = Object.assign({ source: 'excel', sheet: sh.name }, r);
    }
    if (!best.names.length && sheets.length) best.sheet = sheets[0].name;
    return best;
  }
  if (ext === 'csv') {
    const txt = fs.readFileSync(abs, 'utf8');
    const rows = txt.split(/\r?\n/).map((l) => l.split(',').map((t) => ({ text: t })));
    return Object.assign({ source: 'csv' }, rosterFromGrid(rows));
  }
  if (ext === 'pdf') {
    const t = PX.pdfText(fs.readFileSync(abs)).pages.join('\n');
    return Object.assign({ source: 'pdf' }, rosterFromText(t));
  }
  if (IMG_EXT_ROSTER.has(ext) || ext === 'jpeg' || ext === 'gif' || ext === 'jpg') {
    const r = await psFile('tools/ocr.ps1', ['-Image', abs, '-Json', '-Scale', '2'], 70000);
    if (r.code !== 0) throw new Error('识别图片失败：' + String(r.err || r.out || '').slice(0, 120));
    const byPos = rosterFromOcr(r.out);
    // 第二次：放大更多再认一遍，只用来补认不出来的名字
    try {
      const r2 = await psFile('tools/ocr.ps1', ['-Image', abs, '-Json', '-Scale', '3'], 90000);
      if (r2.code === 0) {
        const second = rosterFromOcr(r2.out);
        if (second.rows.length) {
          const byPhone = new Map();
          for (const x of second.rows) if (x.phone && x.name) byPhone.set(x.phone, x.name);
          byPos.rows.forEach((x) => { if (!x.name && x.phone && byPhone.has(x.phone)) x.name = byPhone.get(x.phone); });
          // 手机号也没认出来的盲行，按顺序补
          const missing = second.rows.filter((x) => x.name).map((x) => x.name);
          byPos.rows.forEach((x) => {
            if (!x.name && !x.phone && missing.length) x.name = missing.shift() || '';
          });
          byPos.names = byPos.rows.map((x) => x.name).filter(Boolean);
        }
      }
    } catch (e2) {}
    if (byPos.names.length) return Object.assign({ source: 'image' }, byPos);
    // 兜底：拿不到坐标就退回纯文本规则
    const r2 = await psFile('tools/ocr.ps1', ['-Image', abs], 70000);
    return Object.assign({ source: 'image' }, rosterFromText(r2.out));
  }
  if (ext === 'xls') throw new Error('老格式 .xls 认不了，先在 Excel/WPS 里另存成 .xlsx');
  throw new Error('认不出这个文件（' + (ext || '无扩展名') + '）。支持 Excel(.xlsx) / CSV / PDF / 图片(png jpg bmp webp)');
}

  if (pathname === '/api/roster/parse' && req.method === 'GET') {
    const rel = String(q.get('rel') || '');
    const absTpl = String(q.get('path') || '');
    if (!rel && !absTpl) return fail(res, 400, '缺少文件');
    let abs;
    try { abs = absTpl || store.abs(rel); } catch (e) { return fail(res, 400, e.message); }
    try {
      const r = await parseRosterAbs(abs);
      if (!r.names.length) return ok(res, { ok: false, source: r.source, names: [], rows: [], error: '这个文件里没认出学生名字' });
      return ok(res, Object.assign({ ok: true }, r));
    } catch (e) {
      return fail(res, 400, e.message);
    }
  }

  if (pathname === '/api/roster/drop' && req.method === 'POST') {
    const name = safeFileName(String(q.get('name') || 'drop.bin'));
    const ext = path.extname(name).slice(1).toLowerCase() || 'bin';
    const dir = path.join(os.tmpdir(), 'courselib-roster');
    fs.mkdirSync(dir, { recursive: true });
    const abs = path.join(dir, Date.now() + '_' + name);
    try {
      const buf = await readBody(req, 60 * 1024 * 1024);
      fs.writeFileSync(abs, buf);
      const r = await parseRosterAbs(abs);
      if (!r.names.length) return ok(res, { ok: false, source: r.source, names: [], rows: [], error: '这个文件里没认出学生名字' });
      return ok(res, Object.assign({ ok: true }, r));
    } catch (e) {
      return fail(res, 400, e.message);
    } finally {
      try { fs.unlinkSync(abs); } catch (e2) {}
    }
  }

  if (pathname === '/api/attendance/templates' && req.method === 'GET') {
    const dir = path.join(APP_DIR, 'templates');
    let items = [];
    try {
      items = fs.readdirSync(dir).filter((f) => /\.xlsx$/i.test(f)).map((f) => ({
        name: f.replace(/\.xlsx$/i, ''),
        path: path.join(dir, f),
        size: fs.statSync(path.join(dir, f)).size,
      }));
    } catch (e) { items = []; }
    return ok(res, { items });
  }

  if (pathname === '/api/attendance/plans' && req.method === 'GET') {
    return ok(res, { plans: store.getPlans() });
  }

  if (pathname === '/api/attendance/plans' && req.method === 'POST') {
    const b = await readJson(req);
    const item = store.savePlan(b || {});
    return ok(res, { plan: item, plans: store.getPlans() });
  }

  if (pathname === '/api/attendance/plans/delete' && req.method === 'POST') {
    const b = await readJson(req);
    return ok(res, { plans: store.delPlan(String(b.id || '')) });
  }

  if (pathname === '/api/attendance/plans/run' && req.method === 'POST') {
    const b = await readJson(req);
    const id = String(b.id || '');
    const month = String(b.month || '').trim();
    if (!/^\d{4}-\d{1,2}$/.test(month) && !/^\d{4}\s*[秋春夏寒暑]/.test(month)) return fail(res, 400, '月份写成 2026-11；一整学期可以写 2026秋季');
    const plan = (store.getPlans() || []).find((p) => p.id === id);
    if (!plan) return fail(res, 404, '找不到这个方案');
    const tpl = plan.tplPath || plan.tplRel;
    if (!tpl) return fail(res, 400, '这个方案没有模板');
    let src;
    try { src = fs.existsSync(tpl) ? fs.readFileSync(tpl) : store.fileBuffer(plan.tplRel); } catch (e) { return fail(res, 404, '模板文件找不到了：' + tpl); }
    const r = AP.fill(src, { month, names: [], students: plan.students || [], blocks: Array.isArray(plan.blocks) ? plan.blocks : [], course: plan.course, org: plan.org, weekdays: plan.weekdays });
    const label = (plan.name || '考勤表') + ' ' + month.replace('-', '年') + '月';
    const outRel = uniqueRel(safeFileName(label) + '.xlsx');
    const abs = path.join(config.root, outRel);
    const slim = AP.keepOnlySheet(r.buf, r.sheetPath, month);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, slim);
    store.indexOne(abs);
    store.dirty();
    libRev += 1;
    return ok(res, { rel: outRel, name: outRel, size: slim.length, sheet: r.sheet, filled: r.filled, slots: r.slots, days: r.days });
  }

  if (pathname === '/api/attendance/schedule' && req.method === 'GET') {
    const wdRaw = String(q.get('weekdays') || '');
    const weekdays = wdRaw.split(',').map((x) => Number(String(x).trim())).filter((n) => Number.isFinite(n) && n >= 0 && n <= 6);
    const interval = Math.max(1, Number(q.get('interval') || 1) || 1);
    const dates = AP.enumerateDates({
      weekdays,
      interval,
      startDate: String(q.get('start') || ''),
      endDate: String(q.get('end') || ''),
    });
    return ok(res, { count: dates.length, dates, first: dates[0] || null, last: dates[dates.length - 1] || null });
  }

  if (pathname === '/api/attendance/template/analyse' && req.method === 'GET') {
    const rel = String(q.get('rel') || '');
    const absTpl = String(q.get('path') || '');
    if (!rel && !absTpl) return fail(res, 400, '缺少模板文件');
    let buf;
    try { buf = absTpl ? fs.readFileSync(absTpl) : store.fileBuffer(rel); } catch (e) { return fail(res, 404, '读不到这个模板文件'); }
    try {
      const an = AP.analyse(buf, { month: String(q.get('month') || '') });
      const first = an.summary[0] || null;
      const sh = an.sheets.find((x) => x.blocks.length) || null;
      const blk = sh ? sh.blocks[0] : null;
      const cols = blk && blk.cols ? blk.cols : null;
      const fieldList = [];
      if (cols) {
        if (cols.no >= 0) fieldList.push('no');
        fieldList.push('name');
        if (cols.phone >= 0) fieldList.push('phone');
        if (cols.cls >= 0) fieldList.push('cls');
        if (cols.sex >= 0) fieldList.push('sex');
      }
      return ok(res, {
        ok: an.ok,
        summary: an.summary,
        sheetName: first ? first.name : '',
        slots: first ? first.slots : 0,
        days: first ? first.days : 0,
        blocks: first ? first.blocks : 0,
        fields: fieldList,
        rows: blk ? blk.rows : [],
        blocksMeta: sh ? sh.blocks.map((b) => ({ blocks: 1, slots: b.nameRows.length, days: b.dayCols.length, kind: b.kind || 'grid' })) : [],
        blockList: sh ? sh.blocks.map((b, bi) => ({
          i: bi,
          kind: b.kind || 'grid',
          slots: b.nameRows.length,
          cols: b.dayCols.length,
          firstIso: b.firstIso || null,
          firstWeekday: (b.firstWeekday == null ? null : b.firstWeekday),
          rows: b.rows || [],
        })) : [],
      });
    } catch (e) {
      return ok(res, { ok: false, summary: [], error: e.message });
    }
  }

  // ===== 学员管理 =====
  if (pathname === '/api/students' && req.method === 'GET') {
    const u = new URL(req.url, 'http://127.0.0.1');
    const items = eduStore().list({
      q: u.searchParams.get('q') || '',
      status: u.searchParams.get('status') || '',
      course: u.searchParams.get('course') || '',
    });
    return ok(res, { items, stats: eduStore().stats(), courses: eduStore().courses() });
  }

  if (pathname === '/api/students/stats' && req.method === 'GET') {
    return ok(res, eduStore().stats());
  }

  if (pathname === '/api/students/save' && req.method === 'POST') {
    const b = await readJson(req);
    try {
      const s = eduStore().save(b);
      libRev += 1;
      return ok(res, { student: s, stats: eduStore().stats() });
    } catch (e) { return fail(res, 400, e.message); }
  }

  if (pathname === '/api/students/delete' && req.method === 'POST') {
    const b = await readJson(req);
    const done = eduStore().remove(b.id);
    libRev += 1;
    return done ? ok(res, { stats: eduStore().stats() }) : fail(res, 404, '找不到这个学员');
  }

  if (pathname === '/api/students/courses' && req.method === 'GET') {
    return ok(res, { courses: eduStore().courses() });
  }

  if (pathname === '/api/students/courses/save' && req.method === 'POST') {
    const b = await readJson(req);
    try { return ok(res, { courses: eduStore().saveCourse(b) }); }
    catch (e) { return fail(res, 400, e.message); }
  }

  if (pathname === '/api/students/courses/delete' && req.method === 'POST') {
    const b = await readJson(req);
    return ok(res, { courses: eduStore().removeCourse(String(b.name || '')) });
  }

  if (pathname === '/api/students/export' && req.method === 'POST') {
    const b = await readJson(req);
    const rows = eduStore().list({});
    const head = ['学号', '姓名', '性别', '年龄', '联系电话', '家长', '学校', '年级', '报读课程', '班级', '课程费用', '单价', '优惠', '应收', '实收', '欠费', '总课时', '已用课时', '剩余课时', '已耗课值', '剩余课值', '缴费状态', '学员状态', '报名日期', '礼物', '礼物领取日期', '备注'];
    const data = rows.map((s) => [s.id, s.name, s.sex, s.age, s.phone, s.parent, s.school, s.grade, s.course, s.class, s.fee, s.unitPrice, s.discount, s.need, s.paid, s.owe, s.totalLessons, s.usedLessons, s.leftLessons, s.usedValue, s.leftValue, s.payState, s.status || '在读', s.enrollDate, s.gift, s.giftAt, s.note]);
    const fmt = String(b.format || 'xlsx').toLowerCase() === 'csv' ? 'csv' : 'xlsx';
    let dir = String(b.dir || '').trim();
    if (!dir) dir = path.join(config.root, '导出');
    if (!path.isAbsolute(dir)) return fail(res, 400, '导出位置要写完整路径，例如 D:\\导出');
    fs.mkdirSync(dir, { recursive: true });
    let base = safeFileName(String(b.name || '学员名单').replace(/\.(xlsx|csv)$/i, ''));
    if (!base) base = '学员名单';
    const outAbs = uniquePath(path.join(dir, base + '.' + fmt));
    let buf;
    if (fmt === 'csv') {
      const lines = [head.join(',')];
      for (const r of data) lines.push(r.map(csvCell).join(','));
      buf = Buffer.from('\ufeff' + lines.join('\r\n'), 'utf8');
    } else {
      buf = buildXlsx([head].concat(data), '学员名单');
    }
    fs.writeFileSync(outAbs, buf);
    // 落在资料库里就顺手索引
    try {
      const relToRoot = path.relative(config.root, outAbs);
      if (relToRoot && !relToRoot.startsWith('..') && !path.isAbsolute(relToRoot)) {
        store.indexOne(relToRoot.replace(/\\/g, '/'));
        store.dirty();
        libRev += 1;
      }
    } catch (e) {}
    return ok(res, { path: outAbs, name: path.basename(outAbs), size: buf.length, count: data.length, format: fmt });
  }

  if (pathname === '/api/students/export.csv' && req.method === 'GET') {
    const rows = eduStore().list({});
    const head = ['学号', '姓名', '性别', '年龄', '联系电话', '家长', '学校', '年级', '报读课程', '班级', '课程费用', '单价', '优惠', '应收', '实收', '欠费', '总课时', '已用课时', '剩余课时', '已耗课值', '剩余课值', '缴费状态', '学员状态', '报名日期', '礼物', '礼物领取日期', '备注'];
    const lines = [head.join(',')];
    for (const s of rows) {
      lines.push([s.id, s.name, s.sex, s.age, s.phone, s.parent, s.school, s.grade, s.course, s.class, s.fee, s.unitPrice, s.discount, s.need, s.paid, s.owe, s.totalLessons, s.usedLessons, s.leftLessons, s.usedValue, s.leftValue, s.payState, s.status || '在读', s.enrollDate, s.gift, s.giftAt, s.note].map(csvCell).join(','));
    }
    const body = '\uFEFF' + lines.join('\r\n');
    res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="students.csv"', 'Cache-Control': 'no-store' });
    return res.end(body);
  }

  if (pathname === '/api/students/import' && req.method === 'POST') {
    const b = await readJson(req);
    const text = String(b.text || '').trim();
    if (!text) return fail(res, 400, '没有内容');
    const lines = text.split(/\r?\n/).filter((x) => x.trim());
    let added = 0;
    const errs = [];
    for (const line of lines) {
      const parts = line.split(/[,\t;，]/).map((x) => x.trim());
      if (!parts[0] || /^(姓名|学生|学员)$/.test(parts[0])) continue;
      try {
        eduStore().save({
          name: parts[0], sex: parts[1] || '', age: parts[2] || '', phone: parts[3] || '',
          course: parts[4] || '', fee: parts[5] || 0, paid: parts[6] || 0,
          class: parts[7] || '', status: '在读',
        });
        added += 1;
      } catch (e) { errs.push(line.slice(0, 20) + '：' + e.message); }
    }
    libRev += 1;
    return ok(res, { added, errors: errs, stats: eduStore().stats() });
  }

  // ===== 学员：批量删除 / Excel 导入 =====
  if (pathname === '/api/students/bulk-update' && req.method === 'POST') {
    const b = await readJson(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    const field = String(b.field || '');
    const mode = String(b.mode || 'set');
    const value = b.value === undefined || b.value === null ? '' : String(b.value);
    const ALLOW = ['course', 'class', 'grade', 'school', 'sex', 'status', 'fee', 'discount', 'paid',
      'totalLessons', 'usedLessons', 'unitPrice', 'gift', 'giftAt', 'note', 'phone', 'age', 'parent'];
    if (!ids.length) return fail(res, '没有选中任何学员');
    if (ALLOW.indexOf(field) < 0) return fail(res, '不支持批量修改这个字段：' + field);
    if (mode !== 'set' && mode !== 'add' && mode !== 'clear') return fail(res, '模式只能是 set / add / clear');
    eduStore().snapshot('before-bulk-' + ids.length + '-' + field);
    // 批量改「报读课程」时，顺带按课程预设带出费用 / 单价 / 每课次课时 / 总课时
    let preset = null;
    if (field === 'course' && mode === 'set' && value) {
      preset = (eduStore().courses() || []).find(function (c) { return c.name === value; }) || null;
    }
    let changed = 0;
    for (const id of ids) {
      const cur = eduStore().list().find(function (x) { return String(x.id) === id; });
      if (!cur) continue;
      let next;
      if (mode === 'clear') next = '';
      else if (mode === 'add') next = Number(cur[field] || 0) + Number(value || 0);
      else next = value;
      const patch = {};
      patch[field] = next;
      if (preset) {
        if (preset.fee) patch.fee = preset.fee;
        if (preset.unitPrice) patch.unitPrice = preset.unitPrice;
        if (preset.perSession) patch.perSession = preset.perSession;
        if (preset.lessons) patch.totalLessons = preset.lessons;
      }
      try { eduStore().save(Object.assign({}, cur, patch)); changed += 1; } catch (e) {}
    }
    libRev += 1;
    return ok(res, { changed: changed, stats: eduStore().stats() });
  }
  if (pathname === '/api/students/delete-batch' && req.method === 'POST') {
    const b = await readJson(req);
    const ids = Array.isArray(b.ids) ? b.ids.map(String) : [];
    if (ids.length) eduStore().snapshot('before-delete-' + ids.length);
    let n = 0;
    for (const id of ids) if (eduStore().remove(id)) n += 1;
    libRev += 1;
    return ok(res, { removed: n, stats: eduStore().stats() });
  }

  if (pathname === '/api/students/import-rows' && req.method === 'POST') {
    const b = await readJson(req);
    const rows = Array.isArray(b.rows) ? b.rows : [];
    if (rows.length) eduStore().snapshot('before-import-' + rows.length);
    let n = 0; const errs = [];
    for (const r of rows) {
      if (!r || !String(r.name || '').trim()) continue;
      try { eduStore().save(Object.assign({ status: '在读' }, r)); n += 1; }
      catch (e) { errs.push(String(r.name) + '：' + e.message); }
    }
    libRev += 1;
    return ok(res, { added: n, errors: errs, stats: eduStore().stats() });
  }

  if (pathname === '/api/students/parse' && req.method === 'POST') {
    const raw = await readBody(req, 30 * 1024 * 1024);
    const name = String(req.headers['x-file-name'] || '').toLowerCase();
    let grid = [];
    if (/\.csv$/.test(name) || (raw.length < 200000 && raw.slice(0, 200).toString('utf8').indexOf(',') >= 0 && !/^PK/.test(raw.slice(0, 2).toString('binary')))) {
      const text = raw.toString('utf8').replace(/^\uFEFF/, '');
      grid = text.split(/\r?\n/).filter((x) => x.trim()).map((line) => line.split(/[,\t;]/).map((c) => c.replace(/^"|"$/g, '').trim()));
    } else {
      const r = EX.xlsxRead(raw, { grid: true });
      const sheets = (r && r.sheets) || [];
      let best = null;
      for (const sh of sheets) {
        const g = sh.grid || [];
        const cells = g.reduce((n, row) => n + row.filter((c) => c && String(c.text || c).trim()).length, 0);
        if (!best || cells > best.cells) best = { g, cells, name: sh.name };
      }
      grid = best ? best.g.map((row) => row.map((c) => (c && c.text != null ? c.text : (c == null ? '' : String(c))))) : [];
    }
    const FIELDS = [
      ['name', ['姓名', '学生姓名', '学员姓名', '学生名字', '学员名字', '学生', '学员', '名字', 'name']],
      ['sex', ['性别', 'sex']],
      ['age', ['年龄', '岁数', 'age']],
      ['phone', ['电话', '手机', '联系电话', '联系方式', '手机号', '家长电话', 'phone', 'tel']],
      ['parent', ['家长', '联系人', '监护人']],
      ['school', ['学校', '就读学校']],
      ['grade', ['年级']],
      ['class', ['班级', '所在班级', '班别', '班']],
      ['course', ['报读课程', '课程', '课程名称', '科目', 'course']],
      ['fee', ['课程费用', '学费', '费用', '应收', '应缴', '金额', '课时费']],
      ['discount', ['优惠', '减免', '折扣']],
      ['paid', ['实收', '实缴', '已缴', '已收', '缴费金额']],
      ['totalLessons', ['总课时', '课时', '课次', '总课次']],
      ['usedLessons', ['已用课时', '已上课时', '已上']],
      ['status', ['状态', '学员状态']],
      ['enrollDate', ['报名日期', '报名时间', '入学日期', '日期']],
      ['note', ['备注', '说明']],
      ['unitPrice', ['单价', '课时单价', '每课时', '单节价格', '单节']],
      ['gift', ['礼物', '礼品', '赠品', '礼物名称', '奖品']],
      ['giftAt', ['礼物领取', '领取日期', '领取时间', '礼品领取']],
    ];
    const cellText = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
    let headerIdx = -1, bestScore = 0;
    for (let i = 0; i < Math.min(grid.length, 15); i += 1) {
      let score = 0;
      for (const c of grid[i]) {
        const t = cellText(c);
        if (!t) continue;
        for (const [, alias] of FIELDS) if (alias.some((a) => t === a || t.includes(a))) { score += 1; break; }
      }
      if (score > bestScore) { bestScore = score; headerIdx = i; }
    }
    if (headerIdx < 0 || bestScore < 2) return fail(res, 400, '没找到表头行：请确保第一行有「姓名 / 电话 / 课程」这类列名');
    const headers = grid[headerIdx].map(cellText);
    const cols = {};
    for (const [key, alias] of FIELDS) {
      let idx = -1;
      for (let i = 0; i < headers.length; i += 1) {
        const t = headers[i];
        if (!t) continue;
        if (alias.some((a) => t === a)) { idx = i; break; }
      }
      if (idx < 0) for (let i = 0; i < headers.length; i += 1) {
        const t = headers[i];
        if (t && alias.some((a) => t.includes(a))) { idx = i; break; }
      }
      if (idx >= 0) cols[key] = idx;
    }
    if (cols.name == null) return fail(res, 400, '表头里没看到「姓名」列');
    for (const k of ['fee', 'discount', 'paid', 'totalLessons', 'usedLessons', 'age']) {
      if (cols[k] == null) continue;
      let num = 0, tot = 0;
      for (let i = headerIdx + 1; i < Math.min(grid.length, headerIdx + 12); i += 1) {
        const v = String((grid[i] || [])[cols[k]] == null ? '' : (grid[i] || [])[cols[k]]).trim();
        if (!v) continue;
        tot += 1;
        if (/^[\d.,￥¥\s]+$/.test(v)) num += 1;
      }
      if (tot >= 3 && num / tot < 0.5) delete cols[k];
    }
    const rows = [];
    for (let i = headerIdx + 1; i < grid.length; i += 1) {
      const r = grid[i] || [];
      const get = (k) => (cols[k] == null ? '' : cellText(r[cols[k]]));
      const name = get('name');
      if (!name) continue;
      if (/^(合计|总计|小计)$/.test(name)) continue;
      if (/^(姓名|学生名字|学员名字|学生姓名|学员姓名|名字)$/.test(name)) continue;
      rows.push({
        name, sex: get('sex'), age: get('age'), phone: get('phone'), parent: get('parent'),
        school: get('school'), grade: get('grade'), class: get('class'),
        course: get('course'), fee: get('fee'), discount: get('discount'), paid: get('paid'),
        totalLessons: get('totalLessons'), usedLessons: get('usedLessons'),
        status: get('status') || '在读', enrollDate: get('enrollDate'), note: get('note'),
      });
    }
    return ok(res, { headers, cols, rows, total: rows.length });
  }

  // 学生考勤表：不用模板，按班块直接画表
  if (pathname === '/api/attendance/student' && req.method === 'POST') {
    const b = await readJson(req);
    const month = String(b.month || '').slice(0, 7);
    if (!/^\d{4}-\d{1,2}$/.test(month) && !/^\d{4}\s*[秋春夏寒暑]/.test(month)) return fail(res, 400, '月份写成 2026-11；一整学期可以写 2026秋季');
    let buf;
    try {
      buf = AT.buildStudent({ month, course: b.course || '', org: b.org || '', tutor: b.tutor || '', blocks: Array.isArray(b.blocks) ? b.blocks : [] });
    } catch (e) { return fail(res, 400, e.message); }
    const isSeason = !/^\d{4}-\d{1,2}$/.test(month);
    const autoName = isSeason ? (month.replace(/\s+/g, '') + '学员考勤表') : (month.replace('-', '年') + '月学员考勤表');
    const outRel = uniqueRel(safeFileName(b.fileName || autoName) + '.xlsx');
    const abs = path.join(config.root, outRel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    store.indexOne(abs); store.dirty(); libRev += 1;
    return ok(res, { rel: outRel, name: outRel, size: buf.length });
  }

  if (pathname === '/api/attendance/template' && req.method === 'POST') {
    const b = await readJson(req);
    const rel = String(b.rel || '');
    const absTpl = String(b.path || '');
    const month = String(b.month || '').slice(0, 7);
    const names = Array.isArray(b.names) ? b.names : String(b.names || '').split(/\r?\n/);
    if (!rel && !absTpl) return fail(res, 400, '缺少模板文件');
    if (!/^\d{4}-\d{1,2}$/.test(month) && !/^\d{4}\s*[秋春夏寒暑]/.test(month)) return fail(res, 400, '月份写成 2026-11；一整学期可以写 2026秋季');
    let src;
    try { src = absTpl ? fs.readFileSync(absTpl) : store.fileBuffer(rel); } catch (e) { return fail(res, 404, '读不到这个模板文件'); }
    let r;
    try {
      const students = Array.isArray(b.students) ? b.students : [];
      r = AP.fill(src, { month, names: names.map((x) => String(x).trim()).filter(Boolean), students, blocks: Array.isArray(b.blocks) ? b.blocks : [], course: b.course || '', org: b.org || '', tutor: b.tutor || '' });
    } catch (e) {
      return fail(res, 400, e.message);
    }
    const label = month.replace('-', '年') + '月考勤表';
    const outRel = uniqueRel(safeFileName(b.fileName || label) + '.xlsx');
    const abs = path.join(config.root, outRel);
    const slim = AP.keepOnlySheet(r.buf, r.sheetPath, month);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, slim);
    store.indexOne(abs);
    store.dirty();
    libRev += 1;
    return ok(res, {
      rel: outRel, name: outRel, size: slim.length,
      sheet: r.sheet, blocks: r.blocks, slots: r.slots, filled: r.filled,
      overflow: r.overflow, days: r.days, sessions: r.sessions || 0, from: rel || absTpl,
    });
  }

  if (pathname === '/api/attendance' && req.method === 'POST') {
    const b = await readJson(req);
    const month = String(b.month || '').slice(0, 7);
    const names = Array.isArray(b.names) ? b.names : String(b.names || '').split(/\r?\n/);
    const buf = AT.buildAttendance({
      month,
      course: b.course || '',
      org: b.org || '',
      weekdays: b.weekdays || [6, 0],
      names,
    });
    const label = month.replace('-', '年') + '月考勤表';
    const rel = uniqueRel(safeFileName(b.fileName || label) + '.xlsx');
    const abs = path.join(config.root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    store.indexOne(abs);
    store.dirty();
    libRev += 1;
    return ok(res, { rel, name: rel, size: buf.length });
  }

  if (pathname === '/api/attendance/teacher' && req.method === 'POST') {
    const b = await readJson(req);
    const month = String(b.month || '').slice(0, 7);
    const names = Array.isArray(b.names) ? b.names : String(b.names || '').split(/\r?\n/);
    const buf = AT.buildTeacher({
      month,
      course: b.course || '',
      org: b.org || '',
      weekdays: b.weekdays || [1, 2, 3, 4, 5],
      names,
      holiday: Number(b.holiday || 0) || 0,
      dutyDays: Number(b.dutyDays || 0) || 0,
    });
    const label = month.replace('-', '年') + '月教师考勤表';
    const rel = uniqueRel(safeFileName(b.fileName || label) + '.xlsx');
    const abs = path.join(config.root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    store.indexOne(abs);
    store.dirty();
    libRev += 1;
    return ok(res, { rel, name: rel, size: buf.length });
  }

  if (pathname === '/api/attendance/campus' && req.method === 'POST') {
    const b = await readJson(req);
    const names = Array.isArray(b.names) ? b.names : String(b.names || '').split(/\r?\n/);
    const buf = AT.buildCampus({
      startDate: b.startDate || '',
      weeks: b.weeks || 20,
      course: b.course || '',
      org: b.org || '',
      names,
    });
    const rel = uniqueRel(safeFileName(b.fileName || '校区考勤表') + '.xlsx');
    const abs = path.join(config.root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, buf);
    store.indexOne(abs);
    store.dirty();
    libRev += 1;
    return ok(res, { rel, name: rel, size: buf.length });
  }

  /* ---- 退出 ---- */
  if (pathname === '/api/shutdown' && req.method === 'POST') {
    ok(res, {});
    setTimeout(() => process.exit(0), 150);
    return;
  }

  return fail(res, 404, '未知接口: ' + pathname);
}

/* ------------------------------ 启动 ------------------------------ */

loadConfig();
if (!config.root) config.root = defaultRoot();
openStore();

const server = http.createServer(async (req, res) => {
  let url;
  let pathname;
  try {
    url = new URL(req.url, 'http://127.0.0.1');
    pathname = url.pathname;
  } catch (_) {
    return fail(res, 400, '请求地址不对');
  }
  try {
    if (pathname.startsWith('/api/')) return await handleApi(req, res, pathname, url);
    return serveStatic(req, res, pathname);
  } catch (e) {
    console.error('[api] ' + pathname + ' -> ' + (e && e.stack ? e.stack : e));
    if (!res.headersSent) return fail(res, 500, (e && e.message) || '服务出错');
    try { res.end(); } catch (_) {}
  }
});

function onReady(port) {
  config.port = port;
  try { fs.writeFileSync(PORT_FILE, String(port)); } catch (_) {}
  startWatch();
  const url = 'http://127.0.0.1:' + port;
  console.log('课程文件库已启动: ' + url);
  console.log('库目录: ' + config.root + (store.error ? '（打不开：' + store.error + '）' : ''));
  if (!process.env.NO_BROWSER) shellOpen(url);

  if (!store.error && store.entries.size === 0) {
    try {
      const exists = fs.existsSync(config.root) && fs.readdirSync(config.root).some((n) => n !== '.lib');
      if (exists) {
        scanState.running = true;
        setImmediate(async () => {
          try { scanState.last = await store.scan((p) => Object.assign(scanState, p)); }
          catch (e) { scanState.last = { error: e.message }; }
          scanState.running = false;
        });
      }
    } catch (_) {}
  }
}

/* 端口被占用就往后找，最多试 20 个；实际端口写进 port.txt，外壳程序据此导航 */
(function tryListen(startPort, tries) {
  let n = 0;
  function go(p) {
    const onErr = (e) => {
      server.removeListener('error', onErr);
      if (e && e.code === 'EADDRINUSE' && n < tries) { n += 1; go(p + 1); return; }
      console.error('[server] 启动失败：' + (e && e.message));
      process.exit(1);
    };
    server.once('error', onErr);
    server.listen(p, '127.0.0.1', () => {
      server.removeListener('error', onErr);
      onReady(p);
    });
  }
  go(startPort);
})(config.port, 20);

process.on('SIGINT', () => { try { store.flush(); } catch (_) {} process.exit(0); });
process.on('uncaughtException', (e) => { console.error('[fatal] ' + (e && e.stack ? e.stack : e)); });
