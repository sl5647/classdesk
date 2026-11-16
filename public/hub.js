const $ = (s) => document.querySelector(s);
const api = async (p, b) => {
  const r = await fetch(p, b === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b),
  });
  const j = await r.json().catch(() => ({ ok: false, error: '返回不是 JSON' }));
  if (!r.ok || j.ok === false) throw new Error(j.error || ('请求失败 ' + r.status));
  return j;
};

(async () => {
  try {
    const s = await api('/api/status');
    $('#hubSub').textContent = '本机运行 · 资料库 ' + (s.count || 0) + ' 个文件 · ' + (s.sizeText || '0 B');
    $("#metaFiles").textContent = (s.count || 0) + ' 个文件 · ' + (s.sizeText || '0 B');
  } catch (e) {
    $('#hubSub').textContent = '资料库打不开：' + e.message;
  }
  try {
    const st = await api('/api/students/stats');
    $('#metaStudents').textContent = (st.total || 0) + ' 名学员 · 在读 ' + (st.active || 0) +
      ' · 应收 ' + (st.feeText || '0') + ' · 实收 ' + (st.paidText || '0');
  } catch (e) {
    $('#metaStudents').textContent = '学员库还没建：' + e.message;
  }
  $('#hubVer').textContent = 'v1.0';
})();
