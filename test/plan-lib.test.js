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
  near(v.adjust.target, 1525 * 1.55 - v.built.deficitKcalPerDay, 10);
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

t('gas/PlanLib.gs が plan-lib.js と同じ内容', function () {
  var fs = require('fs'), path = require('path');
  var a = fs.readFileSync(path.join(__dirname, '..', 'plan-lib.js'), 'utf8');
  var b = fs.readFileSync(path.join(__dirname, '..', 'gas', 'PlanLib.gs'), 'utf8').split('\n').slice(1).join('\n');
  assert.strictEqual(a, b, 'node tools/sync-planlib.js を実行してください');
});

console.log('\n' + n + ' 件すべて成功');
