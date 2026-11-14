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


  // ---- 1日に複数回の測定 → 日ごとの平均 ----
  // 測定のタイミング・条件（サーバーの BTAGS と同じ）
  var TAGS = ['起床後', '午前中', '日中', '午後', '夜', '就寝前', '食事前', '食事後', '排便前', '排便後', '運動前', '運動後', '入浴前', '入浴後', '水分補給前', '水分補給後'];
  var AVG_FIELDS = ['weight', 'fat', 'muscle', 'bmi', 'bmr', 'visceral'];
  // 測定を新しい順（日付→時刻→ID）に並べる。時刻なしはその日の最初扱い
  function sortEntries(entries) {
    return entries.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      var ta = a.time || '', tb = b.time || '';
      if (ta !== tb) return ta < tb ? 1 : -1;
      return String(a.id || '') < String(b.id || '') ? 1 : -1;
    });
  }
  // 日ごとの平均（項目ごとに、値がある測定だけで平均）。新しい日が先頭。
  // 戻り値の1件：{date, weight..visceral(平均), height(その日で最後の値), memo, count, first, last, range:{field:[min,max]}, pending}
  function daily(entries, tag) {
    var byDate = {}, order = [];
    sortEntries(entries).forEach(function (e) {
      if (e.exclude) return; // 「集計から除外」した測定（排便前など、数値がぶれた測定）は平均に入れない
      if (tag && (e.tags || []).indexOf(tag) < 0) return;
      if (!byDate[e.date]) { byDate[e.date] = []; order.push(e.date); }
      byDate[e.date].push(e);
    });
    return order.map(function (date) {
      var list = byDate[date].slice().reverse(); // その日の古い順
      var out = { date: date, count: list.length, height: null, memo: '', range: {}, pending: false };
      AVG_FIELDS.forEach(function (f) {
        var vals = list.map(function (e) { return e[f]; }).filter(function (x) { return x != null; });
        if (!vals.length) { out[f] = null; return; }
        var sum = vals.reduce(function (a, b) { return a + b; }, 0);
        out[f] = f === 'bmr' ? Math.round(sum / vals.length) : r1(sum / vals.length);
        out.range[f] = [Math.min.apply(null, vals), Math.max.apply(null, vals)];
      });
      var memos = [];
      list.forEach(function (e) {
        if (e.height != null) out.height = e.height;
        if (e.memo) memos.push(e.memo);
        if (e.pending) out.pending = true;
      });
      out.memo = memos.join(' / ');
      return out;
    });
  }
  // 同じ日の測定のうち、最初と最後の差（朝→夜の変化）。2回未満なら null
  function intraday(entries, date, field) {
    var vals = entries.filter(function (e) { return e.date === date && !e.exclude && e[field] != null; }).sort(function (a, b) { return (a.time || '') < (b.time || '') ? -1 : ((a.time || '') > (b.time || '') ? 1 : 0); });
    if (vals.length < 2) return null;
    return { first: vals[0][field], last: vals[vals.length - 1][field], diff: r1(vals[vals.length - 1][field] - vals[0][field]) };
  }

  return { TAGS: TAGS, daily: daily, sortEntries: sortEntries, intraday: intraday, compare: compare, r1: r1, toDays: toDays, fromDays: fromDays, bmi: bmi, composition: composition, goalPlan: goalPlan, series: series, change: change, streak: streak };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = BodyLib;
