'use strict';
/**
 * 用「用户自己的模板」生成考勤表
 *
 * 思路：不重建表格，而是**认得出模板里的日期格与姓名格**，然后只改这些格子的文字。
 * 这样原有的字体、颜色、边框、合并、列宽、公式全部原样保留 —— 就是用户熟悉的那个表。
 *
 * 认日期格：一个格里同时写着「数字 + 星期几」（如 "1 \n四"、"16    五"、"3    六"）
 * 认姓名：某一列的表头写「姓名」，下面紧跟若干行格子（就是学生位）
 */

const X = require('./extract');

const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];

function norm(t) {
  return String(t == null ? '' : t).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 把一个格子拆成 {day, week} 或 null */
function parseDayCell(text) {
  const t = String(text == null ? '' : text);
  if (!t.trim()) return null;
  const m = t.match(/(?:^|\s)(\d{1,2})(?!\d)([\s\S]*)$/);
  if (!m) return null;
  const day = Number(m[1]);
  if (!(day >= 1 && day <= 31)) return null;
  const rest = m[2] || '';
  const wm = rest.match(/([一二三四五六日天])/);
  const week = wm ? (wm[1] === '天' ? '日' : wm[1]) : '';
  // 只允许「数字 + 可选星期」这种形状，避免把 "2026年11月" 当日期格
  const left = norm(rest.replace(/[一二三四五六日天]/g, ''));
  if (left.length > 6) return null;
  return { day, week };
}

/** 合并区域 → 每个格子映射到它的锚点格；非锚点格写不进去 */
function mergeAnchors(merges) {
  const map = new Map();
  for (const range of (merges || [])) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(range));
    if (!m) continue;
    const c1 = X.colToNum(m[1]), r1 = Number(m[2]), c2 = X.colToNum(m[3]), r2 = Number(m[4]);
    for (let rr = r1; rr <= r2; rr++) {
      for (let cc = c1; cc <= c2; cc++) map.set(X.numToCol(cc) + rr, X.numToCol(c1) + r1);
    }
  }
  return map;
}

/** 从表头行认出各列：序号 / 姓名 / 电话 / 班级 / 性别 */
function headerCols(row, nameCol) {
  const out = { no: -1, name: nameCol, phone: -1, cls: -1, sex: -1 };
  for (let c = 0; c < (row || []).length; c++) {
    const cell = row[c];
    const t = cell && cell.text ? norm(cell.text) : '';
    if (!t) continue;
    if (out.no < 0 && /^(序号|编号|no\.?|#)$/i.test(t)) out.no = c;
    else if (out.phone < 0 && /电话|手机|联系方式|联络/.test(t)) out.phone = c;
    else if (out.sex < 0 && /性别/.test(t)) out.sex = c;
    else if (out.cls < 0 && /^(班级|级别|班组|班别)$/.test(t)) out.cls = c;
  }
  if (out.name < 0 && nameCol >= 0) out.name = nameCol;
  return out;
}
function isNameHeader(t) {
  const s = norm(t);
  return s === '姓名' || s === '学生' || s === '学生姓名' || s === '学员' || s === '人员';
}

/**
 * 分析模板：找出每个「日期行 → 姓名行 → 学生行」块
 */
function analyse(buf, opts) {
  opts = opts || {};
  const read = X.xlsxRead(buf, { grid: true });
  const out = { sheets: [], month: opts.month || '' };

  read.sheets.forEach((sh, si) => {
    const blocks = [];
    const grid = sh.grid || [];
    for (let r = 0; r < grid.length; r++) {
      const row = grid[r];
      const dayCells = [];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!cell || !cell.text) continue;
        const d = parseDayCell(cell.text);
        if (d) dayCells.push({ col: c, day: d.day, week: d.week, ref: cell.ref, text: cell.text, sid: cell.sid });
      }
      if (dayCells.length < 5) continue;
      // 必须能看出这是「日期」而不是「第几课」：本行大多数格子带星期，或者下一行是星期行
      const withWeek = dayCells.filter((d) => d.week).length;
      let nextIsWeek = false;
      {
        const nrow = grid[r + 1] || [];
        let hit = 0;
        for (const d of dayCells) {
          const c = nrow[d.col];
          if (c && c.text && /^\s*[日一二三四五六天]\s*$/.test(String(c.text))) hit++;
        }
        nextIsWeek = hit >= Math.max(3, Math.floor(dayCells.length * 0.6));
      }
      if (withWeek < dayCells.length * 0.6 && !nextIsWeek) continue;
      // 要求基本连续递增
      let inc = 0;
      for (let i = 1; i < dayCells.length; i++) if (dayCells[i].day === dayCells[i - 1].day + 1) inc++;
      if (inc < dayCells.length - 2) continue;

      // 找姓名表头行：本行或下面一行（允许日期行下面紧跟表头）
      let nameHeaderRow = -1, nameCol = -1;
      for (let rr = r; rr <= Math.min(r + 2, grid.length - 1); rr++) {
        const rowR = grid[rr] || [];
        for (let c = 0; c < rowR.length; c++) {
          if (rowR[c] && isNameHeader(rowR[c].text)) { nameHeaderRow = rr; nameCol = c; break; }
        }
        if (nameCol >= 0) break;
      }
      if (nameCol < 0) {
        // 退一步：用日期行左边的列当姓名列（A 列常见）
        nameCol = 0;
        nameHeaderRow = r;
      }

      // 学生行：从表头下一行开始，一直数到「下一个日期行」或「统计块」为止
      // 空行也算学生位（空模板就是这种），否则认不出干净模板
      const isDayRow = (rr) => {
        let cnt = 0;
        for (const cc of grid[rr] || []) if (cc && cc.text && parseDayCell(cc.text)) cnt++;
        return cnt >= 5;
      };
      const anchorOf2 = new Map();
      for (const range of (sh.merges || [])) {
        const m4 = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(range));
        if (!m4) continue;
        const c1 = X.colToNum(m4[1]), r1 = Number(m4[2]), c2 = X.colToNum(m4[3]), r2 = Number(m4[4]);
        for (let rr2 = r1; rr2 <= r2; rr2++) {
          for (let cc = c1; cc <= c2; cc++) anchorOf2.set(X.numToCol(cc) + rr2, X.numToCol(c1) + r1);
        }
      }
      const nameRows = [];
      for (let rr = nameHeaderRow + 1; rr < grid.length; rr++) {
        if (isDayRow(rr)) break;
        const cell = (grid[rr] || [])[nameCol];
        const txt = cell && cell.text ? norm(cell.text) : '';
        if (txt && (isNameHeader(txt) || parseDayCell(txt))) break;
        const rowText = (grid[rr] || []).filter((c) => c && c.text).map((c) => norm(c.text)).join('|');
        if (!txt && /本月|上月|合计|总计|调休|请假天数|本月结余/.test(rowText)) break;
        const refN = cell && cell.ref ? cell.ref : (nameCol >= 0 ? X.numToCol(nameCol + 1) + (rr + 1) : '');
        const anc = refN ? anchorOf2.get(refN) : null;
        if (anc && anc !== refN) continue;
        nameRows.push({ row: rr, ref: refN, oldText: txt });
        if (nameRows.length > 60) break;
      }

      blocks.push({
        dayStyled: dayCells.map((d) => ({ col: d.col, day: d.day, week: d.week, sid: d.sid })),
        dayRow: r,
        nameHeaderRow,
        nameCol,
        nameRows,
        dayCols: dayCells.map((d) => ({ col: d.col, day: d.day, week: d.week, sid: d.sid })),
        firstDay: dayCells[0].day,
        lastDay: dayCells[dayCells.length - 1].day,
      });
    }
    // ---- 第三种版式：「1 2 3 …」课次 + 下一行「3.2-8」这种周区间 ----
    if (!blocks.length) {
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r] || [];
        let nameCol = -1;
        for (let c = 0; c < row.length; c++) {
          if (row[c] && isNameHeader(row[c].text)) { nameCol = c; break; }
        }
        if (nameCol < 0) continue;
        const nr = grid[r + 1] || [];
        const cols = [];
        for (let c = nameCol + 1; c < row.length; c++) {
          const ht = row[c] && row[c].text ? String(row[c].text).trim() : '';
          const rt = nr[c] && nr[c].text ? String(nr[c].text).trim() : '';
          const isNum = /^\d{1,2}$/.test(ht);
          const isRange = /^\d{1,2}\s*[.\/月]\s*\d{1,2}\s*[-~至]\s*\d{1,2}\s*[.\/日]?\s*\d{0,2}/.test(rt);
          if (isNum || isRange) cols.push({ col: c, sid: row[c] ? row[c].sid : 0, header: ht, range: rt });
          else if (cols.length) break;
        }
        if (cols.length < 3) continue;
        const nameRows = [];
        for (let rr = r + 2; rr < grid.length; rr++) {
          const cell = (grid[rr] || [])[nameCol];
          const txt = cell && cell.text ? norm(cell.text) : '';
          const rowText = (grid[rr] || []).filter((c) => c && c.text).map((c) => norm(c.text)).join('|');
          if (/合计|总计|备注|签名|起始|结课|上课时间/.test(rowText)) break;
          if (txt && isNameHeader(txt)) continue;
          if (nameRows.length > 90) break;
          if (!txt && nameRows.length) break;
          nameRows.push({ row: rr, ref: cell ? cell.ref : '', oldText: txt });
        }
        if (!nameRows.length) continue;
        blocks.push({
          kind: 'weeks',
          dayRow: r,
          rangeRow: r + 1,
          numRow: r,
          nameHeaderRow: r,
          nameCol,
          nameRows,
          dayCols: cols,
          firstDay: 0,
          lastDay: cols.length,
        });
        r += 1;
      }
    }

    // ---- 另一种常见版式：一行「课次 1 2 3…」+ 一行「日期」写具体日期（一张表里可能有多块） ----
    {
      for (let r = 0; r < grid.length; r++) {
        const row = grid[r] || [];
        let labelCol = -1;
        for (let c = 0; c < row.length; c++) {
          const t = row[c] && row[c].text ? norm(row[c].text) : '';
          if (t === '日期' || t === '上课日期') { labelCol = c; break; }
        }
        if (labelCol < 0) continue;
        const cols = [];
        for (let c = labelCol + 1; c < row.length; c++) {
          const cell = row[c];
          if (!cell) continue;
          const t = cell.text == null ? '' : String(cell.text).trim();
          let serial = 0;
          if (/^\d{4,6}(\.\d+)?$/.test(t)) serial = Number(t);
          const isDate = serial >= 20000 && serial <= 80000;
          if (!t && !cell.ref) continue;
          if (!isDate) { if (cols.length) break; else continue; }
          cols.push({ col: c, sid: cell.sid, serial });
        }
        if (cols.length < 3) continue;
        // 课次行：日期行上一行里，在同一批列上写着递增数字
        let numRow = -1;
        for (let rr = r - 1; rr >= Math.max(0, r - 2); rr--) {
          const nr = grid[rr] || [];
          let cnt = 0;
          for (const cc of cols) { const x = nr[cc.col]; if (x && /^\d{1,2}$/.test(String(x.text || '').trim())) cnt++; }
          if (cnt >= Math.max(2, cols.length * 0.6)) { numRow = rr; break; }
        }
        // 姓名表头：日期行下方 1–8 行内找「姓名」
        let nameHeaderRow = -1, nameCol = -1;
        for (let rr = r + 1; rr <= Math.min(r + 8, grid.length - 1); rr++) {
          const nr = grid[rr] || [];
          for (let c = 0; c < nr.length; c++) {
            if (nr[c] && isNameHeader(nr[c].text)) { nameHeaderRow = rr; nameCol = c; break; }
          }
          if (nameCol >= 0) break;
        }
        if (nameCol < 0) continue;
        const nameRows = [];
        for (let rr = nameHeaderRow + 1; rr < grid.length; rr++) {
          const cell = (grid[rr] || [])[nameCol];
          const txt = cell && cell.text ? norm(cell.text) : '';
          const rowText = (grid[rr] || []).filter((c) => c && c.text).map((c) => norm(c.text)).join('|');
          if (/合计|总计|备注|签名|起始|结课|班主任|上课时间|放假/.test(rowText)) break;
          if (txt && isNameHeader(txt)) break;
          if (nameRows.length > 80) break;
          nameRows.push({ row: rr, ref: cell ? cell.ref : '', oldText: txt });
        }
        // 表头下面常有一行是空白的分隔行，去掉开头的空行，避免姓名整体错位
        const ancMapS = mergeAnchors(sh.merges);
        for (let ni = nameRows.length - 1; ni >= 0; ni--) {
          const rw = nameRows[ni];
          const ref2 = rw.ref || (nameCol >= 0 ? X.numToCol(nameCol + 1) + (rw.row + 1) : '');
          const anc2 = ref2 ? ancMapS.get(ref2) : null;
          if (anc2 && anc2 !== ref2) nameRows.splice(ni, 1);
        }
        while (nameRows.length > 1 && !nameRows[0].oldText && nameRows[1].oldText) nameRows.shift();
        if (!nameRows.length) continue;
        blocks.push({
          kind: 'sessions',
          dayRow: r,
          numRow,
          nameHeaderRow,
          nameCol,
          nameRows,
          dayCols: cols.map((c) => ({ col: c.col, sid: c.sid, day: 0, week: '' })),
          firstDay: 0,
          lastDay: cols.length,
        });
        r += 1; // 同一张表里可能还有下一块

      }
    }

    for (const b of blocks) {
      const hrow = grid[b.nameHeaderRow] || grid[b.dayRow] || [];
      b.cols = headerCols(hrow, b.nameCol);
      if (b.cols.sex < 0) {
        const nr2 = grid[b.nameHeaderRow + 1] || [];
        for (let c = 0; c < nr2.length; c++) {
          const t = nr2[c] && nr2[c].text ? norm(nr2[c].text) : '';
          if (/^性别$/.test(t)) { b.cols.sex = c; break; }
        }
      }
      const cellAt = (r, c) => (c >= 0 && grid[r] && grid[r][c] && grid[r][c].text ? norm(grid[r][c].text) : '');
      b.rows = b.nameRows.map((nr) => ({
        name: nr.oldText || '',
        phone: cellAt(nr.row, b.cols.phone),
        cls: cellAt(nr.row, b.cols.cls),
        sex: cellAt(nr.row, b.cols.sex),
      }));
      // 首课日期（sessions/weeks 版式里是真实日期序列），用来给界面推断默认上课星期
      let firstSerial = null;
      if (b.kind === 'sessions' && b.dayCols.length) {
        const g = grid[b.dayRow] && grid[b.dayRow][b.dayCols[0].col];
        const v = g && g.raw != null ? g.raw : (g && g.text);
        const n = Number(v);
        if (n > 20000 && n < 80000) firstSerial = Math.round(n);
      }
      b.firstSerial = firstSerial;
      b.firstWeekday = firstSerial == null ? null : new Date(Date.UTC(1899, 11, 30) + firstSerial * 86400000).getDay();
      b.firstIso = firstSerial == null ? null : new Date(Date.UTC(1899, 11, 30) + firstSerial * 86400000).toISOString().slice(0, 10);
    }
    out.sheets.push({ index: si, name: sh.name, path: sh.path, blocks, maxRow: sh.maxRow, maxCol: sh.maxCol });
  });

  out.summary = out.sheets
    .filter((s) => s.blocks.length)
    .map((s) => ({
      index: s.index,
      name: s.name,
      blocks: s.blocks.length,
      slots: s.blocks.reduce((a, b) => a + b.nameRows.length, 0),
      days: s.blocks.reduce((a, b) => a + b.dayCols.length, 0),
    }));
  out.ok = out.summary.length > 0;
  return out;
}

// 按「星期 + 间隔 + 起止日期」枚举上课日期（ISO 字符串）
function enumerateDates(opts) {
  opts = opts || {};
  const wds = (Array.isArray(opts.weekdays) ? opts.weekdays : []).map(Number).filter((n) => n >= 0 && n <= 6);
  const intv = Math.max(1, Number(opts.interval) || 1);
  const start = String(opts.startDate || '').trim();
  const end = String(opts.endDate || '').trim();
  if (!wds.length || !start) return [];
  const s0 = new Date(start + 'T00:00:00');
  if (isNaN(s0.getTime())) return [];
  let e0 = end ? new Date(end + 'T00:00:00') : null;
  if (!e0 || isNaN(e0.getTime())) { e0 = new Date(s0); e0.setMonth(e0.getMonth() + 5); }
  const wkStart = new Date(s0); wkStart.setDate(wkStart.getDate() - ((wkStart.getDay() + 6) % 7));
  const out = [];
  const d = new Date(s0);
  while (d <= e0 && out.length < 300) {
    const wd = d.getDay();
    const daysFrom = Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(wkStart.getFullYear(), wkStart.getMonth(), wkStart.getDate())) / 86400000);
    if (wds.indexOf(wd) >= 0 && (Math.floor(daysFrom / 7) % intv) === 0) {
      const mm = d.getMonth() + 1, dd = d.getDate();
      out.push(d.getFullYear() + '-' + (mm < 10 ? '0' + mm : mm) + '-' + (dd < 10 ? '0' + dd : dd));
    }
    d.setDate(d.getDate() + 1);
  }
  return out;
}

function daysInMonth(month) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(month || ''));
  if (!m) return 31;
  return new Date(Number(m[1]), Number(m[2]), 0).getDate();
}

function monthFirstWeekday(month) {
  const m = /^(\d{4})-(\d{1,2})$/.exec(String(month || ''));
  if (!m) return 0;
  return new Date(Number(m[1]), Number(m[2]) - 1, 1).getDay();
}

/** 选目标工作表：名字匹配「11月」之类的优先，否则第一个有块的 */
function pickSheet(an, month) {
  const withBlocks = an.sheets.filter((s) => s.blocks.length);
  if (!withBlocks.length) return null;
  const mm = /^(\d{4})-(\d{1,2})$/.exec(String(month || ''));
  if (mm) {
    const want = String(Number(mm[2]));
    const hit = withBlocks.find((s) => norm(s.name).replace(/[^0-9]/g, '') === want);
    if (hit) return hit;
    const hit2 = withBlocks.find((s) => s.name.indexOf(want + '月') >= 0);
    if (hit2) return hit2;
  }
  return withBlocks[0];
}

/**
 * 按模板生成
 * opts: { month:'2026-11', names:[...], sheet: 指定工作表名 || '', course, org }
 */
function fill(buf, opts) {
  opts = opts || {};
  const an = analyse(buf, opts);
  const sheet = pickSheet(an, opts.month);
  if (!sheet) throw new Error('这个模板里没找到「日期格 + 姓名列」的结构，请在模板里保留「1 2 3 …」和「姓名」这两行。');

  const readSheets = X.xlsxRead(buf, { grid: true }).sheets;
  const total = daysInMonth(opts.month);
  const firstWeek = monthFirstWeekday(opts.month);
  const students = (Array.isArray(opts.students) && opts.students.length)
    ? opts.students
        .map((x) => ({
          name: String(x && x.name ? x.name : '').trim(),
          phone: String(x && x.phone ? x.phone : '').trim(),
          cls: String(x && x.cls ? x.cls : '').trim(),
          sex: String(x && x.sex ? x.sex : '').trim(),
        }))
        .filter((x) => x.name)
    : (opts.names || []).map((n) => ({ name: String(n).trim(), phone: '', cls: '', sex: '' })).filter((x) => x.name);
  const blockHasStudents = (opts.blocks || []).some((x) => x && Array.isArray(x.students) && x.students.length);
  if (!students.length && !blockHasStudents) throw new Error('没有填写学生名单。');
  const names = students.map((x) => x.name);

  // 模板若还有「电话 / 班级 / 性别」列，按检测到的列位置一并写入
  const pushExtra = (b, nr, st) => {
    if (!b || !b.cols) return;
    st = st || {};
    const put = (col, val) => {
      if (col == null || col < 0) return;
      const rf = X.numToCol(col + 1) + (nr.row + 1);
      edits.push({ ref: rf, value: val == null ? '' : String(val) });
      usedRefs.add(rf);
    };
    put(b.cols.phone, st.phone);
    put(b.cols.cls, st.cls);
    put(b.cols.sex, st.sex);
  };

  const edits = [];
  let dayPtr = 1;
  let namePtr = 0;
  let slots = 0;
  const origToNew = new Map();
  const usedRefs = new Set();

  // 目标月份的上课日期（按选择的上课星期）
  const wds = (Array.isArray(opts.weekdays) && opts.weekdays.length) ? opts.weekdays.map(Number) : [6, 0];
  const blocksCfg = Array.isArray(opts.blocks) ? opts.blocks : [];
  const tutorName = String(opts.tutor || '').trim();
  const blockRange = new Map(); // dayRow -> { first, last }（序列号）
  const serialDate = (iso) => {
    const mm = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!mm) return null;
    return Math.round((Date.UTC(+mm[1], +mm[2] - 1, +mm[3]) - Date.UTC(1899, 11, 30)) / 86400000);
  };
  const classDates = [];
  {
    const [y, m] = String(opts.month).split('-').map(Number);
    for (let d = 1; d <= total; d++) {
      const wd = new Date(y, m - 1, d).getDay();
      if (wds.indexOf(wd) >= 0) classDates.push(d);
    }
  }
  const pad2 = (n) => (n < 10 ? '0' + n : '' + n);
  const serialOf = (y, m, d) => Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);

  // 合并单元格：非锚点格里写不进去，跳过（否则名字会丢）
  const anchorMap = (() => {
    const map = new Map();
    const srcSheet = readSheets[sheet.index] || {};
    for (const range of (srcSheet.merges || [])) {
      const m3 = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(String(range));
      if (!m3) continue;
      const c1 = X.colToNum(m3[1]), r1 = Number(m3[2]), c2 = X.colToNum(m3[3]), r2 = Number(m3[4]);
      for (let rr = r1; rr <= r2; rr++) {
        for (let cc = c1; cc <= c2; cc++) map.set(X.numToCol(cc) + rr, X.numToCol(c1) + r1);
      }
    }
    return map;
  })();
  const writ = (nr) => { const anchor = anchorMap.get(nr.ref); return !anchor || anchor === nr.ref; };

  let blockIdx = -1;
  for (const b of sheet.blocks) {
    blockIdx += 1;
    slots += b.nameRows.length;
    // 块级名单优先：opts.blocks[i].students 存在时，这个块用它自己的名单
    const cfgB = blocksCfg[blockIdx] || null;
    const ownStud = cfgB && Array.isArray(cfgB.students) && cfgB.students.length
      ? cfgB.students.map((x) => ({
          name: String(x && x.name ? x.name : '').trim(),
          phone: String(x && x.phone ? x.phone : '').trim(),
          cls: String(x && x.cls ? x.cls : '').trim(),
          sex: String(x && x.sex ? x.sex : '').trim(),
        })).filter((x) => x.name)
      : null;
    const ownNames = ownStud ? ownStud.map((x) => x.name) : null;
    let ownPtr = 0;
    if (b.kind === 'weeks') {
      const [y, m] = String(opts.month).split('-').map(Number);
      const first = new Date(y, m - 1, 1);
      let cursor = new Date(first);
      cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7)); // 回到当周周一
      for (let i = 0; i < b.dayCols.length; i++) {
        const dc = b.dayCols[i];
        const start = new Date(cursor); start.setDate(start.getDate() + i * 7);
        const end = new Date(start); end.setDate(end.getDate() + 6);
        const ref = X.numToCol(dc.col + 1) + (b.rangeRow + 1);
        const touchesMonth = (start.getMonth() + 1 === m) || (end.getMonth() + 1 === m);
        const endTxt = (end.getMonth() === start.getMonth()) ? String(end.getDate()) : (end.getMonth() + 1) + '.' + end.getDate();
        edits.push({ ref, value: touchesMonth ? (start.getMonth() + 1) + '.' + start.getDate() + '-' + endTxt : '' });
        usedRefs.add(ref);
      }
      for (const nr of b.nameRows.filter(writ)) {
        for (const dc of b.dayCols) {
          const ref = X.numToCol(dc.col + 1) + (nr.row + 1);
          edits.push({ ref, value: '' });
          usedRefs.add(ref);
        }
        const pool = ownStud || students;
        const idx = ownStud ? ownPtr : namePtr;
        if (idx >= pool.length) continue;
        const ref = X.numToCol(b.nameCol + 1) + (nr.row + 1);
        edits.push({ ref, value: pool[idx].name });
        pushExtra(b, nr, pool[idx]);
        if (ownStud) ownPtr += 1; else namePtr += 1;
        usedRefs.add(ref);
      }
      continue;
    }
    if (b.kind === 'sessions') {
      const [y, m] = String(opts.month).split('-').map(Number);
      const colN = b.dayCols.length;
      const cfg = blocksCfg[blockIdx] || null;
      const blockDates = cfg && cfg.startDate
        ? enumerateDates(cfg).map(serialDate).filter((v) => v != null)
        : classDates.map((d) => serialOf(y, m, d));
      const intv = Math.max(1, Number((cfg && cfg.interval) || 1));
      if (blockDates.length) {
        blockRange.set(b.dayRow, { first: blockDates[0], last: blockDates[blockDates.length - 1] });
      }
      for (let i = 0; i < colN; i++) {
        const dc = b.dayCols[i];
        const ref = X.numToCol(dc.col + 1) + (b.dayRow + 1);
        if (i < blockDates.length) {
          const wdN = (cfg && Array.isArray(cfg.weekdays) ? cfg.weekdays.length : wds.length);
          if (i === 0) {
            edits.push({ ref, value: String(blockDates[0]), s: dc.sid });
          } else if (wdN <= 1) {
            // 每周固定一天：写成公式，改首课日后面自动跟（隔周则 +14）
            const prev = X.numToCol(dc.col) + (b.dayRow + 1);
            edits.push({ ref, f: prev + '+' + (7 * intv), s: dc.sid });
          } else {
            // 一周多天：间隔不固定，直接写日期
            edits.push({ ref, value: String(blockDates[i]), s: dc.sid });
          }
        } else {
          edits.push({ ref, value: '', s: dc.sid });
        }
        usedRefs.add(ref);
        if (b.numRow >= 0) {
          const nref = X.numToCol(dc.col + 1) + (b.numRow + 1);
          edits.push({ ref: nref, value: i < blockDates.length ? String(i + 1) : '' });
          usedRefs.add(nref);
        }
      }
      for (const nr of b.nameRows.filter(writ)) {
        const pool = ownStud || students;
        const idx = ownStud ? ownPtr : namePtr;
        if (idx >= pool.length) break;
        for (const dc of b.dayCols) {
          const ref = X.numToCol(dc.col + 1) + (nr.row + 1);
          edits.push({ ref, value: '' });
          usedRefs.add(ref);
        }
        const ref = X.numToCol(b.nameCol + 1) + (nr.row + 1);
        edits.push({ ref, value: pool[idx].name });
        pushExtra(b, nr, pool[idx]);
        if (ownStud) ownPtr += 1; else namePtr += 1;
        usedRefs.add(ref);
      }
      continue;
    }
    // 模板里每个星期几用过的单元格样式（周末通常有底色），换月后按新星期重新挑
    const styleByWeek = {};
    for (const dc of b.dayCols) {
      if (dc.week && styleByWeek[dc.week] == null && dc.sid != null) styleByWeek[dc.week] = dc.sid;
    }
    // 日期格：从上一个块接着数
    for (const dc of b.dayCols) {
      const ref = X.numToCol(dc.col + 1) + (b.dayRow + 1);
      const w = (firstWeek + dayPtr - 1) % 7;
      const s = dayPtr <= total ? (styleByWeek[WEEK_CN[w]] != null ? styleByWeek[WEEK_CN[w]] : dc.sid) : dc.sid;
      if (dayPtr <= total) {
        edits.push({ ref, value: dayPtr + '\n' + WEEK_CN[w], s });
      } else {
        edits.push({ ref, value: '', s });
      }
      usedRefs.add(ref);
      dayPtr += 1;
    }
    // 学生名（同时清掉模板里残留的打勾/半天等标记，避免张冠李戴）
    for (const nr of b.nameRows.filter(writ)) {
      for (const dc of b.dayCols) {
        const ref = X.numToCol(dc.col + 1) + (nr.row + 1);
        edits.push({ ref, value: '' });
        usedRefs.add(ref);
      }
      const ref = X.numToCol(b.nameCol + 1) + (nr.row + 1);
      const pool = ownStud || students;
      const idx = ownStud ? ownPtr : namePtr;
      if (idx < pool.length) {
        edits.push({ ref, value: pool[idx].name });
        pushExtra(b, nr, pool[idx]);
        if (ownStud) ownPtr += 1; else namePtr += 1;
      } else {
        edits.push({ ref, value: '' });
      }
      usedRefs.add(ref);
    }
  }

  // 模板下方的统计表里还写着旧名字，整表扫一遍按顺序换掉
  if (origToNew.size) {
    const sheetData = readSheets[sheet.index];
    for (let r = 0; r < sheetData.grid.length; r++) {
      const row = sheetData.grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!cell || !cell.text) continue;
        if (usedRefs.has(cell.ref)) continue;
        const t = String(cell.text).trim();
        if (names.indexOf(t) >= 0) continue;
        if (origToNew.has(t)) {
          edits.push({ ref: cell.ref, value: origToNew.get(t), s: cell.sid });
        }
      }
    }
  }

  // 合并单元格：只允许写左上角那一格，否则 Excel 会判定文件损坏
  {
    const sheetData = readSheets[sheet.index];
    const anchorOf = new Map();
    for (const range of (sheetData.merges || [])) {
      const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
      if (!m) continue;
      const c1 = X.colToNum(m[1]), r1 = Number(m[2]), c2 = X.colToNum(m[3]), r2 = Number(m[4]);
      for (let rr = r1; rr <= r2; rr++) {
        for (let cc = c1; cc <= c2; cc++) {
          const ref = X.numToCol(cc) + rr;
          anchorOf.set(ref, X.numToCol(c1) + r1);
        }
      }
    }
    for (let i = edits.length - 1; i >= 0; i--) {
      const e = edits[i];
      const anchor = anchorOf.get(e.ref);
      if (anchor && anchor !== e.ref) edits.splice(i, 1);
    }
  }

  // 表头里若写着「起始日期…结课日期…」，一并改成上课区间（有班块配置就用班块的首课/结课）
  if (classDates.length) {
    const sheetData = readSheets[sheet.index];
    const [hy, hm] = String(opts.month).split('-').map(Number);
    let hy1 = hy, hm1 = hm, d1 = classDates[0];
    let hy2 = hy, hm2 = hm, d2 = classDates[classDates.length - 1];
    const isoList = [];
    for (const cfg of blocksCfg) {
      if (!cfg || !cfg.startDate) continue;
      const ds = enumerateDates(cfg);
      if (ds.length) { isoList.push(ds[0]); isoList.push(ds[ds.length - 1]); }
      if (cfg.endDate && /^\d{4}-\d{2}-\d{2}$/.test(cfg.endDate)) isoList.push(cfg.endDate);
    }
    if (isoList.length) {
      isoList.sort();
      const p1 = isoList[0].split('-').map(Number);
      const p2 = isoList[isoList.length - 1].split('-').map(Number);
      hy1 = p1[0]; hm1 = p1[1]; d1 = p1[2];
      hy2 = p2[0]; hm2 = p2[1]; d2 = p2[2];
    }
    const txt = '起始日期：' + hy1 + '年 ' + pad2(hm1) + ' 月 ' + pad2(d1) + ' 日      结课日期: ' + hy2 + '年 ' + pad2(hm2) + ' 月 ' + pad2(d2) + ' 日';
    for (let r = 0; r < sheetData.grid.length; r++) {
      const row = sheetData.grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!cell || !cell.text) continue;
        if (!/起始日期|结课日期/.test(String(cell.text))) continue;
        if (usedRefs.has(cell.ref)) continue;
        // 若这一行属于某个班块（下面最近的一个 dayRow），用该块自己的首末日期
        let rowTxt = txt;
        if (blockRange.size) {
          let bestRow = -1;
          for (const dr of blockRange.keys()) if (dr > r && (bestRow < 0 || dr < bestRow)) bestRow = dr;
          const rg = bestRow >= 0 ? blockRange.get(bestRow) : null;
          if (rg) {
            const iso = (v) => { const dt = new Date(Date.UTC(1899, 11, 30) + v * 86400000); return dt.toISOString().slice(0, 10).split('-').map(Number); };
            const p1 = iso(rg.first), p2 = iso(rg.last);
            rowTxt = '起始日期：' + p1[0] + '年 ' + pad2(p1[1]) + ' 月 ' + pad2(p1[2]) + ' 日      结课日期: ' + p2[0] + '年 ' + pad2(p2[1]) + ' 月 ' + pad2(p2[2]) + ' 日';
          }
        }
        edits.push({ ref: cell.ref, value: rowTxt });
        usedRefs.add(cell.ref);
      }
    }
  }

  // 班主任 / 上课老师：有填就写进去（模板里是「班主任：」这种前缀）
  if (tutorName) {
    const sheetData = readSheets[sheet.index];
    for (let r = 0; r < sheetData.grid.length; r++) {
      const row = sheetData.grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!cell || !cell.text) continue;
        const t = String(cell.text);
        const m2 = /^(班主任|上课老师|任课老师)\s*[:：]/.exec(t);
        if (!m2 || usedRefs.has(cell.ref)) continue;
        edits.push({ ref: cell.ref, value: m2[1] + '：' + tutorName });
        usedRefs.add(cell.ref);
      }
    }
  }

  // 标题里若写着「2026年春季…考勤表」，把年月换成目标月，避免和月份对不上
  {
    const sheetData = readSheets[sheet.index];
    const [ty, tm] = String(opts.month).split('-').map(Number);
    for (let r = 0; r < Math.min(8, sheetData.grid.length); r++) {
      const row = sheetData.grid[r] || [];
      for (let c = 0; c < row.length; c++) {
        const cell = row[c];
        if (!cell || !cell.text) continue;
        const t = String(cell.text);
        if (t.indexOf('考勤表') < 0) continue;
        if (usedRefs.has(cell.ref)) continue;
        const nt = t.replace(/20\d{2}\s*年\s*[春夏秋冬]\s*季?/g, ty + '年' + tm + '月');
        if (nt !== t) {
          edits.push({ ref: cell.ref, value: nt });
          usedRefs.add(cell.ref);
        }
      }
    }
  }

  const bySheet = {};
  bySheet[sheet.path] = edits;
  const outBuf = X.xlsxApplyEdits(buf, bySheet);

  return {
    buf: outBuf,
    sheet: sheet.name,
    sheetPath: sheet.path,
    blocks: sheet.blocks.length,
    slots,
    filled: namePtr,
    overflow: Math.max(0, names.length - slots),
    days: Math.min(dayPtr - 1, total),
    sessions: classDates.length,
    totalDays: total,
    analyse: an,
  };
}

/** 只留一张工作表，并把它的名字改掉 */
function keepOnlySheet(buf, keepPath, newName) {
  // 经验：Excel 对「部件被删掉但声明没同步」极其敏感（报“不能取得类 Workbooks 的 Open 属性”）。
  // 最稳的做法是不删任何部件，只把 <sheets> 改成一个，并把 activeTab 归零，其余原样保留。
  const zip = require('./zip');
  const files = zip.readAll(buf);
  const wbPath = 'xl/workbook.xml';
  const relPath = 'xl/_rels/workbook.xml.rels';
  const wbBuf = files.get(wbPath);
  const relBuf = files.get(relPath);
  if (!wbBuf || !relBuf) return buf;
  let wb = wbBuf.toString('utf8');
  const rels = relBuf.toString('utf8');

  const relMap = {};
  let rm;
  const relRe = /<Relationship\b[^>]*?Id="([^"]+)"[^>]*?Target="([^"]+)"[^>]*?>/g;
  while ((rm = relRe.exec(rels))) {
    let t = rm[2].replace(/^\.\//, '');
    if (t.indexOf('/') < 0) t = 'xl/' + t;
    else if (t.indexOf('xl/') !== 0) t = 'xl/' + t;
    relMap[rm[1]] = t;
  }

  let kept = null;
  const sheetRe = /<sheet\b([^>]*?)\/>/g;
  while ((rm = sheetRe.exec(wb))) {
    const attrs = rm[1];
    const rid = (attrs.match(/\br:id="([^"]+)"/) || [])[1] || '';
    if ((relMap[rid] || '') === keepPath) { kept = rm[0]; break; }
  }
  if (!kept) return buf;

  const safeName = String(newName).replace(/["<>]/g, '');
  const keptTag = kept.replace(/\bname="[^"]*"/, 'name="' + safeName + '"');
  wb = wb.replace(/<sheets>[\s\S]*?<\/sheets>/, '<sheets>' + keptTag + '</sheets>');
  wb = wb.replace(/(<workbookView\b[^>]*?)activeTab="\d+"/, '$1activeTab="0"');
  if (!/activeTab="/.test(wb)) wb = wb.replace(/<workbookView\b/, '<workbookView activeTab="0"');

  files.set(wbPath, Buffer.from(wb, 'utf8'));
  return zip.writeZip([...files].map(([name, data]) => ({ name, data })));
}

module.exports = { analyse, fill, keepOnlySheet, parseDayCell, daysInMonth, enumerateDates };
