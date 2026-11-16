const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

async function api(p, b) {
  const r = await fetch(p, b === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  });
  const j = await r.json().catch(() => ({ ok: false, error: '返回不是 JSON' }));
  if (!r.ok || j.ok === false) throw new Error(j.error || ('请求失败 ' + r.status));
  return j;
}

const S = {
  courseEdit: new Set(), items: [], courses: [], stats: {}, editing: null, q: '', status: '', course: '', pay: '', sel: new Set(), xlsxRows: null };

const money = (n) => '¥' + (Number(n) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 2 });

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function toast(msg, bad) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:34px;transform:translateX(-50%);background:' +
      (bad ? '#e0533d' : '#1b2233') + ';color:#fff;padding:9px 16px;border-radius:8px;font-size:13px;z-index:99;opacity:0;transition:.2s';
    document.body.appendChild(el);
  }
  el.style.background = bad ? '#e0533d' : '#1b2233';
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = '0'; }, 2200);
}

async function load() {
  try {
    const p = new URLSearchParams();
    if (S.q) p.set('q', S.q);
    if (S.status) p.set('status', S.status);
    if (S.course) p.set('course', S.course);
    const d = await api('/api/students?' + p.toString());
    S.items = d.items || [];
    S.courses = d.courses || [];
    S.stats = d.stats || {};
    renderStats();
    renderCourses();
    renderList();
  } catch (e) {
    toast('读学员数据失败：' + e.message, true);
  }
}

function renderStats() {
  const st = S.stats || {};
  $('#stats').innerHTML = [
    ['学员总数', st.total || 0, ''],
    ['在读', st.active || 0, 'ok'],
    ['应收', money(st.fee), ''],
    ['实收', money(st.paid), 'ok'],
    ['待收（欠费）', money(st.owe), 'warn'],
    ['课时（已用/总）', (st.lessonsUsed || 0) + ' / ' + (st.lessonsTotal || 0), ''],
    ['剩余课时', String(st.lessonsLeft || 0), 'ok'],
    ['已耗课值', money(st.usedValue), ''],
  ].map(([k, v, cls]) => `<div class="stat ${cls}"><div class="k">${k}</div><div class="v">${typeof v === 'number' ? v : esc(v)}</div></div>`).join('');
}

function renderCourses() {
  const sel = $('#fCourse');
  const cur = sel.value;
  sel.innerHTML = '<option value="">全部课程</option>' +
    S.courses.map((c) => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('');
  sel.value = cur;

  $('#courseList').innerHTML = S.courses.map((c) => `<option value="${esc(c.name)}" label="${esc(money(c.fee))}">`).join('');

  const box = $('#courseRows');
  box.innerHTML = S.courses.length
    ? S.courses.map((c) => {
        const key = esc(c.name);
        if (S.courseEdit && S.courseEdit.has(c.name)) {
          return '<div class="course-row editing" data-k="' + key + '">' +
            '<input class="ce" data-f="name" value="' + key + '">' +
            '<input class="ce num" data-f="fee" value="' + (c.fee || '') + '" placeholder="费用">' +
            '<input class="ce num" data-f="unitPrice" value="' + (c.unitPrice || '') + '" placeholder="单价/课次">' +
            '<input class="ce num" data-f="perSession" value="' + (c.perSession || '') + '" placeholder="每课次课时">' +
            '<input class="ce num" data-f="lessons" value="' + (c.lessons || '') + '" placeholder="课时">' +
            '<span class="ops"><b class="sv" data-sv="' + key + '">保存</b><b class="rm" data-rm="' + key + '">删除</b></span>' +
            '</div>';
        }
        return '<div class="course-row" data-k="' + key + '">' +
          '<span class="cname">' + key + '</span>' +
          '<span class="cmeta">' + money(c.fee) +
          (c.unitPrice ? ' · ' + money(c.unitPrice) + '/课次' : '') +
          (c.lessons ? ' · ' + (c.lessons / (c.perSession || 2)) + ' 课次' : '') + '</span>' +
          '<span class="ops"><b class="ed" data-ed="' + key + '">改</b><b class="rm" data-rm="' + key + '">删除</b></span></div>';
      }).join('')
    : '<div class="hint">还没有常用课程</div>';

  $$('#courseRows .ed').forEach((el) => {
    el.onclick = () => { S.courseEdit.add(el.dataset.ed); renderCourses(); };
  });
  $$('#courseRows .sv').forEach((el) => {
    el.onclick = async () => {
      const row = el.closest('.course-row');
      const oldName = el.dataset.sv;
      const g = (f) => row.querySelector('[data-f="' + f + '"]').value.trim();
      const name = g('name');
      if (!name) { toast('课程名不能为空', true); return; }
      try {
        await api('/api/students/courses/save', { name, fee: g('fee'), unitPrice: g('unitPrice'), perSession: g('perSession'), lessons: g('lessons') });
        if (name !== oldName) await api('/api/students/courses/delete', { name: oldName });
        const r = await api('/api/students/courses');
        S.courses = r.courses;
        S.courseEdit.delete(oldName);
        renderCourses();
        toast('已保存');
      } catch (e) { toast(e.message, true); }
    };
  });
  $$('#courseRows .rm').forEach((el) => {
    el.onclick = async () => {
      try {
        const r = await api('/api/students/courses/delete', { name: el.dataset.rm });
        S.courses = r.courses;
        S.courseEdit.delete(el.dataset.rm);
        renderCourses();
        toast('已删除课程');
      } catch (e) { toast(e.message, true); }
    };
  });
}

function diffTag(s) {
  const need = Number(s.need || 0);
  const paid = Number(s.paid || 0);
  const d = Math.round((need - paid) * 100) / 100;
  if (!d) return '';
  if (d > 0) return '<span class="diff less" title="应收 ' + money(need) + '，实收 ' + money(paid) + '">差 ' + money(d) + '</span>';
  return '<span class="diff more" title="多收了 ' + money(-d) + '">多 ' + money(-d) + '</span>';
}

function payPill(s) {
  const cls = s.payState === '已缴清' ? 'paid' : (s.payState === '部分缴费' ? 'part' : 'none');
  return `<span class="pill ${cls}">${esc(s.payState)}</span>`;
}
function statePill(s) {
  const m = { '在读': 's-in', '停课': 's-pause', '结业': 's-done', '退费': 's-refund' };
  const v = s.status || '在读';
  return `<span class="pill ${m[v] || 's-in'}">${esc(v)}</span>`;
}

function renderList() {
  let arr = S.items;
  if (S.pay === 'diff') arr = arr.filter((s) => Math.round((Number(s.need || 0) - Number(s.paid || 0)) * 100) / 100 !== 0);
  if (S.pay === 'owe') arr = arr.filter((s) => s.owe > 0);
  if (S.pay === 'clear') arr = arr.filter((s) => s.owe <= 0);

  $('#count').textContent = `共 ${arr.length} 名学员`;
  $('#empty').style.display = arr.length ? 'none' : '';
  $('#tbl').style.display = arr.length ? '' : 'none';

  $('#rows').innerHTML = arr.map((s) => `
    <tr data-id="${esc(s.id)}">
      <td class="w-ck"><input type="checkbox" class="ck" data-id="${esc(s.id)}" ${S.sel.has(s.id) ? 'checked' : ''}></td>
      <td><b>${esc(s.name)}</b></td>
      <td>${esc(s.sex || '')}</td>
      <td class="num">${s.age ? esc(s.age) : ''}</td>
      <td>${esc(s.phone || '')}</td>
      <td>${esc(s.course || '')}</td>
      <td>${esc(s.class || '')}</td>
      <td class="num">${money(s.fee)}</td>
      <td class="num">${s.unitPrice ? (s.unitAuto ? '<span class="auto-u" title="按 费用 ÷ 课次数 自动算">' + money(s.unitPrice) + '</span>' : money(s.unitPrice)) + '<span class="u-suf">/课次</span>' : ''}</td>
      <td class="num">${money(s.need)}</td>
      <td class="num">${s.discount ? money(s.discount) : ''}</td>
      <td class="num">${money(s.paid)}${diffTag(s)}</td>
      <td class="num ${s.owe > 0 ? 'owe' : ''}">${s.owe > 0 ? money(s.owe) : ''}</td>
      <td class="num">${s.usedLessons || 0}/${s.totalLessons || 0}<span class="left-les">剩 ${s.leftLessons || 0}</span></td>
      <td>${payPill(s)}</td>
      <td>${giftPill(s)}</td>
      <td>${statePill(s)}</td>
      <td class="op">编辑</td>
    </tr>`).join('');

  $$('#rows tr').forEach((tr) => {
    tr.onclick = (ev) => {
      if (ev.target && ev.target.classList && ev.target.classList.contains('ck')) return;
      openEdit(S.items.find((x) => x.id === tr.dataset.id));
    };
  });
  $$('#rows .ck').forEach((ck) => {
    ck.onclick = (ev) => {
      ev.stopPropagation();
      if (ck.checked) S.sel.add(ck.dataset.id); else S.sel.delete(ck.dataset.id);
      syncSel();
    };
  });
  syncSel();
}

function openEdit(s) {
  S.editing = s || null;
  $('#edTitle').textContent = s ? '编辑学员 · ' + s.name : '新增学员';
  $('#btnDel').style.display = s ? '' : 'none';
  const set = (id, v) => { const el = $('#' + id); if (el) el.value = v == null ? '' : v; };
  set('f_name', s && s.name); set('f_sex', s && s.sex); set('f_age', s && s.age);
  set('f_phone', s && s.phone); set('f_parent', s && s.parent); set('f_school', s && s.school);
  set('f_grade', s && s.grade); set('f_class', s && s.class); set('f_course', s && s.course);
  set('f_enroll', s && s.enrollDate); set('f_fee', s && s.fee); set('f_discount', s && s.discount);
  set('f_paid', s && s.paid); set('f_status', (s && s.status) || '在读');
  set('f_total', s && s.totalLessons); set('f_used', s && s.usedLessons); set('f_note', s && s.note);
  set('f_gift', s && s.gift); set('f_giftAt', s && s.giftAt);
  set('f_unit', s && s.unitPrice); set('f_per', s && s.perSession);
  updateCalc();
  $('#maskEdit').classList.add('show');
  setTimeout(() => $('#f_name').focus(), 60);
}

function updateCalc() {
  const fee = Number($('#f_fee').value) || 0;
  const dis = Number($('#f_discount').value) || 0;
  const paid = Number($('#f_paid').value) || 0;
  const unit = Number($('#f_unit').value) || 0;
  const per = Number($('#f_per').value) || 2;
  const total = Number($('#f_total').value) || 0;
  const sess = total > 0 ? Math.round((total / per) * 100) / 100 : 0;
  // 有单价就按「单价 × 实际课次」算应收（报 12 课时只收 6 课次的钱）
  const base = (unit > 0 && sess > 0) ? unit * sess : fee;
  const need = Math.max(0, Math.round((base - dis) * 100) / 100);
  const owe = Math.max(0, Math.round((need - paid) * 100) / 100);
  $('#calcHint').innerHTML = `应收 <b>${money(need)}</b> · 实收 <b>${money(paid)}</b> · ` +
    (owe > 0 ? `还差 <b style="color:#e0533d">${money(owe)}</b>` : '<b style="color:#12885a">已缴清</b>');
}

function collect() {
  const g = (id) => $('#' + id).value.trim();
  return {
    id: S.editing ? S.editing.id : '',
    name: g('f_name'), sex: g('f_sex'), age: g('f_age'), phone: g('f_phone'), parent: g('f_parent'),
    school: g('f_school'), grade: g('f_grade'), class: g('f_class'),
    course: g('f_course'), enrollDate: g('f_enroll'),
    fee: g('f_fee'), discount: g('f_discount'), paid: g('f_paid'),
    status: g('f_status') || '在读',
    totalLessons: g('f_total'), usedLessons: g('f_used'),
    gift: g('f_gift'), giftAt: g('f_giftAt'), unitPrice: g('f_unit'), perSession: g('f_per'),
    note: g('f_note'),
  };
}

async function save() {
  const body = collect();
  if (!body.name) { toast('姓名必填', true); $('#f_name').focus(); return; }
  try {
    const r = await api('/api/students/save', body);
    $('#maskEdit').classList.remove('show');
    S.stats = r.stats;
    await load();
    toast(S.editing ? '已保存修改' : '已新增学员');
  } catch (e) { toast('保存失败：' + e.message, true); }
}

async function del() {
  if (!S.editing) return;
  if (!confirm(`删除学员「${S.editing.name}」？删了找不回来。`)) return;
  try {
    const r = await api('/api/students/delete', { id: S.editing.id });
    $('#maskEdit').classList.remove('show');
    S.stats = r.stats;
    await load();
    toast('已删除');
  } catch (e) { toast('删除失败：' + e.message, true); }
}

function syncSel() {
  const n = S.sel.size;
  const bar = $('#batchBar');
  if (bar) bar.style.display = n ? 'flex' : 'none';
  if ($('#selN')) $('#selN').textContent = n;
  const all = $$('#rows .ck');
  if ($('#ckAll')) $('#ckAll').checked = all.length > 0 && all.every((c) => c.checked);
}

/* ---------- 事件 ---------- */
$('#q').oninput = (e) => { S.q = e.target.value.trim(); clearTimeout(window._t); window._t = setTimeout(load, 250); };
$('#fStatus').onchange = (e) => { S.status = e.target.value; load(); };
$('#fCourse').onchange = (e) => { S.course = e.target.value; load(); };
$('#fPay').onchange = (e) => { S.pay = e.target.value; renderList(); };
$('#btnAdd').onclick = () => openEdit(null);
$('#btnSave').onclick = save;
$('#btnDel').onclick = del;
function openExport() {
  const d = new Date();
  const stamp = d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
  $('#ex_name').value = '学员名单-' + stamp;
  $('#ex_dir').value = '';
  $('#ex_hint').textContent = '';
  $('#maskExport').classList.add('show');
  setTimeout(() => $('#ex_name').focus(), 60);
}
$('#btnExport').onclick = openExport;
$('#ex_pick').onclick = () => { openPicker((p) => { if (p) $('#ex_dir').value = p; }); };
$('#ex_go').onclick = async () => {
  const name = ($('#ex_name').value || '').trim() || '学员名单';
  const dir = ($('#ex_dir').value || '').trim();
  const format = $('#ex_fmt').value;
  $('#ex_hint').textContent = '正在导出…';
  try {
    const r = await api('/api/students/export', { name, dir, format });
    $('#ex_hint').innerHTML = '已导出 ' + r.count + ' 人 → ' + r.path +
      '<div style="margin-top:8px"><button class="btn sm" id="ex_open">打开文件</button> ' +
      '<button class="btn sm" id="ex_reveal">打开所在文件夹</button></div>';
    const op = $('#ex_open'); const rv = $('#ex_reveal');
    if (op) op.onclick = () => api('/api/openPath', { path: r.path }).catch((e) => toast('打不开：' + e.message, true));
    if (rv) rv.onclick = () => api('/api/openPath', { path: r.path, reveal: true }).catch((e) => toast('打不开：' + e.message, true));
    toast('已导出：' + r.name);
  } catch (e) { $('#ex_hint').textContent = '导出失败：' + e.message; }
};
['#f_fee', '#f_discount', '#f_paid'].forEach((s) => { $(s).oninput = updateCalc; });
['f_fee', 'f_discount', 'f_paid', 'f_unit', 'f_per', 'f_total'].forEach((id) => {
  const el = $('#' + id); if (el) el.addEventListener('input', updateCalc);
});
$('#f_course').onchange = () => {
  const c = S.courses.find((x) => x.name === $('#f_course').value);
  if (!c) return;
  // 换课程 → 直接按这门课的预设覆盖（费用/单价/每课次课时/总课时），手改过也以新课程为准
  if (c.fee) $('#f_fee').value = c.fee;
  if (c.unitPrice) $('#f_unit').value = c.unitPrice;
  if (c.perSession) $('#f_per').value = c.perSession;
  if (c.lessons) $('#f_total').value = c.lessons;
  updateCalc();
  toast('已按「' + c.name + '」带出费用 / 单价 / 课时');
};

$$('[data-close]').forEach((b) => {
  b.onclick = () => b.closest('.mask').classList.remove('show');
});
$$('.mask').forEach((m) => {
  m.addEventListener('mousedown', (e) => { if (e.target === m) m.classList.remove('show'); });
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $$('.mask.show').forEach((m) => m.classList.remove('show'));
});

/* 课程与费用 */
$('#btnCourses').onclick = () => { renderCourses(); $('#maskCourses').classList.add('show'); };
$('#c_add').onclick = async () => {
  const name = $('#c_name').value.trim();
  if (!name) { toast('课程名不能为空', true); return; }
  try {
    const r = await api('/api/students/courses/save', {
      name,
      fee: $('#c_fee').value,
      unitPrice: $('#c_unit').value,
      perSession: $('#c_per').value,
      lessons: $('#c_lessons').value,
    });
    S.courses = r.courses;
    $('#c_name').value = ''; $('#c_fee').value = ''; $('#c_unit').value = ''; $('#c_per').value = ''; $('#c_lessons').value = '';
    renderCourses();
    toast('已保存课程');
  } catch (e) { toast(e.message, true); }
};

/* 批量粘贴 */
$('#btnImport').onclick = () => { $('#maskImport').classList.add('show'); $('#impHint').textContent = ''; };
$('#impDo').onclick = async () => {
  const text = $('#impText').value;
  if (!text.trim()) { toast('先粘贴内容', true); return; }
  try {
    const r = await api('/api/students/import', { text });
    $('#impHint').textContent = `导入 ${r.added} 条` + (r.errors && r.errors.length ? '；失败 ' + r.errors.length + ' 条：' + r.errors.join(' / ') : '');
    await load();
    toast('已导入 ' + r.added + ' 名学员');
    if (!r.errors || !r.errors.length) setTimeout(() => $('#maskImport').classList.remove('show'), 900);
  } catch (e) { toast('导入失败：' + e.message, true); }
};


/* ---------- 选择 / 批量删除 / 导入 Excel ---------- */
function wireSel() {
  const rows = $('#rows');
  if (rows && !rows.dataset.ckBound) {
    rows.dataset.ckBound = '1';
    rows.addEventListener('click', (ev) => {
      const t = ev.target;
      if (!t || !t.classList || !t.classList.contains('ck')) return;
      ev.stopPropagation();
      if (t.checked) S.sel.add(t.dataset.id); else S.sel.delete(t.dataset.id);
      syncSel();
    }, true);
  }
  const all = $('#ckAll');
  if (all && !all.dataset.ckBound) {
    all.dataset.ckBound = '1';
    all.onclick = () => {
      const on = all.checked;
      $$('#rows .ck').forEach((ck) => {
        ck.checked = on;
        if (on) S.sel.add(ck.dataset.id); else S.sel.delete(ck.dataset.id);
      });
      syncSel();
    };
  }
  syncSel();
}

const _renderList = renderList;
renderList = function () {
  _renderList();
  wireSel();
};

if ($('#btnClearSel')) {
  $('#btnClearSel').onclick = () => {
    S.sel.clear();
    $$('#rows .ck').forEach((ck) => { ck.checked = false; });
    syncSel();
  };
}

if ($('#btnDelSel')) {
  $('#btnDelSel').onclick = async () => {
    const ids = [...S.sel];
    if (!ids.length) return;
    if (!confirm('删除选中的 ' + ids.length + ' 名学员？删了找不回来。')) return;
    try {
      const r = await api('/api/students/delete-batch', { ids });
      S.sel.clear();
      S.stats = r.stats;
      await load();
      toast('已删除 ' + r.removed + ' 名学员');
    } catch (e) { toast('删除失败：' + e.message, true); }
  };
}

const FIELD_LABEL = { name: '姓名', sex: '性别', age: '年龄', phone: '联系电话', parent: '家长', school: '学校', grade: '年级', class: '班级', course: '报读课程', fee: '课程费用', discount: '优惠', paid: '实收', totalLessons: '总课时', usedLessons: '已用课时', status: '状态', enrollDate: '报名日期', note: '备注' };

if ($('#btnXlsx')) {
  $('#btnXlsx').onclick = () => {
    S.xlsxRows = null;
    $('#xlsxPreview').innerHTML = '';
    $('#xlsxInfo').textContent = '';
    $('#xlsxDo').disabled = true;
    $('#xlsxFile').value = '';
    $('#maskXlsx').classList.add('show');
  };

  $('#xlsxFile').onchange = async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    $('#xlsxInfo').textContent = '正在识别 ' + f.name + ' …';
    $('#xlsxPreview').innerHTML = '';
    $('#xlsxDo').disabled = true;
    try {
      const buf = await f.arrayBuffer();
      const r = await fetch('/api/students/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(f.name) },
        body: buf,
      }).then((x) => x.json());
      if (!r.ok) throw new Error(r.error || '识别失败');
      S.xlsxRows = r.rows || [];
      const chips = Object.keys(FIELD_LABEL).map((k) => r.cols[k] == null ? '' :
        '<span class="mapchip">' + FIELD_LABEL[k] + ' ← ' + esc(r.headers[r.cols[k]] || ('第' + (r.cols[k] + 1) + '列')) + '</span>').join('');
      $('#xlsxInfo').innerHTML = '识别到 <b>' + S.xlsxRows.length + '</b> 名学员。<div class="maprow">' + chips + '</div>';
      const head = ['姓名', '性别', '年龄', '电话', '课程', '费用', '实收', '班级'];
      const body = S.xlsxRows.slice(0, 8).map((s) => '<tr><td>' + esc(s.name) + '</td><td>' + esc(s.sex) + '</td><td>' + esc(s.age) +
        '</td><td>' + esc(s.phone) + '</td><td>' + esc(s.course) + '</td><td class="num">' + esc(s.fee) +
        '</td><td class="num">' + esc(s.paid) + '</td><td>' + esc(s.class) + '</td></tr>').join('');
      $('#xlsxPreview').innerHTML = '<div class="prev"><table><thead><tr>' + head.map((x) => '<th>' + x + '</th>').join('') +
        '</tr></thead><tbody>' + body + '</tbody></table></div>' +
        (S.xlsxRows.length > 8 ? '<div class="hint">只预览前 8 行，实际导入 ' + S.xlsxRows.length + ' 行</div>' : '');
      $('#xlsxDo').disabled = !S.xlsxRows.length;
    } catch (e) {
      $('#xlsxInfo').textContent = '识别失败：' + e.message;
    }
  };

  $('#xlsxDo').onclick = async () => {
    if (!S.xlsxRows || !S.xlsxRows.length) return;
    try {
      const r = await api('/api/students/import-rows', { rows: S.xlsxRows });
      $('#maskXlsx').classList.remove('show');
      S.stats = r.stats;
      await load();
      toast('已导入 ' + r.added + ' 名学员' + (r.errors && r.errors.length ? '，' + r.errors.length + ' 条失败' : ''));
    } catch (e) { toast('导入失败：' + e.message, true); }
  };
}

wireSel();
load();

/* ---- init 兜底：首屏没渲染出来就再跑一次 ---- */
function bootStudents() {
  try { wireSel(); } catch (e) { console.error('wireSel', e); }
  if (!document.querySelector('#rows tr')) {
    try { load(); } catch (e) { console.error('load', e); }
  }
}
window.addEventListener('load', bootStudents);
setTimeout(bootStudents, 400);

/* ---------------- 礼物 + 批量修改 ---------------- */
function giftPill(s) {
  if (!s || !s.giftAt) return '<span class="pill gray">未领</span>';
  return '<span class="pill ok" title="' + esc((s.gift ? s.gift + ' · ' : '') + s.giftAt) + '">已领</span>';
}

function bulkApply() {
  const ids = [...S.sel];
  if (!ids.length) return toast('先勾选要改的学员', true);
  const field = $('#bulkField').value;
  const mode = $('#bulkMode').value;
  const pick = $('#bulkChoice');
  const usePick = pick && pick.style.display !== 'none';
  const value = ((usePick ? pick.value : $('#bulkValue').value) || '').trim();
  if (mode === 'set' && !value) return toast('填一下新的值', true);
  if (mode === 'add' && !/^-?\d+(\.\d+)?$/.test(value)) return toast('「加上」只能填数字', true);
  api('/api/students/bulk-update', { ids, field, mode, value }).then((r) => {
    $('#maskBulk').classList.remove('show');
    S.sel.clear();
    load().then(() => toast('已修改 ' + r.changed + ' 名学员'));
  }).catch((e) => toast('修改失败：' + e.message, true));
}

function markGift() {
  const ids = [...S.sel];
  if (!ids.length) return toast('先勾选学员', true);
  const d = new Date();
  const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  api('/api/students/bulk-update', { ids, field: 'giftAt', mode: 'set', value: today }).then((r) => {
    S.sel.clear();
    load().then(() => toast('已标记 ' + r.changed + ' 人礼物已领（' + today + '）'));
  }).catch((e) => toast('标记失败：' + e.message, true));
}

(function wireBulk() {
  if (!$('#btnBulk')) return;
  $('#btnBulk').onclick = function () {
    $('#bulkN').textContent = '（已选 ' + S.sel.size + ' 人）';
    $('#bulkValue').value = '';
    $('#bulkHint').textContent = '';
    $('#maskBulk').classList.add('show');
    syncBulkInput();
    setTimeout(function () { $('#bulkValue').focus(); }, 50);
  };
  $('#bulkMode').onchange = function () { syncBulkInput(); };
  $('#bulkDo').onclick = bulkApply;
  function syncBulkInput() {
    const f = $('#bulkField').value;
    const num = ['fee', 'discount', 'paid', 'totalLessons', 'usedLessons'].indexOf(f) >= 0;
    const opt = $('#bulkMode').querySelector('option[value=add]');
    if (opt) opt.disabled = !num;
    if (!num) $('#bulkMode').value = 'set';

    const sel = $('#bulkChoice');
    const inp = $('#bulkValue');
    let opts = null;
    if (f === 'course') opts = (S.courses || []).map((c) => c.name);
    else if (f === 'status') opts = ['在读', '停课', '结业', '退费'];
    else if (f === 'sex') opts = ['男', '女'];
    else if (f === 'grade') opts = ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级', '初一', '初二', '初三'];

    const fixed = opts && opts.length && $('#bulkMode').value !== 'add';
    if (fixed) {
      sel.innerHTML = '<option value="">请选择…</option>' + opts.map((o) => '<option value="' + esc(o) + '">' + esc(o) + '</option>').join('');
      sel.value = '';
      sel.style.display = '';
      inp.style.display = 'none';
      inp.placeholder = '';
    } else {
      sel.style.display = 'none';
      inp.style.display = '';
      inp.placeholder = f === 'giftAt' ? '2026-11-14' : (f === 'class' ? '如：102' : '如：人工智能机器人 / 102');
    }
  }

  $('#bulkField').onchange = function () {
    const f = $('#bulkField').value;
    const num = ['fee', 'discount', 'paid', 'totalLessons', 'usedLessons'].indexOf(f) >= 0;
    const opt = $('#bulkMode').querySelector('option[value=add]');
    if (opt) opt.disabled = !num;
    if (!num) $('#bulkMode').value = 'set';
    syncBulkInput();
  };
  if ($('#btnGift')) $('#btnGift').onclick = markGift;
})();
