'use strict';
/* 文件库：索引、标签、备注、回收站、改名/移动/删除。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { extractText, canExtract } = require('./extract');
const { autoTags, autoTagList, parseAuto } = require('./autotag');

const EXT_GROUP = {
  doc: 'doc', docx: 'doc', rtf: 'doc', txt: 'doc', md: 'doc', pdf: 'doc', wps: 'doc', odt: 'doc',
  xls: 'sheet', xlsx: 'sheet', xlsm: 'sheet', csv: 'sheet', et: 'sheet', ods: 'sheet',
  ppt: 'slide', pptx: 'slide', ppsx: 'slide', dps: 'slide', odp: 'slide',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', bmp: 'image', webp: 'image', svg: 'image', ico: 'image',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  py: 'code', js: 'code', json: 'code', html: 'code', htm: 'code', css: 'code', sb3: 'code', sb2: 'code', ino: 'code', xml: 'code', sql: 'code',
  mp4: 'media', avi: 'media', mov: 'media', mp3: 'media', wav: 'media', m4a: 'media',
};

const GROUP_LABEL = { doc: '文档', sheet: '表格', slide: '演示', image: '图片', archive: '压缩包', code: '代码', media: '音视频', other: '其他' };

function groupOf(ext) { return EXT_GROUP[String(ext || '').toLowerCase()] || 'other'; }

/** 正文小写缓存（WeakMap，entry 换新即自动失效），避免每次搜索重复 toLowerCase */
const LOWER = new WeakMap();
function lowerText(e) {
  let v = LOWER.get(e);
  if (v === undefined) { v = String(e.text || '').toLowerCase(); LOWER.set(e, v); }
  return v;
}

const JUNK = new Set(['dll', 'qm', 'pyd', 'node', 'so', 'dylib', 'exe', 'msi', 'pak', 'dat', 'bin', 'lib', 'obj', 'pdb']);

/** Office 临时锁文件（~$xxx.docx）和 macOS 资源分叉（._xxx）不是真正的资料 */
function isTempName(name) {
  return name.startsWith('~$') || name.startsWith('._') || name === '.DS_Store' || name === 'Thumbs.db';
}

class Store {
  constructor(root) {
    this.root = root;
    this.libDir = path.join(root, '.lib');
    this.trashDir = path.join(this.libDir, 'trash');
    this.indexPath = path.join(this.libDir, 'index.json');
    this.metaPath = path.join(this.libDir, 'meta.json');
    this.prefsPath = path.join(this.libDir, 'prefs.json');
    this.entries = new Map(); // rel -> entry
    this.tags = [];           // [{id,name,color}]
    this.prefs = { views: [], favs: [], recents: [], plans: [] };
    this.savedAt = 0;
    this._dirty = false;
    this._timer = null;
    this.lastScan = null;
    this.ensureDirs();
    this.load();
  }

  ensureDirs() {
    for (const d of [this.root, this.libDir, this.trashDir]) {
      try { fs.mkdirSync(d, { recursive: true }); } catch (e) {
        this.error = this.error || ('无法创建资料库目录：' + d + '（' + e.code + '）');
      }
    }
  }

  abs(rel) { return path.join(this.root, rel); }

  safeRel(rel) {
    const clean = String(rel || '').replace(/\\/g, '/').replace(/^\/+/, '');
    if (clean.split('/').some((p) => p === '..')) throw new Error('非法路径: ' + rel);
    if (clean === '.lib' || clean.startsWith('.lib/')) throw new Error('不能操作库内部目录');
    return clean;
  }

  load() {
    try {
      if (fs.existsSync(this.indexPath)) {
        const data = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
        for (const f of data.files || []) this.entries.set(f.rel, f);
        this.savedAt = data.savedAt || 0;
      }
      if (fs.existsSync(this.metaPath)) {
        const m = JSON.parse(fs.readFileSync(this.metaPath, 'utf8'));
        this.tags = m.tags || [];
      }
      if (fs.existsSync(this.prefsPath)) {
        const p = JSON.parse(fs.readFileSync(this.prefsPath, 'utf8'));
        this.prefs = { views: p.views || [], favs: p.favs || [], recents: p.recents || [], plans: p.plans || [] };
      }
    } catch (e) {
      console.error('[store] 读取索引失败:', e.message);
    }
  }

  save() {
    this._dirty = false;
    const files = [...this.entries.values()];
    const payload = { version: 3, savedAt: Date.now(), files };
    try {
      const tmp = this.indexPath + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(payload));
      fs.renameSync(tmp, this.indexPath);
      fs.writeFileSync(this.metaPath, JSON.stringify({ tags: this.tags }, null, 2));
    } catch (e) {
      console.error('[store] 保存索引失败:', e.message);
    }
  }

  dirty() {
    this._dirty = true;
    if (!this._timer) {
      this._timer = setTimeout(() => { this._timer = null; if (this._dirty) this.save(); }, 1500);
    }
  }

  flush() { if (this._timer) { clearTimeout(this._timer); this._timer = null; } if (this._dirty) this.save(); }

  /* ------------------------- 扫描 / 索引 ------------------------- */

  walk(dir, out = []) {
    let items;
    try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
    for (const it of items) {
      if (it.name.startsWith('.lib') || it.name === '.edu') continue;
      const full = path.join(dir, it.name);
      if (it.isDirectory()) this.walk(full, out);
      else if (it.isFile()) out.push(full);
    }
    return out;
  }

  indexOne(absPath) {
    const rel = path.relative(this.root, absPath).replace(/\\/g, '/');
    if (rel.startsWith('.lib') || rel === '.edu' || rel.startsWith('.edu/') || rel.startsWith('..')) return null;
    if (isTempName(path.basename(absPath))) return null;
    let st;
    try { st = fs.statSync(absPath); } catch (_) { return null; }
    const ext = (path.extname(absPath).slice(1) || '').toLowerCase();
    const prev = this.entries.get(rel);
    if (prev && prev.size === st.size && prev.mtime === Math.round(st.mtimeMs)) return prev;
    const entry = {
      rel,
      name: path.basename(absPath),
      dir: path.dirname(rel) === '.' ? '' : path.dirname(rel),
      ext,
      group: groupOf(ext),
      size: st.size,
      mtime: Math.round(st.mtimeMs),
      text: '',
      textNote: '',
      note: prev ? prev.note || '' : '',
      tags: prev ? prev.tags || [] : [],
      addedAt: prev ? prev.addedAt || Date.now() : Date.now(),
    };
    const big = st.size > 60 * 1024 * 1024;
    if (big) {
      entry.textNote = '文件超过 60MB，未抽取正文';
    } else if (!JUNK.has(ext) && canExtract(ext)) {
      try {
        const buf = fs.readFileSync(absPath);
        const r = extractText(ext, buf);
        entry.text = r.text || '';
        entry.textNote = r.note || '';
      } catch (e) {
        entry.textNote = '读取失败：' + e.message;
      }
    }
    this.entries.set(rel, entry);
    return entry;
  }

  /** 增量扫描整个库（每 12 个文件让出一次事件循环，界面不卡）；返回 {added, updated, removed, total} */
  async scan(onProgress) {
    const started = Date.now();
    for (const rel of [...this.entries.keys()]) {
      if (rel === '.edu' || rel.startsWith('.edu/')) this.entries.delete(rel);
    }
    const files = this.walk(this.root);
    const seen = new Set();
    let added = 0, updated = 0;
    const total = files.length;
    for (let i = 0; i < total; i++) {
      const f = files[i];
      const rel = path.relative(this.root, f).replace(/\\/g, '/');
      if (rel.startsWith('.lib') || rel === '.edu' || rel.startsWith('.edu/')) continue;
      const before = this.entries.get(rel);
      const e = this.indexOne(f);
      if (!e) continue;
      seen.add(rel);
      if (before) {
        if (before.mtime !== e.mtime || before.size !== e.size) updated++;
      } else added++;
      if (onProgress && (i % 25 === 0 || i === total - 1)) onProgress({ done: i + 1, total, rel });
      if (i % 200 === 0) this.save();
      if (i % 12 === 11) await new Promise((r) => setImmediate(r));
    }
    let removed = 0;
    for (const rel of [...this.entries.keys()]) {
      if (!seen.has(rel)) { this.entries.delete(rel); removed++; }
    }
    this.save();
    this.lastScan = { at: Date.now(), added, updated, removed, total, ms: Date.now() - started };
    return this.lastScan;
  }

  /* ------------------------- 查询 ------------------------- */

  all() { return [...this.entries.values()]; }

  query(opts = {}) {
    const q = String(opts.q || '').trim().toLowerCase();
    const tokens = q ? q.split(/\s+/).filter(Boolean) : [];
    const groups = String(opts.groups || '').split(',').filter(Boolean);
    const exts = String(opts.exts || '').split(',').filter(Boolean).map((x) => x.replace(/^\./, '').toLowerCase());
    const tags = String(opts.tags || '').split(',').filter(Boolean);
    const autoSel = parseAuto(opts.auto);
    const relList = String(opts.rels || '').split(',').map((x) => x.trim()).filter(Boolean);
    const relSet = relList.length ? new Set(relList) : null;
    const dir = String(opts.dir || '').replace(/\\/g, '/').replace(/\/$/, '');
    const sizeMin = opts.sizeMin ? Number(opts.sizeMin) : null;
    const sizeMax = opts.sizeMax ? Number(opts.sizeMax) : null;
    const dateFrom = opts.dateFrom ? new Date(opts.dateFrom + 'T00:00:00').getTime() : null;
    const dateTo = opts.dateTo ? new Date(opts.dateTo + 'T23:59:59').getTime() : null;
    const sort = opts.sort || 'mtime';
    const desc = opts.order !== 'asc';
    const page = Math.max(1, Number(opts.page) || 1);
    const pageSize = Math.min(500, Math.max(1, Number(opts.pageSize) || 100));

    let rows = this.all();
    if (relSet) rows = rows.filter((r) => relSet.has(r.rel));
    if (groups.length) rows = rows.filter((r) => groups.includes(r.group));
    if (exts.length) rows = rows.filter((r) => exts.includes(r.ext));
    const direct = !!opts.direct;
    if (dir || direct) rows = rows.filter((r) => (direct ? r.dir === dir : (r.dir === dir || r.dir.startsWith(dir + '/'))));
    if (tags.length) rows = rows.filter((r) => (r.tags || []).some((t) => tags.includes(t)));
    if (autoSel.length) {
      rows = rows.filter((r) => {
        const at = autoTags(r);
        return autoSel.every(({ k, vals }) => vals.includes(at[k] || ''));
      });
    }
    if (sizeMin != null) rows = rows.filter((r) => r.size >= sizeMin);
    if (sizeMax != null) rows = rows.filter((r) => r.size <= sizeMax);
    if (dateFrom != null) rows = rows.filter((r) => r.mtime >= dateFrom);
    if (dateTo != null) rows = rows.filter((r) => r.mtime <= dateTo);
    if (tokens.length) {
      const scored = [];
      for (const r of rows) {
        const name = r.name.toLowerCase();
        const rel = r.rel.toLowerCase();
        let score = 0;
        let ok = true;
        for (const t of tokens) {
          const inName = name.includes(t);
          const inPath = rel.includes(t);
          const inText = r.text ? lowerText(r).includes(t) : false;
          if (!inName && !inPath && !inText) { ok = false; break; }
          score += inName ? 8 : 0;
          score += inPath ? 2 : 0;
          score += inText ? 1 : 0;
        }
        if (ok) { r._score = score; scored.push(r); }
      }
      rows = scored;
      if (q && !opts.sort) rows.sort((a, b) => b._score - a._score || b.mtime - a.mtime);
    }
    if (opts.sort || !tokens.length) {
      const cmp = {
        name: (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'),
        ext: (a, b) => (a.ext || '').localeCompare(b.ext || '') || a.name.localeCompare(b.name, 'zh-Hans-CN'),
        size: (a, b) => a.size - b.size,
        mtime: (a, b) => a.mtime - b.mtime,
        dir: (a, b) => (a.dir || '').localeCompare(b.dir || '', 'zh-Hans-CN'),
      }[sort] || ((a, b) => a.mtime - b.mtime);
      rows.sort((a, b) => (desc ? -cmp(a, b) : cmp(a, b)));
    }
    const total = rows.length;
    const strip = (r) => {
      const { text, ...rest } = r;
      return { ...rest, hasText: !!(text && text.length), auto: autoTagList(r), _score: undefined };
    };
    const items = opts.all ? rows.map(strip) : rows.slice((page - 1) * pageSize, page * pageSize).map(strip);
    return { total, page, pageSize, items };
  }

  facets() {
    const groups = {};
    const exts = {};
    const auto = { 校区: {}, 学期: {}, 类型: {} };
    let totalSize = 0;
    for (const r of this.entries.values()) {
      groups[r.group] = (groups[r.group] || 0) + 1;
      exts[r.ext] = (exts[r.ext] || 0) + 1;
      totalSize += r.size;
      const at = autoTags(r);
      for (const k of ['校区', '学期', '类型']) {
        const v = at[k];
        if (v) auto[k][v] = (auto[k][v] || 0) + 1;
      }
    }
    const autoOut = {};
    for (const k of ['校区', '学期', '类型']) {
      autoOut[k] = Object.entries(auto[k])
        .map(([v, count]) => ({ v, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 40);
    }
    return {
      count: this.entries.size,
      size: totalSize,
      auto: autoOut,
      groups: Object.entries(groups).map(([k, v]) => ({ key: k, label: GROUP_LABEL[k] || k, count: v })).sort((a, b) => b.count - a.count),
      exts: Object.entries(exts).map(([k, v]) => ({ key: k, count: v })).sort((a, b) => b.count - a.count).slice(0, 30),
    };
  }

  // 文件夹视图：每个目录的递归文件数/总大小/最近修改
  /** 真实磁盘上的所有子目录（含空文件夹），返回 rel 路径数组 */
  realDirs(limit = 4000) {
    const out = [];
    const walk = (rel) => {
      if (out.length >= limit) return;
      const abs = rel ? this.abs(rel) : this.root;
      let list = [];
      try { list = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
      for (const it of list) {
        if (!it.isDirectory()) continue;
        if (it.name === '.lib' || it.name.startsWith('.')) continue;
        const childRel = rel ? rel + '/' + it.name : it.name;
        out.push(childRel);
        walk(childRel);
      }
    };
    walk('');
    return out;
  }

  folderList({ q = '', dir = '', sort = 'name', order = 'asc' } = {}) {
    const agg = new Map();
    for (const e of this.entries.values()) {
      const parts = e.dir ? e.dir.split('/') : [];
      let acc = '';
      for (const part of parts) {
        acc = acc ? acc + '/' + part : part;
        let o = agg.get(acc);
        if (!o) { o = { path: acc, count: 0, direct: 0, dirs: 0, size: 0, mtime: 0 }; agg.set(acc, o); }
        o.count += 1;
        o.size += e.size || 0;
        if ((e.mtime || 0) > o.mtime) o.mtime = e.mtime || 0;
        if (acc === e.dir) o.direct += 1;
      }
    }
    // 把磁盘上存在、但索引里没有的目录（新文件夹 / 空文件夹）也补进来
    for (const p of this.realDirs()) {
      if (!agg.has(p)) agg.set(p, { path: p, count: 0, direct: 0, dirs: 0, size: 0, mtime: 0 });
    }
    for (const p of agg.keys()) {
      const i = p.lastIndexOf('/');
      if (i > 0) { const parent = agg.get(p.slice(0, i)); if (parent) parent.dirs += 1; }
    }
    let items = [...agg.values()].map((o) => ({
      path: o.path,
      name: o.path.slice(o.path.lastIndexOf('/') + 1),
      up: o.path.includes('/') ? o.path.slice(0, o.path.lastIndexOf('/')) : '',
      count: o.count, direct: o.direct, dirs: o.dirs, size: o.size, mtime: o.mtime,
    }));
    if (dir) { const pre = dir + '/'; items = items.filter((o) => o.path === dir || o.path.startsWith(pre)); }
    if (q) { const t = q.toLowerCase(); items = items.filter((o) => o.path.toLowerCase().includes(t)); }
    const mul = order === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      if (sort === 'size') return (a.size - b.size) * mul;
      if (sort === 'mtime') return (a.mtime - b.mtime) * mul;
      if (sort === 'count') return (a.count - b.count) * mul || a.path.localeCompare(b.path, 'zh-Hans-CN');
      return a.path.localeCompare(b.path, 'zh-Hans-CN') * mul;
    });
    return { items, total: items.length };
  }

  folders() {
    const map = new Map();
    for (const r of this.entries.values()) {
      const parts = r.dir ? r.dir.split('/') : [];
      let acc = '';
      for (const p of parts) {
        acc = acc ? acc + '/' + p : p;
        if (!map.has(acc)) map.set(acc, 0);
      }
      if (r.dir) map.set(r.dir, (map.get(r.dir) || 0));
    }
    // 计数：自身 + 后代
    const counts = new Map();
    for (const r of this.entries.values()) {
      let acc = '';
      for (const p of (r.dir ? r.dir.split('/') : [])) {
        acc = acc ? acc + '/' + p : p;
        counts.set(acc, (counts.get(acc) || 0) + 1);
      }
    }
    return [...map.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN')).map((p) => ({ path: p, count: counts.get(p) || 0 }));
  }

  get(rel) {
    const e = this.entries.get(rel);
    return e || null;
  }

  /* ------------------------- 修改操作 ------------------------- */

  rename(rel, newName) {
    const clean = this.safeRel(rel);
    const bad = /[<>:"/\\|?*\x00-\x1f]/;
    if (!newName || bad.test(newName)) throw new Error('文件名不能包含 \\ / : * ? " < > |');
    const entry = this.entries.get(clean);
    if (!entry) throw new Error('找不到文件');
    const dirPart = path.posix.dirname(clean) === '.' ? '' : path.posix.dirname(clean);
    const targetRel = dirPart ? dirPart + '/' + newName : newName;
    const isDir = entry.isFolder;
    if (isDir) throw new Error('暂时只支持改文件，不支持改文件夹名');
    if (this.entries.has(targetRel)) throw new Error('同名文件已存在：' + targetRel);
    if (fs.existsSync(this.abs(targetRel))) throw new Error('磁盘上已有同名文件');
    fs.renameSync(this.abs(clean), this.abs(targetRel));
    this.entries.delete(clean);
    entry.rel = targetRel;
    entry.name = newName;
    entry.ext = newName.includes('.') ? newName.split('.').pop().toLowerCase() : '';
    entry.group = groupOf(entry.ext);
    entry.mtime = Date.now();
    this.entries.set(targetRel, entry);
    this.dirty();
    return entry;
  }

  move(rel, targetDirRel) {
    const clean = this.safeRel(rel);
    const entry = this.entries.get(clean);
    if (!entry) throw new Error('找不到文件');
    const targetDir = this.safeRel(targetDirRel || '');
    if (targetDir) fs.mkdirSync(this.abs(targetDir), { recursive: true });
    const targetRel = targetDir ? targetDir + '/' + entry.name : entry.name;
    if (targetRel === clean) return entry;
    if (this.entries.has(targetRel) || fs.existsSync(this.abs(targetRel))) throw new Error('目标位置已有同名文件');
    fs.mkdirSync(path.dirname(this.abs(targetRel)), { recursive: true });
    fs.renameSync(this.abs(clean), this.abs(targetRel));
    this.entries.delete(clean);
    entry.rel = targetRel;
    entry.dir = targetDir;
    this.entries.set(targetRel, entry);
    this.dirty();
    return entry;
  }

  trash(rel) {
    const clean = this.safeRel(rel);
    const entry = this.entries.get(clean);
    if (!entry) throw new Error('找不到文件');
    const id = Date.now().toString(36) + '-' + crypto.randomBytes(3).toString('hex');
    const dest = path.join(this.trashDir, id + '__' + entry.name);
    fs.renameSync(this.abs(clean), dest);
    this.entries.delete(clean);
    const list = this.trashList();
    list.unshift({
      id, rel: clean, name: entry.name, size: entry.size, at: Date.now(), file: path.basename(dest),
      tags: entry.tags || [], note: entry.note || '',
    });
    fs.writeFileSync(path.join(this.trashDir, 'trash.json'), JSON.stringify(list, null, 2));
    this.dirty();
    return id;
  }

  trashList() {
    try { return JSON.parse(fs.readFileSync(path.join(this.trashDir, 'trash.json'), 'utf8')); } catch (_) { return []; }
  }

  restore(id) {
    const list = this.trashList();
    const item = list.find((x) => x.id === id);
    if (!item) throw new Error('回收站里找不到');
    let targetRel = item.rel;
    let n = 2;
    while (fs.existsSync(this.abs(targetRel))) {
      targetRel = item.rel.replace(/(\.[^./]+)?$/, (m) => '(' + n++ + ')' + (m || ''));
    }
    fs.mkdirSync(path.dirname(this.abs(targetRel)), { recursive: true });
    fs.renameSync(path.join(this.trashDir, item.file), this.abs(targetRel));
    const next = list.filter((x) => x.id !== id);
    fs.writeFileSync(path.join(this.trashDir, 'trash.json'), JSON.stringify(next, null, 2));
    const entry = this.indexOne(this.abs(targetRel));
    if (entry) {
      if (item.tags && item.tags.length) entry.tags = item.tags;
      if (item.note) entry.note = item.note;
      this.entries.set(entry.rel, entry);
    }
    this.dirty();
    return { rel: targetRel, entry };
  }

  purge(id) {
    const list = this.trashList();
    const item = list.find((x) => x.id === id);
    if (!item) throw new Error('回收站里找不到');
    try { fs.unlinkSync(path.join(this.trashDir, item.file)); } catch (_) {}
    fs.writeFileSync(path.join(this.trashDir, 'trash.json'), JSON.stringify(list.filter((x) => x.id !== id), null, 2));
    return true;
  }

  setTags(rel, tagIds) {
    const e = this.safeRel(rel);
    const entry = this.entries.get(e);
    if (!entry) throw new Error('找不到文件');
    entry.tags = [...new Set((tagIds || []).filter(Boolean))];
    this.dirty();
    return entry;
  }

  setNote(rel, note) {
    const entry = this.entries.get(this.safeRel(rel));
    if (!entry) throw new Error('找不到文件');
    entry.note = String(note || '').slice(0, 5000);
    this.dirty();
    return entry;
  }

  addTag(name, color) {
    const n = String(name || '').trim();
    if (!n) throw new Error('标签名不能为空');
    if (this.tags.some((t) => t.name === n)) throw new Error('标签已存在');
    const tag = { id: 't' + Date.now().toString(36), name: n, color: color || pickColor() };
    this.tags.push(tag);
    this.dirty();
    return tag;
  }

  removeTag(id) {
    this.tags = this.tags.filter((t) => t.id !== id);
    for (const e of this.entries.values()) e.tags = (e.tags || []).filter((t) => t !== id);
    this.dirty();
    return true;
  }

  /* ------------------------- 收藏 / 最近 / 视图 ------------------------- */

  savePrefs() {
    try { fs.writeFileSync(this.prefsPath, JSON.stringify(this.prefs, null, 2)); } catch (e) { console.error('[store] 保存偏好失败:', e.message); }
  }

  getPrefs() { return this.prefs; }

  getPlans() { return this.prefs.plans || []; }

  savePlan(plan) {
    const list = this.prefs.plans || [];
    const id = plan.id || ('p' + Date.now().toString(36));
    const item = {
      id,
      name: String(plan.name || '未命名方案').slice(0, 40),
      tplPath: String(plan.tplPath || ''),
      tplRel: String(plan.tplRel || ''),
      course: String(plan.course || ''),
      org: String(plan.org || ''),
      weekdays: Array.isArray(plan.weekdays) ? plan.weekdays : [],
      students: Array.isArray(plan.students) ? plan.students.slice(0, 200) : [],
      blocks: Array.isArray(plan.blocks) ? plan.blocks.slice(0, 20).map((b) => ({
        weekdays: Array.isArray(b && b.weekdays) ? b.weekdays : [],
        interval: Math.min(8, Math.max(1, Number((b && b.interval) || 1))),
        startDate: String((b && b.startDate) || ''),
        endDate: String((b && b.endDate) || ''),
        students: Array.isArray(b && b.students) ? b.students.slice(0, 200) : [],
      })) : [],
      at: Date.now(),
    };
    const i = list.findIndex((x) => x.id === id);
    if (i >= 0) list[i] = item; else list.unshift(item);
    this.prefs.plans = list.slice(0, 30);
    this.savePrefs();
    return item;
  }

  delPlan(id) {
    this.prefs.plans = (this.prefs.plans || []).filter((p) => p.id !== id);
    this.savePrefs();
    return this.prefs.plans;
  }

  addRecent(rel) {
    const clean = this.safeRel(rel);
    const list = (this.prefs.recents || []).filter((x) => x !== clean);
    list.unshift(clean);
    this.prefs.recents = list.slice(0, 25);
    this.savePrefs();
    return this.prefs.recents;
  }

  toggleFav(rel) {
    const clean = this.safeRel(rel);
    const list = this.prefs.favs || [];
    const i = list.indexOf(clean);
    if (i >= 0) list.splice(i, 1); else list.unshift(clean);
    this.prefs.favs = list;
    this.savePrefs();
    return { rel: clean, fav: i < 0, favs: this.prefs.favs };
  }

  saveView(name, query) {
    const n = String(name || '').trim();
    if (!n) throw new Error('视图名不能为空');
    const q = String(query || '');
    const list = this.prefs.views || [];
    const exist = list.find((v) => v.name === n);
    if (exist) { exist.query = q; exist.at = Date.now(); }
    else list.push({ id: 'v' + Date.now().toString(36), name: n, query: q, at: Date.now() });
    this.prefs.views = list.slice(0, 40);
    this.savePrefs();
    return this.prefs.views;
  }

  delView(id) {
    this.prefs.views = (this.prefs.views || []).filter((v) => v.id !== id);
    this.savePrefs();
    return this.prefs.views;
  }

  fileBuffer(rel) {
    const clean = this.safeRel(rel);
    return fs.readFileSync(this.abs(clean));
  }

  writeFile(rel, buf) {
    const clean = this.safeRel(rel);
    const entry = this.entries.get(clean);
    if (!entry) throw new Error('找不到文件');
    const tmp = this.abs(clean) + '.tmp';
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, this.abs(clean));
    this.indexOne(this.abs(clean));
    this.dirty();
    return this.entries.get(clean);
  }
}

function pickColor() {
  const palette = ['#2f7cf6', '#e05c4b', '#22a06b', '#b26be0', '#e09a1a', '#2aa8b8', '#d94f8a', '#6b7ae0'];
  return palette[Math.floor(Math.random() * palette.length)];
}

module.exports = { Store, groupOf, GROUP_LABEL, JUNK, isTempName };
