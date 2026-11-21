
/* 炭水化物の目標（残りカロリーから逆算）と白ご飯換算 */
(function () {
  var ML = require('../meal-lib.js'), assert = require('assert');
  var c = ML.carbGoals({ kcal: 1700, protein: 125, fat: 45, kcalMin: 1660, kcalMax: 1800 });
  assert.strictEqual(c.carbs, Math.round((1700 - 500 - 405) / 4));
  assert.ok(c.carbsMin < c.carbs && c.carbsMax > c.carbs);
  assert.strictEqual(ML.carbGoals({ kcal: 1700, protein: 0, fat: 45 }), null);
  assert.strictEqual(ML.carbGoals({ kcal: 500, protein: 125, fat: 45 }), null);
  assert.strictEqual(ML.riceG(35.6), 100);
  assert.strictEqual(ML.riceG(0), 0);
  assert.strictEqual(ML.pastaG(75), 100);
  assert.strictEqual(ML.focacciaPieces(31), 1);
  assert.strictEqual(ML.focacciaPieces(46), 1.5);
  assert.strictEqual(ML.pastaG(0), 0);
  console.log('ok  carbGoals / riceG');
})();

/* 記録した日の数え方（全画面共通）と、記録忘れのアラート */
(function () {
  var ML = require('../meal-lib.js'), assert = require('assert');
  var L = [
    { id: 'a', date: '2026/11/15', kcal: 1800, protein: 120, fat: 50, carbs: 200 },
    { id: 'b', date: '2026/11/16', kcal: 1100, protein: 80, fat: 30, carbs: 120 },          // 2食・少なめでも記録した日
    { id: 'b2', date: '2026/11/16', kcal: 0, protein: 0, fat: 0, carbs: 0 },
    { id: 'c', date: '2026/11/17', kcal: 600, protein: 40, fat: 20, carbs: 60 },             // 少なすぎ → アラート
    ML.markEntry('m1', '2026/11/19'),                                                         // 食べていない日（確定）
    { id: 'd', date: '2026/11/21', kcal: 1700, protein: 110, fat: 45, carbs: 190 },
    { id: 'e', date: '2026/11/22', kcal: 500, protein: 30, fat: 10, carbs: 60 }              // 今日（途中）
  ];
  var t19 = ML.dayTotal(L, '2026/11/19');
  assert.deepStrictEqual([t19.meals, t19.kcal, t19.confirmed, t19.logged], [0, 0, true, true], '「これで全部」の日は食事0件・0kcalで記録した日');
  var av = ML.average(ML.lastDays(L, '2026/11/22', 7), '2026/11/22');
  assert.strictEqual(av.days, 4, '直近7日（16〜22日）から今日を除き、記録した日＝16・17・19（0kcal）・21日');
  assert.strictEqual(av.kcal, Math.round((1100 + 600 + 0 + 1700) / 4));
  var s = ML.suspects(L, '2026/11/22', 1660, 7);
  assert.deepStrictEqual(s.map(function (x) { return x.date + ':' + x.reason; }), ['2026/11/20:none', '2026/11/18:none', '2026/11/17:low'], '2食・1100kcalの日（下限1660の65%以上）は出さない');
  assert.ok(!s.some(function (x) { return x.date === '2026/11/19'; }), '確定した日は出さない');
  assert.ok(!s.some(function (x) { return x.date === '2026/11/22'; }), '今日は出さない');
  assert.deepStrictEqual(ML.suspects([{ date: '2026/11/21', kcal: 1800 }], '2026/11/22', 0, 7), [], '最初に記録した日より前は出さない');
  console.log('ok  記録した日の数え方・記録忘れのアラート');
})();
