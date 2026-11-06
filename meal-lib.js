/* 食事の集計（画面とテストで共通） */
var MealLib = (function () {
  function r1(n) { return Math.round(n * 10) / 10; }
  function toDays(s) { var p = s.split('/'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fromDays(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + ('0' + d.getUTCDate()).slice(-2); }
  function zero() { return { kcal: 0, protein: 0, fat: 0, carbs: 0, meals: 0 }; }

  // 1日の合計
  function dayTotal(logs, date) {
    var t = zero();
    logs.forEach(function (l) {
      if (l.date !== date) return;
      t.kcal += l.kcal || 0; t.protein += l.protein || 0; t.fat += l.fat || 0; t.carbs += l.carbs || 0; t.meals++;
    });
    t.kcal = Math.round(t.kcal); t.protein = r1(t.protein); t.fat = r1(t.fat); t.carbs = r1(t.carbs);
    return t;
  }

  // 終了日までの直近 n 日（古い順）。記録の無い日は meals=0
  function lastDays(logs, endDate, n) {
    var out = [], e = toDays(endDate);
    for (var i = n - 1; i >= 0; i--) { var d = fromDays(e - i), t = dayTotal(logs, d); t.date = d; out.push(t); }
    return out;
  }

  // 記録がある日だけの平均
  function average(days) {
    var a = days.filter(function (d) { return d.meals > 0; }), t = { kcal: 0, protein: 0, fat: 0, carbs: 0, days: a.length };
    if (!a.length) return t;
    a.forEach(function (d) { t.kcal += d.kcal; t.protein += d.protein; t.fat += d.fat; t.carbs += d.carbs; });
    t.kcal = Math.round(t.kcal / a.length); t.protein = r1(t.protein / a.length); t.fat = r1(t.fat / a.length); t.carbs = r1(t.carbs / a.length);
    return t;
  }

  // 三大栄養素のエネルギー比（%）
  function energySplit(t) {
    var p = t.protein * 4, f = t.fat * 9, c = t.carbs * 4, sum = p + f + c;
    if (!sum) return null;
    return { protein: Math.round(p / sum * 100), fat: Math.round(f / sum * 100), carbs: Math.round(c / sum * 100) };
  }

  // 目標に対する達成率（目標0＝null）
  function pct(v, goal) { return goal > 0 ? Math.round(v / goal * 100) : null; }

  // 食事の区分の並び順
  var TYPES = ['朝食', '昼食', '夕食', '間食', '飲酒', 'その他'];
  function typeOrder(t) { var i = TYPES.indexOf(t); return i < 0 ? 99 : i; }

  return { r1: r1, toDays: toDays, fromDays: fromDays, dayTotal: dayTotal, lastDays: lastDays, average: average, energySplit: energySplit, pct: pct, TYPES: TYPES, typeOrder: typeOrder };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MealLib;
