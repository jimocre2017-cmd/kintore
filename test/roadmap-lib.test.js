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
console.log(n + ' 件OK');
