/* 体組成の計算（画面とテストで共通） */
var BodyLib = (function () {
  function r1(n) { return Math.round(n * 10) / 10; }
  function toDays(s) { var p = s.split('/'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fromDays(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + ('0' + d.getUTCDate()).slice(-2); }
  function bmi(w, hCm) { return w && hCm ? r1(w / Math.pow(hCm / 100, 2)) : null; }

  // 体脂肪率から除脂肪体重・体脂肪量
  function composition(w, fat) {
    if (!w || fat == null) return null;
    var lean = w * (1 - fat / 100);
    return { lean: r1(lean), fatMass: r1(w - lean) };
  }

  // 目標体脂肪率に必要な減量（除脂肪体重を維持する前提、脂肪1kg=7200kcal）
  function goalPlan(w, fat, goal) {
    if (!w || fat == null || !goal) return null;
    var lean = w * (1 - fat / 100), target = lean / (1 - goal / 100), lose = Math.max(0, w - target);
    return { lean: r1(lean), targetWeight: r1(target), loseKg: r1(lose), kcal: Math.round(lose * 7200) };
  }

  // 同じ日付の最新値を持つ項目の、直近 n 日の系列（古い順）
  function series(logs, field, today, n) {
    var from = toDays(today) - n + 1, out = [];
    logs.forEach(function (l) {
      var d = toDays(l.date);
      if (l[field] != null && d >= from && d <= toDays(today)) out.push({ date: l.date, day: d, v: l[field] });
    });
    out.sort(function (a, b) { return a.day - b.day; });
    return out;
  }

  // 直近 n 日前と比べた変化（その日以前で最も新しい記録と最新値の差）
  function change(logs, field, today, n) {
    var withV = logs.filter(function (l) { return l[field] != null; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    if (!withV.length) return null;
    var latest = withV[0], lim = toDays(today) - n, ref = null;
    withV.forEach(function (l) { if (toDays(l.date) <= lim && !ref) ref = l; });
    if (!ref) return null;
    return { from: ref.date, diff: r1(latest[field] - ref[field]) };
  }

  // 記録した日数と連続日数（今日または昨日から遡る）
  function streak(logs, today) {
    var set = {}; logs.forEach(function (l) { set[l.date] = 1; });
    var d = toDays(today);
    if (!set[fromDays(d)]) d--;
    var n = 0;
    while (set[fromDays(d)]) { n++; d--; }
    return n;
  }

  // 最新の値と、n日前（その日以前で最も新しい記録）の値の比較。項目ごとに最新の記録を使う
  var FIELDS = ['weight', 'fat', 'muscle', 'bmi', 'bmr', 'visceral'];
  function compare(logs, today, periods) {
    return periods.map(function (n) {
      var row = { days: n, fields: {} };
      FIELDS.forEach(function (f) {
        var withV = logs.filter(function (l) { return l[f] != null; }).sort(function (a, b) { return a.date < b.date ? 1 : -1; });
        if (!withV.length) { row.fields[f] = null; return; }
        var latest = withV[0], lim = toDays(today) - n, ref = null;
        withV.forEach(function (l) { if (!ref && toDays(l.date) <= lim) ref = l; });
        row.fields[f] = ref && ref !== latest ? { now: latest[f], then: ref[f], diff: r1(latest[f] - ref[f]), from: ref.date } : null;
      });
      return row;
    });
  }

  return { compare: compare, r1: r1, toDays: toDays, fromDays: fromDays, bmi: bmi, composition: composition, goalPlan: goalPlan, series: series, change: change, streak: streak };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BodyLib;
