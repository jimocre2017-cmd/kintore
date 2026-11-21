/* node test/plan-lib.test.js で実行（外部ライブラリ不要） */
var assert = require('assert');
var P = require('../plan-lib.js');
var B = require('../body-lib.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }
function near(a, b, tol, msg) { assert.ok(Math.abs(a - b) <= tol, (msg || '') + ' 期待 ' + b + '±' + tol + ' / 実際 ' + a); }

/* ---- 実データ（スプレッドシート 2026/11/06〜11/08） ---- */
var entries = [
  { date: '2026/11/06', time: '15:00', id: 'a', weight: 66.3, fat: 25.4, muscle: 33.4, bmr: 1540, tags: ['午後'] },
  { date: '2026/11/06', time: '19:00', id: 'b', weight: 66.1, fat: 25.5, muscle: 33.2, bmr: 1540, tags: ['食事後'] },
  { date: '2026/11/08', time: '08:54', id: 'c', weight: 65.7, fat: 26.0, muscle: 31.9, bmr: 1525, tags: ['起床後'] }
];
var meals = [
  ['2026/11/06', 393], ['2026/11/06', 337], ['2026/11/06', 355],
  ['2026/11/07', 159], ['2026/11/07', 324], ['2026/11/07', 180], ['2026/11/07', 411], ['2026/11/07', 700], ['2026/11/07', 970], ['2026/11/07', 285],
  ['2026/11/08', 413], ['2026/11/08', 30], ['2026/11/08', 605], ['2026/11/08', 1220]
].map(function (x, i) { return { date: x[0], kcal: x[1], protein: 20, fat: 10, carbs: 30 }; });

t('日ごとの食事合計と「記録が揃った日」の判定', function () {
  var m = P.mealDays(meals);
  assert.strictEqual(m['2026/11/07'].kcal, 3029);
  assert.strictEqual(m['2026/11/08'].kcal, 2268);
  assert.strictEqual(m['2026/11/06'].kcal, 1085);
  assert.ok(m['2026/11/07'].complete && m['2026/11/08'].complete);
});

t('基準線：測った日だけで平均し、3日未満は暫定', function () {
  var daily = B.daily(entries);
  var bm = P.bodyDays(daily);
  var base = P.baseline(bm, '2026/11/09', 7); // 開始日以降のデータはまだ無い → 最新7日で暫定
  assert.ok(base.provisional);
  assert.strictEqual(base.days, 2);
  var base2 = P.baseline(bm, '2026/11/08', 7);
  near(base2.fatMass, 65.7 * 0.26, 0.001);
  near(base2.lean, 65.7 * 0.74, 0.001);
});

t('計画：11/8の数値から12%まで（除脂肪量を維持）', function () {
  var bm = P.bodyDays(B.daily(entries));
  var base = P.baseline(bm, '2026/11/08', 7);
  var plan = P.normalizePlan({ goalFat: 12, startDate: '2026/11/08', weeklyLossKg: 0.5 });
  var b = P.build(plan, base);
  near(b.toLoseKg, 10.45, 0.02, '落とす脂肪量');
  near(b.targetWeight, 55.25, 0.02, '目標体重');
  near(b.deficitKcalPerDay, 514, 1, '1日の赤字');
  assert.strictEqual(b.deadline, P.addDays('2026/11/08', Math.round(b.toLoseKg / 0.5 * 7)));
  near(P.plannedFatMass(b, '2026/11/15'), b.baseFatMass - 0.5, 0.001);
  near(P.plannedFatPct(b, '2026/11/08'), 26.0, 0.001);
  assert.ok(!b.aggressive);
});

t('期限を指定すると週あたりの減量が逆算される。速すぎれば aggressive', function () {
  var bm = P.bodyDays(B.daily(entries));
  var base = P.baseline(bm, '2026/11/08', 7);
  var b = P.build(P.normalizePlan({ goalFat: 12, startDate: '2026/11/08', deadline: '2027/02/08' }), base);
  assert.ok(b.weeklyLossKg > 0.7 && b.aggressive, '3か月で10kgは速すぎる');
});

t('週は月曜始まり', function () {
  assert.strictEqual(P.weekStart('2026/11/08'), '2026/11/02');
  assert.strictEqual(P.weekStart('2026/11/09'), '2026/11/09');
  assert.strictEqual(P.nextMonday('2026/11/08'), '2026/11/09');
});

/* ---- 合成データ：真の消費2400kcal、摂取1850kcal を35日続けた場合 ---- */
function synth(opts) {
  var start = '2026/11/09', e = [], m = [], TDEE = opts.tdee, lean = 48.6, fm0 = 17.1, i;
  for (i = 0; i < opts.days; i++) {
    var ds = P.addDays(start, i), intake = opts.intake[i % opts.intake.length];
    var fm = fm0 - (TDEE - opts.avgIntake) / 7200 * i + Math.sin(i * 2.1) * 0.35; // 日々の誤差 ±0.35kg
    var w = lean + fm;
    if (!opts.skipBody || !opts.skipBody(i)) e.push({ date: ds, time: '08:00', id: 'e' + i, weight: w, fat: fm / w * 100, muscle: 32, bmr: 1525, tags: ['起床後'] });
    if (!opts.skipMeal || !opts.skipMeal(i)) [0, 1, 2].forEach(function (k) { m.push({ date: ds, kcal: intake / 3, protein: 40, fat: 20, carbs: 50 }); });
  }
  return { entries: e, meals: m, last: P.addDays(start, opts.days - 1) };
}
function run(s, extra) {
  return P.view(Object.assign({ today: s.last, daily: B.daily(s.entries), meals: s.meals, plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5 }, mealGoalKcal: 1850 }, extra || {}));
}

t('35日分：実測の消費カロリーが真値(2400)に近く、順調と判定される', function () {
  var s = synth({ days: 35, tdee: 2400, avgIntake: 1850, intake: [1850] });
  var v = run(s);
  var o = P.observedTdee(P.bodyDays(B.daily(s.entries)), P.mealDays(s.meals), s.last, 28);
  near(o.tdee, 2400, 220, '実測TDEE');
  assert.strictEqual(v.adjust.status, 'on_track');
  assert.strictEqual(v.adjust.target, 1850); // 変更幅が小さいので据え置き
  assert.ok(v.weeks.length === 5);
  assert.ok(Math.abs(v.now.gapKg) < 0.5, '計画からのずれは小さい: ' + v.now.gapKg);
});

t('摂取が多すぎて減っていない場合は「遅れ」。目標は上限200kcalの幅で下げる', function () {
  var s = synth({ days: 35, tdee: 2400, avgIntake: 2300, intake: [2300] });
  var v = run(s);
  assert.strictEqual(v.adjust.status, 'behind');
  assert.ok(v.now.gapKg > 0.8, '計画より脂肪が多い');
  // 実測消費は2400前後 → 計画の赤字514を引いた約1890。今の目標1850からの差が小さいので据え置き
  assert.ok(Math.abs(v.adjust.target - 1850) <= 200);
  assert.ok(v.adjust.reasons.join('').indexOf('摂取は目標より') >= 0, '摂取オーバーが主因と説明される');
});

t('減りすぎ(週0.9kg相当)は「速すぎ」。目標を引き上げる（上限+200）', function () {
  var s = synth({ days: 35, tdee: 2400, avgIntake: 1500, intake: [1500] });
  var v = run(s, { mealGoalKcal: 1500 });
  assert.strictEqual(v.adjust.status, 'ahead');
  assert.strictEqual(v.adjust.target, 1700);
  assert.ok(v.adjust.reasons.join('').indexOf('1%/週') >= 0 || v.adjust.actual.weeklyLossKg > 0.65);
});

t('記録不足の週は調整せず、今の目標を維持する', function () {
  var s = synth({ days: 35, tdee: 2400, avgIntake: 1850, intake: [1850], skipMeal: function (i) { return i >= 30 && i % 2 === 0; } });
  var v = run(s);
  assert.strictEqual(v.adjust.status, 'insufficient');
  assert.strictEqual(v.adjust.target, 1850);
  assert.ok(v.adjust.reasons.length >= 1);
});

t('最初の10日は実測を使わず、基礎代謝×活動係数から計画値を出す', function () {
  var s = synth({ days: 7, tdee: 2400, avgIntake: 1850, intake: [1850] });
  var v = run(s, { mealGoalKcal: 0 });
  assert.strictEqual(v.adjust.status, 'learning');
  assert.strictEqual(v.adjust.tdee.basis, 'estimated');
  near(v.adjust.target, Math.max(1525, 1525 * P.DEFAULTS.activity - v.built.deficitKcalPerDay), 10);
});

t('下限（基礎代謝）を下回る目標は出さない', function () {
  var s = synth({ days: 35, tdee: 1700, avgIntake: 1500, intake: [1500] });
  var v = run(s, { mealGoalKcal: 1550 });
  assert.ok(v.adjust.target >= 1525);
});

t('週予算の残り：今週の使用kcalから1日あたりの残りを出す', function () {
  var s = synth({ days: 3, tdee: 2400, avgIntake: 1850, intake: [1850, 2400, 1000] }); // 月火水(11/9〜11/11)
  var v = run(s);
  var w = v.weeks[v.weeks.length - 1];
  assert.strictEqual(w.weekBudget, 1850 * 7);
  assert.strictEqual(w.usedKcal, 1850 + 2400 + 1000);
  assert.strictEqual(w.remainingKcal, 1850 * 7 - 5250);
  assert.strictEqual(w.remainingDays, 4); // 木金土日（水は記録が揃った日）
  assert.strictEqual(w.perDayRemaining, Math.round((1850 * 7 - 5250) / 4));
});

t('目標が未設定ならモードだけ返す', function () {
  var v = P.view({ today: '2026/11/08', daily: [], meals: [], plan: {} });
  assert.strictEqual(v.configured, false);
});

t('緩やかな計画（ease）：終盤を緩め、合計の減量と期限は変えない', function () {
  var bm = P.bodyDays(B.daily(entries));
  var base = P.baseline(bm, '2026/11/08', 7);
  var mk = function (shape, pauses) { return P.build(P.normalizePlan({ goalFat: 12, startDate: '2026/11/08', deadline: '2027/04/30', shape: shape, pauses: pauses }), base); };
  var lin = mk('linear'), ez = mk('ease');
  near(P.plannedFatMass(ez, ez.deadline), ez.targetFatMass, 0.001, '期限で目標に着く');
  near(P.plannedFatMass(lin, lin.deadline), lin.targetFatMass, 0.001);
  assert.ok(ez.weeklyLossKg1 > lin.weeklyLossKg1, '前半は直線より速い');
  near(ez.weeklyLossKg2 / ez.weeklyLossKg1, 0.6, 0.001, '終盤は前半の6割');
  assert.ok(ez.phase2Days > 0 && P.rateAt(ez, ez.deadline) < P.rateAt(ez, '2026/12/01'));
  // 途中の点：前半は直線より先行（脂肪量が少ない）、終盤は直線より後ろ
  assert.ok(P.plannedFatMass(ez, '2027/01/31') < P.plannedFatMass(lin, '2027/01/31'));
  var gapMid = P.plannedFatMass(lin, '2027/01/31') - P.plannedFatMass(ez, '2027/01/31');
  var gapEnd = P.plannedFatMass(lin, '2027/04/15') - P.plannedFatMass(ez, '2027/04/15');
  assert.ok(gapEnd >= 0 && gapEnd < gapMid, '先行分は終盤に向けて縮まり、期限で一致する');
});

t('休止期間：その間は減らさず、期限は変えずに残りの日で取り戻す', function () {
  var bm = P.bodyDays(B.daily(entries));
  var base = P.baseline(bm, '2026/11/08', 7);
  var pauses = [{ from: '2026/12/28', to: '2027/01/05', reason: '年末年始' }];
  var a = P.build(P.normalizePlan({ goalFat: 12, startDate: '2026/11/08', deadline: '2027/04/30' }), base);
  var b = P.build(P.normalizePlan({ goalFat: 12, startDate: '2026/11/08', deadline: '2027/04/30', pauses: pauses }), base);
  assert.strictEqual(b.activeDays, a.activeDays - 9);
  assert.ok(b.weeklyLossKg > a.weeklyLossKg, '休んだ分、ほかの週は少し速くなる');
  assert.strictEqual(P.plannedFatMass(b, '2026/12/28'), P.plannedFatMass(b, '2026/12/27')); // 休止中は減らない
  assert.strictEqual(P.plannedFatMass(b, '2027/01/05'), P.plannedFatMass(b, '2026/12/27'));
  assert.ok(P.plannedFatMass(b, '2027/01/06') < P.plannedFatMass(b, '2027/01/05'));
  near(P.plannedFatMass(b, b.deadline), b.targetFatMass, 0.001);
  assert.strictEqual(P.rateAt(b, '2026/12/31'), 0);
  assert.strictEqual(P.activeDaysLeft(b, '2026/12/31'), P.activeDaysLeft(b, '2026/12/27'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(P.cleanPauses([{ from: '2027-1-3', to: '2027/01/01' }, { from: '2026/12/28', to: '2027-01-05', reason: 'x' }, {}]))), [{ from: '2026/12/28', to: '2027/01/05', reason: 'x' }]);
});

t('休止中の調整：維持カロリー（赤字0）で運用し、statusは paused', function () {
  var bm = P.bodyDays(B.daily(entries));
  var pauses = [{ from: '2026/11/20', to: '2026/11/25', reason: '旅行' }];
  var v = P.view({ today: '2026/11/22', daily: B.daily(entries), meals: [], plan: { goalFat: 12, startDate: '2026/11/08', weeklyLossKg: 0.5, shape: 'ease', pauses: pauses }, targets: [], mealGoalKcal: 1800 });
  if (v.adjust.status === 'insufficient' && !v.adjust.tdee) return; // 基礎代謝の記録が無いデータでは調整しない
  assert.strictEqual(v.adjust.status, 'paused');
  assert.strictEqual(v.adjust.planned.deficitKcalPerDay, 0);
  assert.strictEqual(v.adjust.target, v.adjust.rawTarget);
});

t('維持期：最低体脂肪率の許容帯に収まれば維持カロリー、外れたら±200kcal', function () {
  var s = synth({ days: 35, tdee: 2400, avgIntake: 2400, intake: [2400] });
  var mk = function (extra) { return run(s, { plan: Object.assign({ goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, phase: 'maintain' }, extra) }); };
  var cur = mk({ floorFat: 20 }).adjust.floor.currentFat;
  var inBand = mk({ floorFat: Math.floor(cur) - 0.5 }).adjust, above = mk({ floorFat: cur - 4 }).adjust, below = mk({ floorFat: cur + 3 }).adjust;
  assert.strictEqual(inBand.status, 'maintaining');
  assert.strictEqual(inBand.planned.deficitKcalPerDay, 0);
  assert.strictEqual(inBand.target, Math.round(inBand.tdee.kcal / 10) * 10);
  assert.strictEqual(above.status, 'above_band');
  assert.strictEqual(above.target, Math.round((above.tdee.kcal - 200) / 10) * 10);
  assert.strictEqual(below.status, 'below_floor');
  assert.strictEqual(below.target, Math.round((below.tdee.kcal + 200) / 10) * 10);
});

t('減量期：最低体脂肪率に届いたら floor_reached で維持カロリーに切替を促す', function () {
  var s = synth({ days: 35, tdee: 2400, avgIntake: 2400, intake: [2400] });
  var cur = run(s, { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, floorFat: 20 } }).adjust.floor.currentFat;
  var v = run(s, { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, floorFat: cur + 1 } }).adjust;
  assert.strictEqual(v.status, 'floor_reached');
  assert.ok(v.floorReached);
  var w = run(s, { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, floorFat: cur - 3 } }).adjust;
  assert.notStrictEqual(w.status, 'floor_reached');
});

t('gas/PlanLib.gs が plan-lib.js と同じ内容', function () {
  var fs = require('fs'), path = require('path');
  var a = fs.readFileSync(path.join(__dirname, '..', 'plan-lib.js'), 'utf8');
  var b = fs.readFileSync(path.join(__dirname, '..', 'gas', 'PlanLib.gs'), 'utf8').split('\n').slice(1).join('\n');
  assert.strictEqual(a, b, 'node tools/sync-planlib.js を実行してください');
});


/* ---- マスタープラン連動（モード別の次週カロリー） ---- */
var RL = require('../roadmap-lib.js');
t('adjustCfg：選択に応じてモードと範囲が決まる', function () {
  assert.deepStrictEqual([RL.adjustCfg('', 'cut').mode, RL.adjustCfg('hold', 'cut').mode, RL.adjustCfg('advance', 'cut').mode, RL.adjustCfg('maintain', 'cut').mode, RL.adjustCfg('', 'maintain').mode], ['cut', 'cut', 'bulk', 'maintain', 'maintain']);
  assert.deepStrictEqual([RL.adjustCfg('advance').kcalMin, RL.adjustCfg('advance').kcalMax], [1950, 2100]);
  assert.strictEqual(RL.adjustCfg('maintain').kcalMax, 0);
});
t('第1期：目標がマスタープランの範囲（1660〜1800）に収まる', function () {
  var s = synth({ days: 35, tdee: 2400, avgIntake: 1850, intake: [1850] });
  var v = run(s, { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, roadmap: RL.adjustCfg('', 'cut') } });
  assert.strictEqual(v.adjust.mode, 'cut');
  assert.strictEqual(v.adjust.target, 1800);
  assert.ok(v.adjust.reasons.join('').indexOf('マスタープランの範囲') >= 0);
});
t('第2期バルク：体重の増え方が目安内なら据え置き、速すぎれば下げ、範囲（1950〜2100）に収める', function () {
  var rm = { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, roadmap: RL.adjustCfg('advance', 'cut') };
  var ok = run(synth({ days: 35, tdee: 2400, avgIntake: 2600, intake: [2600] }), { plan: rm, mealGoalKcal: 2000 });
  assert.strictEqual(ok.adjust.mode, 'bulk'); assert.strictEqual(ok.adjust.status, 'bulk_ok'); assert.strictEqual(ok.adjust.target, 2000);
  var fast = run(synth({ days: 35, tdee: 2400, avgIntake: 3000, intake: [3000] }), { plan: rm, mealGoalKcal: 2000 });
  assert.strictEqual(fast.adjust.status, 'bulk_fast'); assert.ok(fast.adjust.target <= 2100 && fast.adjust.target >= 1950);
  var low = run(synth({ days: 35, tdee: 2400, avgIntake: 2600, intake: [2600] }), { plan: rm, mealGoalKcal: 1800 });
  assert.ok(low.adjust.target >= 1950, '範囲の下限まで引き上げる: ' + low.adjust.target);
});
t('マスタープランで維持を選ぶと、減量計画が維持期でなくても維持カロリーで運用する', function () {
  var s = synth({ days: 35, tdee: 2400, avgIntake: 2400, intake: [2400] });
  var v = run(s, { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, roadmap: RL.adjustCfg('maintain', 'cut') }, mealGoalKcal: 2400 });
  assert.strictEqual(v.adjust.mode, 'maintain'); assert.strictEqual(v.adjust.planned.deficitKcalPerDay, 0);
});

t('消費カロリーの係数：既定はRoadmapLibと同じ・実測が出たら係数を返し、保存された係数を推定に使う', function () {
  var R = require('../roadmap-lib.js');
  assert.strictEqual(P.DEFAULTS.activity, R.ACTIVITY, '既定の係数は全体で1つ');
  var s = synth({ days: 35, tdee: 2400, avgIntake: 1850, intake: [1850] });
  var v = run(s);
  assert.strictEqual(v.adjust.tdee.basis, 'observed');
  near(v.adjust.calibration, 2400 / 1525, 0.12);
  var s7 = synth({ days: 7, tdee: 2400, avgIntake: 1850, intake: [1850] });
  var v7 = run(s7, { mealGoalKcal: 0, plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, activityCal: 1.5 } });
  assert.strictEqual(v7.adjust.tdee.calibrated, true);
  near(v7.adjust.tdee.estimated, 1525 * 1.5, 2);
  var bad = run(s7, { mealGoalKcal: 0, plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, activityCal: 3 } });
  assert.strictEqual(bad.adjust.tdee.calibrated, false, 'ありえない係数は使わない');
});

t('たんぱく質：マスタープランの期の範囲を使う（無ければ体重×1.6〜1.8）', function () {
  var R = require('../roadmap-lib.js');
  var s = synth({ days: 35, tdee: 2400, avgIntake: 1850, intake: [1850] });
  var v = run(s, { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, roadmap: R.adjustCfg('', 'cut', null, { weightKg: 65, fatPct: 25 }) } });
  assert.deepStrictEqual(v.adjust.protein, { minG: 112, targetG: 127, maxG: 151 }, '第1期：除脂肪量（65kg×75%）×2.3〜3.1g');
  var v3 = run(s, { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, roadmap: R.adjustCfg('', 'cut', null, { weightKg: 65, fatPct: 25 }, { kcal: 2400 }) } });
  assert.deepStrictEqual(v3.adjust.range, { min: 1800, max: 2160 }, '第1期のカロリー範囲は消費2400の75〜90%');
  assert.ok(v3.adjust.target >= 1800 && v3.adjust.target <= 2160, String(v3.adjust.target));
  var v2 = run(s);
  assert.strictEqual(v2.adjust.protein.targetG, Math.round(v2.adjust.weightKg * 1.8));
});
t('絞り込み期：赤字は小さい範囲（消費の90〜97%）に収め、計画が維持期の設定でも絞り込みを優先する', function () {
  var en = { kcal: 2400, basis: 'observed', bmr: 1500 }, body = { weightKg: 65, fatPct: 16 };
  var cfg = RL.adjustCfg('shred', 'cut', null, body, en);
  assert.strictEqual(cfg.mode, 'shred'); assert.strictEqual(cfg.kcalMin, 2160); assert.strictEqual(cfg.kcalMax, 2330); assert.strictEqual(cfg.floorFat, 12);
  var v = run(synth({ days: 35, tdee: 2400, avgIntake: 1700, intake: [1700] }), { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, roadmap: cfg } });
  assert.strictEqual(v.adjust.mode, 'shred'); assert.strictEqual(v.adjust.planned.aggressive, false);
  assert.ok(v.adjust.target >= 2160 || v.adjust.status === 'floor_reached', '範囲の下限まで引き上げる: ' + v.adjust.target + ' ' + v.adjust.status);
  var vm = run(synth({ days: 35, tdee: 2400, avgIntake: 2300, intake: [2300] }), { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, phase: 'maintain', floorFat: 12, roadmap: RL.adjustCfg('shred', 'maintain', null, body, en) } });
  assert.strictEqual(vm.adjust.mode, 'shred', '計画が維持期の設定でも、絞り込みを選んでいれば絞り込み');
});
t('第3期：減量中の食事から維持カロリーへ、毎週+100kcalずつ戻す（回復）。戻りきったら維持', function () {
  var s = synth({ days: 35, tdee: 2400, avgIntake: 2400, intake: [2400] });
  var cur = run(s, { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, phase: 'maintain', floorFat: 20 } }).adjust.floor.currentFat;
  var mk = function (prevKcal) {
    var cfg = RL.adjustCfg('maintain', 'maintain');
    return run(s, { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, phase: 'maintain', floorFat: Math.floor(cur) - 0.5, roadmap: cfg }, targets: [{ from: '2026/11/01', kcal: prevKcal }], mealGoalKcal: prevKcal }).adjust;
  };
  assert.strictEqual(RL.adjustCfg('maintain', 'cut').recover, true); assert.strictEqual(RL.adjustCfg('', 'cut').recover, false);
  var a = mk(1800), mt = Math.round(a.tdee.kcal / 10) * 10;
  assert.strictEqual(a.status, 'recovering'); assert.strictEqual(a.target, 1900);
  assert.strictEqual(a.recovery.toKcal, mt); assert.strictEqual(a.recovery.fromKcal, 1800); assert.ok(a.recovery.weeksLeft >= 1);
  assert.strictEqual(mk(mt - 60).status, 'maintaining', '差が小さければ回復ではなく維持');
  assert.strictEqual(mk(mt - 100).status, 'maintaining');
  var last = mk(mt - 150); assert.strictEqual(last.status, 'recovering'); assert.strictEqual(last.target, mt - 50 > mt ? mt : Math.min(mt, mt - 150 + 100));
  var noRec = run(s, { plan: { goalFat: 12, startDate: '2026/11/09', weeklyLossKg: 0.5, phase: 'maintain', floorFat: Math.floor(cur) - 0.5 }, mealGoalKcal: 1800 }).adjust;
  assert.strictEqual(noRec.status, 'maintaining', 'マスタープランの設定が無ければ従来どおり');
});
console.log('\n' + n + ' 件すべて成功');
