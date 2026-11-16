/* 统一文件/文件夹选择器（仿 Windows「打开」对话框） */
(function () {
  if (window.openPickerShared) return;
  const fmtSize = (n) => {
    if (!n) return '';
    if (n < 1024) return n + ' 字节';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    if (n < 1024 * 1024 * 1024) return (n / 1048576).toFixed(1) + ' MB';
    return (n / 1073741824).toFixed(2) + ' GB';
  };
  const fmtDate = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    const p = (n) => String(n).padStart(2, '0');
    return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  };
  const EXT_LABEL = { xlsx: 'Excel 工作表', xls: 'Excel 97-2003 工作表', xlsm: 'Excel 启用宏的工作表', csv: 'CSV 文件', docx: 'Word 文档', doc: 'Word 97-2003 文档', pdf: 'PDF 文档', pptx: 'PowerPoint 演示文稿', txt: '文本文档', png: 'PNG 图片', jpg: 'JPEG 图片', jpeg: 'JPEG 图片', gif: 'GIF 图片' };
  const typeOf = (name, isDir) => {
    if (isDir) return '文件夹';
    const e = (name.split('.').pop() || '').toLowerCase();
    return EXT_LABEL[e] || ((e ? e.toUpperCase() : '') + ' 文件');
  };
  const css = `
  #pkMask{position:fixed;inset:0;background:rgba(16,24,40,.38);backdrop-filter:blur(3px);z-index:80;display:none;align-items:center;justify-content:center;font-size:13px}
  #pkMask.show{display:flex}
  #pkMask .pk{width:820px;max-width:94vw;height:560px;max-height:88vh;background:#fff;border-radius:10px;box-shadow:0 24px 60px rgba(16,24,40,.28);display:flex;flex-direction:column;overflow:hidden}
  #pkMask .pk-title{display:flex;align-items:center;gap:8px;padding:14px 18px 10px;font-size:14px;font-weight:600;color:#1f2937}
  #pkMask .pk-title .x{margin-left:auto;border:0;background:none;font-size:18px;color:#98a2b3;cursor:pointer}
  #pkMask .pk-bar{display:flex;align-items:center;gap:8px;padding:0 18px 10px}
  #pkMask .pk-up{width:30px;height:30px;border:1px solid #d5dae3;background:#fff;border-radius:6px;cursor:pointer;color:#4b5563}
  #pkMask .pk-addr{flex:1;height:30px;border:1px solid #d5dae3;border-radius:6px;padding:0 10px;font-size:12.5px;color:#374151}
  #pkMask .pk-addr:focus{outline:none;border-color:#2f6bff;box-shadow:0 0 0 3px rgba(47,107,255,.12)}
  #pkMask .pk-go{height:30px;padding:0 12px;border:1px solid #d5dae3;background:#f7f9fc;border-radius:6px;cursor:pointer}
  #pkMask .pk-body{flex:1;display:flex;min-height:0;border-top:1px solid #e8ecf3}
  #pkMask .pk-nav{width:172px;flex:0 0 172px;border-right:1px solid #e8ecf3;overflow:auto;padding:8px 6px}
  #pkMask .pk-nav .grp{font-size:11.5px;color:#98a2b3;padding:8px 8px 4px}
  #pkMask .pk-nav .it{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:6px;cursor:pointer;color:#374151;white-space:nowrap;overflow:hidden}
  #pkMask .pk-nav .it:hover{background:#f2f6ff}
  #pkMask .pk-nav .it.on{background:#e8f0ff;color:#1d4ed8}
  #pkMask .pk-list{flex:1;overflow:auto}
  #pkMask table{width:100%;border-collapse:collapse}
  #pkMask thead th{position:sticky;top:0;background:#f7f9fc;text-align:left;font-weight:600;color:#4b5563;font-size:12px;padding:8px 10px;border-bottom:1px solid #e8ecf3;z-index:2}
  #pkMask tbody td{padding:7px 10px;border-bottom:1px solid #f2f4f8;color:#374151;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  #pkMask tbody tr{cursor:pointer}
  #pkMask tbody tr:hover{background:#f7faff}
  #pkMask tbody tr.on{background:#e8f0ff}
  #pkMask td.nm{max-width:0;width:52%}
  #pkMask .ico{display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;margin-right:7px;vertical-align:-5px}
  #pkMask .ico svg{width:20px;height:20px;display:block}
  #pkMask td.sz,#pkMask td.dt{color:#6b7280;font-size:12.5px}
  #pkMask .pk-empty{padding:40px;text-align:center;color:#98a2b3}
  #pkMask .pk-fbar{display:flex;align-items:center;gap:8px;padding:10px 18px;border-top:1px solid #e8ecf3;background:#fbfcfe}
  #pkMask .pk-fbar label{color:#4b5563;white-space:nowrap}
  #pkMask .pk-name{flex:1;height:30px;border:1px solid #d5dae3;border-radius:6px;padding:0 10px}
  #pkMask .pk-type{height:30px;border:1px solid #d5dae3;border-radius:6px;padding:0 8px;color:#4b5563;background:#fff}
  #pkMask .pk-foot{display:flex;align-items:center;gap:8px;padding:12px 18px;border-top:1px solid #e8ecf3}
  #pkMask .pk-hint{flex:1;color:#98a2b3;font-size:12px}
  #pkMask .pk-btn{height:32px;padding:0 16px;border-radius:6px;border:1px solid #d5dae3;background:#fff;cursor:pointer;color:#374151}
  #pkMask .pk-btn.pri{background:#2f6bff;border-color:#2f6bff;color:#fff}
  #pkMask .pk-btn:disabled{opacity:.5;cursor:not-allowed}
  `;
  let st = { path: '', parent: '', ext: '', sel: null, selKind: '', cb: null, data: null, lnkMap: new Map() };
  function el(id) { return document.getElementById(id); }
  function inject() {
    if (el('pkMask')) return;
    const s = document.createElement('style');
    s.textContent = css;
    document.head.appendChild(s);
    const d = document.createElement('div');
    d.id = 'pkMask';
    d.innerHTML = `
      <div class="pk">
        <div class="pk-title"><span id="pkTitle">选择文件夹</span><button class="x" id="pkClose">✕</button></div>
        <div class="pk-bar">
          <button class="pk-up" id="pkUp" title="上一层">↑</button>
          <input class="pk-addr" id="pkAddr" placeholder="可以直接粘贴路径，回车跳转">
          <div class="pk-go" id="pkGo">转到</div>
        </div>
        <div class="pk-body">
          <div class="pk-nav" id="pkNav"></div>
          <div class="pk-list" id="pkList"></div>
        </div>
        <div class="pk-fbar">
          <label>文件名</label>
          <input class="pk-name" id="pkName" placeholder="点上面的文件，或直接写名字">
          <select class="pk-type" id="pkType"></select>
        </div>
        <div class="pk-foot">
          <span class="pk-hint" id="pkHint"></span>
          <button class="pk-btn" id="pkCancel">取消</button>
          <button class="pk-btn pri" id="pkOk">打开</button>
        </div>
      </div>`;
    document.body.appendChild(d);
    d.addEventListener('mousedown', (e) => { if (e.target === d) close(); });
    el('pkClose').onclick = close;
    el('pkCancel').onclick = close;
    el('pkUp').onclick = () => { if (st.parent) load(st.parent); };
    el('pkGo').onclick = goTyped;
    el('pkAddr').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); goTyped(); } });
    el('pkOk').onclick = confirm;
    el('pkName').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); confirm(); } });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && el('pkMask').classList.contains('show')) close();
    });
  }
  function goTyped() {
    let v = (el('pkAddr').value || '').trim().replace(/^"|"$/g, '').replace(/^'|'$/g, '');
    if (!v) return load('');
    load(v);
  }
  function openPicker(cb, opts) {
    inject();
    st.cb = cb;
    st.ext = String((opts && opts.ext) || '').toLowerCase();
    st.sel = null; st.selKind = '';
    el('pkTitle').textContent = st.ext ? '打开' : '选择文件夹';
    el('pkOk').textContent = st.ext ? '打开' : '选这个文件夹';
    const sel = el('pkType');
    sel.innerHTML = st.ext ? '<option>' + st.ext.split(',').map((x) => (x || '').toUpperCase() + ' 文件').join(' / ') + '</option>' : '<option>文件夹</option>';
    el('pkName').value = '';
    el('pkName').placeholder = st.ext ? '点上面的文件，或直接写文件名' : '文件夹名字自动填';
    el('pkMask').classList.add('show');
    load(String((opts && opts.start) || ''));
  }
  function load(p) {
    fetch('/api/browse?ext=' + encodeURIComponent(st.ext) + '&path=' + encodeURIComponent(p || ''))
      .then((r) => r.json())
      .then((d) => {
        if (!d || d.ok === false) { hint(d && d.error ? d.error : '打不开这个文件夹'); return; }
        st.data = d;
        st.path = d.path || '';
        st.parent = d.parent || '';
        st.sel = null; st.selKind = '';
        el('pkAddr').value = st.path || '此电脑';
        el('pkName').value = '';
        renderNav();
        renderList();
        hint(st.ext ? '选一个文件，双击直接打开' : '双击文件夹进去；直接点「选这个文件夹」就是选当前这一层');
        prefetchLinks(d.links || []);
      })
      .catch((e) => hint('打不开：' + e.message));
  }
  function prefetchLinks(links) {
    const todo = links.filter((l) => !st.lnkMap.has(String(l.path).toLowerCase()));
    if (!todo.length) return;
    fetch('/api/lnks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ paths: todo.map((l) => l.path) }) })
      .then((r) => r.json())
      .then((j) => {
        (j.items || []).forEach((it, i) => {
          const key = String(todo[i].path).toLowerCase();
          st.lnkMap.set(key, it);
        });
        if (st.sel && st.selKind === 'l') showSelected();
      })
      .catch(() => {});
  }

  function renderNav() {
    const d = st.data || {};
    const nav = el('pkNav');
    const parts = [];
    parts.push('<div class="grp">快速访问</div>');
    (d.places || []).forEach((x) => {
      parts.push('<div class="it" data-p="' + esc(x.path) + '"><span class="ico">' + SVG.dir + '</span>' + esc(x.name) + '</div>');
    });
    parts.push('<div class="grp">此电脑</div>');
    (d.drives || []).forEach((x) => {
      parts.push('<div class="it" data-p="' + esc(x.path) + '"><span class="ico">' + SVG.drive + '</span>' + esc(x.name) + '</div>');
    });
    nav.innerHTML = parts.join('');
    nav.querySelectorAll('.it').forEach((it) => { it.onclick = () => load(it.dataset.p); });
  }
  function renderList() {
    const d = st.data || {};
    const dirs = d.dirs || [];
    const links = d.links || [];
    const files = d.files || [];
    const box = el('pkList');
    if (!dirs.length && !links.length && !files.length) {
      box.innerHTML = '<div class="pk-empty">这个文件夹是空的' + (st.ext ? '（没有匹配的文件）' : '') + '</div>';
      return;
    }
    const rows = [];
    dirs.forEach((x) => rows.push({ kind: 'd', name: x.name, path: x.path, mtime: x.mtime, size: 0, type: '文件夹' }));
    links.forEach((x) => rows.push({ kind: 'l', name: x.name, path: x.path, mtime: 0, size: 0, type: '快捷方式' }));
    files.forEach((x) => rows.push({ kind: 'f', name: x.name, path: x.path, mtime: x.mtime, size: x.size, type: typeOf(x.name, false) }));
    box.innerHTML = '<table><thead><tr><th style="width:52%">名称</th><th style="width:24%">修改日期</th><th style="width:16%">类型</th><th style="width:8%">大小</th></tr></thead><tbody>' +
      rows.map((r, i) => '<tr data-i="' + i + '"><td class="nm"><span class="ico">' + (r.kind === 'd' ? SVG.dir : r.kind === 'l' ? SVG.link : iconFor(r.name)) + '</span>' + esc(r.name) + '</td><td class="dt">' + fmtDate(r.mtime) + '</td><td>' + esc(r.type) + '</td><td class="sz">' + (r.kind === 'f' ? fmtSize(r.size) : '') + '</td></tr>').join('') +
      '</tbody></table>';
    st.rows = rows;
    box.querySelectorAll('tbody tr').forEach((tr) => {
      const r = rows[Number(tr.dataset.i)];
      tr.onclick = () => selectRow(r, tr);
      tr.ondblclick = () => {
        if (r.kind === 'd') { load(r.path); return; }
        if (r.kind === 'f') { selectRow(r, tr); confirm(); return; }
        // 快捷方式：文件夹就进去，文件才直接选定
        selectRow(r, tr);
        hint('正在解析快捷方式…');
        resolveLink(r.path).then((t) => {
          if (!t || !t.target) { hint('这个快捷方式打不开了'); return; }
          if (t.isDir) { load(t.target); return; }
          hint('已选中：' + r.name + ' → ' + t.target + '（文件）');
          confirm();
        });
      };
    });
  }
  const SVG = {
    dir: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M1.1 3.9c0-.7.6-1.2 1.2-1.2h3.5l1.5 1.8h6.4c.7 0 1.2.5 1.2 1.2v7.2c0 .7-.5 1.2-1.2 1.2H2.3c-.7 0-1.2-.5-1.2-1.2V3.9z" fill="#f2b53f"/><path d="M1.1 6.4h13.8v5.7c0 .7-.5 1.2-1.2 1.2H2.3c-.7 0-1.2-.5-1.2-1.2V6.4z" fill="#ffc75e"/></svg>',
    drive: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="1.6" y="4.2" width="12.8" height="7.6" rx="1.8" fill="#dfe6f1" stroke="#8593a8" stroke-width="1"/><path d="M1.8 8.6h12.4" stroke="#8593a8" stroke-width="1"/><rect x="3.3" y="9.9" width="3.4" height="1.1" rx=".55" fill="#8593a8"/><circle cx="12.2" cy="10.4" r=".75" fill="#6d7b90"/></svg>',
    link: '<svg viewBox="0 0 16 16" width="15" height="15"><path d="M6.6 9.4a2.6 2.6 0 0 1 0-3.7l1.6-1.6a2.6 2.6 0 1 1 3.7 3.7l-.9.9" fill="none" stroke="#5b7fd4" stroke-width="1.3" stroke-linecap="round"/><path d="M9.4 6.6a2.6 2.6 0 0 1 0 3.7l-1.6 1.6a2.6 2.6 0 1 1-3.7-3.7l.9-.9" fill="none" stroke="#5b7fd4" stroke-width="1.3" stroke-linecap="round"/></svg>',
    xls: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="2.4" y="1.8" width="11.2" height="12.4" rx="1.4" fill="#2f8f4e"/><path d="M5 6.4h6M5 9h6M5 11.6h3.6" stroke="#fff" stroke-width="1" stroke-linecap="round"/></svg>',
    doc: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="2.4" y="1.8" width="11.2" height="12.4" rx="1.4" fill="#2f6fd0"/><path d="M5 6.4h6M5 9h6M5 11.6h3.6" stroke="#fff" stroke-width="1" stroke-linecap="round"/></svg>',
    ppt: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="2.4" y="1.8" width="11.2" height="12.4" rx="1.4" fill="#d4622f"/><path d="M5 6.4h6M5 9h6M5 11.6h3.6" stroke="#fff" stroke-width="1" stroke-linecap="round"/></svg>',
    img: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="2.4" y="2.8" width="11.2" height="10.4" rx="1.4" fill="#6f8fb8"/><circle cx="6" cy="6.4" r="1.1" fill="#fff"/><path d="M3.4 11.6l3.4-3 2.4 2 2-1.6 2.4 2.4" stroke="#fff" stroke-width="1.1" fill="none" stroke-linejoin="round"/></svg>',
    pdf: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="2.4" y="1.8" width="11.2" height="12.4" rx="1.4" fill="#c8433a"/><path d="M5 6.4h6M5 9h6M5 11.6h3.6" stroke="#fff" stroke-width="1" stroke-linecap="round"/></svg>',
    txt: '<svg viewBox="0 0 16 16" width="15" height="15"><rect x="2.4" y="1.8" width="11.2" height="12.4" rx="1.4" fill="#8b96a6"/><path d="M5 6.4h6M5 9h6M5 11.6h3.6" stroke="#fff" stroke-width="1" stroke-linecap="round"/></svg>',
  };

  function iconFor(name) {
    const e = (name.split('.').pop() || '').toLowerCase();
    if (['xlsx', 'xls', 'xlsm', 'csv'].includes(e)) return SVG.xls;
    if (['docx', 'doc'].includes(e)) return SVG.doc;
    if (['pptx', 'ppt'].includes(e)) return SVG.ppt;
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'].includes(e)) return SVG.img;
    if (e === 'pdf') return SVG.pdf;
    return SVG.txt;
  }
  function selectRow(r, tr) {
    el('pkList').querySelectorAll('tbody tr').forEach((x) => x.classList.remove('on'));
    tr.classList.add('on');
    st.sel = r; st.selKind = r.kind;
    if (r.kind === 'f') { el('pkName').value = r.name; hint('已选中：' + r.name); return; }
    showSelected();
  }
  function resolveLink(p) {
    const key = String(p).toLowerCase();
    if (st.lnkMap.has(key)) return Promise.resolve(st.lnkMap.get(key));
    return fetch('/api/lnk?path=' + encodeURIComponent(p))
      .then((r) => r.json())
      .then((j) => { st.lnkMap.set(key, j); return j; })
      .catch(() => null);
  }

  function showSelected() {
    const r = st.sel;
    if (!r) return;
    if (r.kind === 'l') {
      const t = st.lnkMap.get(String(r.path).toLowerCase());
      if (t && t.target) hint('已选中：' + r.name + ' → ' + t.target + (t.isDir ? '（文件夹）' : '（文件）'));
      else { hint('正在解析快捷方式…'); resolveLink(r.path).then(showSelected); }
      return;
    }
    el('pkName').value = r.name;
    hint('已选中：' + r.name + (r.kind === 'd' ? '（双击进入）' : ''));
  }
  function confirm() {
    if (st.ext) {
      const typed = (el('pkName').value || '').trim();
      if (!st.sel || st.selKind === 'd') {
        if (!typed) { hint('先选一个文件'); return; }
        const p = st.path ? st.path.replace(/[\\/]$/, '') + '\\' + typed : typed;
        finish(p);
        return;
      }
      if (st.selKind === 'l') {
        resolveLink(st.sel.path).then((t) => {
          if (!t || !t.target || !t.exists) { hint('这个快捷方式打不开了'); return; }
          if (t.isDir) { hint('这个快捷方式指向的是文件夹'); return; }
          finish(t.target);
        });
        return;
      }
      finish(st.sel.path);
      return;
    }
    if (!st.sel) {
      if (st.path) { finish(st.path); return; }
      hint('先选一个');
      return;
    }
    if (st.selKind === 'd') { finish(st.sel.path); return; }
    if (st.selKind === 'l') {
      resolveLink(st.sel.path).then((t) => {
        if (!t || !t.target || !t.exists) { hint('这个快捷方式打不开了'); return; }
        if (!t.isDir) { hint('这个快捷方式指向的是文件，不是文件夹'); return; }
        finish(t.target);
      });
      return;
    }
    finish(st.path);
  }
  function finish(p) {
    const cb = st.cb;
    close();
    if (cb) try { cb(p); } catch (e) { console.error(e); }
  }
  function close() {
    const m = el('pkMask');
    if (m) m.classList.remove('show');
  }
  function hint(t) { const h = el('pkHint'); if (h) h.textContent = t; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  window.openPicker = openPicker;
  window.openPickerShared = openPicker;
})();
