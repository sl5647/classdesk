'use strict';
/* 分析类功能：重复文件、系列分组。只读，不改索引。 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JUNK } = require('./store');

/** 找内容完全一样的文件：先按大小分组，只对"有同尺寸伙伴"的文件算哈希，省时间 */
function findDuplicates(root, entries) {
  const bySize = new Map();
  for (const e of entries) {
    if (!e.size || e.size < 512) continue; // 太小的一般是无意义空文件
    if (JUNK.has(e.ext)) continue;
    if (/^(~\$|\._|\.)/.test(e.name)) continue;
    if (!bySize.has(e.size)) bySize.set(e.size, []);
    bySize.get(e.size).push(e);
  }
  const groups = [];
  let hashed = 0;
  for (const [size, list] of bySize) {
    if (list.length < 2) continue;
    if (size > 500 * 1024 * 1024) continue; // 超大文件跳过，免得卡住
    const byHash = new Map();
    for (const e of list) {
      let h;
      try {
        h = crypto.createHash('sha1').update(fs.readFileSync(path.join(root, e.rel))).digest('hex');
        hashed++;
      } catch (_) { continue; }
      if (!byHash.has(h)) byHash.set(h, []);
      byHash.get(h).push(e);
    }
    for (const [hash, files] of byHash) {
      if (files.length < 2) continue;
      groups.push({
        size,
        hash,
        files: files
          .map((f) => ({ rel: f.rel, name: f.name, dir: f.dir, mtime: f.mtime }))
          .sort((a, b) => (a.rel.length - b.rel.length) || a.rel.localeCompare(b.rel)),
      });
    }
  }
  groups.sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
  const wasted = groups.reduce((s, g) => s + g.size * (g.files.length - 1), 0);
  return { groups, wasted, hashed, groupCount: groups.length };
}

/** 把名字削成"系列名"：2026斗门考勤（9月）-> 斗门考勤 */
function stemOf(name) {
  let s = String(name).replace(/\.[^.]+$/, '');
  s = s.replace(/[（(【\[][^（()）【\[\]】]{0,20}[)）】\]]/g, ' '); // 括号内容
  s = s.replace(/(20\d{2}|\d{2})\s*[年\-_．.]?\s*(秋|春|暑|寒)季?/g, ' '); // 学期
  s = s.replace(/20\d{2}\s*[年\-_．.]?/g, ' '); // 年份
  s = s.replace(/\d{1,2}\s*月份?/g, ' '); // 月份
  s = s.replace(/第?\s*\d+\s*(课|周|课时|版|次|讲|天)/g, ' '); // 第几课
  s = s.replace(/[-_　 .．·、,，:：]+/g, ' '); // 分隔符
  s = s.replace(/\d+/g, ' '); // 剩下的数字一般就是序号/日期
  s = s.replace(/[^\u4e00-\u9fa5A-Za-z0-9]+/g, ''); // 去掉残留标点
  s = s.replace(/\s+/g, '');
  return s;
}

function monthsOf(name) {
  const out = new Set();
  const re = /(?:^|[^\d])(\d{1,2})\s*月/g;
  let m;
  while ((m = re.exec(name))) {
    const n = Number(m[1]);
    if (n >= 1 && n <= 12) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** 同一文件夹里名字相近的一堆文件 = 一个系列，顺便报"区间内缺哪个月" */
function findSeries(entries, opts = {}) {
  const dirFilter = String(opts.dir || '').replace(/\\/g, '/').replace(/\/$/, '');
  const minCount = Math.max(2, Number(opts.minCount) || 2);
  const map = new Map();
  for (const e of entries) {
    if (dirFilter && !(e.dir === dirFilter || e.dir.startsWith(dirFilter + '/'))) continue;
    if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'ico', 'mp4', 'mov', 'avi'].includes(e.ext)) continue;
    if (/^(~\$|\._|\.)/.test(e.name)) continue;
    const stem = stemOf(e.name);
    if (stem.length < 2) continue;
    const key = (e.dir || '') + ' :: ' + stem;
    if (!map.has(key)) map.set(key, { key, dir: e.dir || '', stem, files: [], months: new Set() });
    const g = map.get(key);
    g.files.push({ rel: e.rel, name: e.name, size: e.size, mtime: e.mtime });
    for (const mo of monthsOf(e.name)) g.months.add(mo);
  }
  const out = [];
  for (const g of map.values()) {
    if (g.files.length < minCount) continue;
    const months = [...g.months].sort((a, b) => a - b);
    let missing = [];
    if (months.length >= 2) {
      for (let i = months[0]; i <= months[months.length - 1]; i++) if (!months.includes(i)) missing.push(i);
    }
    g.files.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    out.push({ key: g.key, dir: g.dir, stem: g.stem, count: g.files.length, months, missing, files: g.files });
  }
  out.sort((a, b) => (b.missing.length - a.missing.length) || (b.count - a.count));
  return out.slice(0, 300);
}

module.exports = { findDuplicates, findSeries, stemOf, monthsOf };
