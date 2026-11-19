/* node test/roadmap-lib.test.js で実行（外部ライブラリ不要） */
var assert = require('assert');
var R = require('../roadmap-lib.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

t('日付からフェーズが決まる', function () {
  assert.strictEqual(R.current('2026/11/18').phase.key, 'recomp');
  assert.strictEqual(R.current('2027/04/30').phase.key, 'recomp');
  assert.strictEqual(R.current('2027/05/01').phase.key, 'leanbulk');
  assert.strictEqual(R.current('2027/06/30').phase.key, 'leanbulk');
  assert.strictEqual(R.current('2027/07/01'), null);
  assert.strictEqual(R.current('2027/04/30').daysLeft, 0);
  assert.strictEqual(R.current('2027/04/20').daysLeft, 10);
});
t('第1期の食事目標は表の範囲の中央を目安にする', function () {
  var g = R.mealGoals(R.ROADMAP.phases[0]);
  assert.deepStrictEqual(g, { kcal: 1730, kcalMin: 1660, kcalMax: 1800, protein: 125, proteinMin: 120, proteinMax: 130, fat: 45, fatMin: 40, fatMax: 50 });
});
t('第2期はたんぱく質・脂質を送らない（今の値を残す）', function () {
  var g = R.mealGoals(R.ROADMAP.phases[1]);
  assert.strictEqual(g.kcalMin, 1950); assert.strictEqual(g.kcalMax, 2100); assert.strictEqual(g.kcal, 2030);
  assert.ok(!('protein' in g) && !('fat' in g));
});
t('目標との差：体脂肪率は下回れば到達、LBMは上回れば到達', function () {
  var p = R.progress(R.ROADMAP.phases[0], { fatPct: 25.0, leanKg: 48.6 });
  assert.deepStrictEqual(p.map(function (x) { return x.key; }), ['fatPct', 'leanKg']);
  assert.strictEqual(p[0].gap, -10); assert.strictEqual(p[0].reached, false);
  assert.strictEqual(p[1].gap, 1.4); assert.strictEqual(p[1].reached, false);
  assert.strictEqual(R.progress(R.ROADMAP.phases[0], { fatPct: 15, leanKg: 50 }).every(function (x) { return x.reached; }), true);
  assert.strictEqual(R.progress(R.ROADMAP.phases[0], {})[0].gap, null);
});
t('食事の平均が範囲の下・中・上のどこか', function () {
  var m = R.mealCheck(R.ROADMAP.phases[0], { kcal: 1500, protein: 125, fat: 60 });
  assert.deepStrictEqual(m.map(function (x) { return x.state; }), ['under', 'in', 'over']);
});
t('AIに渡す要約', function () {
  var b = R.brief('2026/11/20', { fatPct: 25, leanKg: 48.6 }, { kcal: 1700, protein: 110, fat: 45 }, { fat7: null, decision: '' });
  assert.strictEqual(b.nowPhaseKey, 'recomp');
  assert.strictEqual(b.nextPhase.label, '第2期：リーンバルク仕上げ');
  assert.strictEqual(b.rules.length, 3);
  assert.strictEqual(b.waitingForUserChoice, false);
});
t('直近7日の体脂肪率平均：3日未満は判断しない', function () {
  var d = [{ date: '2027/03/01', fat: 15.4 }, { date: '2027/03/02', fat: 14.8 }, { date: '2027/02/20', fat: 12 }, { date: '2027/03/03', fat: null }];
  assert.strictEqual(R.fat7(d, '2027/03/03'), null);
  d.push({ date: '2027/03/03', fat: 15.0 });
  var f = R.fat7(d, '2027/03/03');
  assert.deepStrictEqual(f, { avg: 15.1, days: 3 }); // 7日より前の12%は入らない
});
t('15%に届いたら選ぶ状態になり、自動では切り替わらない', function () {
  var rd = { avg: 15.0, days: 5 }, no = { avg: 15.2, days: 5 };
  var a = R.resolve('2027/03/10', { fat7: rd, decision: '' });
  assert.strictEqual(a.ready, true); assert.strictEqual(a.needChoice, true); assert.strictEqual(a.phase.key, 'recomp');
  assert.strictEqual(R.resolve('2027/03/10', { fat7: no, decision: '' }).needChoice, false);
  assert.strictEqual(R.resolve('2027/06/01', { fat7: no, decision: '' }).phase.key, 'recomp'); // 日付だけでは第2期にならない
  assert.strictEqual(R.resolve('2027/06/01', { fat7: no, decision: '' }).overdue, true);
});
t('進む／据え置くの選択', function () {
  var rd = { avg: 14.9, days: 7 };
  var adv = R.resolve('2027/03/10', { fat7: rd, decision: 'advance' });
  assert.strictEqual(adv.phase.key, 'leanbulk'); assert.strictEqual(adv.needChoice, false);
  var hold = R.resolve('2027/03/10', { fat7: rd, decision: 'hold' });
  assert.strictEqual(hold.phase.key, 'recomp'); assert.strictEqual(hold.needChoice, false); assert.strictEqual(hold.decision, 'hold');
  assert.strictEqual(R.brief('2027/03/10', {}, null, { fat7: rd, decision: 'hold' }).userChoice, 'hold');
});
t('有酸素：第1期は時速の範囲、第2期は週の回数', function () {
  var logs = [
    { date: '2026/11/17', type: 'ウォーキング', km: 3.6, mins: 40 },   // 5.4 → 範囲内
    { date: '2026/11/18', type: 'ウォーキング', km: 4.0, mins: 40 },   // 6.0 → 速すぎ
    { date: '2026/11/19', type: 'ウォーキング', km: 3.0, mins: 40 },   // 4.5 → 遅め
    { date: '2026/11/12', type: 'ウォーキング', km: 4.0, mins: 40 },   // 7日より前
    { date: '2026/11/19', type: 'ウォーキング', km: 0, mins: 30 }      // 距離なし → 判定なし
  ];
  var c = R.cardioCheck(R.ROADMAP.phases[0], logs, '2026/11/19');
  assert.strictEqual(c.mode, 'speed'); assert.strictEqual(c.sessions.length, 4);
  assert.deepStrictEqual(c.sessions.map(function (x) { return x.state; }), ['in', 'fast', 'slow', null]);
  assert.strictEqual(c.outside, 2);
  var f = R.cardioCheck(R.ROADMAP.phases[1], logs, '2026/11/19');
  assert.strictEqual(f.mode, 'frequency'); assert.strictEqual(f.days, 3); assert.strictEqual(f.state, 'over');
  assert.strictEqual(R.cardioCheck(R.ROADMAP.phases[1], [], '2026/11/19').state, 'under');
});
t('今週のバランス：第1期（減量）', function () {
  var P0 = R.ROADMAP.phases[0];
  var b = R.balance(P0, { meal: { kcal: 1500, protein: 125, fat: 60, carbs: 150 }, sets: { chest: 13, legs: 4 }, cardio: { mode: 'speed', sessions: [{ state: 'fast' }] } });
  var st = {}; b.items.forEach(function (x) { st[x.key] = x.state; });
  assert.deepStrictEqual(st, { kcal: 'under', protein: 'in', fat: 'over', chest: 'over', legs: 'under', cardio: 'over' });
  assert.strictEqual(b.under, 2); assert.strictEqual(b.over, 3); assert.strictEqual(b['in'], 1);
  assert.ok(b.items[0].advice.indexOf('筋量') >= 0);               // 減量期の食事不足は筋量低下の助言
  assert.strictEqual(R.balance(P0, { sets: { chest: 12, legs: 9.6 } }).items.filter(function (x) { return x.key === 'chest' || x.key === 'legs'; }).every(function (x) { return x.state === 'in'; }), true); // 上限の+20%まではちょうど
  assert.strictEqual(R.balance(P0, { sets: { chest: 12.1, legs: 9.7 } }).over, 2);
  assert.strictEqual(R.balance(P0, {}).nodata, 5); // カロリー・たんぱく質・脂質・胸・脚（有酸素はデータなしなら項目に出さない）
});
t('今週のバランス：第2期（増量）は同じ「少ない」でも助言が変わる', function () {
  var P1 = R.ROADMAP.phases[1];
  var b = R.balance(P1, { meal: { kcal: 1700, carbs: 200 }, sets: null, cardio: { mode: 'frequency', min: 1, max: 2, days: 4, state: 'over' } });
  var st = {}; b.items.forEach(function (x) { st[x.key] = x.state; });
  assert.deepStrictEqual(st, { kcal: 'under', carbs: 'under', cardio: 'over' });
  assert.ok(b.items[0].advice.indexOf('増量') >= 0);
  assert.notStrictEqual(b.items[0].advice, R.balance(R.ROADMAP.phases[0], { meal: { kcal: 1500 } }).items[0].advice);
});

(function () {
  var R = require('../roadmap-lib.js'), assert = require('assert'), rd = { avg: 14.9, days: 5 };
  var m = R.resolve('2027/03/10', { fat7: rd, decision: 'maintain' });
  assert.strictEqual(m.phase.key, 'maintain'); assert.strictEqual(m.needChoice, false); assert.strictEqual(m.decision, 'maintain');
  assert.strictEqual(R.resolve('2027/03/10', { fat7: rd, decision: '' }).needChoice, true, '未選択なら選ぶ状態');
  assert.strictEqual(R.ROADMAP.phases.length, 2, '日付で決まる期は2つのまま');
  var b = R.brief('2027/03/10', {}, null, { fat7: rd, decision: 'maintain' });
  assert.strictEqual(b.userChoice, 'maintain'); assert.strictEqual(b.nowPhaseKey, 'maintain');
  assert.deepStrictEqual(R.mealGoals(m.phase).kcal, undefined, '維持期はカロリーを固定しない');
  assert.ok(R.mealGoals(m.phase).protein > 0);
  assert.ok(R.balance(m.phase, { meal: { protein: 125, fat: 45 } }).items.every(function (x) { return x.state === 'in'; }));
  console.log('ok  maintain decision');
})();

(function () {
  var R = require('../roadmap-lib.js'), assert = require('assert');
  var k = function (o) { return R.advice(o).map(function (x) { return x.key; }); };
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 14.9, days: 5 }, decision: '' }), ['choose']);
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 14.6, days: 5 }, decision: 'maintain', planPhase: 'maintain', floorFat: 13 }), ['maint-over'], '最低13＋1.5=14.5を超えたら');
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 14.5, days: 5 }, decision: 'maintain', planPhase: 'maintain', floorFat: 13 }), [], '許容帯の中');
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 12.5, days: 5 }, decision: 'maintain', planPhase: 'maintain', floorFat: 13 }), ['maint-below']);
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 18.1, days: 5 }, decision: 'advance' }), ['bulk-over']);
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 17.5, days: 5 }, decision: 'advance' }), []);
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: null, decision: 'maintain' }), [], '測定が足りないときは出さない');
  assert.strictEqual(R.MAINT_BAND_PCT, 1.5);
  console.log('ok  advice rules');
})();
(function () {
  var a = function (o) { o.date = '2026/11/19'; return R.autoMealGoals(o); };
  var cut = a({ weightKg: 60, bmr: 1400, adoptedKcal: 1720 }).goals;
  assert.deepStrictEqual(cut, { kcal: 1720, kcalMin: 1660, kcalMax: 1800, protein: 125, proteinMin: 120, proteinMax: 130, fat: 45, fatMin: 40, fatMax: 50 }, '第1期：マスタープランの数値＋採用カロリー');
  assert.strictEqual(a({ weightKg: 60, bmr: 1400, adoptedKcal: 1320 }).goals.kcal, 1660, '採用値が範囲の外なら範囲に収める');
  assert.strictEqual(a({ weightKg: 60, bmr: 1400 }).goals.kcal, 1730, '採用値が無ければ範囲の中央');
  var bulk = a({ decision: 'advance', weightKg: 60, bmr: 1520, adoptedKcal: 2000, fatPct: 15 }).goals;
  assert.deepStrictEqual([bulk.kcalMin, bulk.kcal, bulk.kcalMax, bulk.proteinMin, bulk.protein, bulk.proteinMax, bulk.fatMin, bulk.fat, bulk.fatMax], [1950, 2000, 2100, 96, 108, 132, 44, 65, 67], 'バルク：カロリー・炭水化物はマスタープラン、たんぱく質は体重基準、脂質は残りから逆算');
  assert.strictEqual(a({ decision: 'advance', weightKg: 60, bmr: 1520, adoptedKcal: 1950, fatPct: 15 }).goals.fat, 60, '1950kcalでは脂質の残りが少ない');
  var top = a({ decision: 'advance', weightKg: 60, bmr: 1520, adoptedKcal: 2100, fatPct: 15 }).goals;
  assert.strictEqual(top.fat, top.fatMax, '残りが上限(30%)を超えるときは上限に収める');
  var hi = a({ decision: 'advance', weightKg: 70, bmr: 1520, adoptedKcal: 2000, fatPct: 22 }).goals;
  assert.deepStrictEqual([hi.proteinMin, hi.protein, hi.proteinMax, hi.fat], [109, 120, 137, 60], '体脂肪率20%以上は除脂肪量基準（70kg×78%＝54.6kg）');
  assert.strictEqual(a({ decision: 'advance', weightKg: 70, bmr: 1520, adoptedKcal: 2000, fat7: { avg: 15, days: 5 }, fatPct: 22 }).goals.protein, 126, '7日平均の体脂肪率があればそれを使う');
  var mt = a({ decision: 'maintain', weightKg: 60, bmr: 1400, adoptedKcal: 1700 }).goals;
  assert.deepStrictEqual([mt.kcalMin, mt.kcal, mt.kcalMax, mt.protein, mt.fat], [1740, 1890, 2040, 125, 45], '維持：基礎代謝×1.35±150（古い採用値は使わない）');
  assert.strictEqual(a({ planPhase: 'maintain', weightKg: 60, bmr: 1520 }).goals.kcal, 2050, '減量計画が維持期でも維持');
  var none = a({ decision: 'maintain' }).goals;
  assert.strictEqual(none.kcal, undefined, '体組成が無い維持期はカロリーを出さない（今の値を残す）');
  assert.strictEqual(none.protein, 125);
  assert.strictEqual(a({ decision: 'hold', weightKg: 60, bmr: 1400 }).phaseKey, 'recomp', '据え置きは第1期');
  console.log('ok  autoMealGoals');
})();
console.log(n + ' 件OK');
