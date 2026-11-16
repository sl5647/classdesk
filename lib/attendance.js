'use strict';
/* 考勤表生成器（零依赖）：按月份 + 星期几 + 名单生成一份 xlsx。
 * 布局参考现有考勤表：标题行 / 日期行 / 星期行 / 姓名 + 每天一格 / 统计列。 */
const { writeZip } = require('./zip');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
}
function colName(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* 样式索引（对应下面 styles.xml 的 cellXfs 顺序） */
const S = {
  plain: 0,
  title: 1,      // 加粗 16 居中
  head: 2,       // 加粗 11 居中 灰底 边框
  headSun: 3,    // 加粗 居中 橙底
  headSat: 4,    // 加粗 居中 浅蓝底
  name: 5,       // 加粗 居左 边框
  cell: 6,       // 居中 边框（上课日，待填）
  off: 7,        // 居中 边框 浅灰底（不上课）
  num: 8,        // 居中 边框（统计）
  name2: 9,      // 居左 边框
  title2: 10,    // 加粗 13 居中
  pct: 11,       // 百分比
  wrapHead: 12,  // 加粗 居中 灰底 边框（自动换行）
  num1: 13,      // 数字 0.0（半天用）
};

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];

/**
 * opts: { month:'2026-11', course:'机器人', weekdays:[6,0], names:['张三'], org:'斗门容闳' }
 * 返回 xlsx Buffer
 */
function buildAttendance(opts) {
  const rawMonth = String(opts.month || '').trim();
  const m = /^(\d{4})-(\d{1,2})$/.exec(rawMonth);
  const sem = /^(\d{4})\s*[-—/]?\s*(秋|春|秋季|春季|夏|夏季|寒|寒假|暑|暑假)(季)?$/.exec(rawMonth);
  if (!m && !sem) throw new Error('月份写成 2026-11；一整学期可以写成 2026秋季');
  const y = Number((m || sem)[1]);
  const mo = m ? Number(m[2]) : (/秋/.test(rawMonth) ? 9 : (/春/.test(rawMonth) ? 3 : 7));
  const label = m ? (y + '年' + mo + '月') : rawMonth.replace(/\s+/g, '');
  const days = new Date(y, mo, 0).getDate();
  const weekdays = new Set((opts.weekdays && opts.weekdays.length ? opts.weekdays : [6, 0]).map(Number));
  const names = (opts.names || []).map((s) => String(s).trim()).filter(Boolean);
  if (!names.length) throw new Error('名单是空的');
  const course = String(opts.course || '').trim();
  const org = String(opts.org || '').trim();

  // 每列：日期
  const dateCols = [];
  for (let d = 1; d <= days; d++) {
    const wd = new Date(y, mo - 1, d).getDay();
    dateCols.push({ d, wd, cls: weekdays.has(wd) });
  }
  const classDays = dateCols.filter((x) => x.cls).length;

  const head1 = ['序号', '姓名'];
  const head2 = ['', ''];
  for (const c of dateCols) {
    head1.push(c.d + '');
    head2.push(WEEK[c.wd]);
  }
  head1.push('应到', '实到', '出勤率', '备注');
  head2.push('', '', '', '');

  const rows = [];
  const styleRows = [];   // 与 rows 同构，存样式索引
  const title = opts.title ? String(opts.title)
    : `${y}年${mo}月  ${course ? course + '  ' : ''}${opts.label || '考勤表'}${org ? '（' + org + '）' : ''}`;
  const width = head1.length;

  rows.push([title]);
  styleRows.push([S.title]);
  rows.push(head1);
  styleRows.push(head1.map((_, i) => (i >= 2 && i < 2 + days
    ? (dateCols[i - 2].wd === 0 ? S.headSun : dateCols[i - 2].wd === 6 ? S.headSat : S.head)
    : S.head)));
  rows.push(head2);
  styleRows.push(head2.map((_, i) => (i >= 2 && i < 2 + days
    ? (dateCols[i - 2].wd === 0 ? S.headSun : dateCols[i - 2].wd === 6 ? S.headSat : S.head)
    : S.head)));

  names.forEach((n, idx) => {
    const row = [idx + 1, n];
    const st = [S.num, S.name];
    for (const c of dateCols) { row.push(''); st.push(c.cls ? S.cell : S.off); }
    const rn = 4 + idx;
    const dayRange = `${colName(3)}${rn}:${colName(2 + days)}${rn}`;
    const dutyRef = colName(2 + days + 1) + rn;
    const doneRef = colName(2 + days + 2) + rn;
    row.push(classDays, { f: `COUNTA(${dayRange})` }, { f: `IF(${dutyRef}=0,"",${doneRef}/${dutyRef})` }, '');
    st.push(S.num, S.num, S.pct, S.num);
    rows.push(row);
    styleRows.push(st);
  });

  // 统计行
  const t = ['', '合计'];
  const ts = [S.num, S.name];
  for (const c of dateCols) { t.push(''); ts.push(c.cls ? S.cell : S.off); }
  const first = 4;
  const last = 3 + names.length;
  const dutyCol = colName(2 + days + 1);
  const doneCol = colName(2 + days + 2);
  const totRow = last + 1;
  t.push({ f: `SUM(${dutyCol}${first}:${dutyCol}${last})` }, { f: `SUM(${doneCol}${first}:${doneCol}${last})` },
    { f: `IF(${dutyCol}${totRow}=0,"",${doneCol}${totRow}/${dutyCol}${totRow})` }, '');
  ts.push(S.num, S.num, S.pct, S.num);
  rows.push(t);
  styleRows.push(ts);

  const merges = [];
  const lastCol = colName(width);
  merges.push(`A1:${lastCol}1`);

  const sheet = sheetXml(rows, styleRows, merges, {
    cols: [5, 14, ...Array(days).fill(4.2), 7, 7, 9, 14],
    freeze: 'C4',
    rowHeights: Object.assign({ 1: 34, 2: 24, 3: 20 }, ...names.map((_, i) => ({ [4 + i]: 30 })), { [4 + names.length]: 24 }),
  });
  const name = `${y}年${mo}月${course ? course : ''}考勤表`;
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CT, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(WB(name), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WBREL, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
  ]);
}

function cellXml(ref, value, s) {
  const st = s ? ` s="${s}"` : '';
  if (value && typeof value === 'object' && value.f) return `<c r="${ref}"${st}><f>${esc(value.f)}</f></c>`;
  if (value === null || value === undefined || value === '') return `<c r="${ref}"${st}/>`;
  if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${st}><v>${value}</v></c>`;
  return `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(value)}</t></is></c>`;
}

function sheetXml(rows, styles, merges, opt) {
  const o = opt || {};
  let body = '';
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i] || [];
    const st = styles[i] || [];
    const r = i + 1;
    const ht = o.rowHeights && o.rowHeights[r] ? ` ht="${o.rowHeights[r]}" customHeight="1"` : '';
    let cells = '';
    for (let c = 0; c < row.length; c++) {
      cells += cellXml(colName(c + 1) + r, row[c], st[c] || 0);
    }
    body += `<row r="${r}"${ht}>${cells}</row>`;
  }
  let colsXml = '';
  if (o.cols) {
    colsXml = '<cols>' + o.cols.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('') + '</cols>';
  }
  let mergeXml = '';
  if (merges && merges.length) {
    mergeXml = `<mergeCells count="${merges.length}">` + merges.map((r) => `<mergeCell ref="${r}"/>`).join('') + '</mergeCells>';
  }
  let paneXml = '';
  if (o.freeze) {
    const mm = /^([A-Z]+)(\d+)$/.exec(o.freeze);
    const xSplit = mm ? colNum(mm[1]) - 1 : 0;
    const ySplit = mm ? Number(mm[2]) - 1 : 0;
    // xSplit / ySplit 为 0 时不能写进 XML（Excel 会判定文件损坏）
    const xs = xSplit > 0 ? ` xSplit="${xSplit}"` : '';
    const ys = ySplit > 0 ? ` ySplit="${ySplit}"` : '';
    const ap = xSplit > 0 && ySplit > 0 ? 'bottomRight' : (ySplit > 0 ? 'bottomLeft' : 'topRight');
    paneXml = `<sheetViews><sheetView workbookViewId="0" showGridLines="0"><pane${xs}${ys} topLeftCell="${o.freeze}" activePane="${ap}" state="frozen"/></sheetView></sheetViews>`;
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${paneXml}${colsXml}<sheetData>${body}</sheetData>${mergeXml}<pageMargins left="0.3" right="0.3" top="0.4" bottom="0.4" header="0.2" footer="0.2"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

function colNum(s) {
  let n = 0;
  for (const ch of s) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

const CT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

function WB(name) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="${esc(name).slice(0, 30)}" sheetId="1" r:id="rId1"/></sheets></workbook>`;
}

const WBREL = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="0.0"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="微软雅黑"/></font>
<font><b/><sz val="16"/><name val="微软雅黑"/></font>
<font><b/><sz val="10.5"/><name val="微软雅黑"/></font>
<font><sz val="10.5"/><name val="微软雅黑"/></font>
</fonts>
<fills count="6">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF4F6FA"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFE7D6"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE3EEFF"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFF7F8FA"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border/>
<border><left style="thin"><color rgb="FF8C96A8"/></left><right style="thin"><color rgb="FF8C96A8"/></right><top style="thin"><color rgb="FF8C96A8"/></top><bottom style="thin"><color rgb="FF8C96A8"/></bottom></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14">
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="10" fontId="3" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="常规" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
</styleSheet>`;

// 校区考勤表：学生 × 第 N 周（每格打勾/0-1），周次表头带起止日期
function buildCampus(opts) {
  const weeks = Math.min(40, Math.max(1, Number(opts.weeks || 20)));
  const start = String(opts.startDate || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(start);
  if (!m) throw new Error('学期首周周一要写成 2026-09-07');
  const y0 = Number(m[1]), mo0 = Number(m[2]), d0 = Number(m[3]);
  const first = new Date(Date.UTC(y0, mo0 - 1, d0));
  const students = (opts.names || []).map((x) => String(x).trim()).filter(Boolean);
  if (!students.length) throw new Error('名单是空的');
  const course = String(opts.course || '').trim();
  const org = String(opts.org || '').trim();

  const weekCols = [];
  for (let i = 0; i < weeks; i++) {
    const a = new Date(first.getTime() + i * 7 * 86400000);
    const b = new Date(a.getTime() + 6 * 86400000);
    const fmt = (dt) => (dt.getUTCMonth() + 1) + '.' + dt.getUTCDate();
    weekCols.push({ i, label: fmt(a) + '-' + fmt(b) });
  }

  const title = opts.title ? String(opts.title)
    : `${y0}年${mo0}月起 ${course ? course + '  ' : ''}学生考勤表${org ? '（' + org + '）' : ''}`;
  const head1 = ['序号', '姓名'];
  const head2 = ['', ''];
  for (const w of weekCols) { head1.push('第' + (w.i + 1) + '周'); head2.push(w.label); }
  head1.push('应到', '实到', '出勤率');
  head2.push('', '', '');

  const rows = []; const styleRows = []; const width = head1.length;
  rows.push([title]); styleRows.push([S.title]);
  rows.push(head1); styleRows.push(head1.map(() => S.head));
  rows.push(head2); styleRows.push(head2.map(() => S.head));

  const firstRow = 4;
  students.forEach((n, idx) => {
    const row = [idx + 1, n]; const st = [S.num, S.name];
    for (let i = 0; i < weeks; i++) { row.push(''); st.push(S.cell); }
    const rn = firstRow + idx;
    const rng = `${colName(3)}${rn}:${colName(2 + weeks)}${rn}`;
    row.push(weeks, { f: 'COUNTA(' + rng + ')' }, { f: `IF(${colName(3 + weeks)}${rn}=0,"",${colName(4 + weeks)}${rn}/${colName(3 + weeks)}${rn})` });
    st.push(S.num, S.num, S.pct);
    rows.push(row); styleRows.push(st);
  });

  const lastRow = firstRow + students.length - 1;
  const totRow = lastRow + 1;
  const t = ['', '合计']; const ts = [S.num, S.name];
  for (let i = 0; i < weeks; i++) { t.push(''); ts.push(S.cell); }
  t.push({ f: `SUM(${colName(3 + weeks)}${firstRow}:${colName(3 + weeks)}${lastRow})` },
    { f: `SUM(${colName(4 + weeks)}${firstRow}:${colName(4 + weeks)}${lastRow})` },
    { f: `IF(${colName(3 + weeks)}${totRow}=0,"",${colName(4 + weeks)}${totRow}/${colName(3 + weeks)}${totRow})` });
  ts.push(S.num, S.num, S.pct);
  rows.push(t); styleRows.push(ts);

  const sheet = sheetXml(rows, styleRows, ['A1:' + colName(width) + '1'], {
    cols: [5, 14, ...Array(weeks).fill(10.5), 7, 7, 9],
    freeze: 'C4',
    rowHeights: Object.assign({ 1: 34, 2: 22, 3: 18 }, ...students.map((_, i) => ({ [4 + i]: 26 })), { [totRow]: 24 }),
  });
  const name = '校区考勤表 ' + y0 + '年' + mo0 + '月';
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CT, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(WB(name), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WBREL, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
  ]);
}

// 教师月度考勤表：日期网格（>15 天分 1–15 / 16–月末 两段）+ 统计块
function buildTeacher(opts) {
  const month = String(opts.month || '').slice(0, 7);
  const m = /^(\d{4})-(\d{1,2})$/.exec(month);
  if (!m) throw new Error('月份格式要写成 2026-11');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const days = new Date(y, mo, 0).getDate();
  const names = (opts.names || []).map((x) => String(x).trim()).filter(Boolean);
  if (!names.length) throw new Error('名单是空的');
  const org = String(opts.org || '').trim();
  const course = String(opts.course || '').trim();
  const holiday = Number(opts.holiday || 0) || 0;
  const workdayCount = (() => { let n = 0; for (let d = 1; d <= days; d++) { const wd = new Date(y, mo - 1, d).getDay(); if (wd >= 1 && wd <= 5) n++; } return n; })();
  const dutyDays = Number(opts.dutyDays || 0) || workdayCount;

  const dayList = [];
  for (let d = 1; d <= days; d++) dayList.push({ d, wd: new Date(y, mo - 1, d).getDay() });
  const segs = [dayList.slice(0, 15)];
  if (dayList.length > 15) segs.push(dayList.slice(15));

  const title = opts.title ? String(opts.title)
    : `${y}年${mo}月  ${course ? course + '  ' : ''}教师考勤表${org ? '（' + org + '）' : ''}`;
  const maxWidth = 1 + Math.max(...segs.map((s) => s.length));

  const rows = [];
  const st = [];
  const merges = [`A1:${colName(maxWidth)}1`];
  rows.push([title]); st.push([S.title]);

  const gridRanges = names.map(() => []);

  segs.forEach((seg) => {
    const headCls = seg.map((c) => (c.wd === 0 ? S.headSun : c.wd === 6 ? S.headSat : S.head));
    rows.push(['姓名', ...seg.map((c) => c.d)]);
    st.push([S.head, ...headCls]);
    rows.push(['', ...seg.map((c) => WEEK[c.wd])]);
    st.push([S.head, ...headCls]);
    const firstRow = rows.length + 1;
    names.forEach((n, i) => {
      const r = [n];
      const s2 = [S.name];
      for (const c of seg) { r.push(''); s2.push(c.wd === 0 || c.wd === 6 ? S.off : S.cell); }
      rows.push(r); st.push(s2);
      gridRanges[i].push({ row: firstRow + i, from: 'B', to: colName(1 + seg.length) });
    });
  });

  const statsHead = ['姓名', '本月假期', '本月上班天数', '本月实上班天数', '休息天数', '调休天数', '请假天数', '加班天数', '上月结余', '本月结余', '备注'];
  const statsRowIdx = rows.length + 1;
  rows.push(statsHead); st.push(statsHead.map(() => S.wrapHead));

  names.forEach((n, i) => {
    const rs = gridRanges[i] || [];
    const cnt = (tok) => rs.map((g) => `COUNTIF(${g.from}${g.row}:${g.to}${g.row},"${tok}")`).join('+') || '0';
    const full = (`${cnt('✓')}+${cnt('√')}+${cnt('半')}`) + `+(${cnt('半天')})*0.5`;
    const rest = `(${cnt('○')})+(${cnt('×')})`;
    const rr = statsRowIdx + i + 1;
    rows.push([n, holiday, dutyDays, { f: full }, { f: rest }, '', '', '', 0, { f: `I${rr}+H${rr}-G${rr}-F${rr}+D${rr}-C${rr}` }, '']);
    st.push([S.name, S.num, S.num, S.num1, S.num, S.num, S.num, S.num, S.num, S.num1, S.num]);
  });

  const totR = statsRowIdx + names.length + 1;
  const sumCol = (c) => ({ f: `SUM(${c}${statsRowIdx + 1}:${c}${totR - 1})` });
  rows.push(['合计', sumCol('B'), sumCol('C'), sumCol('D'), sumCol('E'), sumCol('F'), sumCol('G'), sumCol('H'), sumCol('I'), sumCol('J'), '']);
  st.push([S.name, S.num, S.num, S.num1, S.num, S.num, S.num, S.num, S.num, S.num1, S.num]);

  const sheet = sheetXml(rows, st, merges, {
    cols: [14, ...Array(maxWidth - 1).fill(5.6)],
    freeze: 'B3',
    rowHeights: Object.assign({ 1: 38 }, { [statsRowIdx]: 54 }),
  });
  const name = `${y}年${mo}月教师考勤表`;
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CT, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(WB(name), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WBREL, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
  ]);
}

// 生成「学生考勤表」：按 blocks 配置直接画表（不依赖用户模板）
// blocks: [{ weekdays:[1], interval:1, startDate:'2026-11-02', endDate:'2027-02-22',
//            students:[{name,phone,cls,sex}] }]
function buildStudent(opts) {
  opts = opts || {};
  const rawMonth = String(opts.month || '').trim();
  const m = /^(\d{4})-(\d{1,2})$/.exec(rawMonth);
  const sem = /^(\d{4})\s*[-—/]?\s*(秋|春|秋季|春季|夏|夏季|寒|寒假|暑|暑假)(季)?$/.exec(rawMonth);
  if (!m && !sem) throw new Error('月份写成 2026-11；一整学期可以写成 2026秋季');
  const y = Number((m || sem)[1]);
  const mo = m ? Number(m[2]) : (/秋/.test(rawMonth) ? 9 : (/春/.test(rawMonth) ? 3 : 7));
  const label = m ? (y + '年' + mo + '月') : rawMonth.replace(/\s+/g, '');
  const course = String(opts.course || '').trim();
  const org = String(opts.org || '').trim();
  const tutor = String(opts.tutor || '').trim();
  const blocks = (Array.isArray(opts.blocks) ? opts.blocks : []).filter((b) => b && ((b.students || []).length || b.weekdays));
  if (!blocks.length) throw new Error('没有班块');

  const rows = [];
  const st = [];
  const merges = [];
  const iso = (x) => new Date(x + 'T00:00:00');
  const fmt = (d) => `${d.getFullYear()}年 ${String(d.getMonth() + 1).padStart(2, '0')} 月 ${String(d.getDate()).padStart(2, '0')} 日`;

  blocks.forEach((b, bi) => {
    const students = (b.students || []).filter((x) => String((x && x.name) || '').trim());
    const wds = (b.weekdays && b.weekdays.length ? b.weekdays : [1]).map(Number);
    const interval = Math.max(1, Number(b.interval || 1));
    const start = /^\d{4}-\d{2}-\d{2}$/.test(String(b.startDate || '')) ? b.startDate : null;
    if (!start) throw new Error('第' + (bi + 1) + '个班块没有首课日期');
    const sd = iso(start);
    const endCap = /^\d{4}-\d{2}-\d{2}$/.test(String(b.endDate || '')) ? iso(b.endDate) : null;

    const dates = [];
    const week0 = new Date(sd);
    week0.setDate(week0.getDate() - ((week0.getDay() + 6) % 7));
    for (let w = 0; w < 40 && dates.length < 60; w += interval) {
      for (const wd of wds) {
        const d = new Date(week0);
        d.setDate(d.getDate() + w * 7 + ((wd + 6) % 7));
        if (d < sd) continue;
        if (endCap && d > endCap) continue;
        dates.push(d);
      }
    }
    dates.sort((a, b2) => a - b2);
    if (!endCap && dates.length > 24) dates.length = 24;
    const n = Math.max(1, dates.length);
    const last = dates.length ? dates[dates.length - 1] : sd;

    const showCls = students.some((x) => x && String(x.cls || '').trim());
    const left = showCls ? ['序号', '姓名', '联系方式', '班级', '项目'] : ['序号', '姓名', '联系方式', '项目'];
    const base = left.length;
    const total = base + n;

    const title = `${label}  ${course ? course + '  ' : ''}学员考勤表${org ? '（' + org + '）' : ''}`;
    rows.push([title]); st.push([S.title]);
    merges.push(`A${rows.length}:${colName(total)}${rows.length}`);

    rows.push([`起始日期：${fmt(sd)}      结课日期：${fmt(last)}`]); st.push([S.head]);
    merges.push(`A${rows.length}:${colName(total)}${rows.length}`);

    const info = [];
    if (course) info.push('课程：' + course);
    if (tutor) info.push('班主任：' + tutor);
    rows.push([info.join('        ')]); st.push([S.head]);
    merges.push(`A${rows.length}:${colName(total)}${rows.length}`);

    const hr1 = left.slice();
    for (let i = 1; i <= n; i += 1) hr1.push(i);
    const hrSty = left.map(() => S.wrapHead).concat(Array(n).fill(S.head));
    rows.push(hr1); st.push(hrSty);
    const hRow = rows.length;
    for (let c = 1; c <= base; c += 1) merges.push(`${colName(c)}${hRow}:${colName(c)}${hRow + 1}`);

    const dr = ['', '', '', '', ''].slice(0, base);
    for (const d of dates) dr.push(`${d.getMonth() + 1}/${d.getDate()}`);
    rows.push(dr); st.push(Array(total).fill(S.head));

    const list = students.length ? students : [{}];
    list.forEach((s2, i) => {
      const line = [i + 1, s2.name || '', s2.phone || ''];
      if (showCls) line.push(s2.cls || '');
      line.push(s2.sex || '');
      for (let k = 0; k < n; k += 1) line.push('');
      rows.push(line);
      st.push(line.map((_, k) => (k === 0 ? S.num : k === 1 ? S.name : S.cell)));
    });

    rows.push(Array(total).fill('')); st.push(Array(total).fill(S.cell));
  });

  const maxCols = Math.max(...rows.map((r) => r.length));
  const dateCols = Array.from({ length: Math.max(0, maxCols - 5) }, () => 9);
  const sheet = sheetXml(rows, st, merges, { cols: [5, 11, 15, 8, 6].concat(dateCols), freeze: 'A6' });
  const name = `${label}学员考勤表`;
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from(CT, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(RELS, 'utf8') },
    { name: 'xl/workbook.xml', data: Buffer.from(WB(name), 'utf8') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from(WBREL, 'utf8') },
    { name: 'xl/styles.xml', data: Buffer.from(STYLES, 'utf8') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet, 'utf8') },
  ]);
}

module.exports = { buildAttendance, buildCampus, buildTeacher, buildStudent };

