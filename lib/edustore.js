const fs = require('fs');
const path = require('path');

const EMPTY = { students: [], courses: [], seq: 0 };

class EduStore {
  constructor(root) {
    this.dir = path.join(root, '.edu');
    this.file = path.join(this.dir, 'students.json');
    this.data = null;
    this.error = null;
    this.load();
  }

  stamp() {
    try { return fs.statSync(this.file).mtimeMs; } catch (e) { return 0; }
  }

  reloadIfChanged() {
    const now = this.stamp();
    if (now && now !== this.mtime) {
      this.load();
      return true;
    }
    return false;
  }

  load() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf8').replace(/^\uFEFF/, '');
        const j = JSON.parse(raw);
        this.data = {
          students: Array.isArray(j.students) ? j.students : [],
          courses: Array.isArray(j.courses) ? j.courses : [],
          seq: Number(j.seq) || 0,
        };
      } else {
        this.data = JSON.parse(JSON.stringify(EMPTY));
        this.flush();
      }
    } catch (e) {
      this.error = e.message;
      this.data = JSON.parse(JSON.stringify(EMPTY));
    }
    this.mtime = this.stamp();
  }

  snapshot(tag) {
    try {
      if (!fs.existsSync(this.file)) return;
      const dir = path.join(this.dir, 'backup');
      fs.mkdirSync(dir, { recursive: true });
      const name = 'students-' + new Date().toISOString().replace(/[:.]/g, '-') + (tag ? '-' + tag : '') + '.json';
      fs.copyFileSync(this.file, path.join(dir, name));
      const all = fs.readdirSync(dir).filter((f) => f.startsWith('students-')).sort();
      while (all.length > 20) { try { fs.unlinkSync(path.join(dir, all.shift())); } catch (e) {} }
    } catch (e) { /* 备份失败不影响主流程 */ }
  }

  audit(op, n) {
    try {
      const line = new Date().toISOString() + '\t' + op + '\t' + (n == null ? '' : n) + '\tpid=' + process.pid + '\n';
      fs.appendFileSync(path.join(this.dir, 'writes.log'), line);
    } catch (e) {}
  }

  flush() {
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
      fs.renameSync(tmp, this.file);
      this.mtime = this.stamp();
      this.audit('flush', (this.data.students || []).length);
    } catch (e) {
      this.error = e.message;
    }
  }

  static normNum(v) {
    const n = Number(String(v == null ? '' : v).replace(/[^\d.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  }

  static calc(s) {
    const fee = EduStore.normNum(s.fee);
    const discount = EduStore.normNum(s.discount);
    const paid = EduStore.normNum(s.paid);
    const total = EduStore.normNum(s.totalLessons);
    const used = EduStore.normNum(s.usedLessons);
    // 单价是「元/课次」，1 课次 = perSession 课时（默认 2）
    const perIn = EduStore.normNum(s.perSession);
    const per = perIn > 0 ? perIn : 2;
    const sessionsTotal = total > 0 ? Math.round((total / per) * 100) / 100 : 0;
    const unitIn = EduStore.normNum(s.unitPrice);
    const unit = unitIn > 0 ? unitIn : (sessionsTotal > 0 ? Math.round((fee / sessionsTotal) * 100) / 100 : 0);
    // 应收：填了单价就按「单价 × 实际买的课次」算（只报 12 课时 = 6 课次，就只收 6 课次的钱）；
    // 没填单价时退回「课程费用 − 优惠」
    let need;
    if (unitIn > 0 && sessionsTotal > 0) need = Math.round((unitIn * sessionsTotal - discount) * 100) / 100;
    else need = fee - discount;
    if (need < 0) need = 0;
    const owe = Math.max(0, Math.round((need - paid) * 100) / 100);
    const left = Math.max(0, total - used);
    const usedValue = Math.round((used / per) * unit * 100) / 100;
    const leftValue = Math.round((left / per) * unit * 100) / 100;
    return Object.assign({}, s, {
      fee, discount, paid, need, owe,
      perSession: per, sessionsTotal,
      unitPrice: unit, unitAuto: !(unitIn > 0),
      usedValue, leftValue,
      usedSessions: Math.round((used / per) * 100) / 100,
      leftSessions: Math.round((left / per) * 100) / 100,
      totalLessons: total, usedLessons: used, leftLessons: left,
      payState: owe <= 0 ? (paid > 0 ? '已缴清' : '未缴费') : (paid > 0 ? '部分缴费' : '未缴费'),
    });
  }

  list(q) {
    this.reloadIfChanged();
    const kw = String((q && q.q) || '').trim().toLowerCase();
    const status = String((q && q.status) || '').trim();
    const course = String((q && q.course) || '').trim();
    let arr = this.data.students.map(EduStore.calc);
    if (kw) {
      arr = arr.filter((s) => [s.name, s.phone, s.course, s.class, s.school, s.note, s.parent]
        .some((v) => String(v || '').toLowerCase().includes(kw)));
    }
    if (status) arr = arr.filter((s) => (s.status || '在读') === status);
    if (course) arr = arr.filter((s) => s.course === course);
    arr.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')) ||
      String(a.name || '').localeCompare(String(b.name || ''), 'zh'));
    return arr;
  }

  stats() {
    this.reloadIfChanged();
    const arr = this.data.students.map(EduStore.calc);
    const active = arr.filter((s) => (s.status || '在读') === '在读').length;
    const fee = arr.reduce((n, s) => n + s.need, 0);
    const paid = arr.reduce((n, s) => n + s.paid, 0);
    const owe = arr.reduce((n, s) => n + s.owe, 0);
    const lesTotal = arr.reduce((n, s) => n + EduStore.normNum(s.totalLessons), 0);
    const lesUsed = arr.reduce((n, s) => n + EduStore.normNum(s.usedLessons), 0);
    const lesLeft = arr.reduce((n, s) => n + EduStore.normNum(s.leftLessons), 0);
    const usedValue = arr.reduce((n, s) => n + EduStore.normNum(s.usedValue), 0);
    return {
      total: arr.length, active, fee, paid, owe,
      lessonsTotal: lesTotal, lessonsUsed: lesUsed, lessonsLeft: lesLeft,
      usedValue, usedValueText: money(usedValue),
      feeText: money(fee), paidText: money(paid), oweText: money(owe),
      courses: [...new Set(arr.map((s) => s.course).filter(Boolean))],
    };
  }

  save(input) {
    const now = new Date().toISOString();
    const s = Object.assign({}, input);
    if (s.id) {
      const i = this.data.students.findIndex((x) => String(x.id) === String(s.id));
      if (i < 0) throw new Error('找不到这个学员');
      const old = this.data.students[i];
      this.data.students[i] = Object.assign({}, old, s, { id: old.id, updatedAt: now, createdAt: old.createdAt || now });
    } else {
      this.data.seq = Number(this.data.seq || 0) + 1;
      s.id = 'S' + String(this.data.seq).padStart(4, '0');
      s.createdAt = now;
      s.updatedAt = now;
      this.data.students.push(s);
    }
    this.flush();
    return EduStore.calc(this.data.students.find((x) => String(x.id) === String(s.id)));
  }

  remove(id) {
    this.reloadIfChanged();
    const n = this.data.students.length;
    this.data.students = this.data.students.filter((x) => String(x.id) !== String(id));
    this.flush();
    return n !== this.data.students.length;
  }

  courses() { return this.data.courses || []; }

  saveCourse(c) {
    this.reloadIfChanged();
    const name = String((c && c.name) || '').trim();
    if (!name) throw new Error('课程名不能为空');
    const fee = EduStore.normNum(c.fee);
    const unitPrice = EduStore.normNum(c.unitPrice);
    const lessons = EduStore.normNum(c.lessons);
    const perSession = EduStore.normNum(c.perSession) || 2;
    const list = this.data.courses || (this.data.courses = []);
    const i = list.findIndex((x) => x.name === name);
    const item = { name, fee, unitPrice, lessons, perSession };
    if (i >= 0) list[i] = item;
    else list.push(item);
    this.flush();
    return list;
  }

  removeCourse(name) {
    this.reloadIfChanged();
    this.data.courses = (this.data.courses || []).filter((x) => x.name !== name);
    this.flush();
    return this.data.courses;
  }
}

function money(n) {
  const v = Number(n) || 0;
  return '¥' + v.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}

module.exports = { EduStore, money };
