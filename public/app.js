

'use strict';
/* 教学文件管理 前端 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));
const S = {
  q: '', groups: new Set(), tags: new Set(), dir: '',
  auto: { 校区: new Set(), 学期: new Set(), 类型: new Set() },
  onlyRels: [],
  sizeMin: '', sizeMax: '', dateFrom: '', dateTo: '',
  sort: 'mtime', order: 'desc', page: 1, pageSize: 100,
  items: [], total: 0, sel: new Set(), active: null,
  tagsAll: [], folders: [], facets: null, status: {},
  prefs: { views: [], favs: [], recents: [] },
  showFolders: true, fitems: [], folderTotal: 0,
  tagTarget: [], tagMode: 'add',
};
function autoQuery() {
  const parts = [];
  for (const k of ['校区', '学期', '类型']) {
    const vals = [...S.auto[k]];
    if (vals.length) parts.push(k + '=' + vals.join('|'));
  }
  return parts.join(',');
}
function hasAuto() { return autoQuery().length > 0; }

const GROUP_ORDER = ['doc', 'sheet', 'slide', 'image', 'archive', 'code', 'media', 'other'];

/* ---------------- 基础工具 ---------------- */
async function api(path, opts = {}) {
  const r = await fetch(path, opts);
  let j;
  try { j = await r.json(); } catch (_) { throw new Error('服务返回异常 (' + r.status + ')'); }
  if (!r.ok || j.ok === false) throw new Error(j.error || '请求失败');
  return j;
}
const post = (p, body) => api(p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

let toastTimer = null;

/* ---------------- 线性小图标（替代 emoji） ---------------- */
const LIC = (body) => '<svg class="lic" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' + body + '</svg>';
const PICON = {
  folder: LIC('<path d="M1.9 4.4h4.2l1.5 1.7h6.5a1 1 0 0 1 1 1v5.4a1 1 0 0 1-1 1H2.9a1 1 0 0 1-1-1V5.4a1 1 0 0 1 1-1z"/>'),
  drive: LIC('<rect x="1.9" y="4.1" width="12.2" height="7.8" rx="1.7"/><path d="M1.9 8.6h12.2"/><circle cx="4.4" cy="10.4" r=".72" fill="currentColor" stroke="none"/><circle cx="11.6" cy="10.4" r=".72" fill="currentColor" stroke="none"/>'),
  desktop: LIC('<rect x="2" y="3.1" width="12" height="8" rx="1.3"/><path d="M6 13.3h4M8 11.1v2.2"/>'),
  download: LIC('<path d="M8 2.9v6.6"/><path d="M5.3 7.1L8 9.8l2.7-2.7"/><path d="M3 12.6h10"/>'),
  doc: LIC('<path d="M4.1 2.4h4.7l3.1 3.1v8.1H4.1z"/><path d="M8.8 2.4v3.1h3.1M6 8.6h4M6 11h4"/>'),
  image: LIC('<rect x="2.2" y="3.2" width="11.6" height="9.6" rx="1.4"/><circle cx="5.9" cy="6.5" r="1.05"/><path d="M2.8 11.3l3.5-3.1 2.2 1.9 1.9-1.6 2.9 2.6"/>'),
  music: LIC('<circle cx="5.9" cy="11.5" r="1.7"/><path d="M7.6 11.5V4.9l5-1.2v6.5"/><circle cx="11" cy="10.2" r="1.7"/>'),
  up: LIC('<path d="M8 12.8V3.6"/><path d="M4.4 7.2L8 3.6l3.6 3.6"/>'),
  clean: LIC('<path d="M3 5.2h10M6.4 5.2V3.6h3.2v1.6M4.6 5.2l.7 7.4h5.4l.7-7.4"/>'),
  grid: LIC('<rect x="2.2" y="2.6" width="4.6" height="4.6" rx="1"/><rect x="9.2" y="2.6" width="4.6" height="4.6" rx="1"/><rect x="2.2" y="8.8" width="4.6" height="4.6" rx="1"/><rect x="9.2" y="8.8" width="4.6" height="4.6" rx="1"/>'),
  sheet: LIC('<rect x="2.4" y="2.6" width="11.2" height="10.8" rx="1.3"/><path d="M2.4 6.1h11.2M6.4 6.1v7.3"/>'),
};
const placeIcon = (name) => {
  const n = String(name || '');
  if (/桌面|Desktop/i.test(n)) return PICON.desktop;
  if (/下载|Download/i.test(n)) return PICON.download;
  if (/文档|Document/i.test(n)) return PICON.doc;
  if (/图片|Picture|Image/i.test(n)) return PICON.image;
  if (/音乐|Music/i.test(n)) return PICON.music;
  return PICON.folder;
};

function toast(msg, isErr) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.className = 'toast'), isErr ? 4200 : 2200);
}
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function fmtSize(n) {
  if (n < 1024) return n + ' B';
  if (n < 1048576) return (n / 1024).toFixed(0) + ' KB';
  if (n < 1073741824) return (n / 1048576).toFixed(1) + ' MB';
  return (n / 1073741824).toFixed(2) + ' GB';
}
function fmtTime(ms) {
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function highlight(text, q) {
  const safe = esc(text);
  if (!q) return safe;
  const words = q.split(/\s+/).filter(Boolean).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return safe;
  return safe.replace(new RegExp('(' + words.join('|') + ')', 'gi'), '<mark>$1</mark>');
}
function tagById(id) { return S.tagsAll.find((t) => t.id === id); }

function openModal(id) { $(id).classList.add('show'); }
function closeModal(id) { $(id).classList.remove('show'); }
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('.mask').classList.remove('show')));
document.querySelectorAll('.mask').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m) m.classList.remove('show'); }));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') document.querySelectorAll('.mask.show').forEach((m) => m.classList.remove('show'));
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#q').focus(); $('#q').select(); }
  if (e.key === 'F2' && S.active) { e.preventDefault(); askRename(); }
});

/* ---------------- 面包屑导航 ---------------- */
function renderCrumbs() {
  const box = $('#crumbs');
  if (!box) return;
  const segs = S.dir ? S.dir.split('/') : [];
  const p = [];
  p.push(`<button class="cbtn" id="crumbBack" title="返回上一级（Alt+← / Backspace）"${S.dir ? '' : ' disabled'}>← 返回</button>`);
  p.push(`<span class="crm ${segs.length ? '' : 'cur'}" data-go="">${PICON.folder}全部文件</span>`);
  let acc = '';
  segs.forEach((s) => {
    acc = acc ? acc + '/' + s : s;
    p.push('<span class="csep">›</span>');
    p.push(`<span class="crm" data-go="${esc(acc)}">${esc(s)}</span>`);
  });
  const nf = S.fitems ? S.fitems.length : 0;
  if (nf) p.push(`<span class="cnote">${nf} 个文件夹</span>`);
  box.innerHTML = p.join('');
  box.style.display = 'flex';
  box.querySelectorAll('[data-go]').forEach((el) => {
    el.onclick = () => { S.dir = el.dataset.go; S.page = 1; S.active = ''; loadFacets(); loadList(); };
  });
  const back = $('#crumbBack');
  if (back) back.onclick = goUp;
}
function goUp() {
  if (!S.dir) return;
  const i = S.dir.lastIndexOf('/');
  S.dir = i > 0 ? S.dir.slice(0, i) : '';
  S.page = 1;
  S.active = '';
  loadFacets();
  loadList();
}
document.addEventListener('keydown', (ev) => {
  if (ev.altKey && ev.key === 'ArrowLeft') { ev.preventDefault(); goUp(); }
  else if (ev.key === 'Backspace' && !/^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || '')) { ev.preventDefault(); goUp(); }
});
/* ---------------- 文件夹行辅助（与文件混排） ---------------- */
function sortFolders(list) {
  const key = S.sort;
  const dir = S.order === 'asc' ? 1 : -1;
  const cmp = (a, b) => {
    if (key === 'size') return (a.size - b.size) * dir;
    if (key === 'mtime') return (a.mtime - b.mtime) * dir;
    if (key === 'count' || key === 'ext') return (a.count - b.count) * dir;
    return a.name.localeCompare(b.name, 'zh') * dir;
  };
  return list.slice().sort(cmp);
}
function directFolders(list) {
  return (list || []).filter((d) => {
    const i = d.path.lastIndexOf('/');
    const parent = i < 0 ? '' : d.path.slice(0, i);
    return parent === S.dir;
  });
}
/* ---------------- 文件夹行 ---------------- */
function showFolderDetail(path) {
  const d = S.fitems.find((x) => x.path === path);
  if (!d) return;
  const pane = $('#detail');
  pane.innerHTML = `
    <h3>${PICON.folder}<span>${esc(d.name)}</span></h3>
    <div class="path">${esc(d.path)}</div>
    <div class="actions">
      <button class="btn primary sm" data-fact="enter">进入这个文件夹</button>
      <button class="btn sm" data-fact="reveal">在资源管理器中显示</button>
    </div>
    <div class="kv">
      <span class="k">文件数</span><span>${d.count} 个（本层 ${d.direct || 0} 个）</span>
      <span class="k">子文件夹</span><span>${d.dirs || 0} 个</span>
      <span class="k">总大小</span><span>${fmtSize(d.size)}</span>
      <span class="k">最近修改</span><span>${fmtTime(d.mtime)}</span>
      <span class="k">上层</span><span>${esc(d.up) || '库根目录'}</span>
    </div>
    <div class="pv-note">双击列表里的文件夹，或点上面「进入这个文件夹」，就能看到里面的文件。</div>`;
  pane.querySelectorAll('[data-fact]').forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.fact === 'enter') return enterFolder(d.path);
      const r = await post('/api/folders/reveal', { path: d.path }).catch((e) => { toast(e.message, true); return null; });
      if (r) toast('已在资源管理器中打开');
    };
  });
}
function enterFolder(path) {
  S.dir = path || '';
  S.page = 1;
  loadFacets();
  loadList();
}

/* ---------------- 左侧：类型 / 标签 / 文件夹 ---------------- */
function renderFacets(f) {
  S.facets = f;
  const groups = (f.facets.groups || []).sort((a, b) => GROUP_ORDER.indexOf(a.key) - GROUP_ORDER.indexOf(b.key));
  const allActive = S.groups.size === 0;
  const hint = allActive ? '<div class="facet-hint">全部文件＝本层；勾类型＝只看这类</div>' : '';
  $('#facetGroups').innerHTML =
    `<div class="side-item root ${allActive ? 'active' : ''}" data-group="__all" title="不看类型，显示当前目录的内容">
      <span class="ck ${allActive ? 'on' : ''}"></span>${PICON.folder}全部文件<span class="cnt">${f.facets.count}</span></div>` +
    hint +
    groups.map((g) => {
      const on = S.groups.has(g.key);
      return `<div class="side-item ${on ? 'active' : ''}" data-group="${g.key}">
      <span class="ck ${on ? 'on' : ''}"></span><span class="sq" style="background:${groupColor(g.key)}"></span>${g.label}<span class="cnt">${g.count}</span></div>`;
    }).join('');

  $('#facetGroups').querySelectorAll('.side-item').forEach((el) => {
    el.onclick = (ev) => {
      const key = el.dataset.group;
      if (key === '__all') {
        S.groups.clear();
      } else if (ev.ctrlKey || ev.metaKey || ev.shiftKey) {
        if (S.groups.has(key)) S.groups.delete(key); else S.groups.add(key);
      } else {
        const only = S.groups.size === 1 && S.groups.has(key);
        S.groups.clear();
        if (!only) S.groups.add(key);
      }
      S.page = 1;
      loadFacets();
      loadList();
    };
  });

  renderTags();
  renderAutoTags(f.facets.auto || {});
  renderTree(f.folders || []);
  if (f.prefs) { S.prefs = f.prefs; }
  renderPrefs();
}
/* 智能标签：校区 / 学期 / 类型 */
const AUTO_KEYS = [['校区', 4], ['学期', 4], ['类型', 5]];
function renderAutoTags(auto) {
  const box = $('#autoTags');
  if (!box) return;
  let html = '';
  for (const [k, limit] of AUTO_KEYS) {
    const list = (auto[k] || []).slice(0, limit);
    if (!list.length) continue;
    html += `<div class="autoGroup"><div class="autoTitle">${k}</div><div class="autoChips">` +
      list.map((it) => `<span class="achip ${S.auto[k].has(it.v) ? 'on' : ''}" data-k="${esc(k)}" data-v="${esc(it.v)}">${esc(it.v)}<span class="acnt">${it.count}</span></span>`).join('') +
      '</div></div>';
  }
  box.innerHTML = html || '<div class="side-item muted" style="cursor:default">（还没有可自动识别的标签）</div>';
  box.querySelectorAll('.achip').forEach((el) => {
    el.onclick = () => {
      const k = el.dataset.k;
      const v = el.dataset.v;
      if (S.auto[k].has(v)) S.auto[k].delete(v); else S.auto[k].add(v);
      S.onlyRels = [];
      S.page = 1; renderAutoTags(auto); loadList();
    };
  });
}

/* 我的视图 / 收藏 / 最近 */
function renderPrefs() {
  const views = S.prefs.views || [];
  $('#viewList').innerHTML = views.length
    ? views.map((v) => `<div class="side-item" data-view="${v.id}">
        <span style="color:var(--brand)">★</span>${esc(v.name)}<span class="cnt" title="删除视图">✕</span></div>`).join('')
    : '<div class="side-hint">点下面「保存当前筛选」就能存成快捷方式</div>';
  $('#viewList').querySelectorAll('[data-view]').forEach((el) => {
    el.onclick = (ev) => {
      const v = views.find((x) => x.id === el.dataset.view);
      if (!v) return;
      if (ev.target.classList.contains('cnt')) {
        post('/api/views/delete', { id: v.id }).then((r) => { S.prefs.views = r.views; renderPrefs(); });
        return;
      }
      applyView(v);
    };
  });

  const favs = S.prefs.favs || [];
  $('#favList').innerHTML = favs.length
    ? favs.slice(0, 12).map((rel) => `<div class="side-item mini" data-rel="${esc(rel)}" title="${esc(rel)}">☆ ${esc(rel.split('/').pop())}</div>`).join('')
    : '<div class="side-hint">在文件详情里点「☆ 收藏」就会出现在这里</div>';
  bindRelClicks('#favList');

  const recents = S.prefs.recents || [];
  $('#recentList').innerHTML = recents.length
    ? recents.slice(0, 10).map((rel) => `<div class="side-item mini" data-rel="${esc(rel)}" title="${esc(rel)}">🕘 ${esc(rel.split('/').pop())}</div>`).join('')
    : '';
  bindRelClicks('#recentList');
}

function bindRelClicks(sel) {
  $(sel).querySelectorAll('[data-rel]').forEach((el) => {
    el.onclick = async () => {
      const rel = el.dataset.rel;
      S.active = rel;
      renderList();
      loadDetail(rel);
    };
  });
}

function applyView(v) {
  const sp = new URLSearchParams(v.query || '');
  S.q = sp.get('q') || '';
  $('#q').value = S.q;
  $('#qClear').style.display = S.q ? 'block' : 'none';
  S.groups = new Set((sp.get('groups') || '').split(',').filter(Boolean));
  S.tags = new Set((sp.get('tags') || '').split(',').filter(Boolean));
  S.auto = { 校区: new Set(), 学期: new Set(), 类型: new Set() };
  for (const part of (sp.get('auto') || '').split(',')) {
    if (!part) continue;
    const i = part.indexOf('=');
    const k = part.slice(0, i);
    if (!S.auto[k]) continue;
    part.slice(i + 1).split('|').filter(Boolean).forEach((x) => S.auto[k].add(x));
  }
  S.dir = sp.get('dir') || '';
  const smin = sp.get('sizeMin') || '';
  const smax = sp.get('sizeMax') || '';
  S.sizeMin = smin ? String(Number(smin) / 1048576) : '';
  S.sizeMax = smax ? String(Number(smax) / 1048576) : '';
  $('#sizeMin').value = S.sizeMin;
  $('#sizeMax').value = S.sizeMax;
  S.dateFrom = sp.get('dateFrom') || '';
  S.dateTo = sp.get('dateTo') || '';
  $('#dateFrom').value = S.dateFrom;
  $('#dateTo').value = S.dateTo;
  S.onlyRels = [];
  S.page = 1;
  loadFacets(); loadList();
  toast('已套用视图：' + v.name);
}

function groupColor(k) {
  return { doc: '#4f86ff', sheet: '#22a06b', slide: '#e07a4f', image: '#9aa3b2', archive: '#e0a92b', code: '#7c5cff', media: '#2aa8b8', other: '#c3c8d2' }[k] || '#c3c8d2';
}

function renderTags() {
  $('#tagList').innerHTML = S.tagsAll.length
    ? S.tagsAll.map((t) => `<div class="side-item ${S.tags.has(t.id) ? 'active' : ''}" data-tag="${t.id}">
        <span class="tagdot" style="background:${t.color}"></span>${esc(t.name)}
        <span class="cnt" title="删除标签">✕</span></div>`).join('')
    : '<div class="side-item muted" style="cursor:default">还没有标签</div>';

  $('#tagList').querySelectorAll('[data-tag]').forEach((el) => {
    el.onclick = (ev) => {
      const id = el.dataset.tag;
      if (ev.target.classList.contains('cnt')) {
        if (!confirm('删除标签「' + (tagById(id) || {}).name + '」？文件不会被删。')) return;
        post('/api/tags/delete', { id }).then(() => { S.tags.delete(id); loadFacets(); loadList(); });
        return;
      }
      if (S.tags.has(id)) S.tags.delete(id); else S.tags.add(id);
      S.page = 1; loadFacets(); loadList();
    };
  });
}

/* 目录树已移除；这里只把文件夹清单存进 S.folders，供「移动」弹窗选目标目录 */
function renderTree(folders) { S.folders = folders; }

/* ---------------- 列表 ---------------- */
function params() {
  return new URLSearchParams({
    q: S.q,
    groups: [...S.groups].join(','),
    tags: [...S.tags].join(','),
    auto: autoQuery(),
    rels: S.onlyRels.join(','),
    dir: S.dir,
    sizeMin: S.sizeMin ? Math.round(Number(S.sizeMin) * 1048576) : '',
    sizeMax: S.sizeMax ? Math.round(Number(S.sizeMax) * 1048576) : '',
    dateFrom: S.dateFrom, dateTo: S.dateTo,
    direct: (!S.groups.size && !S.q.trim() && !hasAuto()) ? 1 : '',
    sort: S.sort, order: S.order, page: S.page, pageSize: S.pageSize,
  });
}

/** 导出/视图用：干净的对象（值不编码） */
function queryObject() {
  return {
    q: S.q,
    groups: [...S.groups].join(','),
    tags: [...S.tags].join(','),
    auto: autoQuery(),
    rels: S.onlyRels.join(','),
    dir: S.dir,
    sizeMin: S.sizeMin ? Math.round(Number(S.sizeMin) * 1048576) : '',
    sizeMax: S.sizeMax ? Math.round(Number(S.sizeMax) * 1048576) : '',
    dateFrom: S.dateFrom,
    dateTo: S.dateTo,
  };
}

async function loadFacets() {
  try {
    const r = await api('/api/facets');
    S.tagsAll = r.tags || [];
    renderFacets(r);
  } catch (e) { toast(e.message, true); }
}

let listSeq = 0;
async function loadList() {
  const seq = ++listSeq;
  const q = S.q.trim();
  const types = [...S.groups];
  const wantFolders = S.showFolders && !q && !types.length && !hasAuto();
  const wantFiles = true;
  const fp = new URLSearchParams({ dir: S.dir, sort: 'name', order: 'asc' });
  const p = params();
  if (q && !types.length) p.set('groups', '');   // 搜索时没勾类型＝全部类型
  const jobs = [
    wantFolders ? api('/api/folders?' + fp.toString()) : Promise.resolve(null),
    wantFiles ? api('/api/files?' + p.toString()) : Promise.resolve(null),
  ];
  const [fr, ff] = await Promise.all(jobs).catch((e) => { toast(e.message, true); return [null, null]; });
  if (seq !== listSeq) return;
  S.fitems = fr ? sortFolders(directFolders(fr.items)) : [];
  S.items = ff ? ff.items : [];
  S.total = ff ? ff.total : 0;
  renderList();
}
/* 表头点击排序：文件名/所在文件夹/大小/修改时间，可来回切升降序 */
function bindHeaderSort() {
  const map = { 1: 'name', 2: 'dir', 3: 'size', 4: 'mtime' };
  $$('#fileHead th').forEach((th, i) => {
    const key = map[i];
    if (!key) return;
    th.style.cursor = 'pointer';
    th.onclick = () => {
      if (S.sort === key) S.order = S.order === 'asc' ? 'desc' : 'asc';
      else { S.sort = key; S.order = key === 'name' ? 'asc' : 'desc'; }
      S.page = 1;
      $('#sort').value = S.sort;
      $('#order').value = S.order;
      markSortHead();
      loadList();
    };
  });
}
function markSortHead() {
  const map = { name: 1, dir: 2, size: 3, mtime: 4 };
  $$('#fileHead th').slice(1).forEach((th) => {   // 跳过第 0 列（全选复选框），写 textContent 会把它删掉
    if (!th.querySelector('input')) th.textContent = th.textContent.replace(/[↑↓]\s*$/, '').trim();
    th.classList.remove('sorted');
  });
  const th = $$('#fileHead th')[map[S.sort]];
  if (th) {
    th.textContent = th.textContent + (S.order === 'asc' ? ' ↑' : ' ↓');
    th.classList.add('sorted');
  }
}
function renderList() {
  const tb = $('#rows');
  const q = S.q.trim();
  const folderRows = S.fitems.map((d) => `<tr class="frow" data-path="${esc(d.path)}" title="双击进入这个文件夹">
      <td></td>
      <td class="c-name"><div class="nm"><span class="fbadge">${PICON.folder}</span>
        <span class="fname">${esc(d.name)}</span></div></td>
      <td class="muted"></td>
      <td class="muted" title="${d.count} 个文件">${d.count} 个文件</td>
      <td class="muted">${fmtTime(d.mtime)}</td>
      <td class="muted">${d.dirs ? d.dirs + ' 个子文件夹' : ''}</td>
    </tr>`).join('');
  const fileRows = S.items.map((f, i) => {
    const tags = (f.tags || []).map((id) => { const t = tagById(id); return t ? `<span class="mini-tag" style="background:${t.color}">${esc(t.name)}</span>` : ''; }).join('');
    const autos = (f.auto || []).map((a) => `<span class="auto-tag" title="智能标签·${esc(a.k)}">${esc(a.v)}</span>`).join('');
    return `<tr data-rel="${esc(f.rel)}" data-i="${i}" class="${S.active === f.rel ? 'active' : ''}">
      <td><input type="checkbox" class="rowck" ${S.sel.has(f.rel) ? 'checked' : ''}></td>
      <td class="c-name"><div class="nm"><span class="ext-badge ${f.group}">${esc(f.ext || '?')}</span>
        <span class="fname" title="${esc(f.rel)}">${highlight(f.name, q)}</span></div></td>
      <td class="muted" title="${esc(f.dir || '根目录')}">${esc(f.dir || '库根目录')}</td>
      <td class="muted">${fmtSize(f.size)}</td>
      <td class="muted">${fmtTime(f.mtime)}</td>
      <td>${tags}${autos}</td>
    </tr>`;
  }).join('');
  tb.innerHTML = folderRows + fileRows;

  $$('#rows tr.frow').forEach((tr) => {
    tr.onclick = () => {
      $$('#rows tr').forEach((x) => x.classList.remove('active'));
      tr.classList.add('active');
      showFolderDetail(tr.dataset.path);
    };
    tr.ondblclick = () => { S.dir = tr.dataset.path; S.page = 1; S.active = ''; loadFacets(); loadList(); };
  });

  $$('#rows tr[data-rel]').forEach((tr) => {
    const rel = tr.dataset.rel;
    tr.onclick = (ev) => {
      if (ev.target.classList.contains('rowck')) return;
      S.active = rel; renderList(); loadDetail(rel);
    };
    tr.ondblclick = (ev) => { if (!ev.target.classList.contains('rowck')) openFile(rel); };
    const ck = tr.querySelector('.rowck');
    ck.onchange = () => {
      if (ck.checked) S.sel.add(rel); else S.sel.delete(rel);
      tr.classList.toggle('sel', ck.checked);
      renderBatch();
    };
  });

  const pages = Math.max(1, Math.ceil(S.total / S.pageSize));
  const filtered = S.groups.size || S.tags.size || S.sizeMin || S.sizeMax || S.dateFrom || S.dateTo || hasAuto() || S.onlyRels.length;
  const nf = S.fitems.length;
  const parts = [];
  if (nf) parts.push(`共 ${nf} 个文件夹`);
  parts.push(`${S.total} 个文件`);
  $('#summary').textContent = (parts.length ? parts.join(' · ') : '空文件夹')
    + (q ? ` · 命中「${q}」` : '') + (S.onlyRels.length ? ' · 仅看所选系列' : '') + (filtered && !q ? ' · 已筛选' : '');
  $('#pageInfo').textContent = S.groups.size || q ? `第 ${S.page} / ${pages} 页` : '';
  $('#prevPage').disabled = S.page <= 1;
  $('#nextPage').disabled = S.page >= pages;
  const ca2 = $('#checkAll');
  if (ca2) ca2.checked = S.items.length > 0 && S.items.every((f) => S.sel.has(f.rel));

  const empty = $('#empty');
  const nothing = !S.fitems.length && !S.items.length;
  if (nothing) {
    empty.style.display = 'block';
    empty.innerHTML = S.status.count === 0
      ? '<b>库还是空的</b><br>点右上角「＋ 导入文件」，或直接把文件夹拖进窗口。'
        + (S.status.source ? '<br><span class="muted">上次用的来源：' + esc(S.status.source) + '</span>' : '')
      : (S.groups.size || q
        ? '这里没有匹配的内容，试试清空筛选条件或换个关键词。'
        : '这个目录是空的。<br><span class="muted">左侧「类型」里点一个，就能按类型看全库的文件。</span>');
  } else empty.style.display = 'none';
  renderBatch();
  renderCrumbs();
}
function renderBatch() {
  const n = S.sel.size;
  $('#batchbar').classList.toggle('show', n > 0);
  $('#batchInfo').textContent = `已选 ${n} 项`;
}

/* ---------------- 详情面板 ---------------- */
async function loadDetail(rel) {
  const pane = $('#detail');
  pane.innerHTML = '<div class="pv-note">读取中…</div>';
  const r = await api('/api/file?rel=' + encodeURIComponent(rel)).catch((e) => { pane.innerHTML = `<div class="pv-note">${esc(e.message)}</div>`; return null; });
  if (!r) return;
  const f = r.file;
  const tags = (f.tags || []).map((id) => { const t = tagById(id); return t ? `<span class="tagchip on" data-rm="${t.id}" title="点一下移除这个标签" style="background:${t.color};cursor:pointer">${esc(t.name)} ✕</span>` : ''; }).join('');
  const isImg = f.group === 'image';
  const canEditText = ['txt', 'md', 'csv', 'json', 'js', 'py', 'html', 'css', 'xml', 'log', 'ini', 'bat', 'ps1', 'sql'].includes(f.ext);

  let previewHtml = '';
  const pvUrl = '/api/preview?rel=' + encodeURIComponent(f.rel);
  if (isImg) previewHtml = `<div class="preview"><img src="${pvUrl}" alt=""></div>`;
  else if (f.ext === 'pdf') previewHtml = `<div class="preview pdf"><iframe src="${pvUrl}#toolbar=1&view=FitH" title="PDF"></iframe></div>`;
  else if (f.group === 'media' && /mp4|webm|mov/.test(f.ext)) previewHtml = `<div class="preview"><video src="${pvUrl}" controls style="width:100%"></video></div>`;
  else if (f.group === 'media' && /mp3|wav|m4a|ogg|flac|aac/.test(f.ext)) previewHtml = `<div class="preview"><audio src="${pvUrl}" controls style="width:100%"></audio></div>`;
  else if (f.text) previewHtml = `<div class="preview"><pre>${highlight(f.text.slice(0, 4000), S.q)}</pre></div>`;
  else previewHtml = `<div class="pv-note">${esc(f.textNote || '没有可抽取的正文')}<br>用「打开」按钮看原件</div>`;

  const editBtns = [];
  if (f.ext === 'docx') editBtns.push('<button class="btn sm" data-act="editDocx">编辑正文</button>');
  if (['xlsx', 'xlsm'].includes(f.ext)) editBtns.push('<button class="btn sm" data-act="editXlsx">编辑表格</button>');
  if (canEditText) editBtns.push('<button class="btn sm" data-act="editText">编辑文本</button>');
  if (f.ext === 'pptx') editBtns.push('<button class="btn sm" data-act="pptxList">翻页看文字</button>');

  const isFav = (S.prefs.favs || []).includes(f.rel);
  pane.innerHTML = `
    <h3>${esc(f.name)}</h3>
    <div class="path">${esc(f.rel)}</div>
    <div class="actions">
      <button class="btn primary sm" data-act="open">打开</button>
      <button class="btn sm" data-act="reveal">在文件夹中显示</button>
      <button class="btn sm ${isFav ? 'primary' : ''}" data-act="fav">${isFav ? '★ 已收藏' : '☆ 收藏'}</button>
    </div>
    <div class="actions sub">
      <button class="btn sm" data-act="rename">改名</button>
      <button class="btn sm" data-act="move">移动</button>
      <button class="btn sm danger" data-act="del">删除</button>
      ${editBtns.join('')}
      <button class="btn sm" data-act="toPdf">转 PDF</button>
      <button class="btn sm" data-act="toPng">转图片</button>
    </div>
    <div class="kv">
      <span class="k">类型</span><span>${esc(f.ext || '?')} · ${fmtSize(f.size)}</span>
      <span class="k">修改时间</span><span>${fmtTime(f.mtime)}</span>
      <span class="k">所在位置</span><span>${esc(f.dir || '库根目录')}</span>
      <span class="k">智能标签</span><span>${(f.auto || []).map((a) => `<span class="auto-tag">${esc(a.v)}</span>`).join('') || '—'}</span>
      <span class="k">正文索引</span><span>${f.text ? '已索引 ' + f.text.length + ' 字' : (esc(f.textNote) || '无')}</span>
    </div>
    <div class="fieldLabel">标签</div>
    <div class="tagpick" id="detailTags">${tags || '<span class="muted" style="font-size:12px">未打标签</span>'}
      <button class="tagchip" data-act="tag">＋</button></div>
    <div class="fieldLabel">备注</div>
    <textarea class="notes" id="detailNote" placeholder="给这个文件写点说明，方便以后找回"></textarea>
    <div style="display:flex;justify-content:flex-end;margin-top:6px"><button class="btn sm" id="saveNote">保存备注</button></div>
    <div class="fieldLabel">预览</div>
    <div id="pvBox">${previewHtml}</div>
  `;
  $('#detailNote').value = f.note || '';
  $('#saveNote').onclick = async () => {
    await post('/api/note', { rel: f.rel, note: $('#detailNote').value });
    toast('备注已保存'); loadList();
  };
  const tagBox = pane.querySelector('#detailTags');
  if (tagBox) tagBox.onclick = async (ev) => {
    const el = ev.target.closest('[data-rm]');
    if (!el) return;
    ev.stopPropagation();
    try {
      await post('/api/tags/assign', { rels: [f.rel], tags: [el.dataset.rm], mode: 'remove' });
      toast('已移除标签');
      loadDetail(f.rel); loadFacets(); loadList();
    } catch (e) { toast(e.message, true); }
  };
  pane.querySelectorAll('[data-act]').forEach((b) => {
    const act = b.dataset.act;
    b.onclick = () => {
      if (act === 'open') openFile(f.rel);
      else if (act === 'reveal') post('/api/reveal', { rel: f.rel });
      else if (act === 'rename') askRename(f.rel);
      else if (act === 'move') askMove([f.rel]);
      else if (act === 'del') askDelete([f.rel]);
      else if (act === 'tag') askTag([f.rel]);
      else if (act === 'editDocx') editDocx(f.rel);
      else if (act === 'editXlsx') editXlsx(f.rel);
      else if (act === 'editText') editText(f.rel);
      else if (act === 'pptxList') showPptx(f.rel);
      else if (act === 'toPdf') { S.sel.clear(); S.active = f.rel; openConvert('pdf'); }
      else if (act === 'toPng') { S.sel.clear(); S.active = f.rel; openConvert('png'); }
      else if (act === 'fav') {
        post('/api/favs', { rel: f.rel }).then((r) => {
          S.prefs.favs = r.favs || [];
          renderPrefs();
          loadDetail(f.rel);
          toast(r.fav ? '已收藏' : '已取消收藏');
        }).catch((e) => toast(e.message, true));
      }
    };
  });
}

/* ---------------- 操作 ---------------- */
function openFile(rel) { post('/api/open', { rel }).catch((e) => toast(e.message, true)); }

function askRename(rel) {
  rel = rel || S.active;
  if (!rel) return;
  const cur = rel.split('/').pop();
  $('#renameInput').value = cur;
  $('#renameOk').onclick = async () => {
    try {
      const name = $('#renameInput').value.trim();
      const r = await post('/api/rename', { rel, name });
      closeModal('#maskRename');
      S.active = r.file.rel;
      toast('已改名'); loadFacets(); loadList();
    } catch (e) { toast(e.message, true); }
  };
  openModal('#maskRename');
  setTimeout(() => { const i = $('#renameInput'); i.focus(); i.select(); }, 50);
}

let moveRels = [];
function askMove(rels) {
  moveRels = rels;
  $('#moveDir').value = '';
  $('#moveFolders').innerHTML = S.folders
    .map((f) => `<div class="side-item" data-d="${esc(f.path)}"><span>${PICON.folder}</span>${esc(f.path)}<span class="cnt">${f.count}</span></div>`)
    .join('') || '<div class="muted" style="font-size:12px">还没有子文件夹，可以直接在上面输入新路径</div>';
  $('#moveFolders').querySelectorAll('[data-d]').forEach((el) => {
    el.onclick = () => { $('#moveDir').value = el.dataset.d; };
  });
  $('#moveOk').onclick = async () => {
    try {
      const r = await post('/api/move', { rels: moveRels, dir: $('#moveDir').value.trim() });
      closeModal('#maskMove');
      toast(`已移动 ${r.moved} 个` + (r.errors.length ? `，失败 ${r.errors.length}` : ''));
      if (r.errors.length) console.warn(r.errors);
      S.sel.clear(); S.active = null; loadFacets(); loadList(); $('#detail').innerHTML = '<div class="pv-note">左边点一个文件，这里显示详情</div>';
    } catch (e) { toast(e.message, true); }
  };
  openModal('#maskMove');
}

let confirmCb = null;
function askDelete(rels) {
  $('#confirmText').innerHTML = `要删除 <b>${rels.length}</b> 个文件吗？<br>会先进回收站，可以恢复。`;
  confirmCb = async () => {
    const r = await post('/api/trash', { rels });
    closeModal('#maskConfirm');
    toast(`已移到回收站 ${r.deleted} 个` + (r.errors.length ? `，失败 ${r.errors.length}` : ''));
    S.sel.clear(); S.active = null;
    $('#detail').innerHTML = '<div class="pv-note">左边点一个文件，这里显示详情</div>';
    loadFacets(); loadList();
  };
  openModal('#maskConfirm');
}
$('#confirmOk').onclick = () => confirmCb && confirmCb().catch((e) => toast(e.message, true));

function askTag(rels, mode = 'add') {
  S.tagTarget = rels;
  S.tagMode = mode;
  $('#tagTarget').textContent = `给 ${rels.length} 个文件打标签${mode === 'remove' ? '（移除）' : ''}`;
  $('#tagPick').innerHTML = S.tagsAll.map((t) => `<span class="tagchip" data-id="${t.id}" style="border-color:${t.color};color:${t.color}">${esc(t.name)}</span>`).join('') || '<span class="muted" style="font-size:12px">先建一个标签</span>';
  const picked = new Set();
  $('#tagPick').querySelectorAll('[data-id]').forEach((el) => {
    el.onclick = () => {
      const id = el.dataset.id;
      if (picked.has(id)) { picked.delete(id); el.classList.remove('on'); el.style.background = '#fff'; el.style.color = tagById(id).color; }
      else { picked.add(id); el.classList.add('on'); el.style.background = tagById(id).color; el.style.color = '#fff'; }
    };
  });
  $('#tagOk').onclick = async () => {
    try {
      let ids = [...picked];
      const newName = $('#newTagName').value.trim();
      if (newName) {
        const r = await post('/api/tags', { name: newName });
        S.tagsAll = r.tags; ids.push(r.tag.id);
      }
      if (!ids.length) { closeModal('#maskTag'); return; }
      await post('/api/tags/assign', { rels, tags: ids, mode });
      closeModal('#maskTag');
      $('#newTagName').value = '';
      toast('标签已更新'); loadFacets(); loadList();
    } catch (e) { toast(e.message, true); }
  };
  const rmBtn = $('#tagRemove');
  if (rmBtn) rmBtn.onclick = async () => {
    const ids = [...picked];
    if (!ids.length) { toast('先点一下要移除的标签', true); return; }
    try {
      await post('/api/tags/assign', { rels, tags: ids, mode: 'remove' });
      closeModal('#maskTag');
      toast('标签已移除'); loadFacets(); loadList(); if (S.active) loadDetail(S.active);
    } catch (e) { toast(e.message, true); }
  };
  openModal('#maskTag');
}

/* ---------------- 大号编辑器通用 ---------------- */
function openEditor(title, sub, hint) {
  $('#edTitle').textContent = title || '编辑';
  $('#edSub').textContent = sub || '';
  $('#edHint').textContent = hint || '';
  $('#edBody').innerHTML = '';
  $('#edSave').style.display = '';
  $('#edSave').disabled = false;
  $('#edCancel').disabled = false;
  openModal('#maskEditor');
  return $('#edBody');
}
function closeEditor() { closeModal('#maskEditor'); $('#edBody').innerHTML = ''; }

/* ---------------- 编辑器：纯文本 ---------------- */
async function editText(rel) {
  const r = await api('/api/text/get?rel=' + encodeURIComponent(rel));
  const box = openEditor('编辑文本', rel, '直接改，保存后写回原文件');
  box.innerHTML = '<textarea class="bigtext" id="txtEditor" spellcheck="false"></textarea>';
  const ta = $('#txtEditor');
  ta.value = r.text;
  $('#edSave').onclick = async () => {
    $('#edSave').disabled = true;
    try {
      await post('/api/text/save', { rel, text: ta.value });
      toast('已保存'); closeEditor(); loadDetail(rel); loadList();
    } catch (e) { toast(e.message, true); } finally { $('#edSave').disabled = false; }
  };
  ta.focus();
}

/* ---------------- 编辑器：docx 段落（带格式） ---------------- */
const DOCX_BASE_SIZE = 14;

function paraCss(st) {
  if (!st) return '';
  const css = [];
  if (st.align) css.push('text-align:' + st.align);
  if (st.bold) css.push('font-weight:700');
  if (st.italic) css.push('font-style:italic');
  if (st.underline) css.push('text-decoration:underline');
  if (st.size && st.size !== DOCX_BASE_SIZE) css.push('font-size:' + Math.min(34, Math.max(9, st.size)) + 'px');
  if (st.color) css.push('color:' + st.color);
  return css.join(';');
}

async function editDocx(rel) {
  const r = await api('/api/docx/paragraphs?rel=' + encodeURIComponent(rel));
  const blocks = r.blocks || (r.paragraphs || []).map((p) => ({ type: 'p', index: p.index, text: p.text, style: null }));
  const box = openEditor('编辑正文', rel + ' · 共 ' + r.paragraphs.length + ' 段',
    '按原文档的分段、字号、加粗、居中和表格显示；改文字会保留原格式，图片和页眉不动；保存前自动备份');
  box.innerHTML = '<div class="docx-paper" id="docxPaper"></div>';
  const paper = $('#docxPaper');

  const paraEl = (p, cls) => {
    const el = document.createElement('div');
    el.className = cls || 'dp';
    el.dataset.idx = p.index;
    el.contentEditable = 'true';
    el.spellcheck = false;
    const css = paraCss(p.style);
    if (css) el.setAttribute('style', css);
    el.textContent = p.text || '';
    if (!p.text || !p.text.trim()) {
      el.classList.add('dp-empty');
      el.textContent = '';
    }
    return el;
  };

  blocks.forEach((b) => {
    if (b.type === 'tbl') {
      const t = document.createElement('table');
      t.className = 'dtbl';
      b.rows.forEach((row) => {
        const tr = document.createElement('tr');
        row.forEach((cell) => {
          const td = document.createElement('td');
          if (cell.span > 1) td.colSpan = cell.span;
          const inner = document.createElement('div');
          inner.className = 'dcell';
          (cell.paragraphs || []).forEach((p) => inner.appendChild(paraEl(p, 'dp dp-cell')));
          td.appendChild(inner);
          tr.appendChild(td);
        });
        t.appendChild(tr);
      });
      paper.appendChild(t);
      return;
    }
    paper.appendChild(paraEl(b, 'dp'));
  });

  const fields = [...paper.querySelectorAll('[data-idx]')];
  const changed = () => fields.filter((el) => el.textContent !== (r.paragraphs.find((p) => p.index === Number(el.dataset.idx)) || {}).text);

  $('#edSave').style.display = '';
  $('#edHint').textContent = '直接点文字改，样式会保留；回车不会加新段落（要加段落在 Word 里改）';
  $('#edSave').onclick = async () => {
    const edits = fields.map((el) => ({ index: Number(el.dataset.idx), text: el.textContent }));
    const diff = edits.filter((e) => e.text !== (r.paragraphs.find((p) => p.index === e.index) || {}).text);
    if (!diff.length) { toast('没有改动'); closeEditor(); return; }
    $('#edSave').disabled = true;
    try {
      await post('/api/docx/save', { rel, paragraphs: edits });
      toast('已保存 ' + diff.length + ' 段，用 Word 打开看看');
      closeEditor(); loadDetail(rel); loadList();
    } catch (e) { toast(e.message, true); } finally { $('#edSave').disabled = false; }
  };
  // 段落里按回车不允许换行（避免破坏段落结构）
  paper.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); e.target.blur(); }
  });
}

/* ---------------- 编辑器：xlsx 单元格（带样式） ---------------- */
let xlsxState = null;

async function editXlsx(rel) {
  const r = await api('/api/xlsx/sheets?rel=' + encodeURIComponent(rel));
  xlsxState = { rel, sheets: r.sheets, active: 0, edits: {} };
  openEditor('编辑表格', rel, '双击单元格改字，回车确认；灰色是公式单元格，不能改');
  renderXlsxEditor();
}

function cellCss(cell) {
  const st = cell && cell.style;
  if (!st) return '';
  const css = [];
  if (st.b) css.push('font-weight:700');
  if (st.i) css.push('font-style:italic');
  if (st.u) css.push('text-decoration:underline');
  if (st.sz) css.push('font-size:' + Math.min(26, Math.max(9, Math.round(st.sz * 1.15))) + 'px');
  if (st.color) css.push('color:' + st.color);
  if (st.bg) css.push('background:' + st.bg);
  if (st.align) css.push('text-align:' + (st.align === 'centerContinuous' ? 'center' : st.align));
  if (st.wrap) css.push('white-space:pre-wrap');
  return css.join(';');
}

function renderXlsxEditor() {
  const st = xlsxState;
  const sh = st.sheets[st.active];
  const box = $('#edBody');
  const cols = sh.maxCol;
  const letters = [...Array(cols)].map((_, i) => colName(i + 1));
  const edits = st.edits[sh.path] || {};

  // 合并区域：主格保留内容，其余格子让位
  const covered = new Map();
  const spanAt = new Map();
  (sh.merges || []).forEach((ref) => {
    const [aRef, bRef] = ref.split(':');
    const ac = colToNum(aRef.replace(/\d+/g, '')), ar = Number(aRef.replace(/[A-Z]+/g, ''));
    const bc = colToNum(bRef.replace(/\d+/g, '')), br = Number(bRef.replace(/[A-Z]+/g, ''));
    spanAt.set(aRef, { rows: br - ar + 1, cols: bc - ac + 1 });
    for (let r = ar; r <= br; r++) for (let c = ac; c <= bc; c++) {
      const key = letters[c - 1] + r;
      if (key !== aRef) covered.set(key, aRef);
    }
  });

  let html = '<div class="sheet-tabs">' + st.sheets.map((s, i) =>
    '<button data-s="' + i + '" class="' + (i === st.active ? 'on' : '') + '">' + esc(s.name) + '</button>').join('') + '</div>';
  html += '<div class="grid-wrap"><table class="cells sz">';
  html += '<colgroup><col style="width:44px">';
  for (let c = 1; c <= cols; c++) html += '<col style="width:' + ((sh.colWidth && sh.colWidth[c]) || 92) + 'px">';
  html += '</colgroup><thead><tr><th class="corner"></th>' + letters.map((l) => '<th>' + l + '</th>').join('') + '</tr></thead><tbody>';

  for (let r = 1; r <= sh.grid.length; r++) {
    const h = (sh.rowHeight && sh.rowHeight[r]) || 26;
    html += '<tr style="height:' + h + 'px"><th>' + r + '</th>';
    for (let c = 1; c <= cols; c++) {
      const ref = letters[c - 1] + r;
      if (covered.has(ref)) continue;
      const cell = sh.grid[r - 1][c - 1];
      const val = edits[ref] !== undefined ? edits[ref] : (cell ? cell.text : '');
      const isF = cell && cell.hasF;
      const span = spanAt.get(ref);
      const css = cellCss(cell);
      const cls = [isF ? 'formula' : '', edits[ref] !== undefined ? 'dirty' : ''].join(' ');
      html += '<td data-ref="' + ref + '" data-r="' + (r - 1) + '" data-c="' + (c - 1) + '" class="' + cls + '"'
        + (span ? ' rowspan="' + span.rows + '" colspan="' + span.cols + '"' : '')
        + (css ? ' style="' + css + '"' : '')
        + (isF ? ' title="公式：' + esc(cell.formula) + '"' : '')
        + '>' + esc(val) + '</td>';
    }
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  box.innerHTML = html;

  box.querySelectorAll('[data-s]').forEach((b) => {
    b.onclick = () => { xlsxState.active = Number(b.dataset.s); renderXlsxEditor(); };
  });
  box.querySelectorAll('td[data-ref]').forEach((td) => {
    if (td.classList.contains('formula')) return;
    td.ondblclick = () => {
      td.contentEditable = 'true';
      td.classList.add('editing');
      td.focus();
      document.execCommand('selectAll', false, null);
    };
    const commit = () => {
      if (td.contentEditable !== 'true') return;
      td.contentEditable = 'false';
      td.classList.remove('editing');
      const sheet = xlsxState.sheets[xlsxState.active];
      const ref = td.dataset.ref;
      const val = td.textContent;
      const orig = (sheet.grid[Number(td.dataset.r)][Number(td.dataset.c)] || {}).text || '';
      if (!xlsxState.edits[sheet.path]) xlsxState.edits[sheet.path] = {};
      if (val === orig) delete xlsxState.edits[sheet.path][ref];
      else xlsxState.edits[sheet.path][ref] = val;
      td.classList.toggle('dirty', val !== orig);
      const n = Object.keys(xlsxState.edits).reduce((s2, k) => s2 + Object.keys(xlsxState.edits[k]).length, 0);
      $('#edHint').textContent = n ? '已修改 ' + n + ' 个单元格' : '双击单元格改字，回车确认；灰色是公式单元格，不能改';
    };
    td.onblur = commit;
    td.addEventListener('focusout', commit);
    td.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); td.blur(); } };
  });
  $('#edSave').onclick = async () => {
    const total = Object.keys(xlsxState.edits).reduce((s2, k) => s2 + Object.keys(xlsxState.edits[k]).length, 0);
    if (!total) { toast('没有改动'); closeEditor(); return; }
    $('#edSave').disabled = true;
    try {
      await post('/api/xlsx/save', { rel: xlsxState.rel, sheets: xlsxState.edits });
      toast('已保存 ' + total + ' 个单元格');
      closeEditor(); loadDetail(xlsxState.rel); loadList();
    } catch (e) { toast(e.message, true); } finally { $('#edSave').disabled = false; }
  };
}

function colToNum(s) { let n = 0; for (const ch of String(s).toUpperCase()) { const c = ch.charCodeAt(0); if (c < 65 || c > 90) continue; n = n * 26 + (c - 64); } return n; }
function colName(n) { let s = ''; while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }

/* ---------------- pptx 逐页文字 ---------------- */
async function showPptx(rel) {
  try {
    const r = await api('/api/pptx/slides?rel=' + encodeURIComponent(rel));
    const html = r.slides.map((s) => `<div style="margin-bottom:12px">
      <div style="font-weight:600;font-size:12px;color:#5f6673;margin-bottom:2px">第 ${s.no} 页</div>
      <pre style="margin:0;white-space:pre-wrap;font:12.5px/1.7 'Microsoft YaHei',sans-serif">${esc(s.lines.join('\n')) || '<span class="muted">（无文字）</span>'}</pre></div>`).join('');
    $('#pvBox').innerHTML = `<div class="preview" style="max-height:520px">${html || '<div class="pv-note">没有抽取到文字</div>'}</div>`;
  } catch (e) { toast(e.message, true); }
}

/* ---------------- 回收站 ---------------- */
async function showTrash() {
  const r = await api('/api/trash/list');
  const box = $('#trashList');
  box.innerHTML = r.items.length
    ? '<table class="files"><tbody>' + r.items.map((it) => `<tr>
        <td><b>${esc(it.name)}</b><div class="muted" style="font-size:11.5px">${esc(it.rel)}</div></td>
        <td style="width:90px" class="muted">${fmtSize(it.size)}</td>
        <td style="width:130px" class="muted">${fmtTime(it.at)}</td>
        <td style="width:130px">
          <button class="btn sm" data-restore="${it.id}">恢复</button>
          <button class="btn sm ghost danger" data-purge="${it.id}">彻底删除</button></td></tr>`).join('') + '</tbody></table>'
    : '<div class="pv-note">回收站是空的</div>';
  box.querySelectorAll('[data-restore]').forEach((b) => {
    b.onclick = async () => {
      try { await post('/api/trash/restore', { id: b.dataset.restore }); toast('已恢复'); showTrash(); loadFacets(); loadList(); }
      catch (e) { toast(e.message, true); }
    };
  });
  box.querySelectorAll('[data-purge]').forEach((b) => {
    b.onclick = async () => {
      if (!confirm('彻底删除后无法恢复，确定？')) return;
      await post('/api/trash/purge', { id: b.dataset.purge }); showTrash();
    };
  });
  openModal('#maskTrash');
}

/* ---------------- 导入 ---------------- */
let pollTimer = null;
/* ---------------- 应用内文件夹选择器 ---------------- */
const PICK = { path: '', selected: '', cb: null, loading: false, ext: '', isFile: false };

function openPickerDispatch(cb, opts) {
  if (window.openPickerShared) return window.openPickerShared(cb, opts);
  return openPickerOld(cb, opts);
}

async function openPickerOld(cb, opts) {
  PICK.cb = cb;
  PICK.selected = '';
  PICK.ext = (opts && opts.ext) || '';
  PICK.isLnk = false;
  const hd = document.querySelector('#maskPick header');
  if (hd && hd.firstChild) hd.firstChild.nodeValue = PICK.ext ? '选择一个文件' : '选择文件夹';
  if ($('#pickOk')) $('#pickOk').textContent = PICK.ext ? '用这个文件' : '选这个文件夹';
  PICK.isFile = false;
  $('#maskPick').classList.add('show');
  await loadPick('');
}

async function loadPick(p) {
  if (PICK.loading) return;
  PICK.loading = true;
  try {
    const url = '/api/browse' + (p || PICK.ext ? '?path=' + encodeURIComponent(p || '') + (PICK.ext ? '&ext=' + encodeURIComponent(PICK.ext) : '') : '');
    const r = await (await fetch(url)).json();
    const d = r.data || r;
    if (!r.ok) { toast(r.error || '打不开这个文件夹', true); return; }
    PICK.path = d.path || '';
    PICK.selected = PICK.path;
    const pi = $('#pickPath');
    if (pi) pi.value = PICK.path || '';
    PICK.isFile = !!(d && d.pickFile);
    if (PICK.isFile) PICK.selected = PICK.path.replace(/[\\/]+$/, '') + '\\' + d.pickFile;
    renderPick(d);
    if (d && d.pickFile) {
      const hit = Array.prototype.slice.call($('#pickList').querySelectorAll('.pr.file')).find((n) => n.dataset.path === PICK.selected);
      if (hit) { hit.classList.add('on'); hit.scrollIntoView({ block: 'center' }); }
      $('#pickHint').textContent = '已选中文件：' + d.pickFile;
    }
  } catch (e) {
    toast('读取目录失败：' + e.message, true);
  } finally {
    PICK.loading = false;
  }
}

async function openLnk(lnkPath) {
  try {
    const r = await api('/api/lnk?path=' + encodeURIComponent(lnkPath));
    const d = r.data || r;
    if (!d || !d.target) { toast('这个快捷方式打不开', true); return; }
    if (!d.exists) { toast('它指向的位置已经不存在了：' + d.target, true); return; }
    if (d.isDir) { PICK.isLnk = false; PICK.isFile = false; loadPick(d.target); return; }
    PICK.isLnk = false; PICK.isFile = true; loadPick(d.target);
  } catch (e) {
    toast('读取快捷方式失败：' + e.message, true);
  }
}

function renderPick(d) {
  const nav = $('#pickNav');
  nav.innerHTML = '';
  const addNav = (icon, name, path, cls) => {
    const el = document.createElement('div');
    el.className = 'pn' + (cls ? ' ' + cls : '');
    el.innerHTML = '<span>' + icon + '</span><span class="nm">' + esc(name) + '</span>';
    el.title = path || name;
    if (!cls) el.onclick = () => loadPick(path);
    nav.appendChild(el);
  };
  (d.places || []).forEach((x) => addNav(placeIcon(x.name), x.name, x.path));
  (d.drives || []).forEach((x) => addNav(PICON.drive, x.name, x.path));
  if (d.parent) addNav(PICON.up, '上一层', d.parent, '');

  const list = $('#pickList');
  list.innerHTML = '';
  if (d.path === '') {
    list.innerHTML = '<div class="empty">先点左边选一个位置，或直接双击下面的磁盘</div>';
    (d.drives || []).forEach((x) => {
      const el = document.createElement('div');
      el.className = 'pr';
      el.innerHTML = '<span class="ico">' + PICON.drive + '</span><span class="nm">' + esc(x.name) + '</span>';
      el.onclick = () => loadPick(x.path);
      el.ondblclick = () => loadPick(x.path);
      list.appendChild(el);
    });
    (d.places || []).forEach((x) => {
      const el = document.createElement('div');
      el.className = 'pr';
      el.innerHTML = '<span class="ico">' + placeIcon(x.name) + '</span><span class="nm">' + esc(x.name) + '</span>';
      el.onclick = () => loadPick(x.path);
      el.ondblclick = () => loadPick(x.path);
      list.appendChild(el);
    });
    return;
  }
  if ((!d.dirs || !d.dirs.length) && (!d.links || !d.links.length) && (!PICK.ext || !d.files || !d.files.length)) {
    list.innerHTML = '<div class="empty">这里没有可选的文件夹' + (PICK.ext ? '或表格' : '') + '，可以直接点「选这个文件夹」</div>';
  }
  (d.dirs || []).forEach((x) => {
    const el = document.createElement('div');
    el.className = 'pr';
    el.dataset.path = x.path;
    el.innerHTML = '<span class="ico">' + PICON.folder + '</span><span class="nm">' + esc(x.name) + '</span>';
    el.onclick = () => {
      list.querySelectorAll('.pr.on').forEach((n) => n.classList.remove('on'));
      el.classList.add('on');
      PICK.selected = x.path;
      $('#pickHint').textContent = '已选中文件夹：' + x.name;
    };
    el.ondblclick = () => loadPick(x.path);
    list.appendChild(el);
  });
  (d.links || []).forEach((x) => {
    const el = document.createElement('div');
    el.className = 'pr lnk';
    el.dataset.path = x.path;
    el.innerHTML = '<span class="ico"><svg class="lic" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6.6 9.4a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 1 0-3.7-3.7l-.9.9"/><path d="M9.4 6.6a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 1 0 3.7 3.7l.9-.9"/></svg></span><span class="nm">' + esc(x.name) + '</span><span class="lnktag">快捷方式</span>';
    el.onclick = () => {
      list.querySelectorAll('.pr.on').forEach((n) => n.classList.remove('on'));
      el.classList.add('on');
      PICK.selected = x.path;
      PICK.isLnk = true;
      PICK.isFile = false;
      $('#pickHint').textContent = '快捷方式：' + x.name + '（双击或点按钮打开它指向的位置）';
    };
    el.ondblclick = () => { PICK.selected = x.path; openLnk(x.path); };
    list.appendChild(el);
  });
  (d.files || []).forEach((x) => {
    const el = document.createElement('div');
    el.className = 'pr file';
    el.dataset.path = x.path;
    el.innerHTML = '<span class="ico">' + `<svg class="lic" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4.1 2.4h4.7l3.1 3v8.2H4.1z"/><path d="M8.8 2.4v3h3"/></svg>` + '</span><span class="nm">' + esc(x.name) + '</span>';
    el.onclick = () => {
      list.querySelectorAll('.pr.on').forEach((n) => n.classList.remove('on'));
      el.classList.add('on');
      PICK.selected = x.path;
      PICK.isFile = true;
      $('#pickHint').textContent = '已选中文件：' + x.name;
    };
    el.ondblclick = () => {
      PICK.selected = x.path;
      PICK.isFile = true;
      $('#maskPick').classList.remove('show');
      if (PICK.cb) PICK.cb(x.path);
    };
    list.appendChild(el);
  });
  $('#pickHint').textContent = (d.dirs ? d.dirs.length : 0) + ' 个文件夹'
    + (PICK.ext ? ' · ' + (d.files ? d.files.length : 0) + ' 个表格文件（单击选中，双击直接用）' : ' · 双击进去')
    + ((d.links && d.links.length) ? ' · ' + d.links.length + ' 个快捷方式' : '');
}

function gotoTypedPath() {
  const el = $('#pickPath');
  if (!el) return;
  let v = String(el.value || '').trim();
  v = v.replace(/^["']+|["']+$/g, '');
  if (!v) return loadPick('');
  loadPick(v);
}

function bindPicker() {
  if (!$('#pickOk')) return;
  const pi = $('#pickPath');
  if (pi) {
    pi.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); gotoTypedPath(); } };
  }
  const go = $('#pickGo');
  if (go) go.onclick = () => gotoTypedPath();
  $('#pickOk').onclick = () => {
    if (PICK.isLnk) {
      const lp = PICK.selected;
      if (!lp) return toast('先点一下快捷方式', true);
      openLnk(lp);
      return;
    }
    const target = PICK.selected || (PICK.ext ? '' : PICK.path);
    $('#maskPick').classList.remove('show');
    if (target && PICK.cb) PICK.cb(target);
  };
}

async function chooseSourceFor(inputId, title, btn) {
  const el = $(inputId);
  const before = el ? el.value.trim() : '';
  PICK.selected = '';
  toast(title || '选择文件夹');
  openPickerDispatch((picked) => {
    if (el && picked) {
      el.value = picked;
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  if (before) setTimeout(() => {}, 0);
}

function cleanPath(v) { return String(v || '').trim().replace(/^["']+|["']+$/g, ''); }

function startImport() {
  const src = cleanPath($('#impSrc').value);
  if (!src) return toast('填一个来源文件夹', true);
  const mode = document.querySelector('input[name=impMode]:checked').value;
  $('#impStart').disabled = true;
  $('#impProgress').style.display = 'block';
  post('/api/import', { src, mode, skipJunk: $('#impSkipJunk').checked, skipBigZip: $('#impSkipZip').checked })
    .then(() => { toast('开始导入'); pollImport(); })
    .catch((e) => { toast(e.message, true); $('#impStart').disabled = false; });
}
function pollImport() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    try {
      const s = await api('/api/import/status');
      const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
      $('#impProgress').querySelector('i').style.width = pct + '%';
      $('#impStatus').textContent = s.running
        ? `正在处理 ${s.done} / ${s.total}（${pct}%）· 跳过 ${s.skipped} 个 · ${s.current}`
      : `完成：已复制 ${Math.max(0, s.done - (s.skipped || 0))} 个，跳过 ${s.skipped} 个${s.errors.length ? '，失败 ' + s.errors.length + ' 个' : ''}`;
      if (!s.running) {
        clearInterval(pollTimer);
        $('#impStart').disabled = false;
        loadFacets(); loadList();
        api('/api/status').then((r) => { S.status = r; $('#scanInfo').textContent = `库：${r.root} · ${r.count} 个文件 · ${r.sizeText}`; });
      }
    } catch (_) {}
  }, 600);
}

/* ---------------- 拖拽导入 ---------------- */
const dropHint = $('#dropHint');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; dropHint.classList.add('show'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('dragleave', (e) => { e.preventDefault(); if (--dragDepth <= 0) { dragDepth = 0; dropHint.classList.remove('show'); } });
window.addEventListener('drop', async (e) => {
  const attOpen = document.querySelector('#maskAtt') && document.querySelector('#maskAtt').classList.contains('show');
  const f0 = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
  if (attOpen && f0) {
    const ok = /\.(png|jpe?g|bmp|webp|gif|pdf|xlsx|xlsm|csv)$/i.test(f0.name || '') || !/\./.test(f0.name || '');
    if (ok) {
      e.preventDefault();
      e.stopPropagation();
      dragDepth = 0; dropHint.classList.remove('show');
      handleRosterFile(f0, document.querySelector('#attDrop'));
      return;
    }
  }
  e.preventDefault();
  dragDepth = 0; dropHint.classList.remove('show');
  const items = [...(e.dataTransfer.items || [])];
  const entries = items.map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (entries.length) {
    const files = [];
    for (const ent of entries) await walkEntry(ent, '', files);
    uploadFiles(files);
  } else {
    uploadFiles([...e.dataTransfer.files].map((f) => ({ file: f, rel: f.name })));
  }
});

function walkEntry(entry, prefix, out) {
  return new Promise((resolve) => {
    if (entry.isFile) {
      entry.file((f) => { out.push({ file: f, rel: prefix ? prefix + '/' + f.name : f.name }); resolve(); }, resolve);
    } else if (entry.isDirectory) {
      const dirPath = prefix ? prefix + '/' + entry.name : entry.name;
      const reader = entry.createReader();
      const all = [];
      const readBatch = () => reader.readEntries(async (batch) => {
        if (!batch.length) {
          for (const en of all) await walkEntry(en, dirPath, out);
          return resolve();
        }
        all.push(...batch);
        readBatch();
      }, resolve);
      readBatch();
    } else resolve();
  });
}

async function uploadFiles(list) {
  if (!list.length) return;
  let done = 0, err = 0;
  const dir = S.dir || '';
  for (const item of list) {
    try {
      const qs = '?name=' + encodeURIComponent(item.rel.split('/').pop()) + '&dir=' + encodeURIComponent(item.rel.includes('/') ? (dir ? dir + '/' : '') + item.rel.split('/').slice(0, -1).join('/') : dir);
      await api('/api/upload' + qs, { method: 'POST', body: item.file });
      done++;
    } catch (e) { err++; }
    if (done % 5 === 0) toast(`导入中 ${done}/${list.length}`);
  }
  toast(`导入完成：${done} 个${err ? '，失败 ' + err : ''}`, !!err);
  loadFacets(); loadList();
}

/* ---------------- 事件绑定 ---------------- */
let qTimer = null;
$('#q').addEventListener('input', (e) => {
  const v = e.target.value;
  $('#qClear').style.display = v ? 'block' : 'none';
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { S.q = v; S.page = 1; loadList(); }, 220);
});
$('#qClear').onclick = () => { $('#q').value = ''; S.q = ''; $('#qClear').style.display = 'none'; loadList(); };
$('#q').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { clearTimeout(qTimer); S.q = $('#q').value; S.page = 1; loadList(); }
});

$('#sort').onchange = (e) => {
  S.sort = e.target.value;
  if (S.sort === 'mtime' || S.sort === 'size') S.order = S.sort === 'mtime' ? 'desc' : 'desc';
  $('#order').value = S.order;
  S.page = 1; loadList();
};
$('#order').onchange = (e) => { S.order = e.target.value; S.page = 1; loadList(); };
$('#pageSize').onchange = (e) => { S.pageSize = Number(e.target.value); S.page = 1; loadList(); };
$('#prevPage').onclick = () => { if (S.page > 1) { S.page--; loadList(); } };
$('#nextPage').onclick = () => { S.page++; loadList(); };
$('#checkAll').onchange = (e) => {
  S.items.forEach((f) => e.target.checked ? S.sel.add(f.rel) : S.sel.delete(f.rel));
  renderList();
};

$('#bTag').onclick = () => askTag([...S.sel]);
$('#bMove').onclick = () => askMove([...S.sel]);
$('#bDel').onclick = () => askDelete([...S.sel]);
$('#bClear').onclick = () => { S.sel.clear(); renderList(); };
$('#bRename').onclick = () => openBatchRename();
$('#bZip').onclick = () => zipFiles([...S.sel]);

/* ---------------- 工具：重复文件 / 系列 / 导出清单 ---------------- */
$('#btnTools').onclick = () => openModal('#maskTools');
$('#toolDup').onclick = () => { closeModal('#maskTools'); showDups(); };
$('#toolSeries').onclick = () => { closeModal('#maskTools'); showSeries(); };
$('#toolExport').onclick = async () => {
  closeModal('#maskTools');
  try {
    const r = await post('/api/export/list', { query: queryObject() });
    toast(`已导出 ${r.count} 条记录：${r.name}`);
    post('/api/openPath', { path: r.path, reveal: true }).catch(() => {});
  } catch (e) { toast(e.message, true); }
};

async function showDups() {
  openModal('#maskDup');
  $('#dupSummary').textContent = '正在比对文件内容…（文件多时需要几秒）';
  $('#dupList').innerHTML = '';
  const r = await api('/api/dups').catch((e) => { $('#dupSummary').textContent = e.message; return null; });
  if (!r) return;
  if (!r.groups.length) {
    $('#dupSummary').textContent = '没有发现内容相同的文件。';
    return;
  }
  S.dupGroups = r.groups;
  const total = r.groups.reduce((a, g) => a + g.files.length, 0);
  $('#dupSummary').textContent = `发现 ${r.groupCount} 组重复（${total} 个文件），删掉多余的能省 ${fmtSize(r.wasted)}。每组默认保留第一个，勾选要移入回收站的。`;
  $('#dupList').innerHTML = r.groups.map((g, gi) => (
    `<div class="dupGroup"><div class="dupHead">${fmtSize(g.size)} · ${g.files.length} 个同内容文件</div>` +
    g.files.map((f, fi) => `<label class="dupRow"><input type="checkbox" data-g="${gi}" data-f="${fi}" ${fi ? 'checked' : ''}>
      <span class="dupName" title="${esc(f.rel)}">${esc(f.rel)}</span></label>`).join('') +
    '</div>')).join('');
}

$('#dupDelete').onclick = async () => {
  const rels = [];
  $('#dupList').querySelectorAll('input[type=checkbox]:checked').forEach((ck) => {
    const g = S.dupGroups && S.dupGroups[Number(ck.dataset.g)];
    if (g && g.files[Number(ck.dataset.f)]) rels.push(g.files[Number(ck.dataset.f)].rel);
  });
  if (!rels.length) return toast('没有勾选任何文件');
  try {
    const r = await post('/api/trash', { rels });
    toast(`已移入回收站 ${r.count || rels.length} 个`);
    closeModal('#maskDup');
    await refreshStatus(); loadFacets(); loadList();
  } catch (e) { toast(e.message, true); }
};

async function showSeries() {
  openModal('#maskSeries');
  $('#seriesList').innerHTML = '<div class="hint">正在归类…</div>';
  const r = await api('/api/series').catch((e) => { $('#seriesList').innerHTML = `<div class="hint">${esc(e.message)}</div>`; return null; });
  if (!r) return;
  const list = r.series || [];
  if (!list.length) { $('#seriesList').innerHTML = '<div class="hint">没有找到成系列的文件。</div>'; return; }
  $('#seriesList').innerHTML = list.map((s, i) => {
    const miss = (s.missing || []).length
      ? `<span class="miss">缺 ${s.missing.join('、')} 月</span>`
      : '<span class="ok">月份齐全</span>';
    return `<div class="serGroup">
      <div class="serHead"><b>${esc(s.stem)}</b><span class="muted">${esc(s.dir || '库根目录')}</span></div>
      <div class="serMeta">共 ${s.count} 个 · 月份 ${s.months.length ? s.months.join('、') : '未识别'} · ${miss}
        <button class="btn sm" data-ser="${i}">只看这组</button></div>
    </div>`;
  }).join('');
  $('#seriesList').querySelectorAll('[data-ser]').forEach((b) => {
    b.onclick = () => {
      const s = list[Number(b.dataset.ser)];
      S.onlyRels = (s.files || []).map((f) => f.rel);
      S.page = 1;
      closeModal('#maskSeries');
      loadList();
      toast(`只看「${s.stem}」：${S.onlyRels.length} 个文件`);
    };
  });
}

/* ---------------- 打包下载 ---------------- */
async function zipFiles(rels) {
  if (!rels.length) return toast('先勾选文件');
  try {
    toast('正在打包…');
    const r = await post('/api/export/zip', { rels, name: '课程资料-' + rels.length + '个文件' });
    toast(`已打包 ${r.count} 个文件（${r.sizeText}）：${r.name}`);
    post('/api/openPath', { path: r.path, reveal: true }).catch(() => {});
  } catch (e) { toast(e.message, true); }
}

/* ---------------- 批量改名 ---------------- */
function brNewName(name, seq) {
  const dot = name.lastIndexOf('.');
  let base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  const find = $('#brFind').value;
  const rep = $('#brRep').value;
  if (find) {
    if ($('#brRegex').checked) {
      try { base = base.replace(new RegExp(find, 'g'), rep); } catch (e) { /* 正则写错就原样 */ }
    } else base = base.split(find).join(rep);
  }
  base = $('#brPrefix').value + base + $('#brSuffix').value;
  if ($('#brSeq').checked) {
    const start = Number($('#brSeqStart').value) || 1;
    const pad = Math.max(1, Math.min(4, Number($('#brSeqPad').value) || 2));
    base = base + '-' + String(start + seq).padStart(pad, '0');
  }
  return base + ext;
}
function brPreview() {
  const rels = [...S.sel];
  const box = $('#brPreview');
  if (!rels.length) { box.innerHTML = '<span class="muted">没有勾选文件</span>'; return; }
  box.innerHTML = rels.slice(0, 20).map((rel, i) => {
    const old = rel.split('/').pop();
    const nn = brNewName(old, i);
    return `<div>${esc(old)} <span class="muted">→</span> <b>${esc(nn)}</b></div>`;
  }).join('') + (rels.length > 20 ? `<div class="muted">…还有 ${rels.length - 20} 个</div>` : '');
}
function openBatchRename() {
  if (!S.sel.size) return toast('先勾选文件');
  $('#brTarget').textContent = `对勾选的 ${S.sel.size} 个文件套用下面的规则（扩展名不变，重名会自动加序号）`;
  ['#brFind', '#brRep', '#brPrefix', '#brSuffix'].forEach((s) => { $(s).value = ''; });
  $('#brSeq').checked = false; $('#brRegex').checked = false;
  brPreview();
  openModal('#maskBatchRename');
}
['#brFind', '#brRep', '#brPrefix', '#brSuffix', '#brSeq', '#brSeqStart', '#brSeqPad', '#brRegex'].forEach((s) => {
  const el = $(s);
  if (el) { el.oninput = brPreview; el.onchange = brPreview; }
});
$('#brOk').onclick = async () => {
  const rels = [...S.sel];
  const items = rels.map((rel, i) => ({ rel, name: brNewName(rel.split('/').pop(), i) }))
    .filter((it) => it.name !== it.rel.split('/').pop());
  if (!items.length) return toast('规则没有改变任何文件名');
  try {
    const r = await post('/api/rename/batch', { items });
    toast(`改名完成 ${r.renamed} 个` + (r.errors.length ? `，失败 ${r.errors.length} 个` : ''));
    closeModal('#maskBatchRename');
    S.sel.clear();
    await refreshStatus(); loadFacets(); loadList();
  } catch (e) { toast(e.message, true); }
};

/* ---------------- 保存视图 ---------------- */
$('#btnSaveView').onclick = () => {
  const bits = [];
  if (S.q) bits.push('含「' + S.q + '」');
  if (S.groups.size) bits.push([...S.groups].join('/'));
  if (S.tags.size) bits.push([...S.tags].map((id) => (tagById(id) || {}).name || id).join('/'));
  if (hasAuto()) bits.push(autoQuery());
  if (S.dir) bits.push(S.dir);
  if (S.onlyRels.length) bits.push('系列筛选');
  $('#viewQueryText').textContent = bits.length ? '当前条件：' + bits.join(' · ') : '当前没有任何筛选条件';
  $('#viewName').value = '';
  openModal('#maskSaveView');
  setTimeout(() => $('#viewName').focus(), 50);
};
$('#viewOk').onclick = async () => {
  const name = $('#viewName').value.trim();
  if (!name) return toast('给视图起个名字');
  try {
    const r = await post('/api/views', { name, query: new URLSearchParams(queryObject()).toString() });
    S.prefs.views = r.views || [];
    renderPrefs();
    closeModal('#maskSaveView');
    toast('视图已保存：' + name);
  } catch (e) { toast(e.message, true); }
};

$('#sizeMin').oninput = debounceFilter((e) => { S.sizeMin = e.target.value; S.page = 1; loadList(); });
$('#sizeMax').oninput = debounceFilter((e) => { S.sizeMax = e.target.value; S.page = 1; loadList(); });
$('#dateFrom').onchange = (e) => { S.dateFrom = e.target.value; S.page = 1; loadList(); };
$('#dateTo').onchange = (e) => { S.dateTo = e.target.value; S.page = 1; loadList(); };
function debounceFilter(fn) { let t = null; return (e) => { clearTimeout(t); t = setTimeout(() => fn(e), 300); }; }
$('#btnClearFilters').onclick = () => {
  S.groups.clear(); S.tags.clear(); S.dir = ''; S.sizeMin = S.sizeMax = ''; S.dateFrom = S.dateTo = '';
  S.auto = { 校区: new Set(), 学期: new Set(), 类型: new Set() };
  S.onlyRels = [];
  $('#sizeMin').value = $('#sizeMax').value = $('#dateFrom').value = $('#dateTo').value = '';
  S.page = 1; loadFacets(); loadList();
};

$('#btnAddTag').onclick = () => askTag(S.active ? [S.active] : []);
$('#btnTrash').onclick = showTrash;
$('#btnImport').onclick = () => {
  $('#impSrc').value = $('#impSrc').value || (S.status.source || '');
  $('#impStatus').textContent = '';
  $('#impProgress').style.display = 'none';
  $('#impProgress').querySelector('i').style.width = '0';
  openModal('#maskImport');
};
$('#impStart').onclick = startImport;
bindPicker();
if ($('#convSearch')) {
  $('#convSearch').addEventListener('input', (e) => renderConvSearch(e.target.value));
  $('#convSearch').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const first = document.querySelector('#convResults .cr'); if (first) first.click(); } });
}
if ($('#tbClose')) $('#tbClose').onclick = () => convHideTask();
if ($('#tbOpenDir')) $('#tbOpenDir').onclick = async () => {
  let dir = (CONV.outDir || '').trim();
  if (!dir && CONV.lastFile) dir = String(CONV.lastFile).replace(/[\\/][^\\/]*$/, '');
  if (!dir) dir = ((S.status && S.status.exportDir) || '').trim();
  if (!dir) { toast('还不知道结果放在哪，先转一次文件', true); return; }
  toast('正在打开：' + dir);
  // 让外壳先把自己缩下去一点，免得资源管理器被压在我们窗口后面
  try { if (window.chrome && window.chrome.webview) window.chrome.webview.postMessage('mini'); } catch (e) {}
  try {
    const r = await post('/api/openPath', { path: dir });
    if (r && r.via) toast('已用资源管理器打开（' + r.via + '）');
  } catch (e) { toast('打不开：' + e.message, true); }
};
if ($('#tbOpenFile')) $('#tbOpenFile').onclick = () => {
  if (!CONV.lastFile) { toast('还没转换过，先转一次', true); return; }
  post('/api/openPath', { path: CONV.lastFile }).catch((e) => toast('打不开：' + e.message, true));
};
$('#impPick').onclick = (ev) => chooseSourceFor('#impSrc', '选择要导入的文件夹', ev.currentTarget);
if ($('#setPick')) $('#setPick').onclick = (ev) => chooseSourceFor('#setSource', '选择默认的导入来源文件夹', ev.currentTarget);
$('#btnScan').onclick = async () => {
  try {
    await post('/api/scan', {});
    toast('开始扫描，进度看右下角');
    const t = setInterval(async () => {
      const s = await api('/api/scan/status').catch(() => null);
      if (!s) return;
      $('#scanInfo').textContent = s.scanning ? `扫描中 ${s.done}/${s.total} ${s.current || ''}` : (S.status.count + ' 个文件');
      if (!s.scanning) {
        clearInterval(t);
        toast('索引已更新');
        await refreshStatus(); loadFacets(); loadList();
      }
    }, 800);
  } catch (e) { toast(e.message, true); }
};
$('#btnSettings').onclick = () => { $('#setRoot').value = S.status.root || ''; $('#setSource').value = S.status.source || ''; openModal('#maskSettings'); };
$('#setOk').onclick = async () => {
  try {
    const root = $('#setRoot').value.trim();
    const source = $('#setSource').value.trim();
    if (source) await post('/api/config', { source });
    if (root && root !== S.status.root) {
      await post('/api/config', { root });
      toast('库目录已切换，正在重建索引');
    } else {
      toast('已保存');
    }
    closeModal('#maskSettings');
    await refreshStatus(); loadFacets(); loadList();
  } catch (e) { toast(e.message, true); }
};
$('#setQuit').onclick = async () => {
  if (!confirm('确定退出教学文件管理？下次双击桌面图标重新打开。')) return;
  document.body.innerHTML = '<div style="padding:60px;font:16px/2 system-ui;color:#444">正在退出…</div>';
  await post('/api/shutdown', {}).catch(() => {});
  setTimeout(() => {
    try {
      if (window.chrome && window.chrome.webview && window.chrome.webview.postMessage) {
        window.chrome.webview.postMessage('quit');
      } else {
        window.close();
      }
    } catch (e) { }
  }, 300);
};

/* ---------------- 启动 ---------------- */
async function refreshStatus() {
  const r = await api('/api/status').catch(() => null);
  if (!r) return;
  S.status = r;
  S.tagsAll = r.tags || [];
  $('#scanInfo').textContent = `库：${r.root} · ${r.count} 个文件 · ${r.sizeText}`;
  if (r.error) toast('库目录打不开：' + r.error, true);
  if (r.importing) pollImport();
  return r;
}

/* ---------------- 左栏分区：可折叠 ---------------- */
const SEC_DEFAULT_CLOSED = ['标签', '大小与时间', '我的视图', '收藏 / 最近'];
function buildCollapsible() {
  const side = document.querySelector('aside.side');
  if (!side) return;
  let cur = null;
  [...side.children].forEach((el) => {
    if (el.tagName === 'H4') {
      cur = document.createElement('section');
      cur.className = 'sec';
      cur.dataset.key = el.textContent.trim();
      side.insertBefore(cur, el);
      el.classList.add('sec-h');
      cur.appendChild(el);
    } else if (cur) {
      cur.appendChild(el);
    }
  });
  const clearBtn = side.querySelector('#btnClearFilters');
  if (clearBtn) side.appendChild(clearBtn);
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem('sideSecs') || '{}'); } catch (e) { saved = {}; }
  side.querySelectorAll('section.sec').forEach((sec) => {
    const key = sec.dataset.key;
    const closed = key in saved ? !!saved[key] : SEC_DEFAULT_CLOSED.includes(key);
    sec.classList.toggle('closed', closed);
    sec.querySelector('.sec-h').onclick = () => {
      sec.classList.toggle('closed');
      saved[key] = sec.classList.contains('closed');
      try { localStorage.setItem('sideSecs', JSON.stringify(saved)); } catch (e) {}
    };
  });
}

(async function init() {
  $('#edCancel').onclick = () => closeEditor();
  $('#toolAtt').onclick = () => { $('#maskTools').classList.remove('show'); openAttendance(); };
  $('#toolConv').onclick = () => { $('#maskTools').classList.remove('show'); openConvert(); };
  $('#attOk').onclick = submitAttendance;
  if ($('#planSave')) $('#planSave').onclick = savePlan;
  bindAttTpl();
  $('#impSrc').onkeydown = (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const v = cleanPath($('#impSrc').value);
    if (!v) return toast('填一个文件夹路径', true);
    $('#impSrc').value = v;
    toast('路径已填好，点「开始导入」就会开始复制');
  };
  $('#convStart').onclick = startConvert;
  if ($('#convOpen')) $('#convOpen').onclick = () => post('/api/openPath', { path: 'D:\\课程文件库\\导出' }).catch(() => {});

  const _sp0 = new URLSearchParams(location.search);
  if (_sp0.get('dir') !== null) S.dir = _sp0.get('dir') || '';

  buildCollapsible();
  bindCtxMenu();
  bindHeaderSort(); markSortHead();
  await refreshStatus();
  await loadFacets();
  await loadList();
  renderCrumbs();
  if (!S.status.count) {
    $('#impSrc').value = S.status.source || '';
  }
})();


/* ---------------- 右键菜单 ---------------- */
const CTX_EDIT = { docx: '编辑正文', xlsx: '编辑表格', xlsm: '编辑表格', txt: '编辑文本', md: '编辑文本', py: '编辑文本', js: '编辑文本', json: '编辑文本', log: '编辑文本', csv: '编辑文本', ini: '编辑文本' };
function hideCtx() { const m = $('#ctxMenu'); if (m) m.classList.remove('show'); }
function showCtx(x, y, items) {
  const m = $('#ctxMenu');
  if (!m) return;
  m.innerHTML = items.map((it, i) => it.sep ? '<div class="csep"></div>'
    : '<div class="citem' + (it.danger ? ' danger' : '') + '" data-i="' + i + '">' + (it.icon || '') + '<span>' + esc(it.label) + '</span></div>').join('');
  m.classList.add('show');
  const w = m.offsetWidth, ht = m.offsetHeight;
  m.style.left = Math.min(x, window.innerWidth - w - 8) + 'px';
  m.style.top = Math.min(y, window.innerHeight - ht - 8) + 'px';
  m.querySelectorAll('.citem').forEach((el) => {
    el.onclick = () => {
      const it = items[Number(el.dataset.i)];
      hideCtx();
      if (it && it.fn) it.fn();
    };
  });
}
function ctxForFile(rel) {
  const ext = convExt(rel);
  const isFav = (S.prefs.favs || []).includes(rel);
  const items = [
    { label: '打开', icon: PICON.folder, fn: () => openFile(rel) },
    { label: '在文件夹中显示', fn: () => post('/api/reveal', { rel }).catch((e) => toast(e.message, true)) },
    { sep: true },
    { label: '格式转换…', icon: PICON.sheet, fn: () => { S.sel = new Set([rel]); S.active = rel; renderList(); openConvert(); } },
  ];
  if (CTX_EDIT[ext]) {
    const key = (ext === 'xlsx' || ext === 'xlsm') ? 'editXlsx' : (ext === 'docx' ? 'editDocx' : 'editText');
    items.push({ label: CTX_EDIT[ext], fn: () => { S.active = rel; loadDetail(rel); setTimeout(() => { const b = document.querySelector('#detail [data-act="' + key + '"]'); if (b) b.click(); }, 260); } });
  }
  items.push({ sep: true });
  items.push({ label: '重命名', fn: () => askRename(rel) });
  items.push({ label: '移动到…', fn: () => askMove([rel]) });
  items.push({ label: '打标签…', fn: () => askTag([rel]) });
  items.push({ label: isFav ? '取消收藏' : '收藏', fn: () => post('/api/favs', { rel }).then(() => loadFacets()) });
  items.push({ label: '复制相对路径', fn: () => { navigator.clipboard && navigator.clipboard.writeText(rel); toast('已复制：' + rel); } });
  items.push({ sep: true });
  items.push({ label: '删除（进回收站）', danger: true, fn: () => askDelete([rel]) });
  return items;
}
function ctxForFolder(path) {
  return [
    { label: '进入这个文件夹', icon: PICON.folder, fn: () => enterFolder(path) },
    { label: '在资源管理器中打开', fn: () => post('/api/folders/reveal', { path }).catch((e) => toast(e.message, true)) },
    { sep: true },
    { label: '复制路径', fn: () => { navigator.clipboard && navigator.clipboard.writeText(path); toast('已复制：' + path); } },
  ];
}
function bindCtxMenu() {
  document.addEventListener('contextmenu', (ev) => {
    const row = ev.target.closest('#rows tr[data-rel], #rows tr.frow');
    if (!row) return;
    ev.preventDefault();
    if (row.classList.contains('frow')) { showCtx(ev.clientX, ev.clientY, ctxForFolder(row.dataset.path)); return; }
    const rel = row.dataset.rel;
    S.active = rel;
    if (!S.sel.has(rel)) { S.sel = new Set([rel]); }
    renderList(); loadDetail(rel);
    showCtx(ev.clientX, ev.clientY, ctxForFile(rel));
  });
  document.addEventListener('mousedown', (ev) => { if (!ev.target.closest('#ctxMenu')) hideCtx(); }, true);
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') hideCtx(); });
  window.addEventListener('blur', hideCtx);
  document.addEventListener('scroll', hideCtx, true);
}

/* -------- 资料库被外部改动时自动刷新（服务端 fs.watch + rev 计数） -------- */
let libRev = null;
let polling = false;
async function pollLibRev() {
  if (polling) return;
  polling = true;
  try {
    const s = await api('/api/status');
    const rev = s.rev || 0;
    if (libRev === null) { libRev = rev; return; }
    if (rev === libRev) return;
    libRev = rev;
    const keep = S.active;
    await loadFacets();
    await loadList();
    if (keep) {
      const still = (S.items || []).some((x) => x.rel === keep) || (S.folders || []).some((x) => x.path === keep);
      if (still) { S.active = keep; loadDetail(keep); }
      else {
        S.active = '';
        document.querySelector('#detail').innerHTML = '<div class="pv-note">这个文件已经不在原来的位置了（可能被移动或删除）</div>';
      }
    }
    toast('资料库有变化，已自动刷新');
  } catch (e) {
    /* 忽略：服务可能刚好在重启 */
  } finally {
    polling = false;
  }
}
setTimeout(() => { pollLibRev(); setInterval(pollLibRev, 3000); }, 2500);

/* ---------------- 生成考勤表 ---------------- */
const ATT = { days: new Set([6, 0]), blocks: [] };
function isAbsPath(p) {
  return /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\');
}

let ATTTPL = { key: '', info: null };
let attTplTimer = null;

function attTplQuery() {
  const v = $('#attTplPath').value.trim();
  if (!v) return '';
  return isAbsPath(v) ? 'path=' + encodeURIComponent(v) : 'rel=' + encodeURIComponent(v);
}

const ATT_FIELD_LABEL = { no: '序号', name: '姓名', phone: '电话', cls: '班级', sex: '性别' };

function attGridData() {
  const rows = [];
  document.querySelectorAll('#attGrid tbody tr').forEach((tr) => {
    const o = {};
    tr.querySelectorAll('td[data-f]').forEach((td) => { o[td.dataset.f] = td.textContent.trim(); });
    rows.push(o);
  });
  return rows;
}

function renderAttGrid() {
  const wrap = $('#attGridWrap');
  const table = $('#attGrid');
  const head = $('#attGridHead');
  if (!wrap || !table) return;
  const info = ATTTPL.info;
  const fields = (info && info.fields) || [];
  if (!fields.length) { wrap.style.display = 'none'; $('#attNames').style.display = ''; return; }
  const slots = Math.max(3, (info.rows || []).length, (info.slots || 0));
  const rows = [];
  for (let i = 0; i < slots; i++) rows.push((info.rows || [])[i] || {});
  const th = fields.filter((f) => f !== 'no').map((f) => '<th>' + (ATT_FIELD_LABEL[f] || f) + '</th>').join('');
  let html = '<thead><tr>' + (fields.indexOf('no') >= 0 ? '<th style="width:52px">序号</th>' : '') + th + '</tr></thead><tbody>';
  rows.forEach((r, i) => {
    html += '<tr>';
    if (fields.indexOf('no') >= 0) html += '<td class="attno">' + (i + 1) + '</td>';
    fields.filter((f) => f !== 'no').forEach((f) => {
      html += '<td data-f="' + f + '" contenteditable="true">' + esc(r[f] || '') + '</td>';
    });
    html += '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;
  const kinds = (info.blocksMeta || []).map((b) => (b.kind === 'sessions' ? '课次' : b.kind === 'weeks' ? '周区间' : '日网格'));
  head.textContent = '模板的列：' + fields.map((f) => ATT_FIELD_LABEL[f] || f).join(' / ') + '（日期版式：' + (kinds[0] || '日网格') + '）';
  wrap.style.display = 'block';
  $('#attNames').style.display = 'none';
  if ($('#attNamesLabel')) $('#attNamesLabel').textContent = '学生名单（照模板的「' + fields.map((f) => ATT_FIELD_LABEL[f] || f).join(' / ') + '」填）';
}

const WD_LABEL = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
const WD_ORDER = [1, 2, 3, 4, 5, 6, 0];

function blkDates(i) {
  const b = ATT.blocks[i] || {};
  const qs = 'weekdays=' + (b.weekdays || []).join(',') + '&interval=' + (b.interval || 1) +
    '&start=' + encodeURIComponent(b.startDate || '') + '&end=' + encodeURIComponent(b.endDate || '');
  return api('/api/attendance/schedule?' + qs).catch(() => ({ count: 0, dates: [] }));
}

async function refreshBlkDates(i) {
  const box = document.querySelector('.blk[data-i="' + i + '"] .blk-dates');
  if (!box) return;
  const r = await blkDates(i);
  const ds = (r.dates || []).map((d) => d.slice(5).replace('-', '/'));
  box.textContent = r.count
    ? ('共 ' + r.count + ' 次：' + ds.slice(0, 12).join('、') + (r.count > 12 ? ' … 最后一次 ' + ds[ds.length - 1] : ''))
    : '还没排到课：勾星期 + 填首课日';
}

function renderBlocks(info) {
  const wrap = $('#attBlocks');
  if (!wrap) return;
  const blocks = (info && info.blocks) || [];
  if (!blocks.length) { wrap.style.display = 'none'; ATT.blocks = []; return; }
  const fields = ((info && info.fields) || ['name']).filter((f) => f !== 'no');
  ATT.blocks = blocks.map((b) => {
    const wd = (typeof b.firstWeekday === 'number') ? [b.firstWeekday] : [];
    const prevCfg = (ATT.blocks && ATT.blocks[blocks.indexOf(b)]) || {};
    const start = prevCfg.startDate || b.firstIso || '';
    let end = '';
    if (start) {
      const d = new Date(start + 'T00:00:00');
      if (!isNaN(d)) { d.setMonth(d.getMonth() + 4); end = d.toISOString().slice(0, 10); }
    }
    const prev = ATT.blocks && ATT.blocks[blocks.indexOf(b)];
    const keep = (prev && Array.isArray(prev.students) && prev.students.length) ? prev.students : null;
    return {
      weekdays: (prevCfg.weekdays && prevCfg.weekdays.length) ? prevCfg.weekdays : wd,
      interval: prevCfg.interval || 1,
      startDate: start, endDate: prevCfg.endDate || end,
      kind: b.kind, slots: b.slots, cols: b.cols,
      students: keep || (b.rows || []).map((r) => ({ name: r.name || '', phone: r.phone || '', cls: r.cls || '', sex: r.sex || '' })),
    };
  });
  const kindsTxt = { sessions: '课次/日期', weeks: '周区间', day: '日网格' };
  let html = '';
  blocks.forEach((b, i) => {
    const cfg = ATT.blocks[i];
    const chips = WD_ORDER.map((w) =>
      '<button type="button" class="dchip2' + (cfg.weekdays.indexOf(w) >= 0 ? ' on' : '') +
      '" data-wd="' + w + '" data-i="' + i + '">' + WD_LABEL[w] + '</button>').join('');
    const th = fields.map((f) => '<th>' + (ATT_FIELD_LABEL[f] || f) + '</th>').join('');
    const rows = Math.max(2, cfg.students.length, b.slots || (b.nameRows || []).length);
    let body = '';
    for (let r = 0; r < rows; r++) {
      const st = cfg.students[r] || {};
      body += '<tr>' + fields.map((f) => '<td data-f="' + f + '" contenteditable="true">' + esc(st[f] || '') + '</td>').join('') +
        '<td class="rowdel" data-i="' + i + '" data-r="' + r + '" title="删掉这行">✕</td></tr>';
    }
    html += '<div class="blk" data-i="' + i + '">' +
      '<div class="blk-hd"><span class="bno">' + (i + 1) + '</span>第 ' + (i + 1) + ' 块' +
      '<span class="muted">（' + (kindsTxt[b.kind] || b.kind) + ' · ' + (b.slots != null ? b.slots : (b.nameRows || []).length) + ' 个学生位 · ' + (b.cols != null ? b.cols : (b.dayCols || []).length) + ' 次）</span>' +
      '<button class="btn sm blk-del" data-i="' + i + '">删掉这个班</button></div>' +
      '<div class="blk-row"><label>上课</label>' + chips + '</div>' +
      '<div class="blk-row"><label>间隔</label><select data-i="' + i + '" class="blk-intv">' +
      [1, 2, 3, 4].map((n) => '<option value="' + n + '"' + (n === 1 ? ' selected' : '') + '>' + (n === 1 ? '每周' : n === 2 ? '隔周' : '每 ' + n + ' 周') + '</option>').join('') +
      '</select><label>首课</label><input type="date" class="blk-start" data-i="' + i + '" value="' + (cfg.startDate || '') + '">' +
      '<label>结课</label><input type="date" class="blk-end" data-i="' + i + '"" value="' + (cfg.endDate || '') + '"></div>' +
      '<table class="attgrid blkgrid"><thead><tr>' + th + '<th style="width:34px"></th></tr></thead><tbody>' + body + '</tbody></table>' +
      '<div class="blk-tools"><button class="btn sm blk-addrow" data-i="' + i + '">＋ 加一行</button> <span class="muted">点格子直接改；行尾 ✕ 删掉这行</span></div>' +
      '<div class="blk-dates"></div>' +
      '</div>';
  });
  wrap.innerHTML = html;
  wrap.style.display = 'block';
  // 事件
  wrap.querySelectorAll('.dchip2').forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.i), w = Number(btn.dataset.wd);
      const cfg = ATT.blocks[i]; if (!cfg) return;
      const k = cfg.weekdays.indexOf(w);
      if (k >= 0) { if (cfg.weekdays.length > 1) cfg.weekdays.splice(k, 1); } else cfg.weekdays.push(w);
      btn.classList.toggle('on', cfg.weekdays.indexOf(w) >= 0);
      refreshBlkDates(i);
    };
  });
  wrap.querySelectorAll('.blk-intv').forEach((sel) => {
    sel.onchange = () => { const i = Number(sel.dataset.i); ATT.blocks[i].interval = Number(sel.value) || 1; refreshBlkDates(i); };
  });
  wrap.querySelectorAll('.blk-start').forEach((inp) => {
    inp.onchange = () => { const i = Number(inp.dataset.i); ATT.blocks[i].startDate = inp.value; refreshBlkDates(i); };
  });
  wrap.querySelectorAll('.blk-end').forEach((inp) => {
    inp.onchange = () => { const i = Number(inp.dataset.i); ATT.blocks[i].endDate = inp.value; refreshBlkDates(i); };
  });
  wrap.querySelectorAll('.blk-del').forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.i);
      if (ATT.blocks.length <= 1) return toast('至少留一个班块', true);
      ATT.blocks.splice(i, 1);
      renderBlocks({ blocks: ATT.blocks.map((b, k) => ({ i: k, kind: b.kind, slots: b.slots, cols: b.cols })) });
    };
  });
  wrap.querySelectorAll('.blk-addrow').forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.dataset.i);
      const blk = wrap.querySelector('.blk[data-i="' + i + '"]');
      const tb = blk && blk.querySelector('tbody');
      if (!tb) return;
      const fields = ((info && info.fields) || ['name']).filter((f) => f !== 'no');
      const tr = document.createElement('tr');
      const idx = tb.children.length;
      tr.innerHTML = fields.map((f) => '<td data-f="' + f + '" contenteditable="true"></td>').join('') +
        '<td class="rowdel" data-i="' + i + '" data-r="' + idx + '" title="删掉这行">✕</td>';
      tb.appendChild(tr);
    };
  });
  // 删除行：用事件委托，后加的「＋ 加一行」行也能删
  if (!wrap.dataset.delBound) {
    wrap.dataset.delBound = '1';
    const kill = (ev) => {
      const td = ev.target.closest && ev.target.closest('.rowdel');
      if (!td) return;
      ev.preventDefault();
      ev.stopPropagation();
      const tr = td.closest('tr');
      if (tr && tr.parentNode) tr.parentNode.removeChild(tr);
    };
    // mousedown 就办掉，避免先触发输入框 blur 导致整块重画
    wrap.addEventListener('mousedown', kill, true);
    wrap.addEventListener('click', (ev) => { if (ev.target.closest && ev.target.closest('.rowdel')) { ev.preventDefault(); ev.stopPropagation(); } }, true);
  }
  ATT.blocks.forEach((_, i) => refreshBlkDates(i));
}

function firstWeekdayInMonth(ym, wd) {
  const [y, m] = String(ym).split('-').map(Number);
  const d = new Date(y, m - 1, 1);
  while (d.getDay() !== wd) d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

function blocksData() {
  const out = [];
  const ym = ($('#attMonth') && $('#attMonth').value.trim()) || '';
  document.querySelectorAll('.attblocks .blk').forEach((el) => {
    const i = Number(el.dataset.i);
    const cfg = ATT.blocks[i] || {};
    const students = [];
    el.querySelectorAll('tbody tr').forEach((tr) => {
      const o = {};
      tr.querySelectorAll('td[data-f]').forEach((td) => { o[td.dataset.f] = td.textContent.trim(); });
      if ((o.name || '').trim()) students.push(o);
    });
    let start = cfg.startDate || '';
    if (cfg.autoStart && /^\d{4}-\d{1,2}$/.test(ym)) start = '';
    let end = cfg.endDate || '';
    const wd0 = (cfg.weekdays && cfg.weekdays.length) ? Number(cfg.weekdays[0]) : null;
    if (/^\d{4}-\d{1,2}$/.test(ym) && wd0 != null && (!start || start.slice(0, 7) !== ym)) {
      start = firstWeekdayInMonth(ym, wd0);
      const d2 = new Date(start + 'T00:00:00');
      d2.setMonth(d2.getMonth() + 4);
      end = d2.toISOString().slice(0, 10);
    }
    out.push({
      weekdays: cfg.weekdays || [], interval: cfg.interval || 1,
      startDate: start, endDate: end, students,
    });
  });
  return out;
}

function emptyBlock() {
  const d = new Date();
  const delta = (1 - ((d.getDay() + 6) % 7) + 7) % 7 || 7;
  d.setDate(d.getDate() + delta);
  return {
    weekdays: [1], interval: 1, startDate: d.toISOString().slice(0, 10), endDate: '', autoStart: true,
    kind: 'sessions', slots: 3, cols: 12,
    students: [{ name: '', phone: '', cls: '', sex: '' }, { name: '', phone: '', cls: '', sex: '' }, { name: '', phone: '', cls: '', sex: '' }],
  };
}

function syncStudentUI() {
  const hasBlocks = (ATT.blocks || []).length > 0;
  const hide = (sel) => { const el = $(sel); if (el) el.style.display = hasBlocks ? 'none' : ''; };
  hide('#attDays');
  hide('#attNames');
  hide('#attNamesLabel');
  if (hasBlocks) {
    const d = $('#attDays'); if (d && d.previousElementSibling) d.previousElementSibling.style.display = 'none';
    const n = $('#attNames'); if (n && n.previousElementSibling) n.previousElementSibling.style.display = 'none';
  } else {
    const d = $('#attDays'); if (d && d.previousElementSibling) d.previousElementSibling.style.display = '';
    const n = $('#attNames'); if (n && n.previousElementSibling) n.previousElementSibling.style.display = '';
  }
}

async function attAnalyse() {
  const qs = attTplQuery();
  if (!qs) {
    ATTTPL = { key: '', info: null };
    if (!ATT.blocks.length) ATT.blocks = [emptyBlock()];
    renderBlocks({ blocks: ATT.blocks.map((b, i) => ({ i, kind: 'sessions', slots: b.slots || 3, cols: b.cols || 12, rows: b.students })), fields: ['no', 'name', 'phone', 'cls', 'sex'] });
    if ($('#attBlocks')) $('#attBlocks').style.display = '';
    syncStudentUI();
    $('#attGridWrap').style.display = 'none';
    $('#attNames').style.display = 'none';
    if ($('#attTplInfo')) $('#attTplInfo').textContent = '不用模板：按自带样式生成（几个班块就出几张表）';
    if ($('#attNamesLabel')) $('#attNamesLabel').textContent = '名单在每个班块里填';
    return;
  }
  const info = $('#attTplInfo');
  ATTTPL = { key: qs, info: null };
  if (!qs) { info.textContent = ''; return; }
  info.textContent = '正在检测模板…';
  try {
    const r = await api('/api/attendance/template/analyse?' + qs);
    ATTTPL.info = r;
    if (!r.ok) {
      $('#attGridWrap').style.display = 'none'; $('#attNames').style.display = '';
      if ($('#attNamesLabel')) $('#attNamesLabel').textContent = '学生名单（一行一个名字）';
      info.innerHTML = '<span style="color:#c0392b">这个表里认不出考勤结构：需要一行「1 2 3 …」或「课次/日期」的日期格，再加一列「姓名」。请换一个模板。</span>';
      return;
    }
    const s = r.summary[0] || {};
    info.textContent = '检测到 ' + s.blocks + ' 个区块、' + s.slots + ' 个学生位、' + s.days + ' 个日期格（工作表：' + (r.sheetName || s.name) + '）';
    if (Array.isArray(r.blockList) && r.blockList.length) {
      ATTTPL.info = r;
      renderBlocks(Object.assign({}, r, { blocks: r.blockList }));
      $('#attGridWrap').style.display = 'none';
      $('#attNames').style.display = 'none';
      if ($('#attDaysRow')) $('#attDaysRow').style.display = 'none';
      if ($('#attNamesLabel')) $('#attNamesLabel').textContent = '名单在每个班块里填（模板有几个块就有几组）';
      const first = $('#attBlocks input, #attBlocks td[contenteditable]');
      if (first) first.focus();
      $('#attBlocks').scrollIntoView({ block: 'nearest' });
    } else {
      if ($('#attDaysRow')) $('#attDaysRow').style.display = '';
      renderAttGrid();
    }
  } catch (e) {
    info.innerHTML = '<span style="color:#c0392b">检测失败：' + esc(e.message) + '</span>';
  }
}


/* ---------- 拖一份名单/考勤照片进来，自动识别学生 ---------- */
function markMissingNames() {
  document.querySelectorAll('#attBlocks .blkgrid td[data-f="name"]').forEach((td) => {
    if (!td.textContent.trim()) td.classList.add('miss');
    else td.classList.remove('miss');
  });
}

function applyRoster(r) {
  const rows = (r && r.rows) || [];
  if (!rows.length) return toast('这个文件里没认出学生名字', true);
  const blocksOn = document.querySelectorAll('#attBlocks .blk').length > 0 && $('#attBlocks') && $('#attBlocks').style.display !== 'none';
  if (blocksOn) {
    let pi = 0;
    ATT.blocks.forEach((b, bi) => {
      const cap = Math.max(0, Number(b.slots || (b.students || []).length || 0));
      const take = rows.slice(pi, pi + cap);
      pi += take.length;
      b.students = take.map((x) => ({ name: x.name || '', phone: x.phone || '', cls: x.cls || '', sex: x.sex || '' }));
      while (b.students.length < cap) b.students.push({ name: '', phone: '', cls: '', sex: '' });
    });
    // 名单比所有班块的空位还多：直接往最后一个班块里续行，不丢人
    if (pi < rows.length && ATT.blocks.length) {
      const last = ATT.blocks[ATT.blocks.length - 1];
      for (const x of rows.slice(pi)) last.students.push({ name: x.name || '', phone: x.phone || '', cls: x.cls || '', sex: x.sex || '' });
      last.slots = Math.max(Number(last.slots || 0), last.students.length);
    }
    const meta = (ATTTPL && ATTTPL.info) || { blocks: ATT.blocks.map((b, i) => ({ i, kind: 'sessions', slots: b.slots || 3, cols: b.cols || 12 })), fields: ['no', 'name', 'phone', 'cls', 'sex'] };
    renderBlocks(meta);
    const miss = rows.filter((x) => !x.name).length;
    markMissingNames();
    toast('识别到 ' + rows.length + ' 个学生，已按班块填好' + (miss ? '；有 ' + miss + ' 行没认出名字，已用浅红标出，补一下' : ''));
    return;
  }
  const gridOn = $('#attGridWrap') && $('#attGridWrap').style.display !== 'none';
  if (gridOn) {
    const fields = ((ATTTPL.info && ATTTPL.info.fields) || []).filter((f) => f !== 'no');
    let html = '';
    const pad = Math.max(0, rows.length - (ATTTPL.info.rows || []).length);
    rows.forEach((it, i) => {
      html += '<tr>';
      if (((ATTTPL.info.fields) || []).indexOf('no') >= 0) html += '<td class="attno">' + (i + 1) + '</td>';
      fields.forEach((f) => { html += '<td data-f="' + f + '" contenteditable="true">' + esc(it[f] || '') + '</td>'; });
      html += '</tr>';
    });
    document.querySelector('#attGrid tbody').innerHTML = html;
    if (pad > 0) toast('识别到 ' + rows.length + ' 个学生，已填进表格');
    else toast('识别到 ' + rows.length + ' 个学生，已填进表格');
  } else {
    const ta = $('#attNames');
    ta.value = rows.map((x) => x.name).join('\n');
    toast('识别到 ' + rows.length + ' 个学生，已填进名单');
  }
}

async function handleRosterFile(f, box) {
  if (!f) return;
  const el = box || $('#attDrop');
  if (el) { el.classList.add('busy'); el.textContent = '正在识别 ' + f.name + ' …'; }
  try {
    const buf = await f.arrayBuffer();
    const r = await fetch('/api/roster/drop?name=' + encodeURIComponent(f.name || 'file'), { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf }).then((x) => x.json());
    if (!r.ok) throw new Error(r.error || '识别失败');
    applyRoster(r);
  } catch (err) {
    toast('识别失败：' + err.message, true);
  } finally {
    if (el) {
      el.classList.remove('busy');
      el.innerHTML = '把名单或考勤照片拖到这里，自动识别学生<span class="muted">（png / jpg / bmp / webp / xlsx / csv / pdf）</span>';
    }
  }
}

function bindAttDrop() {
  const box = $('#attDrop');
  if (!box) return;
  const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
  box.addEventListener('dragover', (e) => { stop(e); box.classList.add('hot'); });
  box.addEventListener('dragleave', (e) => { stop(e); box.classList.remove('hot'); });
  box.addEventListener('drop', (e) => {
    stop(e);
    box.classList.remove('hot');
    handleRosterFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0], box);
  });
  const dlg = document.querySelector('#maskAtt .dialog');
  if (dlg && !dlg.dataset.dropBound) {
    dlg.dataset.dropBound = '1';
    dlg.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('hot'); });
    dlg.addEventListener('dragleave', () => box.classList.remove('hot'));
    dlg.addEventListener('drop', (e) => {
      e.preventDefault();
      e.stopPropagation();
      box.classList.remove('hot');
      handleRosterFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0], box);
    });
  }
}

function bindAttTpl() {
  const tp = $('#attTplPath');
  if (tp) tp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); tp.value = cleanPath(tp.value); attAnalyse(); } };
  const el = $('#attTplPath');
  if (!el) return;
  el.oninput = () => {
    clearTimeout(attTplTimer);
    attTplTimer = setTimeout(attAnalyse, 500);
  };
  $('#attTplPick').onclick = () => {
    openPickerDispatch((picked) => {
      if (!picked) return;
      el.value = picked;
      attAnalyse();
    }, { ext: 'xlsx,xls,xlsm' });
  };
}

let ATT_PLANS = [];

async function loadPlans() {
  try {
    const r = await api('/api/attendance/plans');
    ATT_PLANS = r.plans || [];
  } catch (e) { ATT_PLANS = []; }
  renderPlans();
}

function renderPlans() {
  const box = $('#planList');
  if (!box) return;
  if (!ATT_PLANS.length) {
    box.innerHTML = '<div class="muted" style="padding:6px 2px">还没有方案。填好下面的内容，点「存为方案」，以后每个月点一下就行。</div>';
    return;
  }
  box.innerHTML = ATT_PLANS.map((p) => {
    const tpl = String(p.tplPath || p.tplRel || '').split(/[\\/]/).pop();
    const n = (p.students || []).length;
    return '<div class="plan-item" data-id="' + esc(p.id) + '">' +
      '<div class="pi-main"><b>' + esc(p.name) + '</b>' +
      '<span>' + esc(tpl || '无模板') + ' · ' + n + ' 人' + (p.org ? ' · ' + esc(p.org) : '') + '</span></div>' +
      '<button class="btn sm primary" data-run="' + esc(p.id) + '">生成本月</button>' +
      '<button class="btn sm" data-edit="' + esc(p.id) + '">填入设置</button>' +
      '<button class="btn sm" data-del="' + esc(p.id) + '">删</button>' +
      '</div>';
  }).join('');
  box.querySelectorAll('[data-run]').forEach((b) => {
    b.onclick = () => runPlan(b.dataset.run);
  });
  box.querySelectorAll('[data-edit]').forEach((b) => {
    b.onclick = () => fillPlan(b.dataset.edit);
  });
  box.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = async () => {
      const r = await post('/api/attendance/plans/delete', { id: b.dataset.del });
      ATT_PLANS = r.plans || [];
      renderPlans();
      toast('已删除方案');
    };
  });
}

function fillPlan(id) {
  const p = ATT_PLANS.find((x) => x.id === id);
  if (!p) return;
  if (p.tplPath) $('#attTplPath').value = p.tplPath;
  else if (p.tplRel) $('#attTplPath').value = p.tplRel;
  $('#attCourse').value = p.course || '';
  $('#attOrg').value = p.org || '';
  $('#planName').value = p.name || '';
  if (Array.isArray(p.weekdays) && p.weekdays.length) { ATT.days = new Set(p.weekdays); renderDayChips(); }
  attAnalyse().then(() => {
    if (Array.isArray(p.blocks) && p.blocks.length) {
      p.blocks.forEach((bp, i) => {
        if (!ATT.blocks[i]) return;
        ATT.blocks[i].weekdays = new Set(Array.isArray(bp.weekdays) ? bp.weekdays : []);
        ATT.blocks[i].interval = bp.interval || 1;
        ATT.blocks[i].startDate = bp.startDate || ATT.blocks[i].startDate;
        ATT.blocks[i].endDate = bp.endDate || ATT.blocks[i].endDate;
        ATT.blocks[i].students = Array.isArray(bp.students) ? bp.students.map((x) => Object.assign({}, x)) : [];
        refreshBlkDates(i);
      });
      renderBlocks({ blocks: ATT.blocks.map((b, i) => ({ i, kind: b.kind, slots: b.slots, cols: b.cols })) });
    } else if (Array.isArray(p.students) && p.students.length) {
      ATT.students = p.students;
      renderAttGrid();
    }
  });
  toast('已填入「' + p.name + '」的设置，可改完再生成');
}

async function savePlan() {
  const name = ($('#planName').value || '').trim();
  if (!name) { toast('先给方案起个名字', true); $('#planName').focus(); return; }
  const bodies = attGridData();
  const payload = {
    name,
    tplPath: isAbsPath($('#attTplPath').value) ? $('#attTplPath').value.trim() : '',
    tplRel: isAbsPath($('#attTplPath').value) ? '' : $('#attTplPath').value.trim(),
    course: $('#attCourse').value.trim(),
    org: $('#attOrg').value.trim(),
    weekdays: Array.from(ATT.days),
    students: bodies,
    blocks: blocksData(),
  };
  const r = await post('/api/attendance/plans', payload);
  ATT_PLANS = r.plans || [];
  renderPlans();
  toast('已存为方案「' + name + '」，以后点「生成本月」就行');
}

async function runPlan(id) {
  const plan = ATT_PLANS.find((x) => x.id === id);
  if (!plan) return;
  const month = ($('#attMonth').value || '').trim();
  if (!/^\d{4}-\d{1,2}$/.test(month)) { toast('月份格式应为 2026-11', true); return; }
  const btn = document.querySelector('[data-run="' + id + '"]');
  if (btn) { btn.disabled = true; btn.textContent = '生成中…'; }
  try {
    const r = await post('/api/attendance/plans/run', { id, month });
    toast('已生成：' + r.rel);
    S.q = r.rel.split('/').pop().replace(/\.xlsx$/i, '');
    $('#maskAtt').classList.remove('show');
    loadFacets(); loadList();
  } catch (e) {
    toast('生成失败：' + e.message, true);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '生成本月'; }
  }
}

async function loadBuiltinTemplates() {
  const sel = $('#attTplBuiltin');
  if (!sel) return;
  try {
    const r = await api('/api/attendance/templates');
    const items = (r && r.items) || [];
    sel.innerHTML = '<option value="">不用模板（用自带样式）</option>' + items.map((t, i) =>
      '<option value="' + i + '">' + t.name + '</option>').join('');
    sel.dataset.items = JSON.stringify(items.map((t) => ({ name: t.name, path: t.path })));
    sel.onchange = () => {
      const list = JSON.parse(sel.dataset.items || '[]');
      const it = list[Number(sel.value)];
      if (!it) return;
      $('#attTplPath').value = it.path;
      $('#attTplPath').dispatchEvent(new Event('input', { bubbles: true }));
    };
  } catch (e) {}
}

function openAttendance() {
  ATT.blocks = [];
  const m = new Date();
  const mm = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0');
  $('#attMonth').value = mm;
  $('#attCourse').value = '机器人';
  $('#attOrg').value = '';
  $('#attNames').value = '';
  $('#attGridWrap').style.display = 'none';
  $('#attNames').style.display = '';
  if ($('#attAddRow')) $('#attAddRow').onclick = () => {
    const tb = document.querySelector('#attGrid tbody');
    if (!tb) return;
    const fields = ((ATTTPL.info && ATTTPL.info.fields) || []).filter((f) => f !== 'no');
    const tr = document.createElement('tr');
    let h = '';
    if ((ATTTPL.info.fields || []).indexOf('no') >= 0) h += '<td class="attno">' + (tb.children.length + 1) + '</td>';
    fields.forEach((f) => { h += '<td data-f="' + f + '" contenteditable="true"></td>'; });
    tr.innerHTML = h;
    tb.appendChild(tr);
  };
  ATT.days = new Set([6, 0]);
  renderDayChips();
  const picks = [...(S.sel || [])];
  const cand = picks.length === 1 ? picks[0] : (picks.length === 0 ? S.active : '');
  $('#attTplPath').value = cand && /\.xlsx$/i.test(cand) ? cand : '';
  attAnalyse();
  bindAttDrop();
  loadPlans();
  loadBuiltinTemplates().then(() => {
    if (!$('#attTplPath').value.trim()) attAnalyse();
    if (false) {
      const sel = $('#attTplBuiltin');
      if (sel && sel.options.length > 1) {
        sel.value = '0';
        sel.dispatchEvent(new Event('change'));
      }
    }
  });
  ATT.mode = 'student';
  if (typeof bindAttMode === 'function') bindAttMode();
  if (typeof switchAttMode === 'function') switchAttMode('student');
  $('#maskAtt').classList.add('show');
  setTimeout(() => $('#attCourse').focus(), 50);
}
function renderDayChips() {
  const names = ['一', '二', '三', '四', '五', '六', '日'];
  const box = $('#attDays');
  box.innerHTML = '';
  names.forEach((t, i) => {
    const wd = (i + 1) % 7;
    const el = document.createElement('button');
    el.className = 'dchip' + (ATT.days.has(wd) ? ' on' : '');
    el.textContent = '周' + t;
    el.onclick = () => {
      if (ATT.days.has(wd)) ATT.days.delete(wd); else ATT.days.add(wd);
      renderDayChips();
    };
    box.appendChild(el);
  });
}
async function submitAttendance() {
  if (ATT.mode === 'teacher' && typeof submitTeacher === 'function') return submitTeacher();
  if (ATT.mode === 'campus' && typeof submitCampus === 'function') return submitCampus();
  const month = $('#attMonth').value.trim();
  const tplVal = $('#attTplPath').value.trim();
  const tutor = ($('#attTutor') && $('#attTutor').value.trim()) || '';
  if (!tplVal) {
    const blocks0 = blocksData();
    if (!blocks0.some((b) => (b.students || []).length)) { toast('每个班块至少要填一个学生', true); return; }
    const r0 = await post('/api/attendance/student', {
      month, course: $('#attCourse').value.trim(), org: $('#attOrg').value.trim(), tutor, blocks: blocks0,
    });
    $('#maskAtt').classList.remove('show');
    S.q = r0.name; await loadFacets(); await loadList();
    toast('已生成：' + r0.name);
    return;
  }
  const blocks = (document.querySelectorAll('.attblocks .blk').length && $('#attBlocks') && $('#attBlocks').style.display !== 'none')
    ? blocksData() : null;
  const useGrid = $('#attGridWrap') && $('#attGridWrap').style.display !== 'none';
  const students = blocks ? blocks.reduce((a, b) => a.concat(b.students), [])
    : (useGrid ? attGridData().filter((x) => (x.name || '').trim()) : []);
  const names = useGrid
    ? students.map((x) => x.name)
    : $('#attNames').value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (!/^\d{4}-\d{1,2}$/.test(month)) return toast('月份要写成 2026-11 这种格式', true);
  if (!names.length && !(blocks && blocks.some((b) => (b.students || []).length))) return toast('先填学生名单，一行一个', true);
  if (!blocks && !ATT.days.size) return toast('至少选一个上课的星期', true);
  const btn = $('#attOk');
  btn.disabled = true; btn.textContent = '生成中…';
  try {
    const payload = {
      tutor,
      month, names, students, weekdays: [...ATT.days], blocks: blocks || [],
      course: $('#attCourse').value.trim(), org: $('#attOrg').value.trim(),
    };
    let r;
    if (tplVal) {
      const extra = isAbsPath(tplVal) ? { path: tplVal } : { rel: tplVal };
      r = await post('/api/attendance/template', Object.assign(extra, payload));
    } else {
      r = await post('/api/attendance', payload);
    }
    if (r.overflow) toast('模板学生位只有 ' + r.slots + ' 个，多出的 ' + r.overflow + ' 人没写进去', true);
    $('#maskAtt').classList.remove('show');
    toast('已生成：' + r.name);
    S.q = r.name.replace(/\.xlsx$/, '');
    $('#q').value = S.q;
    S.dir = ''; S.active = r.rel;
    await loadFacets(); await loadList(); await loadDetail(r.rel);
  } catch (e) {
    toast(e.message, true);
  } finally {
    btn.disabled = false; btn.textContent = '生成';
  }
}

/* ---------------- 格式转换 ---------------- */
const CONV = { rels: [], timer: null, busy: false, fmt: '', fmtLabel: '', lastFile: '', outDir: '' };
function convTargetRels() {
  const picked = [...S.sel];
  if (picked.length) return picked;
  if (S.active) return [S.active];
  return [];
}
function openConvert(presetFmt) {
  const rels = convTargetRels();
  CONV.rels = rels;
  CONV.fmt = '';
  CONV.fmtLabel = '';
  const list = $('#convList');
  if (!rels.length) {
    list.innerHTML = '<span class="muted">还没选文件。关掉这里，在中间列表勾选几个文件（或先点开一个文件）再回来。</span>';
  } else {
    list.innerHTML = rels.slice(0, 12).map((r) => {
      const nm = r.split('/').pop();
      const ext = convExt(r);
      return '<div class="convpool-item"><span class="ext-badge">' + esc(ext.toUpperCase() || '?') + '</span><span class="nm">' + esc(nm) + '</span></div>';
    }).join('') + (rels.length > 12 ? '<div class="muted">… 还有 ' + (rels.length - 12) + ' 个</div>' : '');
  }
  $('#convCount').textContent = rels.length ? '（' + rels.length + ' 个）' : '';
  $('#convHint').textContent = '';
  $('#convBar').style.display = 'none';
  $('#convStart').disabled = rels.length === 0;
  $('#convStart').textContent = '开始转换';
  renderConvAll('');
  $('#convResults').classList.remove('show');
  $('#convSearch').value = '';
  renderConvChips(rels);
  if (presetFmt) { const c = document.querySelector('#convChips .chip[data-fmt="'+presetFmt+'"]'); if (c) c.click(); }
  loadConvMore().then(() => {
    renderConvAll($('#convSearch').value || '');
  });
  $('#maskConv').classList.add('show');
}

const CONV_COMMON = ['pdf', 'png', 'docx', 'xlsx', 'txt', 'csv'];
const CONV_SCENES = [
  { fmt: 'pdf',  t: 'PDF',        n: '打印、发给别人，排版不会乱' },
  { fmt: 'png',  t: '图片',       n: '发微信、贴到 PPT 里' },
  { fmt: 'jpg',  t: '照片 JPG',   n: '手机上都能打开' },
  { fmt: 'docx', t: 'Word 文档',  n: '可以用 Word 打开继续改' },
  { fmt: 'xlsx', t: 'Excel 表格', n: '表格数据，能继续算' },
  { fmt: 'txt',  t: '纯文字',     n: '只留文字，最干净' },
  { fmt: 'mp4',  t: '视频 MP4',   n: '发到微信、手机上都能播' },
  { fmt: 'mp3',  t: '音频 MP3',   n: '存手机里听' },
  { fmt: 'epub', t: '电子书',     n: '手机上像看书一样翻' },
  { fmt: 'html', t: '网页',       n: '浏览器双击就能看' },
  { fmt: 'csv',  t: 'CSV 表格数据', n: '给别的软件读' },
];
const CONV_ASK = {
  '图片': ['png', 'jpg', 'webp', 'gif', 'ico', 'bmp', 'tiff', 'avif'],
  '照片': ['jpg', 'png', 'webp'],
  '视频': ['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif'],
  '音乐': ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
  '音频': ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a'],
  '电子书': ['epub', 'mobi', 'azw3', 'fb2', 'txt'],
  '看书': ['epub', 'mobi', 'azw3'],
  '网页': ['html', 'htm'],
  '压缩包': ['zip', '7z', 'rar', 'tar', 'gz'],
  'word': ['docx', 'doc'],
  'excel': ['xlsx', 'xls', 'csv'],
  'ppt': ['pptx', 'ppt'],
  '图标': ['ico', 'png'],
  'gif': ['gif'],
  '打印': ['pdf'],
};
function convAllowedFor(rels) {
  if (!rels.length) return new Set();
  let acc = null;
  rels.forEach((r) => {
    const t = new Set(convTargetsFor(convExt(r)));
    acc = acc ? new Set([...acc].filter((x) => t.has(x))) : t;
  });
  return acc || new Set();
}
function renderConvChips(rels) {
  const box = $('#convChips');
  const allow = convAllowedFor(rels);
  if (!rels.length) { box.innerHTML = '<span class="muted">还没有选文件</span>'; return; }
  const usable = CONV_SCENES.filter((c) => allow.has(c.fmt));
  if (!usable.length) {
    box.innerHTML = '<span class="muted">这些文件之间没有共同的转换目标，分开转试试。</span>';
    return;
  }
  box.innerHTML = usable.map((c, i) =>
    '<button type="button" class="chip scene' + (i === 0 ? ' on' : '') + '" data-fmt="' + c.fmt + '">' +
    '<b>' + esc(c.t) + '</b><span>' + esc(c.n) + '</span></button>'
  ).join('');
  CONV.fmt = usable[0].fmt;
  CONV.fmtLabel = usable[0].t;
  box.querySelectorAll('[data-fmt]').forEach((b) => {
    b.onclick = () => {
      box.querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      const c = usable.find((u) => u.fmt === b.dataset.fmt);
      CONV.fmt = b.dataset.fmt;
      CONV.fmtLabel = c ? c.t : b.dataset.fmt;
      $('#convStart').textContent = '开始转换（' + CONV.fmtLabel + '）';
    };
  });
  $('#convStart').textContent = '开始转换（' + CONV.fmtLabel + '）';
}
function renderConvSearch(q) {
  renderConvAll(q);
  const box = $('#convResults');
  box.classList.remove('show');
  box.innerHTML = '';
}

// 全部可选格式（点到哪个就是目标）
const CONV_PRIORITY = ['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'csv', 'png', 'jpg', 'webp', 'mp4', 'mp3', 'epub', 'html'];
function convRank(id) {
  const k = String(id).toLowerCase();
  const i = CONV_PRIORITY.indexOf(k);
  return i < 0 ? 50 : i;
}

function renderConvAll(q) {
  const box = $('#convAll');
  if (!box) return;
  const raw = String(q || '').trim();
  const kw = raw.toLowerCase();
  const list = FE_FORMATS || [];
  const byId = new Map(list.map((f) => [String(f.id).toLowerCase(), f]));
  let items = list;
  let aliasHit = '';
  if (kw) {
    items = list.filter((f) => (f.name || '').toLowerCase().includes(kw) || (f.id || '').toLowerCase().includes(kw));
    if (!items.length) {
      const key = Object.keys(CONV_ASK).find((k) => k.includes(kw) || kw.includes(k));
      if (key) {
        aliasHit = key;
        items = CONV_ASK[key].map((id) => byId.get(id)).filter(Boolean);
      }
    }
  }
  items = items.slice().sort((x, y) => convRank(x.id) - convRank(y.id));
  const cnt = $('#convAllCount');
  if (cnt) cnt.textContent = aliasHit ? ('（「' + aliasHit + '」相关的 ' + items.length + ' 种）') : ('（' + items.length + ' 种，点一下就选定）');
  if (!items.length) {
    box.innerHTML = '<div class="muted" style="padding:6px">没找到「' + esc(raw) + '」，换个说法试试：图片 / 视频 / 音乐 / 电子书 / 网页。</div>';
    return;
  }
  box.innerHTML = items.map((f) =>
    '<button type="button" class="fchip' + (CONV.fmt === f.id ? ' on' : '') + '" data-fmt="' + esc(f.id) + '" title=".' + esc(f.id) + '">' +
    esc(f.name || String(f.id).toUpperCase()) + '<span>.' + esc(f.id) + '</span></button>'
  ).join('');
  box.querySelectorAll('[data-fmt]').forEach((b) => {
    b.onclick = () => {
      box.querySelectorAll('.fchip').forEach((x) => x.classList.remove('on'));
      b.classList.add('on');
      $('#convChips').querySelectorAll('.chip').forEach((x) => x.classList.remove('on'));
      CONV.fmt = b.dataset.fmt;
      CONV.fmtLabel = b.textContent.replace(/\.[a-z0-9]+$/i, '').trim() || b.dataset.fmt;
      $('#convStart').textContent = '开始转换（' + CONV.fmtLabel + '）';
      $('#convStart').disabled = false;
    };
  });
}
function convExt(rel) {
  const nm = String(rel || '').split('/').pop();
  const i = nm.lastIndexOf('.');
  return i < 0 ? '' : nm.slice(i + 1).toLowerCase();
}
const CONV_TEXT_EXT = ['txt', 'md', 'json', 'log', 'ini', 'xml', 'html', 'htm', 'py', 'js', 'ts', 'c', 'h', 'java', 'css', 'sql', 'yml', 'yaml', 'csv'];
const CONV_IMG_EXT = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tif', 'tiff', 'ico', 'heic', 'avif'];
const CONV_LABEL = {
  pdf: ['PDF', '打印、发给别人都不会乱'],
  png: ['图片', '发微信、贴到 PPT 里'],
  jpg: ['照片', '手机都能打开'],
  docx: ['Word 文档', '可以用 Word 继续改'],
  xlsx: ['Excel 表格', '表格数据，能继续算'],
  txt: ['纯文字', '只留文字，最干净'],
  csv: ['CSV 表格', '给别的软件读'],
  mp4: ['视频', '发到微信、手机能播'],
  mp3: ['音频', '存手机里听'],
  epub: ['电子书', '手机上像看书一样翻'],
  html: ['网页', '浏览器双击可看'],
};

function convShowTask(title, line, pct) {
  const bar = $('#taskbar');
  if (!bar) return;
  bar.classList.add('show');
  $('#tbTitle').textContent = title || '格式转换';
  $('#tbLine').textContent = line || '';
  const fill = $('#tbFill');
  if (fill) fill.style.width = Math.max(2, Math.min(100, pct || 0)) + '%';
}
function convHideTask() {
  const bar = $('#taskbar');
  if (bar) bar.classList.remove('show');
}
function convTargetsFor(ext) {
  if (ext === 'pdf') return ['png', 'docx', 'txt'];
  if (CONV_IMG_EXT.includes(ext)) return ['docx', 'pdf', 'png'];
  if (ext === 'docx' || ext === 'doc' || ext === 'rtf') return ['pdf', 'png', 'txt'];
  if (ext === 'xlsx' || ext === 'xls') return ['pdf', 'png', 'csv'];
  if (ext === 'pptx' || ext === 'ppt') return ['pdf', 'png', 'docx'];
  if (ext === 'csv') return ['xlsx', 'docx', 'pdf'];
  if (CONV_TEXT_EXT.includes(ext)) return ['docx', 'pdf', 'xlsx', 'png'];
  return [];
}
let FE_FORMATS = null;
async function loadConvMore() {
  if (FE_FORMATS && FE_FORMATS.length) return FE_FORMATS;
  try {
    const d = await api('/api/filee/formats');
    FE_FORMATS = (d && d.available) ? (d.formats || []) : [];
  } catch (e) {
    FE_FORMATS = [];
  }
  return FE_FORMATS;
}
async function startConvertFilee(rels, fmt) {
  if (CONV.busy) return;
  CONV.busy = true;
  const btn = $('#convStart');
  btn.disabled = true; btn.textContent = '转换中…';
  $('#convBar').style.display = 'block';
  $('#convBar').firstElementChild.style.width = '0%';
  $('#convHint').textContent = '正在启动 Filee 引擎…';
  try {
    await post('/api/filee/convert', { rels, to: fmt });
  } catch (e) {
    CONV.busy = false; btn.disabled = false; btn.textContent = '开始转换';
    return toast(e.message, true);
  }
  CONV.timer = setInterval(async () => {
    let s;
    try { s = (await api('/api/filee/status')).state; } catch (_) { return; }
    const pct = s.total ? Math.round((s.done / s.total) * 100) : 0;
    $('#convBar').firstElementChild.style.width = pct + '%';
    $('#convHint').textContent = s.running
      ? '正在转换 ' + Math.min(s.done + 1, s.total) + '/' + s.total + ' → .' + s.fmt
      : '完成：生成 ' + s.files.length + ' 个文件，放在 D:\\课程文件库\\导出';
    if (!s.running) {
      clearInterval(CONV.timer); CONV.timer = null;
      CONV.busy = false;
      btn.disabled = false; btn.textContent = '再转一批';
      if ($('#convOpen')) $('#convOpen').style.display = 'inline';
      if (s.errors && s.errors.length) {
        $('#convHint').textContent += '；失败 ' + s.errors.length + ' 个：' + s.errors.map((e) => e.rel + '（' + e.message + '）').join('；');
      }
      toast('转换完成，结果在「导出」文件夹');
    }
  }, 700);
}

async function startConvert() {
  if (CONV.busy) return;
  const rels = CONV.rels || [];
  if (!rels.length) return toast('先在列表里勾选文件', true);
  const fmt = CONV.fmt;
  if (!fmt) return toast('先选一个目标格式', true);
  const local = ['pdf', 'png', 'docx', 'xlsx', 'txt', 'csv'].includes(fmt);
  const useLocal = local && convAllowedFor(rels).has(fmt);
  if (!useLocal) return startConvertFilee(rels, fmt).catch(() => {});
  CONV.busy = true;
  const btn = $('#convStart');
  btn.disabled = true;
  btn.textContent = '转换中…';
  convShowTask('格式转换', '正在启动…', 4);
  try {
    await post('/api/convert', { rels, to: fmt, width: 1600 });
  } catch (e) {
    CONV.busy = false; btn.disabled = false; btn.textContent = '开始转换';
    convHideTask();
    return toast(e.message, true);
  }
  const t0 = Date.now();
  CONV.timer = setInterval(async () => {
    let st;
    try { st = await api('/api/convert/status'); } catch (_) { return; }
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    convShowTask('格式转换', '正在转换 ' + Math.min(st.done + 1, st.total) + '/' + st.total + (st.current ? '：' + st.current : ''), pct);
    if (!st.running) {
      clearInterval(CONV.timer); CONV.timer = null; CONV.busy = false;
      const outs = st.files || [];
      const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
      convShowTask('转换完成', '生成 ' + outs.length + ' 个文件 · 用时 ' + secs + ' 秒', 100);
      toast('转换完成：' + outs.length + ' 个文件（已进资料库）');
      refreshAfterConvert(outs);
      btn.textContent = '再转一批';
      if (st.errors && st.errors.length) {
        convShowTask('部分失败', st.errors.map((e) => e.rel + '：' + e.error).join('；'), 100);
      }
    }
  }, 700);
}

async function startConvertFilee(rels, fmt) {
  if (CONV.busy) return;
  CONV.busy = true;
  const btn = $('#convStart');
  btn.disabled = true;
  btn.textContent = '转换中…';
  convShowTask('格式转换', '正在启动 Filee 引擎…', 4);
  try {
    await post('/api/filee/convert', { rels, to: fmt });
  } catch (e) {
    CONV.busy = false; btn.disabled = false; btn.textContent = '开始转换';
    convHideTask();
    return toast(e.message, true);
  }
  const t0 = Date.now();
  CONV.timer = setInterval(async () => {
    let st;
    try { st = (await api('/api/filee/status')).state; } catch (_) { return; }
    const pct = st.total ? Math.round((st.done / st.total) * 100) : 0;
    convShowTask('格式转换', '正在转换 ' + Math.min(st.done, st.total) + '/' + st.total + ' → .' + st.fmt, pct);
    if (!st.running) {
      clearInterval(CONV.timer); CONV.timer = null; CONV.busy = false;
      const secs = Math.max(1, Math.round((Date.now() - t0) / 1000));
      convShowTask('转换完成', '生成 ' + (st.files || []).length + ' 个文件 · 用时 ' + secs + ' 秒', 100);
      refreshAfterConvert(st.files || []);
      btn.textContent = '再转一批';
      if (st.errors && st.errors.length) {
        convShowTask('部分失败', st.errors.map((e) => e.rel + '：' + (e.message || e.error || '')).join('；'), 100);
      }
    }
  }, 700);
}

function refreshAfterConvert(files) {
  CONV.lastFile = (files && files[0]) || '';
  CONV.outDir = CONV.lastFile ? String(CONV.lastFile).replace(/[\\/][^\\/]*$/, '') : '';
  loadList();
  loadFacets();
}

/* ===== 三种考勤表：学生 / 教师 / 校区 ===== */
function attNextMonday() {
  const d = new Date();
  const wd = d.getDay();
  const add = (8 - wd) % 7 || 7;
  d.setDate(d.getDate() + add);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function renderTDays() {
  const box = $('#attTDays');
  if (!box) return;
  if (!box) return;
  if (!ATT.tdays) ATT.tdays = new Set([1, 2, 3, 4, 5]);
  box.innerHTML = WD_ORDER.map((w) =>
    '<button type="button" class="dchip' + (ATT.tdays.has(w) ? ' on' : '') + '" data-wd="' + w + '">' + WD_LABEL[w] + '</button>').join('');
  box.querySelectorAll('.dchip').forEach((b) => {
    b.onclick = () => {
      const w = Number(b.dataset.wd);
      if (ATT.tdays.has(w)) { if (ATT.tdays.size > 1) ATT.tdays.delete(w); } else ATT.tdays.add(w);
      b.classList.toggle('on', ATT.tdays.has(w));
    };
  });
}

function bindAttMode() {
  const ab = document.getElementById('attAddBlock');
  if (ab && !ab.dataset.bound) {
    ab.dataset.bound = '1';
    ab.onclick = () => {
      ATT.blocks.push(emptyBlock());
      renderBlocks({ blocks: ATT.blocks.map((b, i) => ({ i, kind: 'sessions', slots: b.slots || 3, cols: b.cols || 12 })), fields: ['no', 'name', 'phone', 'cls', 'sex'] });
      syncStudentUI();
      toast('已加一个班块，记得填它的名单和上课星期');
    };
  }
  const box = $('#attMode');
  if (!box) return;
  if (!box.dataset.bound) {
    box.dataset.bound = '1';
    box.querySelectorAll('.amode').forEach((b) => { b.onclick = () => switchAttMode(b.dataset.mode); });
  }
  if (!ATT.tdays) ATT.tdays = new Set([1, 2, 3, 4, 5]);
  renderTDays();
  if ($('#attCStart') && !$('#attCStart').value) $('#attCStart').value = attNextMonday();
  if ($('#attCWeeks') && !$('#attCWeeks').value) $('#attCWeeks').value = '20';
}

function switchAttMode(m) {
  ATT.mode = m || 'student';
  document.querySelectorAll('#attMode .amode').forEach((b) => b.classList.toggle('on', b.dataset.mode === ATT.mode));
  const pane = { student: '#paneStudent', teacher: '#paneTeacher', campus: '#paneCampus' };
  Object.keys(pane).forEach((k) => { const el = $(pane[k]); if (el) el.style.display = k === ATT.mode ? '' : 'none'; });
  if ($('#attPlanBox')) $('#attPlanBox').style.display = ATT.mode === 'student' ? '' : 'none';
  if ($('#attMonthRow')) $('#attMonthRow').style.display = ATT.mode === 'campus' ? '' : '';
  if ($('#attMonth')) $('#attMonth').style.display = ATT.mode === 'campus' ? 'none' : '';
  const ok = $('#attOk');
  if (ok) ok.textContent = ATT.mode === 'teacher' ? '生成教师考勤表' : ATT.mode === 'campus' ? '生成校区考勤表' : '生成';
}

async function submitTeacher() {
  const month = $('#attMonth').value.trim();
  if (!/^\d{4}-\d{1,2}$/.test(month)) return toast('月份要写成 2026-11 这种格式', true);
  const names = $('#attTNames').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!names.length) return toast('先填老师名单，一行一个', true);
  const btn = $('#attOk');
  btn.disabled = true; btn.textContent = '生成中…';
  try {
    const r = await post('/api/attendance/teacher', {
      month, names,
      holiday: Number(($('#attTHoliday').value || '').trim()) || 0,
      dutyDays: Number(($('#attTDuty').value || '').trim()) || 0,
      course: $('#attCourse').value.trim(), org: $('#attOrg').value.trim(),
    });
    $('#maskAtt').classList.remove('show');
    toast('已生成：' + r.name);
    S.q = String(r.name).replace(/\.xlsx$/, '');
    $('#q').value = S.q;
    loadFacets(); loadList();
  } catch (e) {
    toast('生成失败：' + e.message, true);
  } finally {
    btn.disabled = false; switchAttMode(ATT.mode);
  }
}

async function submitCampus() {
  const startDate = ($('#attCStart').value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return toast('首周周一要选日期，例如 2026-09-07', true);
  const weeks = Number($('#attCWeeks').value) || 20;
  const names = $('#attCNames').value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean);
  if (!names.length) return toast('先填学生名单，一行一个', true);
  const btn = $('#attOk');
  btn.disabled = true; btn.textContent = '生成中…';
  try {
    const r = await post('/api/attendance/campus', {
      startDate, weeks, names,
      course: $('#attCourse').value.trim(), org: $('#attOrg').value.trim(),
    });
    $('#maskAtt').classList.remove('show');
    toast('已生成：' + r.name);
    S.q = String(r.name).replace(/\.xlsx$/, '');
    $('#q').value = S.q;
    loadFacets(); loadList();
  } catch (e) {
    toast('生成失败：' + e.message, true);
  } finally {
    btn.disabled = false; switchAttMode(ATT.mode);
  }
}
