'use strict';
/* 正文抽取 + Office 结构化读写（docx 段落、xlsx 单元格）。全部零依赖。 */
const zip = require('./zip');

const MAX_TEXT = 20000;

function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (m, d) => safeChar(parseInt(d, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
function safeChar(code) {
  try { return String.fromCodePoint(code); } catch (_) { return ''; }
}
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
const collapse = (s) => s.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/* ---------------------------- docx ---------------------------- */

function docxXml(buf) {
  const xml = zip.readOne(buf, 'word/document.xml');
  if (!xml) throw new Error('不是有效的 docx（缺 word/document.xml）');
  return xml.toString('utf8');
}

/* 段落格式：对齐、字号、粗斜下划线、颜色（取段内最长的 run 作代表） */
function paraStyle(p) {
  const jc = (p.match(/<w:jc w:val="([^"]+)"/) || [])[1] || '';
  const align = jc === 'center' ? 'center' : jc === 'right' ? 'right' : jc === 'both' || jc === 'distribute' ? 'justify' : '';
  const runs = [];
  const runRe = /<w:r(?:\s[^>]*)?>([\s\S]*?)<\/w:r>/g;
  let m;
  while ((m = runRe.exec(p))) {
    const body = m[1];
    const rPr = (body.match(/<w:rPr>[\s\S]*?<\/w:rPr>/) || [''])[0];
    const texts = body.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
    if (!texts.length) continue;
    const text = texts.map((t) => decodeEntities(t.replace(/<[^>]+>/g, ''))).join('').replace(/\u00a0/g, ' ');
    if (!text) continue;
    const sz = (rPr.match(/<w:sz w:val="(\d+)"/) || [])[1];
    const color = (rPr.match(/<w:color w:val="([0-9A-Fa-f]{6})"/) || [])[1];
    runs.push({
      text,
      b: /<w:b(?:\s|\/|>)/.test(rPr) && !/<w:b w:val="(0|false)"/.test(rPr),
      i: /<w:i(?:\s|\/|>)/.test(rPr) && !/<w:i w:val="(0|false)"/.test(rPr),
      u: /<w:u\b/.test(rPr) && !/<w:u w:val="none"/.test(rPr),
      sz: sz ? Number(sz) / 2 : 0,
      color: color ? '#' + color : '',
    });
  }
  let main = null;
  for (const r of runs) if (r.text.trim() && (!main || r.text.length > main.text.length)) main = r;
  if (!main && runs.length) main = runs[0];
  return {
    align,
    bold: !!(main && main.b),
    italic: !!(main && main.i),
    underline: !!(main && main.u),
    size: main ? main.sz : 0,
    color: main ? main.color : '',
    mixed: runs.length > 1 && runs.some((r) => r.b !== (main && main.b) || r.i !== (main && main.i) || r.sz !== (main && main.sz)),
  };
}

/** 返回 { paragraphs:[{index,text,empty}], blocks:[段落/表格，带格式] }，index 即正文顺序段落号 */
function docxParagraphs(buf) {
  const xml = docxXml(buf);
  const body = xml.replace(/<w:body>/, '\u0001').split('\u0001')[1] || xml;
  const tokRe = /<w:tbl\b[\s\S]*?<\/w:tbl>|<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
  const paragraphs = [];
  const blocks = [];
  let idx = 0;
  let tm;
  const pushPara = (p) => {
    const texts = p.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
    let text = '';
    for (const t of texts) text += decodeEntities(t.replace(/<[^>]+>/g, ''));
    text = text.replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ');
    const style = paraStyle(p);
    const item = { index: idx++, text, empty: !text.trim(), style };
    paragraphs.push({ index: item.index, text: item.text, empty: item.empty });
    return item;
  };
  while ((tm = tokRe.exec(body))) {
    const tok = tm[0];
    if (/^<w:tbl\b/.test(tok)) {
      const rows = [];
      const rowRe = /<w:tr\b[\s\S]*?<\/w:tr>/g;
      let rm;
      while ((rm = rowRe.exec(tok))) {
        const cells = [];
        const cellRe = /<w:tc\b[\s\S]*?<\/w:tc>/g;
        let cm;
        while ((cm = cellRe.exec(rm[0]))) {
          const span = Number((cm[0].match(/<w:gridSpan w:val="(\d+)"/) || [])[1] || 1);
          const cellParas = [];
          const pRe = /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g;
          let pm;
          while ((pm = pRe.exec(cm[0]))) cellParas.push(pushPara(pm[0]));
          cells.push({ span, paragraphs: cellParas });
        }
        rows.push(cells);
      }
      blocks.push({ type: 'tbl', rows });
    } else {
      const item = pushPara(tok);
      blocks.push({ type: 'p', index: item.index, text: item.text, style: item.style });
    }
  }
  return { paragraphs, blocks };
}

/** 按段落号回写文本：保留段落样式，段内多段 run 合并进第一个 w:t */
/**
 * 改写单个段落文本：新文本写进第一个 w:t，其余 w:t 清空（保留 run 样式），
 * 文本框 / 图形内的 w:t 不动。
 */
function setParaText(p, text) {
  const prot = [];
  const reProt = /<(w:drawing|w:pict|w:txbxContent|mc:AlternateContent)\b[\s\S]*?<\/\1>/g;
  let pm;
  while ((pm = reProt.exec(p))) prot.push([pm.index, pm.index + pm[0].length]);
  const inProt = (i) => prot.some(([a, b]) => i >= a && i < b);

  let first = true;
  let changed = false;
  const out = p.replace(/(<w:t(?:\s[^>]*)?>)([\s\S]*?)(<\/w:t>)/g, (all, open, val, close, off) => {
    if (inProt(off)) return all;
    changed = true;
    const openTag = /xml:space=/.test(open) ? open : open.replace(/^<w:t/, '<w:t xml:space="preserve"');
    if (first) {
      first = false;
      return openTag + esc(text) + close;
    }
    return openTag + close;
  });
  if (changed) return out;
  // 段落里没有 w:t（空段），塞一个进去
  if (/<w:pPr>[\s\S]*?<\/w:pPr>/.test(p)) {
    return p.replace(/(<w:pPr>[\s\S]*?<\/w:pPr>)/, '$1<w:r><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>');
  }
  return p.replace(/^<w:p(?:\s[^>]*)?>/, (m) => m + '<w:r><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r>');
}

function docxApplyParagraphs(buf, edits) {
  const files = zip.readAll(buf);
  let xml = files.get('word/document.xml').toString('utf8');
  const map = new Map(edits.map((e) => [Number(e.index), String(e.text ?? '')]));

  const bStart = xml.indexOf('<w:body>');
  const head = bStart >= 0 ? xml.slice(0, bStart + 8) : '';
  const rest = bStart >= 0 ? xml.slice(bStart + 8) : xml;
  let idx = 0;
  const rebuilt = rest.replace(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g, (p) => {
    if (!map.has(idx)) { idx++; return p; }
    return setParaText(p, map.get(idx++));
  });
  xml = head + rebuilt;
  files.set('word/document.xml', Buffer.from(xml, 'utf8'));
  return zip.writeZip([...files].map(([name, data]) => ({ name, data })));
}

/* ---------------------------- xlsx ---------------------------- */

function sharedStrings(files) {
  const buf = files.get('xl/sharedStrings.xml');
  if (!buf) return [];
  const xml = buf.toString('utf8');
  const items = xml.match(/<si>[\s\S]*?<\/si>/g) || [];
  return items.map((si) => {
    const t = si.match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || [];
    return t.map((x) => decodeEntities(x.replace(/<[^>]+>/g, ''))).join('');
  });
}

function sheetFiles(files) {
  const wb = files.get('xl/workbook.xml');
  const rels = files.get('xl/_rels/workbook.xml.rels');
  const out = [];
  if (wb && rels) {
    const relXml = rels.toString('utf8');
    const relMap = {};
    (relXml.match(/<Relationship\b[^>]*>/g) || []).forEach((r) => {
      const id = (r.match(/Id="([^"]+)"/) || [])[1];
      const target = (r.match(/Target="([^"]+)"/) || [])[1];
      if (id && target) relMap[id] = target.replace(/^\/?xl\//, '').replace(/^\.\//, '');
    });
    const sheetTags = wb.toString('utf8').match(/<sheet\b[^>]*>/g) || [];
    sheetTags.forEach((tag) => {
      const name = (tag.match(/name="([^"]*)"/) || [])[1] || '';
      const rid = (tag.match(/r:id="([^"]+)"/) || [])[1];
      const state = (tag.match(/state="([^"]+)"/) || [])[1];
      let path = relMap[rid];
      if (path && !path.startsWith('xl/')) path = 'xl/' + path;
      if (path && files.has(path)) out.push({ name: decodeEntities(name), path, hidden: state === 'hidden' || state === 'veryHidden' });
    });
  }
  if (!out.length) {
    for (const name of files.keys()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(name)) out.push({ name: name.split('/').pop(), path: name, hidden: false });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
  }
  return out;
}

function colToNum(col) {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function numToCol(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/* ---------- xlsx 样式 ---------- */
function argb(v) {
  if (!v) return '';
  const t = String(v);
  if (/^[0-9A-Fa-f]{8}$/.test(t)) return '#' + t.slice(2);
  if (/^#[0-9A-Fa-f]{6}$/.test(t)) return t;
  return '';
}

function parseXlsxStyles(files) {
  const out = { fonts: [], fills: [], xfs: [] };
  const f = files.get('xl/styles.xml');
  if (!f) return out;
  const xml = f.toString('utf8');
  const block = (tag) => (xml.match(new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)</' + tag + '>')) || [])[1] || '';
  let m;
  const fontsXml = block('fonts');
  const fontRe = /<font\b[^>]*>([\s\S]*?)<\/font>/g;
  while ((m = fontRe.exec(fontsXml))) {
    const body = m[1];
    const sz = (body.match(/<sz val="([\d.]+)"/) || [])[1];
    out.fonts.push({
      b: /<b(?:\s|\/|>)/.test(body) && !/<b val="(0|false)"/.test(body),
      i: /<i(?:\s|\/|>)/.test(body) && !/<i val="(0|false)"/.test(body),
      u: /<u(?:\s|\/|>)/.test(body) && !/<u val="none"/.test(body),
      sz: sz ? Number(sz) : 0,
      color: argb((body.match(/<color rgb="([0-9A-Fa-f]{8})"/) || [])[1]),
    });
  }
  const fillsXml = block('fills');
  const fillRe = /<fill\b[^>]*>([\s\S]*?)<\/fill>/g;
  while ((m = fillRe.exec(fillsXml))) {
    const body = m[1];
    const pat = (body.match(/<patternFill patternType="([^"]+)"/) || [])[1] || '';
    const fg = argb((body.match(/<fgColor rgb="([0-9A-Fa-f]{8})"/) || [])[1]);
    out.fills.push({ bg: pat && pat !== 'none' && fg ? fg : '' });
  }
  const xfsXml = block('cellXfs');
  const xfRe = /<xf\b[^>]*?(?:\/>|>[\s\S]*?<\/xf>)/g;
  while ((m = xfRe.exec(xfsXml))) {
    const tag = m[0];
    const al = (tag.match(/<alignment\b[^>]*\/?>/) || [''])[0];
    out.xfs.push({
      fontId: Number((tag.match(/fontId="(\d+)"/) || [])[1] || 0),
      fillId: Number((tag.match(/fillId="(\d+)"/) || [])[1] || 0),
      align: (al.match(/horizontal="([^"]+)"/) || [])[1] || '',
      wrap: /wrapText="1"/.test(al),
    });
  }
  return out;
}

function cellStyle(styles, id) {
  const xf = styles.xfs[id];
  if (!xf) return null;
  const font = styles.fonts[xf.fontId] || {};
  const fill = styles.fills[xf.fillId] || {};
  const st = {};
  if (font.b) st.b = 1;
  if (font.i) st.i = 1;
  if (font.u) st.u = 1;
  if (font.sz) st.sz = font.sz;
  if (font.color) st.color = font.color;
  if (fill.bg) st.bg = fill.bg;
  if (xf.align && xf.align !== 'general') st.align = xf.align;
  if (xf.wrap) st.wrap = 1;
  return Object.keys(st).length ? st : null;
}

function parseSheet(xml, sst) {
  const rows = [];
  // 注意：空行常写成自闭合 <row r="1"/>，必须单独匹配，否则会把下一行的内容并进来
  const rowRe = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
  let rm;
  while ((rm = rowRe.exec(xml))) {
    const attrs = rm[1];
    const body = rm[3] || '';
    const rnum = Number((attrs.match(/\br="(\d+)"/) || [])[1] || rows.length + 1);
    const cells = [];
    const cellTags = body.match(/<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) || [];
    for (const c of cellTags) {
      const ref = (c.match(/\br="([A-Z]+)(\d+)"/) || []);
      const t = (c.match(/\bt="([^"]+)"/) || [])[1] || '';
      const sid = Number((c.match(/\bs="(\d+)"/) || [])[1] || 0);
      const hasF = /<f[\s>]/.test(c);
      let text = '';
      if (t === 's') {
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        text = v != null ? sst[Number(v)] ?? '' : '';
      } else if (t === 'inlineStr') {
        const t2 = c.match(/<is>([\s\S]*?)<\/is>/);
        text = t2 ? decodeEntities((t2[1].match(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g) || []).map((x) => x.replace(/<[^>]+>/g, '')).join('')) : '';
      } else {
        const v = (c.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        text = v != null ? decodeEntities(v) : '';
        if (t === 'b') text = text === '1' ? 'TRUE' : 'FALSE';
      }
      const f = (c.match(/<f[\s>][\s\S]*?<\/f>/) || [])[0];
      cells.push({ ref: ref[1] ? ref[1] + ref[2] : '', col: ref[1] || '', row: Number(ref[2] || rnum), text, hasF, sid, formula: f ? decodeEntities(f.replace(/<[^>]+>/g, '')) : '' });
    }
    rows.push({ r: rnum, cells });
  }
  return rows;
}

/** 读表格：返回 { sheets:[{name, path, grid:[rows of {ref,text,hasF,type}], maxRow, maxCol}] } */
function xlsxRead(buf, opts = {}) {
  const files = zip.readAll(buf);
  const sst = sharedStrings(files);
  const styles = parseXlsxStyles(files);
  const sheets = sheetFiles(files).map((s) => {
    const xml = files.get(s.path).toString('utf8');
    const rows = parseSheet(xml, sst);

    // 列宽 / 行高
    const colWidth = {};
    const colsXml = (xml.match(/<cols\b[^>]*>([\s\S]*?)<\/cols>/) || [])[1] || '';
    const colRe = /<col\b[^>]*>/g;
    let cm2;
    while ((cm2 = colRe.exec(colsXml))) {
      const tag = cm2[0];
      const min = Number((tag.match(/\bmin="(\d+)"/) || [])[1] || 0);
      const max = Number((tag.match(/\bmax="(\d+)"/) || [])[1] || 0);
      const w = Number((tag.match(/\bwidth="([\d.]+)"/) || [])[1] || 0);
      if (!min || !w) continue;
      for (let i = min; i <= Math.min(max, min + 200); i++) colWidth[i] = Math.round(w * 7.2 + 8);
    }
    const rowHeight = {};
    for (const r of rows) {
      const m3 = null;
    }
    const rowTagRe = /<row\b([^>]*?)(\/>|>)/g;
    let rm3;
    while ((rm3 = rowTagRe.exec(xml))) {
      const a = rm3[1];
      const rn = Number((a.match(/\br="(\d+)"/) || [])[1] || 0);
      const ht = Number((a.match(/\bht="([\d.]+)"/) || [])[1] || 0);
      if (rn && ht) rowHeight[rn] = Math.round(ht * 1.34);
    }

    // 合并单元格 / 冻结
    const merges = [...xml.matchAll(/<mergeCell ref="([A-Z]+\d+:[A-Z]+\d+)"/g)].map((m) => m[1]);
    const pane = (xml.match(/<pane\b[^>]*>/) || [''])[0];
    const freeze = {
      y: Number((pane.match(/ySplit="(\d+)"/) || [])[1] || 0),
      x: Number((pane.match(/xSplit="(\d+)"/) || [])[1] || 0),
    };

    let maxRow = 0, maxCol = 0;
    for (const r of rows) {
      maxRow = Math.max(maxRow, r.r);
      for (const c of r.cells) maxCol = Math.max(maxCol, c.col ? colToNum(c.col) : 0);
    }
    if (opts.grid !== false) {
      maxRow = Math.min(Math.max(maxRow, 20), 3000);
      maxCol = Math.min(Math.max(maxCol, 8), 80);
      const grid = [];
      for (let i = 1; i <= maxRow; i++) grid.push(new Array(maxCol).fill(null));
      for (const r of rows) {
        for (const c of r.cells) {
          if (!c.col) continue;
          const ci = colToNum(c.col) - 1;
          if (ci >= 0 && ci < maxCol && r.r - 1 < maxRow) {
            grid[r.r - 1][ci] = {
              text: c.text, hasF: c.hasF, formula: c.formula, ref: c.ref, sid: c.sid || 0,
              style: cellStyle(styles, c.sid || 0),
            };
          }
        }
      }
      return { name: s.name, path: s.path, hidden: s.hidden, grid, maxRow, maxCol, colWidth, rowHeight, merges, freeze };
    }
    return { name: s.name, path: s.path, hidden: s.hidden };
  });
  return { sheets };
}

/** 只改被用户动过的、且不含公式的单元格 */
function buildCellXml(ref, val, sx, formula) {
  const S = sx == null ? '' : ' s="' + sx + '"';
  if (formula) return '<c r="' + ref + '"' + S + '><f>' + esc(String(formula).replace(/^=/, '')) + '</f></c>';
  if (val === '' || val == null) return '<c r="' + ref + '"' + S + '/>';
  const isNum = /^-?\d+(\.\d+)?$/.test(String(val).trim());
  if (isNum) return '<c r="' + ref + '"' + S + '><v>' + esc(String(val).trim()) + '</v></c>';
  return '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">' + esc(val) + '</t></is></c>';
}

function insertIntoRow(body, cellXml, col) {
  const cellRe = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
  let mm;
  while ((mm = cellRe.exec(body))) {
    const r = (mm[0].match(/\br="([A-Z]+)\d+"/) || [])[1];
    if (r && colToNum(r) > col) return body.slice(0, mm.index) + cellXml + body.slice(mm.index);
  }
  return body + cellXml;
}

function insertRow(inner, newRow, rowNum) {
  const rowRe = /<row\b([^>]*?)(\/>|>[\s\S]*?<\/row>)/g;
  let mm;
  while ((mm = rowRe.exec(inner))) {
    const r = Number((mm[1].match(/\br="(\d+)"/) || [])[1] || 0);
    if (r > rowNum) return inner.slice(0, mm.index) + newRow + inner.slice(mm.index);
  }
  return inner + newRow;
}

/** 往不存在的单元格/空行里写内容（原文件里没有这个 <c> 时） */
function insertCell(xml, ref, val, sx, formula) {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) return xml;
  const col = colToNum(m[1]);
  const rowNum = Number(m[2]);
  const sdOpen = xml.indexOf('<sheetData');
  if (sdOpen < 0) return xml;
  const openEnd = xml.indexOf('>', sdOpen);
  if (openEnd < 0) return xml;
  if (xml[openEnd - 1] === '/') {
    return xml.slice(0, sdOpen) + '<sheetData><row r="' + rowNum + '">' + buildCellXml(ref, val, sx) + '</row></sheetData>' + xml.slice(openEnd + 1);
  }
  const sdClose = xml.indexOf('</sheetData>', openEnd);
  if (sdClose < 0) return xml;
  let inner = xml.slice(openEnd + 1, sdClose);
  const rowRe = /<row\b([^>]*?)(\/>|>([\s\S]*?)<\/row>)/g;
  let target = null, rm;
  while ((rm = rowRe.exec(inner))) {
    const r = (rm[1].match(/\br="(\d+)"/) || [])[1];
    if (Number(r) === rowNum) {
      target = { attrs: rm[1], selfClose: rm[2] === '/>', start: rm.index, end: rm.index + rm[0].length, body: rm[3] || '' };
      break;
    }
  }
  const cellXml = buildCellXml(ref, val, sx, formula);
  if (target) {
    const body = target.selfClose ? cellXml : insertIntoRow(target.body, cellXml, col);
    inner = inner.slice(0, target.start) + '<row' + target.attrs + '>' + body + '</row>' + inner.slice(target.end);
  } else {
    inner = insertRow(inner, '<row r="' + rowNum + '">' + cellXml + '</row>', rowNum);
  }
  return xml.slice(0, openEnd + 1) + inner + xml.slice(sdClose);
}

function xlsxApplyEdits(buf, editsBySheet) {
  const files = zip.readAll(buf);
  for (const [path, edits] of Object.entries(editsBySheet)) {
    const fbuf = files.get(path);
    if (!fbuf) continue;
    let xml = fbuf.toString('utf8');
    const arr = Array.isArray(edits)
      ? edits
      : Object.entries(edits || {}).map(([ref, value]) => ({ ref, value }));
    const byRef = new Map(arr.map((e) => [String(e.ref).toUpperCase(), e.value]));
    const byStyle = new Map(arr.filter((e) => e && e.s != null).map((e) => [String(e.ref).toUpperCase(), e.s]));
    const byF = new Map(arr.filter((e) => e && e.f).map((e) => [String(e.ref).toUpperCase(), String(e.f)]));
    if (!byRef.size) continue;

    const done = new Set();
    xml = xml.replace(/<c\b([^>]*?)(\/>|>[\s\S]*?<\/c>)/g, (whole, attrs) => {
      const ref = (attrs.match(/\br="([A-Z]+\d+)"/) || [])[1];
      if (!ref || !byRef.has(ref)) return whole;
      const close = whole.endsWith('/>') ? '>' : '';
      const inner = close ? whole.slice(whole.indexOf('>', whole.indexOf(attrs) + attrs.length) + 1, whole.lastIndexOf('</c>')) : '';
      const sx0 = byStyle.get(ref);
      if (byF.has(ref)) {
        let cl = attrs.replace(/\s+t="[^"]*"/g, '');
        if (sx0 != null) cl = /\bs="[^"]*"/.test(cl) ? cl.replace(/\bs="[^"]*"/, 's="' + sx0 + '"') : cl + ' s="' + sx0 + '"';
        done.add(ref);
        return '<c' + cl + '><f>' + esc(byF.get(ref).replace(/^=/, '')) + '</f></c>';
      }
      if (/<f[\s>]/.test(inner)) return whole; // 公式单元格不动
      const val = byRef.get(ref);
      let clean = attrs.replace(/\s+t="[^"]*"/g, '');
      const sx = byStyle.get(ref);
      if (sx != null) {
        clean = /\bs="[^"]*"/.test(clean) ? clean.replace(/\bs="[^"]*"/, 's="' + sx + '"') : clean + ' s="' + sx + '"';
      }
      const isNum = val !== '' && val != null && /^-?\d+(\.\d+)?$/.test(String(val).trim());
      const body = val === '' || val == null ? '' : isNum
        ? '<v>' + esc(String(val).trim()) + '</v>'
        : '<is><t xml:space="preserve">' + esc(val) + '</t></is>';
      const tAttr = val === '' || val == null || isNum ? '' : ' t="inlineStr"';
      done.add(ref);
      return '<c' + clean + tAttr + '>' + body + '</c>';
    });
    // 原本不存在的单元格（空行、空格子）要插入新 <c>
    for (const [ref, val] of byRef) {
      if (!done.has(ref)) xml = insertCell(xml, ref, val, byStyle.get(ref), byF.get(ref));
    }
    files.set(path, Buffer.from(xml, 'utf8'));
  }
  return zip.writeZip([...files].map(([name, data]) => ({ name, data })));
}

/* ---------------------------- pptx ---------------------------- */

function pptxSlides(buf) {
  const files = zip.readAll(buf);
  const names = [...files.keys()]
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  return names.map((n) => {
    const xml = files.get(n).toString('utf8');
    const paras = xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || [];
    const lines = paras.map((p) =>
      (p.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map((x) => decodeEntities(x.replace(/<[^>]+>/g, ''))).join('')
    );
    return { name: n, lines: lines.filter((x) => x.trim()) };
  });
}

/* ---------------------------- 文本 / 其他 ---------------------------- */

function decodeTextBuffer(buf) {
  const head = buf.subarray(0, 3);
  if (head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return buf.toString('utf8', 3);
  if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (head[0] === 0xfe && head[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  const s = buf.toString('utf8');
  if (s.includes('\ufffd')) {
    try { return new TextDecoder('gb18030').decode(buf); } catch (_) { /* ignore */ }
  }
  return s.replace(/^\uFEFF/, '');
}

const TEXT_EXT = new Set(['txt', 'md', 'csv', 'log', 'json', 'js', 'ts', 'py', 'html', 'htm', 'css', 'xml', 'yml', 'yaml', 'ini', 'bat', 'ps1', 'sql', 'java', 'c', 'cpp', 'h', 'sh', 'vbs']);

/** -> {text, note} */
function extractText(ext, buf) {
  ext = String(ext || '').toLowerCase();
  try {
    if (ext === 'docx') {
      const paras = docxParagraphs(buf).map((p) => p.text);
      return { text: collapse(paras.join('\n')).slice(0, MAX_TEXT) };
    }
    if (ext === 'xlsx' || ext === 'xlsm') {
      const { sheets } = xlsxRead(buf, { grid: false });
      const files = zip.readAll(buf);
      const sst = sharedStrings(files);
      const parts = [];
      for (const s of sheets) {
        const xml = files.get(s.path).toString('utf8');
        const rows = parseSheet(xml, sst);
        const lines = rows.map((r) => r.cells.map((c) => c.text).filter(Boolean).join(' | ')).filter(Boolean);
        parts.push('【' + s.name + '】\n' + lines.join('\n'));
      }
      return { text: collapse(parts.join('\n\n')).slice(0, MAX_TEXT) };
    }
    if (ext === 'pptx' || ext === 'ppsx') {
      const slides = pptxSlides(buf);
      const parts = slides.map((s) => '【第' + Number(s.name.match(/(\d+)/)[1]) + '页】\n' + s.lines.join('\n'));
      return { text: collapse(parts.join('\n\n')).slice(0, MAX_TEXT) };
    }
    if (ext === 'sb3' || ext === 'sb2') {
      const pj = zip.readOne(buf, 'project.json');
      if (!pj) return { text: '', note: '压缩包内无 project.json' };
      const j = JSON.parse(pj.toString('utf8'));
      const names = [];
      if (j.meta && j.meta.semver) names.push('Scratch ' + j.meta.semver);
      for (const t of j.targets || []) {
        const sp = t.blocks ? Object.values(t.blocks).map((b) => (typeof b === 'object' && b && b.opcode ? b.opcode.replace(/_/g, ' ') : '')).filter(Boolean) : [];
        names.push((t.name || '角色') + (sp.length ? '：' + [...new Set(sp)].slice(0, 30).join('、') : ''));
        for (const c of t.costumes || []) names.push('造型 ' + (c.name || ''));
      }
      return { text: collapse(names.join('\n')).slice(0, MAX_TEXT) };
    }
    if (TEXT_EXT.has(ext)) {
      return { text: collapse(decodeTextBuffer(buf)).slice(0, MAX_TEXT) };
    }
    if (ext === 'pdf') return { text: '', note: 'PDF 暂不抽取正文，用「打开」看原件' };
    if (['doc', 'xls', 'ppt', 'wps', 'et', 'dps'].includes(ext)) return { text: '', note: '旧版二进制格式，不支持抽取正文' };
    if (['zip', 'rar', '7z'].includes(ext)) return { text: '', note: '压缩包未解压' };
    return { text: '' };
  } catch (e) {
    return { text: '', note: '解析失败：' + e.message };
  }
}

/** 这个扩展名是否值得读进来抽正文（图片/音视频/程序文件不必读，省得白读 4GB） */
const OFFICE_EXT = new Set(['docx', 'xlsx', 'xlsm', 'pptx', 'ppsx', 'sb3', 'sb2', 'pdf', 'doc', 'xls', 'ppt', 'wps', 'et', 'dps', 'zip', 'rar', '7z']);
function canExtract(ext) {
  const e = String(ext || '').toLowerCase();
  return TEXT_EXT.has(e) || OFFICE_EXT.has(e);
}

module.exports = {
  extractText,
  canExtract,
  decodeTextBuffer,
  docxParagraphs,
  docxApplyParagraphs,
  xlsxRead,
  xlsxApplyEdits,
  pptxSlides,
  colToNum,
  numToCol,
  esc,
};
