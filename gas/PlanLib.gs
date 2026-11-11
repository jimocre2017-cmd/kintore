// 自動生成：plan-lib.js のコピー。直接編集せず、plan-lib.js を直して node tools/sync-planlib.js を実行する
/* 減量計画の計算（画面・Apps Script・テストで共通）
 * このファイルを gas/PlanLib.gs にそのままコピーして Apps Script でも使う（node tools/sync-planlib.js で同期）。
 * 入力は BodyLib.daily（体組成の日平均）と食事ログ。AIには計算済みの数値だけを渡し、AIは再計算しない。
 */
var PlanLib = (function () {
  var KCAL_PER_KG = 7200; // 脂肪1kgあたり
  var DEFAULTS = { goalFat: 12, weeklyLossKg: 0.5, activity: 1.55 };
  var MIN_BODY_SPAN = 10;   // 実測の消費カロリーを出すのに必要な体組成の期間（日）
  var STEP_LIMIT = 200;     // 1週間で動かす目標カロリーの上限（kcal）
  var EASE_RATIO = 0.6;     // 緩やかな計画：終盤の減量ペースは、前半の何割か
  var EASE_DAYS = 60;       // 終盤とみなす日数（期間が短いときは全体の3割）
  var MAINT_BAND = 1.5;     // 維持期：最低体脂肪率の上にこの幅(%)までを許容帯とする
  var BAND_KG = 0.3;        // 計画との差が±この脂肪量(kg)以内なら「ほぼ計画どおり」
  var HOLD_BAND = 50;       // この差未満なら目標を変えない（kcal）

  function r1(n) { return Math.round(n * 10) / 10; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function toDays(s) { var p = String(s).split('/'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function p2(n) { return ('0' + n).slice(-2); }
  function fromDays(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '/' + p2(d.getUTCMonth() + 1) + '/' + p2(d.getUTCDate()); }
  function addDays(s, n) { return fromDays(toDays(s) + n); }
  function monIndex(dn) { return (((dn + 3) % 7) + 7) % 7; } // 月曜=0（1970/1/1は木曜）
  function weekStart(s) { var d = toDays(s); return fromDays(d - monIndex(d)); }
  function nextMonday(s) { var d = toDays(s), i = monIndex(d); return fromDays(i === 0 ? d : d + 7 - i); }
  function monthOf(s) { return String(s).slice(0, 7); }
  function mean(list) { return list.length ? list.reduce(function (a, b) { return a + b; }, 0) / list.length : null; }

  /* ---- 入力の整形 ---- */
  // 体組成の日平均 → {日付: {weight, fat, muscle, bmr, count, fatMass, lean}}
  function bodyDays(daily) {
    var out = {};
    (daily || []).forEach(function (l) {
      if (l.weight == null) return;
      var d = { date: l.date, weight: l.weight, fat: l.fat, muscle: l.muscle, bmr: l.bmr, count: l.count || 1, fatMass: null, lean: null };
      if (l.fat != null) { d.fatMass = l.weight * l.fat / 100; d.lean = l.weight - d.fatMass; }
      out[l.date] = d;
    });
    return out;
  }
  // 食事ログ → {日付: {kcal, protein, fat, carbs, meals, complete}}。3食以上または1200kcal以上で「記録が揃った日」とみなす
  function mealDays(logs) {
    var out = {};
    (logs || []).forEach(function (l) {
      var d = out[l.date] = out[l.date] || { date: l.date, kcal: 0, protein: 0, fat: 0, carbs: 0, meals: 0, complete: false };
      d.kcal += l.kcal || 0; d.protein += l.protein || 0; d.fat += l.fat || 0; d.carbs += l.carbs || 0; d.meals++;
    });
    Object.keys(out).forEach(function (k) {
      var d = out[k]; d.kcal = Math.round(d.kcal); d.protein = r1(d.protein); d.fat = r1(d.fat); d.carbs = r1(d.carbs);
      d.complete = d.meals >= 3 || d.kcal >= 1200;
    });
    return out;
  }
  /* ---- 休止期間（旅行・年末年始・ダイエットブレイク）：この間は減量せず維持カロリーで過ごす ---- */
  function normDate(s) {
    var m = String(s || '').match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
    return m ? m[1] + '/' + p2(+m[2]) + '/' + p2(+m[3]) : '';
  }
  function cleanPauses(list) {
    var out = [];
    (list || []).forEach(function (x) {
      var f = normDate(x && x.from), t = normDate(x && x.to);
      if (!f || !t || toDays(t) < toDays(f)) return;
      out.push({ from: f, to: t, reason: String((x && x.reason) || '').slice(0, 60) });
    });
    out.sort(function (a, b) { return toDays(a.from) - toDays(b.from); });
    return out;
  }
  // 開始日の翌日〜dateまでに含まれる休止日の数
  function pauseDaysUntil(pauses, startDate, date) {
    var st = toDays(startDate) + 1, e = toDays(date), n = 0;
    (pauses || []).forEach(function (x) {
      var a = Math.max(toDays(x.from), st), z = Math.min(toDays(x.to), e);
      if (z >= a) n += z - a + 1;
    });
    return n;
  }
  function pausedOn(pauses, date) {
    var d = toDays(date), hit = null;
    (pauses || []).forEach(function (x) { if (d >= toDays(x.from) && d <= toDays(x.to)) hit = x; });
    return hit;
  }

  function normalizePlan(plan, today) {
    plan = plan || {};
    var p = {
      goalFat: Number(plan.goalFat) > 0 ? Number(plan.goalFat) : 0,
      startDate: plan.startDate || '',
      weeklyLossKg: Number(plan.weeklyLossKg) > 0 ? Number(plan.weeklyLossKg) : DEFAULTS.weeklyLossKg,
      deadline: plan.deadline || '',
      activity: Number(plan.activity) > 0 ? Number(plan.activity) : DEFAULTS.activity,
      shape: plan.shape === 'ease' ? 'ease' : 'linear',
      pauses: cleanPauses(plan.pauses),
      phase: plan.phase === 'maintain' ? 'maintain' : 'cut',
      floorFat: Number(plan.floorFat) > 0 ? Number(plan.floorFat) : 0
    };
    p.configured = !!(p.goalFat && p.startDate);
    return p;
  }

  /* ---- 基準線（開始日からの7日間の日平均。測った日だけで平均） ---- */
  function baseline(bodyMap, startDate, n) {
    n = n || 7;
    var s = toDays(startDate), list = [], k;
    for (k in bodyMap) if (bodyMap[k].fatMass != null && toDays(k) >= s && toDays(k) < s + n) list.push(bodyMap[k]);
    var provisional = list.length < 3;
    if (provisional) {
      list = Object.keys(bodyMap).map(function (x) { return bodyMap[x]; }).filter(function (d) { return d.fatMass != null && toDays(d.date) >= s; });
      list.sort(function (a, b) { return toDays(a.date) - toDays(b.date); });
      list = list.slice(0, n);
      if (!list.length) {
        list = Object.keys(bodyMap).map(function (x) { return bodyMap[x]; }).filter(function (d) { return d.fatMass != null; });
        list.sort(function (a, b) { return toDays(b.date) - toDays(a.date); });
        list = list.slice(0, n);
      }
    }
    if (!list.length) return null;
    list.sort(function (a, b) { return toDays(a.date) - toDays(b.date); });
    return {
      startDate: startDate, days: list.length, provisional: provisional,
      from: list[0].date, to: list[list.length - 1].date,
      weight: mean(list.map(function (d) { return d.weight; })), fat: mean(list.map(function (d) { return d.fat; })),
      fatMass: mean(list.map(function (d) { return d.fatMass; })), lean: mean(list.map(function (d) { return d.lean; })),
      bmr: mean(list.filter(function (d) { return d.bmr != null; }).map(function (d) { return d.bmr; }))
    };
  }

  /* ---- 計画ライン：基準の脂肪量から目標の脂肪量まで、一定のペースで減らす ---- */
  function build(plan, base) {
    if (!plan.configured || !base) return null;
    var g = plan.goalFat, lean = base.lean, pauses = plan.pauses || [];
    var targetFatMass = lean * g / (100 - g), toLose = Math.max(0, base.fatMass - targetFatMass);
    var weekly = plan.weeklyLossKg, days, deadline = plan.deadline, activeDays;
    var hasDeadline = !!(deadline && toDays(deadline) > toDays(plan.startDate));
    if (hasDeadline) {
      days = toDays(deadline) - toDays(plan.startDate);
      activeDays = Math.max(1, days - pauseDaysUntil(pauses, plan.startDate, deadline));
    } else {
      activeDays = toLose > 0 ? Math.max(1, Math.round(toLose / weekly * 7)) : 0;
      days = activeDays;
      for (var i = 0; i < 6; i++) { var nd = activeDays + pauseDaysUntil(pauses, plan.startDate, addDays(plan.startDate, days)); if (nd === days) break; days = nd; }
      deadline = addDays(plan.startDate, days);
    }
    // 減量する日（休止を除く）の中で、一定ペース（linear）か、終盤を緩めるペース（ease）で脂肪を落とす
    var phase2 = 0, r1, r2;
    if (plan.shape === 'ease' && activeDays > 0) {
      phase2 = Math.min(EASE_DAYS, Math.round(activeDays * 0.3));
      r1 = toLose / ((activeDays - phase2) + EASE_RATIO * phase2); r2 = r1 * EASE_RATIO;
    } else { r1 = activeDays > 0 ? (hasDeadline ? toLose / activeDays : weekly / 7) : 0; r2 = r1; }
    var peakWeekly = r1 * 7;
    return {
      goalFat: g, startDate: plan.startDate, deadline: deadline, totalDays: days,
      shape: plan.shape, pauses: pauses, activeDays: activeDays, phase1Days: activeDays - phase2, phase2Days: phase2,
      ratePerDay1: r1, ratePerDay2: r2, weeklyLossKg1: peakWeekly, weeklyLossKg2: r2 * 7,
      leanKg: lean, baseWeight: base.weight, baseFat: base.fat, baseFatMass: base.fatMass,
      targetFatMass: targetFatMass, targetWeight: lean + targetFatMass, toLoseKg: toLose,
      weeklyLossKg: peakWeekly, weeklyLossPct: base.weight ? peakWeekly / base.weight * 100 : null, // 前半（最も速い時期）の週あたり
      deficitKcalPerDay: Math.round(peakWeekly * KCAL_PER_KG / 7),
      aggressive: !!(base.weight && peakWeekly > base.weight * 0.01) // 体重の1%/週を超える
    };
  }
  // dateまでに経過した「減量する日」の数（休止日を除く）
  function activeElapsed(b, date) {
    var t = Math.max(0, Math.min(toDays(date), toDays(b.startDate) + b.totalDays) - toDays(b.startDate));
    return Math.max(0, t - pauseDaysUntil(b.pauses, b.startDate, date));
  }
  // その日の計画上の減量ペース（kg/週）。休止中は0
  function rateAt(b, date) {
    if (pausedOn(b.pauses, date)) return 0;
    return (activeElapsed(b, date) < b.phase1Days ? b.ratePerDay1 : b.ratePerDay2) * 7;
  }
  function plannedFatMass(b, date) {
    var a = activeElapsed(b, date), loss = a <= b.phase1Days ? b.ratePerDay1 * a : b.ratePerDay1 * b.phase1Days + b.ratePerDay2 * (a - b.phase1Days);
    return Math.max(b.targetFatMass, b.baseFatMass - loss);
  }
  // dateから期限までに残っている「減量する日」の数
  function activeDaysLeft(b, date) { return Math.max(0, b.activeDays - activeElapsed(b, date)); }
  function plannedFatPct(b, date) { var fm = plannedFatMass(b, date); return fm / (b.leanKg + fm) * 100; }

  /* ---- 傾き（最小二乗法）：脂肪量kg/日 ---- */
  function slope(points) {
    var n = points.length;
    if (n < 3) return null;
    var mx = mean(points.map(function (p) { return p.x; })), my = mean(points.map(function (p) { return p.y; })), sxx = 0, sxy = 0;
    points.forEach(function (p) { sxx += (p.x - mx) * (p.x - mx); sxy += (p.x - mx) * (p.y - my); });
    var xs = points.map(function (p) { return p.x; });
    var span = Math.max.apply(null, xs) - Math.min.apply(null, xs);
    if (!sxx || span < 5) return null;
    return { perDay: sxy / sxx, perWeek: sxy / sxx * 7, n: n, span: span };
  }
  function trendOf(bodyMap, field, fromDate, toDate) {
    var pts = [], a = toDays(fromDate), z = toDays(toDate), k;
    for (k in bodyMap) { var x = toDays(k); if (x >= a && x <= z && bodyMap[k][field] != null) pts.push({ x: x, y: bodyMap[k][field] }); }
    return slope(pts);
  }

  /* ---- 1日・1週・1か月の表 ---- */
  function targetFor(targets, date, fallback) {
    var best = null;
    (targets || []).forEach(function (t) { if (t.from <= date && (!best || t.from > best.from)) best = t; });
    return best ? best.kcal : (fallback || 0);
  }

  function daysView(b, bodyMap, mealMap, today, n, targets, fallback) {
    var out = [], e = toDays(today);
    for (var i = 0; i < n; i++) {
      var ds = fromDays(e - i), bd = bodyMap[ds], ml = mealMap[ds], active = toDays(ds) >= toDays(b.startDate);
      var row = { date: ds, active: active, body: !!(bd && bd.fatMass != null), count: bd ? bd.count : 0, kcal: ml ? ml.kcal : null, meals: ml ? ml.meals : 0, protein: ml ? ml.protein : null, complete: !!(ml && ml.complete), target: targetFor(targets, ds, fallback) };
      if (row.body) { row.fat = bd.fat; row.fatMass = bd.fatMass; row.weight = bd.weight; }
      if (active) {
        row.plannedFat = plannedFatPct(b, ds); row.plannedFatMass = plannedFatMass(b, ds);
        if (row.body) { row.gapKg = row.fatMass - row.plannedFatMass; row.gapPct = row.fat - row.plannedFat; }
      }
      out.push(row);
    }
    return out; // 新しい日が先頭
  }

  function weeksView(b, bodyMap, mealMap, today, targets, fallback) {
    var out = [], first = toDays(weekStart(b.startDate)), last = toDays(weekStart(today)), st = toDays(b.startDate), t = toDays(today);
    for (var w = first; w <= last; w += 7) {
      var start = fromDays(w), end = Math.min(w + 6, t), bodyList = [], planned = [], logged = [], used = 0, actDays = 0;
      for (var d = Math.max(w, st); d <= end; d++) {
        var ds = fromDays(d), bd = bodyMap[ds], ml = mealMap[ds];
        actDays++;
        if (bd && bd.fatMass != null) { bodyList.push(bd); planned.push(plannedFatMass(b, ds)); }
        if (ml) { used += ml.kcal; if (ml.complete) logged.push(ml); }
      }
      var target = targetFor(targets, start, fallback), cur = (w === last);
      var row = {
        start: start, end: fromDays(w + 6), current: cur, activeDays: actDays, bodyDays: bodyList.length, mealDays: logged.length, target: target,
        usedKcal: used, weekBudget: target ? target * 7 : 0,
        avgKcal: logged.length ? Math.round(mean(logged.map(function (x) { return x.kcal; }))) : null,
        avgProtein: logged.length ? r1(mean(logged.map(function (x) { return x.protein; }))) : null
      };
      if (bodyList.length) {
        row.fatMass = mean(bodyList.map(function (x) { return x.fatMass; }));
        row.fat = mean(bodyList.map(function (x) { return x.fat; }));
        row.weight = mean(bodyList.map(function (x) { return x.weight; }));
        row.muscle = mean(bodyList.filter(function (x) { return x.muscle != null; }).map(function (x) { return x.muscle; }));
        row.plannedFatMass = mean(planned);
        row.gapKg = row.fatMass - row.plannedFatMass;
        row.plannedFat = mean(bodyList.map(function (x, i) { var fm = planned[i]; return fm / (b.leanKg + fm) * 100; }));
        row.gapPct = row.fat - row.plannedFat;
      }
      if (row.avgKcal != null && target) row.kcalGap = row.avgKcal - target;
      if (cur && target) {
        // 今週の残り予算：記録済みの全kcal（途中の日も含む）を引き、今日が未完なら今日も残り日数に数える
        var tm = mealMap[today], todayOpen = !(tm && tm.complete), left = Math.max(0, w + 6 - t) + (todayOpen ? 1 : 0);
        row.remainingKcal = target * 7 - used; row.remainingDays = left;
        row.perDayRemaining = left > 0 ? Math.round(row.remainingKcal / left) : null;
      }
      out.push(row);
    }
    // 前の週との差（両方に測定が2日以上ある時だけ）
    out.forEach(function (r, i) {
      var p = out[i - 1];
      if (p && r.fatMass != null && p.fatMass != null && r.bodyDays >= 2 && p.bodyDays >= 2) r.changeFromPrev = r.fatMass - p.fatMass;
    });
    return out; // 古い週が先頭
  }

  function monthsView(b, bodyMap, mealMap, today) {
    var map = {}, order = [], st = toDays(b.startDate), t = toDays(today);
    for (var d = st; d <= t; d++) {
      var ds = fromDays(d), m = monthOf(ds), bd = bodyMap[ds], ml = mealMap[ds];
      var x = map[m]; if (!x) { x = map[m] = { month: m, body: [], planned: [], kcal: [] }; order.push(m); }
      if (bd && bd.fatMass != null) { x.body.push(bd); x.planned.push(plannedFatMass(b, ds)); }
      if (ml && ml.complete) x.kcal.push(ml.kcal);
    }
    return order.map(function (m) {
      var x = map[m], r = { month: m, bodyDays: x.body.length, mealDays: x.kcal.length };
      if (x.body.length) {
        r.fatMass = mean(x.body.map(function (y) { return y.fatMass; })); r.fat = mean(x.body.map(function (y) { return y.fat; }));
        r.weight = mean(x.body.map(function (y) { return y.weight; })); r.plannedFatMass = mean(x.planned); r.gapKg = r.fatMass - r.plannedFatMass;
        r.plannedFat = mean(x.body.map(function (y, i) { return x.planned[i] / (b.leanKg + x.planned[i]) * 100; })); r.gapPct = r.fat - r.plannedFat;
      }
      if (x.kcal.length) r.avgKcal = Math.round(mean(x.kcal));
      return r;
    });
  }

  /* ---- 消費カロリー：推定（基礎代謝×活動係数）と、実測（摂取 − 脂肪量の変化×7200） ---- */
  function estimatedTdee(bodyMap, plan, today, base) {
    var from = toDays(today) - 13, v = [], k;
    for (k in bodyMap) if (toDays(k) >= from && bodyMap[k].bmr != null) v.push(bodyMap[k].bmr);
    var bmr = v.length ? mean(v) : (base && base.bmr);
    if (!bmr) return null;
    return { bmr: Math.round(bmr), tdee: Math.round(bmr * plan.activity), activity: plan.activity };
  }
  function observedTdee(bodyMap, mealMap, today, windowDays) {
    windowDays = windowDays || 28;
    var to = today, from = addDays(today, -(windowDays - 1)), tr = trendOf(bodyMap, 'fatMass', from, to);
    if (!tr || tr.span < MIN_BODY_SPAN) return null;
    var inWin = [], d;
    for (d = toDays(from); d <= toDays(to); d++) { var ml = mealMap[fromDays(d)]; if (ml && ml.complete) inWin.push(ml.kcal); }
    var firstBody = null, k;
    for (k in bodyMap) if (bodyMap[k].fatMass != null && toDays(k) >= toDays(from) && (firstBody === null || toDays(k) < firstBody)) firstBody = toDays(k);
    var span = toDays(to) - firstBody + 1, cover = span > 0 ? inWin.length / span : 0;
    if (inWin.length < 7 || cover < 0.7) return null;
    var intake = mean(inWin), tdee = intake - tr.perDay * KCAL_PER_KG;
    return { tdee: Math.round(tdee), intake: Math.round(intake), fatPerWeek: tr.perWeek, bodyPoints: tr.n, span: tr.span, mealDays: inWin.length, coverage: cover };
  }

  /* ---- 次週の調整案（計算はここで確定。AIは文章にするだけ） ---- */
  function adjust(ctx) {
    var b = ctx.built, bodyMap = ctx.bodyMap, mealMap = ctx.mealMap, today = ctx.today, plan = ctx.plan;
    var prev = ctx.prevTarget || 0, reasons = [], status;
    var from7 = addDays(today, -6), meals7 = [], body7 = 0, d;
    for (d = toDays(from7); d <= toDays(today); d++) {
      var ds = fromDays(d), ml = mealMap[ds], bd = bodyMap[ds];
      if (ml && ml.complete) meals7.push(ml);
      if (bd && bd.fatMass != null) body7++;
    }
    var cov = { mealDays: meals7.length, bodyDays: body7, mealNeed: 5, bodyNeed: 3 };
    var weights = []; for (var k in bodyMap) if (toDays(k) >= toDays(from7) && bodyMap[k].weight != null) weights.push(bodyMap[k].weight);
    var weight = weights.length ? mean(weights) : b.baseWeight;
    var est = estimatedTdee(bodyMap, plan, today, ctx.base), obs = observedTdee(bodyMap, mealMap, today, 28);
    var floor = Math.round(Math.max(est ? est.bmr : 1200, 1200));
    var pauseNow = pausedOn(b.pauses, today), rateNow = rateAt(b, today);
    var maintain = plan.phase === 'maintain';
    if (maintain) rateNow = 0; // 維持期：赤字なし（維持カロリー）
    var deficit = Math.round(rateNow * KCAL_PER_KG / 7); // 休止中は0（維持カロリー）
    var out = {
      today: today, coverage: cov, weightKg: r1(weight),
      protein: { minG: Math.round(weight * 1.6), targetG: Math.round(weight * 2.0) },
      planned: { weeklyLossKg: r2(rateNow), deficitKcalPerDay: deficit, aggressive: maintain ? false : b.aggressive, shape: b.shape, paused: !!pauseNow, phase: plan.phase },
      floorKcal: floor, previousTarget: prev || null,
      avgIntake7: meals7.length ? Math.round(mean(meals7.map(function (x) { return x.kcal; }))) : null
    };
    if (!est && !obs) { out.status = 'insufficient'; out.reasons = ['基礎代謝の記録がないため消費カロリーを推定できません']; out.target = prev || null; return out; }

    // 使う消費カロリー：実測が出せればそれ、無ければ推定
    var tdee, basis;
    if (obs && obs.tdee >= floor && est && obs.tdee <= est.bmr * 2.3) { tdee = obs.tdee; basis = 'observed'; }
    else { tdee = est ? est.tdee : obs.tdee; basis = 'estimated'; }
    out.tdee = { kcal: tdee, basis: basis, estimated: est ? est.tdee : null, observed: obs ? obs.tdee : null };
    var raw = Math.max(floor, Math.round((tdee - deficit) / 10) * 10);
    out.rawTarget = raw;

    if (meals7.length < cov.mealNeed) reasons.push('食事の記録が揃った日が直近7日で' + meals7.length + '日（5日以上で調整します）');
    if (body7 < cov.bodyNeed) reasons.push('体組成を測った日が直近7日で' + body7 + '日（3日以上で調整します）');

    var target = raw;
    if (reasons.length) {
      status = 'insufficient';
      target = prev || raw; // 記録が足りない週は、今の目標を変えない
    } else if (basis !== 'observed') {
      status = 'learning';
      target = prev || raw;
      reasons.push('体組成の記録がまだ' + MIN_BODY_SPAN + '日分に届いていないため、計画値（基礎代謝×' + plan.activity + '−計画の赤字）を使います');
    } else {
      var actual = -obs.fatPerWeek, plan_ = rateNow;
      out.actual = { weeklyLossKg: r2(actual), spanDays: obs.span, bodyPoints: obs.bodyPoints, avgIntake: obs.intake, mealDays: obs.mealDays };
      if (actual < plan_ - 0.2) status = 'behind'; else if (actual > plan_ + 0.3) status = 'ahead'; else status = 'on_track';
      if (prev) {
        var diff = raw - prev;
        if (Math.abs(diff) < HOLD_BAND) target = prev;
        else target = prev + Math.max(-STEP_LIMIT, Math.min(STEP_LIMIT, diff));
      } else target = raw;
      target = Math.max(floor, Math.round(target / 10) * 10);
      if (obs.span < 21) reasons.push('実測は' + obs.span + '日分の傾向で、まだ誤差が大きい（週あたり±0.2kg程度）ので、動かす幅を小さく抑えます');
      var leanTr = trendOf(bodyMap, 'lean', addDays(today, -27), today);
      if (leanTr && leanTr.span >= MIN_BODY_SPAN && leanTr.perWeek < -0.3) { out.leanWarning = '除脂肪量が週' + r2(-leanTr.perWeek) + 'kgのペースで減っています（体組成計の推定値。筋トレの重さ・回数と合わせて確認）'; }
      if (actual > weight * 0.01) reasons.push('減量ペースが体重の1%/週を超えています。筋肉が落ちやすいので緩めます');
      if (out.avgIntake7 != null && prev && out.avgIntake7 - prev > 150) reasons.push('直近7日の摂取は目標より' + (out.avgIntake7 - prev) + 'kcal多い。計画とのずれの主因は摂取量です');
    }
    // 最低体脂肪率（フロア）：維持期は許容帯に収める。減量期でも到達したら維持への切替を促す
    var fats = [];
    for (d = toDays(from7); d <= toDays(today); d++) { var bdd = bodyMap[fromDays(d)]; if (bdd && bdd.fat != null) fats.push(bdd.fat); }
    var fat7 = fats.length >= 2 ? mean(fats) : null;
    if (plan.floorFat > 0 && fat7 != null) {
      var upper = plan.floorFat + MAINT_BAND;
      out.floor = { floorFat: plan.floorFat, upperFat: r1(upper), currentFat: r1(fat7), marginPct: r1(fat7 - plan.floorFat) };
      if (maintain && status !== 'insufficient') {
        if (fat7 < plan.floorFat) { status = 'below_floor'; target = Math.round((tdee + STEP_LIMIT) / 10) * 10; reasons.unshift('体脂肪率が最低ライン' + plan.floorFat + '%を下回っています。維持カロリーより' + STEP_LIMIT + 'kcal多く食べて、筋トレは維持します'); }
        else if (fat7 > upper) { status = 'above_band'; target = Math.max(floor, Math.round((tdee - STEP_LIMIT) / 10) * 10); reasons.unshift('体脂肪率が許容帯の上限' + r1(upper) + '%を超えています。維持カロリーより' + STEP_LIMIT + 'kcal控えめにします'); }
        else { status = 'maintaining'; target = Math.max(floor, Math.round(tdee / 10) * 10); reasons.unshift('体脂肪率は許容帯（' + plan.floorFat + '〜' + r1(upper) + '%）の中。維持カロリーで過ごします'); }
      } else if (!maintain && fat7 <= plan.floorFat) {
        status = 'floor_reached'; target = Math.max(floor, Math.round(tdee / 10) * 10); out.floorReached = true;
        reasons.unshift('体脂肪率が最低ライン' + plan.floorFat + '%に届きました。これ以上は減らさず、維持期へ切り替えるのがおすすめです');
      }
    }
    if (pauseNow) { // 休止期間：維持カロリーで運用し、計画との比較は行わない
      status = 'paused'; target = raw;
      reasons.unshift('休止期間（' + pauseNow.from + '〜' + pauseNow.to + (pauseNow.reason ? '：' + pauseNow.reason : '') + '）のため、維持カロリーで過ごします');
      out.pause = { from: pauseNow.from, to: pauseNow.to, reason: pauseNow.reason || '' };
    }
    out.status = status; out.reasons = reasons; out.target = target;
    out.deltaFromPrevious = prev ? target - prev : null;
    out.weeklyBudget = target * 7;
    out.expectedLossKgPerWeek = r2((tdee - target) * 7 / KCAL_PER_KG);
    return out;
  }

  /* ---- 画面・AI用にまとめる ---- */
  function view(ctx) {
    var today = ctx.today, plan = normalizePlan(ctx.plan, today);
    var out = { today: today, plan: plan, configured: plan.configured };
    if (!plan.configured) return out;
    var bodyMap = bodyDays(ctx.daily), mealMap = mealDays(ctx.meals);
    var base = baseline(bodyMap, plan.startDate, 7);
    out.base = base;
    if (!base) { out.noBody = true; return out; }
    var built = build(plan, base); out.built = built;
    var fallback = ctx.mealGoalKcal || 0, targets = ctx.targets || [];
    out.days = daysView(built, bodyMap, mealMap, today, 14, targets, fallback);
    out.weeks = weeksView(built, bodyMap, mealMap, today, targets, fallback);
    out.months = monthsView(built, bodyMap, mealMap, today);
    var prev = targetFor(targets, today, fallback);
    out.adjust = adjust({ plan: plan, built: built, base: base, bodyMap: bodyMap, mealMap: mealMap, today: today, prevTarget: prev });
    // 現在の位置：直近7日の脂肪量の平均と、同じ日の計画値の平均
    var cur = [], pl = [];
    for (var d = toDays(today) - 6; d <= toDays(today); d++) { var ds = fromDays(d), bd = bodyMap[ds]; if (bd && bd.fatMass != null) { cur.push(bd); pl.push(plannedFatMass(built, ds)); } }
    if (cur.length) {
      var fm = mean(cur.map(function (x) { return x.fatMass; })), pf = mean(pl);
      out.now = { days: cur.length, fatMass: fm, fat: mean(cur.map(function (x) { return x.fat; })), weight: mean(cur.map(function (x) { return x.weight; })), plannedFatMass: pf, gapKg: fm - pf, plannedFat: mean(cur.map(function (x, i) { return pl[i] / (built.leanKg + pl[i]) * 100; })) };
      out.now.gapPct = out.now.fat - out.now.plannedFat;
      out.now.remainingKg = Math.max(0, fm - built.targetFatMass);
    }
    return out;
  }

  return {
    KCAL_PER_KG: KCAL_PER_KG, DEFAULTS: DEFAULTS, r1: r1, r2: r2, toDays: toDays, fromDays: fromDays, addDays: addDays, weekStart: weekStart, nextMonday: nextMonday, monthOf: monthOf,
    bodyDays: bodyDays, mealDays: mealDays, normalizePlan: normalizePlan, baseline: baseline, build: build, plannedFatMass: plannedFatMass, rateAt: rateAt, activeElapsed: activeElapsed, activeDaysLeft: activeDaysLeft, cleanPauses: cleanPauses, pausedOn: pausedOn, pauseDaysUntil: pauseDaysUntil, BAND_KG: BAND_KG, MAINT_BAND: MAINT_BAND, plannedFatPct: plannedFatPct,
    slope: slope, trendOf: trendOf, targetFor: targetFor, daysView: daysView, weeksView: weeksView, monthsView: monthsView,
    estimatedTdee: estimatedTdee, observedTdee: observedTdee, adjust: adjust, view: view
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = PlanLib;
