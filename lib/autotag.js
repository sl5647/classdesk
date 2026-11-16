'use strict';
/* 从文件名和路径里推断"智能标签"：校区 / 学期 / 类型。不改索引文件，现算现用。 */

const STOP_CAMPUS = new Set([
  '课件', '媒体', '图片', '视频', '音频', '素材', '文档', '表格', '演示',
  '教学计划', '考勤', '津贴', '结算', '导出', '其他', '文件', '临时', '备份',
  'code', 'doc', 'sheet', 'slide', 'image', 'archive', 'media', 'other',
  'a', 'b', 'c', 'd', 'test', 'testsrc', '图片素材', '视频素材',
]);

/* 类型关键词：从上往下优先，命中第一个就用 */
const TYPE_RULES = [
  ['考勤', /考勤|签到|点名|到岗|出勤/],
  ['津贴', /津贴|补助|补贴/],
  ['结算', /结算|决算|报账|报销|工资|课时费|费用/],
  ['教学计划', /教学计划|授课计划|教学进度|课程计划/],
  ['教案', /教案|备课/],
  ['课件', /课件|讲义|演示稿/],
  ['获奖', /获奖|荣誉|奖状|证书|颁奖|成果/],
  ['比赛', /比赛|竞赛|赛事|赛项|选拔/],
  ['排课', /排课|课表|课程表|调课|任课/],
  ['名单', /名单|花名册|学生信息|报名|登记表/],
  ['缴费', /缴费|收费|学费|退费/],
  ['总结', /总结|小结|反思|汇报/],
  ['培训', /培训|教研|研修|公开课|磨课/],
  ['通知', /通知|公告|方案|制度|细则|办法/],
  ['评价', /评价|考评|考核|评分|评估/],
  ['试卷', /试卷|试题|题库|测试卷|练习题/],
  ['器材', /器材|设备|清单|资产|采购/],
];

const SEASON = { 秋: '秋', 春: '春', 暑: '暑期', 寒: '寒假' };

function termOf(s) {
  let m = s.match(/(20\d{2}|\d{2})\s*[年\-_．. ]?\s*(秋|春|暑|寒)/);
  if (m) {
    const y = m[1].length === 4 ? m[1].slice(2) : m[1];
    return y + (SEASON[m[2]] || m[2]);
  }
  // 再退一步：光有年份
  m = s.match(/(20\d{2})\s*[年\-_．.]/);
  if (m) return m[1] + '年';
  return '';
}

function campusOf(rel, dir) {
  // 优先找带"校区/学校/中心"字样的片段
  const m = rel.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,10}?(?:校区|学校|中心|小学|中学|幼儿园|教育|外联部|教研组))/);
  if (m) return m[1];
  const first = (dir || '').split('/')[0] || (rel.includes('/') ? rel.split('/')[0] : '');
  if (!first) return '';
  if (STOP_CAMPUS.has(first.toLowerCase())) return '';
  if (first.length > 14) return '';
  if (!/[\u4e00-\u9fa5A-Za-z]/.test(first)) return '';
  return first;
}

/** 返回 { 校区, 学期, 类型 }，没有的维度是空字符串 */
function tagsOf(entry) {
  const rel = entry.rel || entry.name || '';
  const dir = entry.dir || '';
  const hay = (entry.name || '') + ' ' + dir;
  let type = '';
  for (const [label, re] of TYPE_RULES) {
    if (re.test(hay)) { type = label; break; }
  }
  return {
    校区: campusOf(rel, dir),
    学期: termOf(rel),
    类型: type,
  };
}

const CACHE = new WeakMap();
function autoTags(entry) {
  let v = CACHE.get(entry);
  if (!v) { v = tagsOf(entry); CACHE.set(entry, v); }
  return v;
}

/** 转成 [{k,v}] 数组，方便前端渲染 */
function autoTagList(entry) {
  const t = autoTags(entry);
  const out = [];
  for (const k of ['校区', '学期', '类型']) if (t[k]) out.push({ k, v: t[k] });
  return out;
}

/** "校区=斗门容闳,学期=26秋,类型=考勤|课表" -> [{k,vals:[]}]  (同维度 OR，跨维度 AND) */
function parseAuto(str) {
  const out = [];
  for (const part of String(str || '').split(',')) {
    const p = part.trim();
    if (!p) continue;
    const i = p.indexOf('=');
    if (i < 0) continue;
    const k = p.slice(0, i).trim();
    const vals = p.slice(i + 1).split('|').map((x) => x.trim()).filter(Boolean);
    if (k && vals.length) out.push({ k, vals });
  }
  return out;
}

module.exports = { autoTags, autoTagList, parseAuto, tagsOf };
