'use strict';
/* 从 PDF 里抽文字（只用内置 zlib，不依赖外部库）。
 * 支持 FlateDecode 内容流 + ToUnicode CMap；扫描件（无文字层）返回空。 */
const zlib = require('zlib');

/* 从 pos 处的 '<<' 开始，取到配对的 '>>'（考虑嵌套） */
function balanced(str, pos) {
  if (str[pos] !== '<' || str[pos + 1] !== '<') return null;
  let depth = 0;
  for (let i = pos; i < str.length - 1; i++) {
    if (str[i] === '<' && str[i + 1] === '<') { depth++; i++; continue; }
    if (str[i] === '>' && str[i + 1] === '>') {
      depth--;
      if (depth === 0) return { text: str.slice(pos + 2, i), end: i + 2 };
      i++;
    }
  }
  return null;
}

function parseObjects(buf) {
  const s = buf.toString('latin1');
  const objs = new Map();
  const re = /(\d+)\s+0\s+obj\b/g;
  let m;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    let end = s.indexOf('endobj', start);
    if (end < 0) end = s.length;
    const body = s.slice(start, end);
    let raw = null;
    let dict = body;
    const sp = body.indexOf('stream');
    if (sp >= 0) {
      dict = body.slice(0, sp);
      let dataStart = sp + 'stream'.length;
      if (body[dataStart] === '\r') dataStart++;
      if (body[dataStart] === '\n') dataStart++;
      let dataEnd = body.indexOf('endstream', dataStart);
      if (dataEnd < 0) dataEnd = body.length;
      raw = Buffer.from(body.slice(dataStart, dataEnd).replace(/\r?\n$/, ''), 'latin1');
    }
    let stream = null;
    if (raw) {
      if (/FlateDecode/.test(dict)) {
        try { stream = zlib.inflateSync(raw).toString('latin1'); } catch (_) {
          try { stream = zlib.inflateRawSync(raw).toString('latin1'); } catch (_) { stream = null; }
        }
      } else if (!/DCTDecode|JPXDecode|CCITTFaxDecode/.test(dict)) {
        stream = raw.toString('latin1');
      }
    }
    objs.set(num, { num, dict, raw, stream });
    re.lastIndex = end;
  }
  return objs;
}

function refOf(dict, key) {
  const m = new RegExp('/' + key + '\\s+(\\d+)\\s+0\\s+R').exec(dict);
  return m ? Number(m[1]) : null;
}
function refsOf(dict, key) {
  const m = new RegExp('/' + key + '\\s*\\[([^\\]]*)\\]').exec(dict);
  if (!m) {
    const one = refOf(dict, key);
    return one == null ? [] : [one];
  }
  return [...m[1].matchAll(/(\d+)\s+0\s+R/g)].map((x) => Number(x[1]));
}

function hexToUnicode(hex) {
  const clean = hex.replace(/[^0-9a-fA-F]/g, '');
  let out = '';
  for (let i = 0; i + 4 <= clean.length; i += 4) out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
  if (!out && clean.length === 2) out = String.fromCharCode(parseInt(clean, 16));
  return out;
}

function parseCMap(text) {
  const map = new Map();
  let width = 1;
  const cs = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(text || '');
  if (cs) {
    const first = /<([0-9a-fA-F]+)>/.exec(cs[1]);
    if (first && first[1].length >= 4) width = 2;
  }
  let m;
  const chars = /beginbfchar([\s\S]*?)endbfchar/g;
  while ((m = chars.exec(text || ''))) {
    for (const p of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g)) {
      if (p[1].length >= 4) width = 2;
      map.set(parseInt(p[1], 16), hexToUnicode(p[2]));
    }
  }
  const ranges = /beginbfrange([\s\S]*?)endbfrange/g;
  while ((m = ranges.exec(text || ''))) {
    for (const it of m[1].matchAll(/<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(<[0-9a-fA-F]+>|\[[^\]]*\])/g)) {
      if (it[1].length >= 4) width = 2;
      const lo = parseInt(it[1], 16);
      const hi = parseInt(it[2], 16);
      if (it[3][0] === '[') {
        const list = [...it[3].matchAll(/<([0-9a-fA-F]+)>/g)].map((x) => hexToUnicode(x[1]));
        for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, list[c - lo]);
      } else {
        const base = it[3].slice(1, -1);
        const start = parseInt(base, 16);
        for (let c = lo; c <= hi; c++) map.set(c, hexToUnicode((start + (c - lo)).toString(16).padStart(base.length, '0')));
      }
    }
  }
  return { map, width };
}

function decodeString(str, font) {
  if (!font || !font.map || !font.map.size) {
    return str.replace(/[\u0000-\u0008\u000b-\u001f]/g, '');
  }
  let out = '';
  if (font.width === 2) {
    for (let i = 0; i + 2 <= str.length; i += 2) {
      const code = (str.charCodeAt(i) << 8) | str.charCodeAt(i + 1);
      if (font.map.has(code)) out += font.map.get(code);
    }
  } else {
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      out += font.map.has(code) ? font.map.get(code) : '';
    }
  }
  return out;
}

/* 把内容流拆成 token（字符串 / 十六进制串 / 数字 / 名字 / 操作符） */
function tokenize(content) {
  const toks = [];
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '(') {
      let depth = 1, j = i + 1, s = '';
      while (j < content.length) {
        const c = content[j];
        if (c === '\\') {
          const nx = content[j + 1];
          const esc = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '(': '(', ')': ')', '\\': '\\' }[nx];
          if (esc !== undefined) { s += esc; j += 2; continue; }
          if (/[0-7]/.test(nx)) {
            let oct = nx; j += 2;
            for (let k = 0; k < 2 && /[0-7]/.test(content[j]); k++) { oct += content[j]; j++; }
            s += String.fromCharCode(parseInt(oct, 8));
            continue;
          }
          j += 2; continue;
        }
        if (c === '(') { depth++; s += c; j++; continue; }
        if (c === ')') { depth--; j++; if (!depth) break; s += c; continue; }
        s += c; j++;
      }
      toks.push({ t: 's', v: s });
      i = j;
      continue;
    }
    if (ch === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i);
      if (end > i) {
        const hex = content.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
        let s = '';
        for (let k = 0; k + 2 <= hex.length; k += 2) s += String.fromCharCode(parseInt(hex.slice(k, k + 2), 16));
        toks.push({ t: 's', v: s });
        i = end + 1;
        continue;
      }
    }
    if (ch === '/') {
      const m = /^\/([^\s/<>\[\]()]*)/.exec(content.slice(i, i + 64));
      toks.push({ t: 'n', v: m ? m[1] : '' });
      i += m ? m[0].length : 1;
      continue;
    }
    const num = /^[-+]?\d*\.?\d+/.exec(content.slice(i, i + 24));
    if (num) { toks.push({ t: 'd', v: parseFloat(num[0]) }); i += num[0].length; continue; }
    const op = /^(Tj|TJ|Td|TD|T\*|Tm|Tf|BT|ET|TL|\'|\")\b/.exec(content.slice(i, i + 4));
    if (op) { toks.push({ t: 'o', v: op[1] }); i += op[0].length; continue; }
    i++;
  }
  return toks;
}

function contentToText(content, fonts) {
  const toks = tokenize(content);
  const lines = [];
  let line = '';
  let cur = null;
  let y = null;
  const flush = () => { if (line.trim()) lines.push(line.replace(/[ \t]+$/g, '')); line = ''; };

  let stack = [];
  for (let k = 0; k < toks.length; k++) {
    const t = toks[k];
    if (t.t !== 'o') { stack.push(t); continue; }
    const op = t.v;
    if (op === 'Tf') {
      const name = [...stack].reverse().find((x) => x.t === 'n');
      if (name) cur = fonts[name.v] || cur;
    } else if (op === 'Tj' || op === "'" || op === '"') {
      const s = [...stack].reverse().find((x) => x.t === 's');
      if (op !== 'Tj') flush();
      if (s) line += decodeString(s.v, cur);
    } else if (op === 'TJ') {
      const arr = stack.filter((x) => x.t === 's' || (x.t === 'd'));
      for (const x of arr) {
        if (x.t === 's') line += decodeString(x.v, cur);
        else if (x.v < -800) line += " ";
      }
    } else if (op === 'Td' || op === 'TD') {
      const nums = stack.filter((x) => x.t === 'd').map((x) => x.v);
      const dx = nums.length >= 2 ? nums[nums.length - 2] : 0;
      const dy = nums.length >= 2 ? nums[nums.length - 1] : 0;
      if (Math.abs(dy) > 0.5) flush();
      else if (dx > 900) line += ' ';
    } else if (op === 'Tm') {
      const nums = stack.filter((x) => x.t === 'd').map((x) => x.v);
      const ny = nums.length >= 6 ? nums[nums.length - 1] : null;
      if (ny != null) {
        if (y != null && Math.abs(ny - y) > 0.5) flush();
        y = ny;
      }
    } else if (op === 'T*') {
      flush();
    } else if (op === 'BT' || op === 'ET') {
      flush();
      y = null;
    }
    stack = [];
  }
  flush();
  return lines.join('\n');
}

function pdfText(buf) {
  let objs;
  try { objs = parseObjects(buf); } catch (_) { return { pages: [], hadText: false }; }
  const pages = [];
  for (const o of objs.values()) {
    if (!/\/Type\s*\/Page\b/.test(o.dict)) continue;
    const content = refsOf(o.dict, 'Contents')
      .map((ref) => (objs.get(ref) && objs.get(ref).stream) || '')
      .join('\n');
    // Resources 可能是内联的（要找配对的 >>），也可能挂在父节点上
    let resDict = '';
    const ri = o.dict.indexOf('/Resources');
    if (ri >= 0) {
      const after = o.dict.indexOf('<<', ri);
      const bal = after >= 0 ? balanced(o.dict, after) : null;
      if (bal) resDict = bal.text;
    }
    if (!resDict) {
      const r = refOf(o.dict, 'Resources');
      if (r != null && objs.get(r)) resDict = objs.get(r).dict;
    }
    const fonts = {};
    const fi = resDict.indexOf('/Font');
    if (fi >= 0) {
      const after = resDict.indexOf('<<', fi);
      const bal = after >= 0 ? balanced(resDict, after) : null;
      if (bal) {
        for (const [, name, numStr] of bal.text.matchAll(/\/([A-Za-z0-9._-]+)\s+(\d+)\s+0\s+R/g)) {
          const fo = objs.get(Number(numStr));
          if (!fo) continue;
          const tu = refOf(fo.dict, 'ToUnicode');
          const cmapObj = tu != null ? objs.get(tu) : null;
          fonts[name] = cmapObj && cmapObj.stream ? parseCMap(cmapObj.stream) : { map: new Map(), width: 1 };
        }
      }
    }
    pages.push(content ? contentToText(content, fonts).trim() : '');
  }
  return { pages, hadText: pages.some((p) => p.length > 0) };
}

module.exports = { pdfText };
