/* FFMI計算と分布比較（ffmi-lib.js）。node test/ffmi.test.js */
var assert = require('assert'), F = require('../ffmi-lib.js');
var n = 0; function t(name, f) { f(); n++; console.log('ok  ' + name); }

t('FFMI：体重64.4・体脂肪25.2%・身長164cm', function () {
  var v = F.ffmi(64.4, 25.2, 164);
  assert.ok(Math.abs(v - 17.9) < 0.1, String(v));
  assert.strictEqual(F.ffmi(0, 25, 164), null);
  assert.strictEqual(F.ffmi(64, 100, 164), null);
});
t('補正FFMI：身長180cmなら変わらない、164cmなら+0.98（Kouri係数6.1）', function () {
  assert.strictEqual(F.normalized(20, 180), 20);
  assert.ok(Math.abs(F.normalized(20, 164) - 20.976) < 0.01);
});
t('パーセンタイル：平均＝50%、+1SD≒84%、−2SD≒2.3%', function () {
  assert.strictEqual(F.percentile(18.8, 18.8, 2.1), 50);
  assert.ok(Math.abs(F.percentile(20.9, 18.8, 2.1) - 84.1) < 0.2);
  assert.ok(Math.abs(F.percentile(14.6, 18.8, 2.1) - 2.3) < 0.2);
});
t('基準：年代と性別で切り替わる（20代男は18.8、20代女は15.0、80歳超でも落ちない）', function () {
  assert.strictEqual(F.refs('M', 26)[0].mean, 18.8);
  assert.strictEqual(F.refs('F', 26)[0].mean, 15.0);
  assert.strictEqual(F.refs('M', 45)[0].mean, 19.1);
  assert.strictEqual(F.refs('M', 90)[0].mean, 17.3);
  assert.strictEqual(F.refs('M', 26).length, 3);
  assert.strictEqual(F.refs(undefined, undefined)[0].mean, 18.8, '未入力は20代男性として扱う');
});
t('言い方：上位◯％・水準', function () {
  assert.strictEqual(F.rankText(84), '上位 16%');
  assert.strictEqual(F.rankText(30), '下から 30%');
  assert.strictEqual(F.rankText(99.95), '上位 0.1%');
  assert.ok(F.levelText(50).indexOf('平均') >= 0);
});
t('スナップショット：筋量維持なら目標FFMI＝現在、+2kgで上がる。ナチュラル上限は男性だけ', function () {
  var o = { weight: 64.4, fat: 25.2, height: 164, sex: 'M', age: 30, goalFat: 15, gainKg: 0 };
  var s = F.snapshot(o);
  assert.strictEqual(s.now.ffmi, s.target.ffmi);
  assert.ok(Math.abs(s.goalWeight - 56.7) < 0.1, String(s.goalWeight));
  assert.ok(s.limitGap > 0 && s.toLimitKg > 0);
  var s2 = F.snapshot(Object.assign({}, o, { gainKg: 2 }));
  assert.ok(s2.target.ffmi > s.now.ffmi);
  assert.strictEqual(F.snapshot(Object.assign({}, o, { sex: 'F' })).limit, null);
  assert.strictEqual(F.snapshot({ weight: 0, fat: 20, height: 164 }), null);
});
console.log('\n' + n + ' passed');
