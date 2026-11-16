'use strict';
/* 生成 .docx：文字（段落，含分页）与图片（每张一页）都支持。零依赖，走 lib/zip.js。 */
const ZW = require('./zip');

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');

function paraXml(text, pageBreak) {
  const pPr = pageBreak ? '<w:pPr><w:pageBreakBefore/></w:pPr>' : '';
  if (!text) return '<w:p>' + pPr + '</w:p>';
  return '<w:p>' + pPr + '<w:r><w:t xml:space="preserve">' + esc(text) + '</w:t></w:r></w:p>';
}

/** 行 → 段落：连续短行合并，别把每行都变成独立段落 */
function linesToParagraphs(lines) {
  const out = [];
  let buf = '';
  const flush = () => { if (buf.trim()) out.push(buf.trim()); buf = ''; };
  for (const raw of lines) {
    const line = String(raw == null ? '' : raw).trim();
    if (!line) { flush(); continue; }
    if (!buf) { buf = line; continue; }
    if (/^[，。！？、；：…—）】」』”]+$/.test(line)) { buf += line; continue; }
    const open = !/[。！？：；]$/.test(buf);
    const label = line.length <= 10 && /[:：]$/.test(line);
    if (open && !label && buf.length + line.length < 260) {
      buf += /[A-Za-z0-9]$/.test(buf) && /^[A-Za-z0-9]/.test(line) ? ' ' + line : line;
    } else { flush(); buf = line; }
  }
  flush();
  return out;
}

function pagesToParagraphs(pages) {
  const paras = [];
  (pages || []).forEach((page, i) => {
    const ps = linesToParagraphs(String(page || '').split('\n'));
    ps.forEach((t, k) => paras.push({ text: t, pageBreak: i > 0 && k === 0 }));
  });
  return paras;
}

function imageSize(buf) {
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), ext: 'png' };
  }
  if (buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8 && marker !== 0xCC) {
        return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), ext: 'jpg' };
      }
      i += 2 + len;
    }
  }
  if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8), ext: 'gif' };
  }
  return null;
}

/** 文字版 docx */
function buildDocx(pages, opts) {
  const o = opts || {};
  const paras = pagesToParagraphs(pages);
  let body = o.title ? paraXml(o.title) : '';
  paras.forEach((p, i) => { body += paraXml(p.text, p.pageBreak); });
  return packDocx(body);
}

/** 图片版 docx：每张图单独一页，宽度不超过 A4 版心 */
function buildDocxFromImages(images, opts) {
  const o = opts || {};
  const parts = [];
  const imgRels = [];
  let body = '';
  const maxW = 9000; // twips
  let idx = 0;
  for (const img of images || []) {
    const size = imageSize(img.buf);
    if (!size) continue;
    idx += 1;
    const rid = 'rId' + (idx + 10);
    const media = 'image' + idx + '.' + size.ext;
    parts.push({ name: 'word/media/' + media, data: img.buf });
    imgRels.push('<Relationship Id="' + rid + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/' + media + '"/>');
    const w = Math.min(maxW, size.w);
    const h = Math.round((size.h / size.w) * w);
    const cx = Math.round(w * 635);
    const cy = Math.round(h * 635);
    body += '<w:p><w:pPr><w:jc w:val="center"/>' + (idx > 1 ? '<w:pageBreakBefore/>' : '') + '</w:pPr>' +
      '<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">' +
      '<wp:extent cx="' + cx + '" cy="' + cy + '"/><wp:docPr id="' + idx + '" name="图片 ' + idx + '"/>' +
      '<a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">' +
      '<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">' +
      '<pic:nvPicPr><pic:cNvPr id="' + idx + '" name="图片 ' + idx + '"/><pic:cNvPicPr/></pic:nvPicPr>' +
      '<pic:blipFill><a:blip r:embed="' + rid + '"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>' +
      '<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="' + cx + '" cy="' + cy + '"/></a:xfrm>' +
      '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>' +
      '</a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>';
  }
  if (o.title) body = paraXml(o.title) + body;
  return packDocx(body, { images: parts, imageRels: imgRels });
}

function packDocx(bodyXml, extra) {
  const e = extra || {};
  const documentXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"' +
    ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"' +
    ' xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">' +
    '<w:body>' + bodyXml +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
    '<w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="720" w:footer="720" w:gutter="0"/>' +
    '</w:sectPr></w:body></w:document>';

  const hasImg = !!(e.images && e.images.length);
  const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    (hasImg ? '<Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/>' : '') +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '</Types>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '</Relationships>';
  const docRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    ((e.imageRels || []).join('')) + '</Relationships>';

  const entries = [
    { name: '[Content_Types].xml', data: Buffer.from(contentTypes, 'utf8') },
    { name: '_rels/.rels', data: Buffer.from(rels, 'utf8') },
    { name: 'word/document.xml', data: Buffer.from(documentXml, 'utf8') },
  ];
  if (hasImg) {
    entries.push({ name: 'word/_rels/document.xml.rels', data: Buffer.from(docRels, 'utf8') });
    for (const img of e.images) entries.push(img);
  }
  return ZW.writeZip(entries);
}

module.exports = { buildDocx, buildDocxFromImages, pagesToParagraphs, linesToParagraphs, imageSize };
