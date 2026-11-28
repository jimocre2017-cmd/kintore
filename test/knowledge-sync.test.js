/* node test/knowledge-sync.test.js ：知見との照合で足した機能（目標の一本化・睡眠・同じ重さの推移・ウエスト÷身長） */
var assert = require('assert');
var R = require('../roadmap-lib.js'), Y = require('../yk-lib.js'), M = require('../meal-lib.js'), B = require('../body-lib.js');
function t(name, fn) { fn(); console.log('ok  ' + name); }
function area(cfg, key) { return cfg.areas.filter(function (a) { return a.key === key; })[0]; }
var DEF = { 'YK_目標_胸': 9, 'YK_目標_脚': 7, 'YK_フェーズ': 0 };

t('期の週セット数：範囲がある期だけ返し、バルク・維持は null', function () {
  assert.deepStrictEqual(R.phaseSets('', 'cut'), R.ROADMAP.phases[0].sets);
  assert.deepStrictEqual(R.phaseSets('shred', 'cut'), R.ROADMAP.shredPhase.sets);
  assert.deepStrictEqual(R.phaseSets('shred8', 'maintain'), R.ROADMAP.shred8Phase.sets);
  assert.strictEqual(R.phaseSets('advance', 'cut'), null);
  assert.strictEqual(R.phaseSets('maintain', 'maintain'), null);
});

t('YKの目標：第1期は従来どおり9・7、絞り込みは期の範囲の中央（胸11・脚9）', function () {
  var c = Y.configFrom(DEF, R.phaseSets('', 'cut'));
  assert.deepStrictEqual([area(c, 'chest').target, area(c, 'legs').target], [9, 7]);
  var s = Y.configFrom(DEF, R.phaseSets('shred', 'cut'));
  assert.deepStrictEqual([area(s, 'chest').target, area(s, 'chest').max, area(s, 'legs').target, area(s, 'legs').max], [11, 12, 9, 10]);
});

t('YKの目標：手で変えた部位と、増量期ボタンは設定シートの値を使う', function () {
  var sh = R.phaseSets('shred', 'cut');
  var c = Y.configFrom({ 'YK_目標_胸': 14, 'YK_目標_脚': 7 }, sh);
  assert.deepStrictEqual([area(c, 'chest').target, area(c, 'legs').target], [14, 9]);
  var b = Y.configFrom({ 'YK_目標_胸': 9, 'YK_目標_脚': 7, 'YK_フェーズ': 1 }, sh);
  assert.deepStrictEqual([area(b, 'chest').target, area(b, 'legs').target], [9, 7]);
});

t('炭水化物：範囲がある期は食事の目標も同じ範囲、無い期は残りカロリーから', function () {
  var o = { date: '2026/11/28', planPhase: 'cut', weightKg: 63, fatPct: 18, bmr: 1530, tdeeKcal: 2200 };
  ['shred', 'shred8', 'advance'].forEach(function (d) {
    var g = R.autoMealGoals(Object.assign({ decision: d }, o)).goals;
    var ph = R.effective(d === 'advance' ? R.ROADMAP.phases[1] : d === 'shred' ? R.ROADMAP.shredPhase : R.ROADMAP.shred8Phase, R.energy(o), o);
    var w = M.withCarbs(g);
    assert.deepStrictEqual([w.carbsMin, w.carbsMax], [ph.carbs.min, ph.carbs.max], d);
    assert.ok(w.carbs >= w.carbsMin && w.carbs <= w.carbsMax, d);
  });
  var first = R.autoMealGoals(Object.assign({ decision: '' }, o)).goals;
  assert.strictEqual(first.carbs, undefined);
  assert.strictEqual(M.withCarbs(first).carbs, M.carbGoals(first).carbs);
});

t('睡眠：直近7日の平均。8%で7時間未満が3日分以上なら注意を出す', function () {
  var logs = [{ date: '2026/11/20', sleep: 3 }, { date: '2026/11/26', sleep: 6 }, { date: '2026/11/27', sleep: 6.5 }, { date: '2026/11/28', sleep: 6 }, { date: '2026/11/28', sleep: null }];
  var s = R.sleep7(logs, '2026/11/28');
  assert.deepStrictEqual(s, { avg: 6.2, days: 3 });
  function keys(sl) { return R.advice({ date: '2026/11/28', decision: 'shred8', fat7: { avg: 10, days: 5 }, sleep7: sl }).map(function (a) { return a.key; }); }
  assert.ok(keys(s).indexOf('shred8-sleep') >= 0);
  assert.ok(keys({ avg: 7.2, days: 5 }).indexOf('shred8-sleep') < 0);
  assert.ok(keys({ avg: 5, days: 2 }).indexOf('shred8-sleep') < 0);
  assert.strictEqual(R.sleep7([], '2026/11/28'), null);
});

t('同じ重さの推移：直近に使った重さの、日ごとの最高回数', function () {
  var logs = [{ date: '2026/11/01', load: 20, reps: 8 }, { date: '2026/11/05', load: 17.5, reps: 12 }, { date: '2026/11/08', load: 20, reps: 9 }, { date: '2026/11/08', load: 20, reps: 7 }, { date: '2026/11/12', load: 15, reps: 15 }, { date: '2026/11/12', load: 20, reps: 10 }];
  assert.deepStrictEqual(Y.repTrend(logs, '回数', 5), { load: 20, unit: '回', points: [{ date: '2026/11/01', v: 8 }, { date: '2026/11/08', v: 9 }, { date: '2026/11/12', v: 10 }] });
  assert.strictEqual(Y.repTrend([], '回数', 5), null);
});

t('ウエスト÷身長の区分', function () {
  assert.deepStrictEqual([B.waistHeight(80, 170).ratio, B.waistHeight(80, 170).level], [0.47, 'ok']);
  assert.strictEqual(B.waistHeight(85, 170).level, 'raised');
  assert.strictEqual(B.waistHeight(102, 170).level, 'high');
  assert.ok(B.waistHeight(80, 170).targetCm < 85);
  assert.strictEqual(B.waistHeight(80, null), null);
  assert.strictEqual(B.daily([{ date: '2026/11/28', id: 'a', sleep: 6.5, tags: [] }])[0].sleep, 6.5);
});
