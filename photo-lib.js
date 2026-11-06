/* 体つき写真の計算（画面とテストで共通） */
var PhotoLib = (function () {
  var ANGLES = ['前', '横', '後ろ'];
  function r1(n) { return Math.round(n * 10) / 10; }
  function toDays(s) { var p = s.split('/'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fromDays(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + ('0' + d.getUTCDate()).slice(-2); }
  function daysBetween(a, b) { return toDays(b) - toDays(a); }

  // 新しい順（日付→時刻）
  function sortNewest(list) {
    return list.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      if ((a.time || '') !== (b.time || '')) return (a.time || '') < (b.time || '') ? 1 : -1;
      return a.id < b.id ? 1 : -1;
    });
  }
  // 古い方を先頭にした2枚
  function order(a, b) {
    var s = sortNewest([a, b]);
    return [s[1], s[0]]; // [before, after]
  }
  // 向きごとの一覧（新しい順）
  function byAngle(photos, angle) { return sortNewest(photos.filter(function (p) { return p.angle === angle; })); }

  // 撮影セット（同じ setId、無ければ同じ日付・時刻）ごとにまとめる。新しい順
  function groupSets(photos) {
    var map = {}, out = [];
    sortNewest(photos).forEach(function (p) {
      var k = p.setId || (p.date + '|' + (p.time || '') + '|' + p.id);
      if (!map[k]) { map[k] = { key: k, date: p.date, time: p.time || '', photos: {} }; out.push(map[k]); }
      map[k].photos[p.angle] = p;
    });
    return out;
  }

  // target と同じ向きで、daysAgo 日以上前（その日以前で最も新しい）の写真。無ければ null
  function reference(photos, target, daysAgo) {
    var lim = fromDays(toDays(target.date) - daysAgo), best = null;
    byAngle(photos, target.angle).forEach(function (p) {
      if (p.id !== target.id && p.date <= lim && !best) best = p;
    });
    return best;
  }
  // 同じ向きで最も古い写真（target 以外）
  function first(photos, target) {
    var L = byAngle(photos, target.angle).filter(function (p) { return p.id !== target.id; });
    return L.length ? L[L.length - 1] : null;
  }

  // その日付以前で最も新しい体組成（日平均）。logs は新しい順
  function bodyAt(logs, date) {
    for (var i = 0; i < logs.length; i++) if (logs[i].date <= date) return logs[i];
    return null;
  }
  var FIELDS = [['weight', '体重', 'kg'], ['fat', '体脂肪率', '%'], ['muscle', '骨格筋率', '%'], ['visceral', '内臓脂肪', '']];
  function bodyDiff(logs, before, after) {
    var b = bodyAt(logs, before.date), a = bodyAt(logs, after.date);
    if (!a || !b) return [];
    return FIELDS.map(function (f) {
      var x = b[f[0]], y = a[f[0]];
      return x != null && y != null ? { key: f[0], label: f[1], unit: f[2], before: x, after: y, diff: r1(y - x), beforeOn: b.date, afterOn: a.date } : null;
    }).filter(Boolean);
  }

  // 長い辺が max を超えるときだけ縮小
  function fitSize(w, h, max) {
    var m = Math.max(w, h);
    if (m <= max) return { w: w, h: h };
    var k = max / m;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
  }

  return { ANGLES: ANGLES, toDays: toDays, fromDays: fromDays, daysBetween: daysBetween, sortNewest: sortNewest, order: order, byAngle: byAngle, groupSets: groupSets, reference: reference, first: first, bodyAt: bodyAt, bodyDiff: bodyDiff, fitSize: fitSize };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PhotoLib;
