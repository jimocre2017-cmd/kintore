/* 3指標トレンド（週平均・ウエスト移動平均・判定）。node test/body-trend.test.js */
var assert = require('assert'), B = require('../body-lib.js'), n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }
function day(date, w, f, waist) { return { date: date, weight: w, fat: f, waist: waist == null ? null : waist }; }
var today = '2026/11/23'; // 月曜
var logs = [
  day('2026/11/23', 64.4, 24.0, null),
  day('2026/11/17', 65.0, 25.0, 82.0), day('2026/11/16', 65.2, 25.2, null),
  day('2026/11/10', 65.6, 25.4, 82.6),
  day('2026/11/03', 66.0, 25.6, 83.2),
  day('2026/10/27', 66.4, 25.8, 83.8)
];
t('週は月曜始まりで、今週が末尾', function () {
  var tr = B.weeklyTrend(logs, today, 4, 4);
  assert.strictEqual(tr.length, 4);
  assert.strictEqual(tr[3].start, '2026/11/23');
  assert.strictEqual(tr[2].start, '2026/11/16');
});
t('週平均：同じ週の日を平均する', function () {
  var tr = B.weeklyTrend(logs, today, 4, 4);
  assert.strictEqual(tr[2].weight, 65.1); // 11/16(65.2)と11/17(65.0)
  assert.strictEqual(tr[2].waist, 82.0);
});
t('ウエストの移動平均：記録のある週が2週未満なら null', function () {
  var tr = B.weeklyTrend(logs, today, 5, 4);
  assert.strictEqual(tr[0].waistMA, null);
  assert.strictEqual(tr[1].waistMA, 83.5); // 10/27週83.8・11/03週83.2
  assert.strictEqual(tr[4].waistMA, 82.6); // 直近4週（11/02・11/09・11/16・今週）のうち記録のある3週：83.2・82.6・82.0
});
t('判定：体重とウエストが下がれば脂肪減', function () {
  var v = B.trendVerdict(B.weeklyTrend(logs, today, 5, 4), 3);
  assert.strictEqual(v.code, 'fatLoss');
});
t('判定：体重だけ下がりウエストが動かない', function () {
  var l2 = logs.map(function (x) { return x.waist == null ? x : Object.assign({}, x, { waist: 82.0 }); });
  assert.strictEqual(B.trendVerdict(B.weeklyTrend(l2, today, 5, 4), 3).code, 'waterOrLean');
});
t('判定：ウエスト未記録でも体重と体脂肪率で判定する', function () {
  var l3 = logs.map(function (x) { return Object.assign({}, x, { waist: null }); });
  var v = B.trendVerdict(B.weeklyTrend(l3, today, 5, 4), 3);
  assert.strictEqual(v.code, 'fatLossNoWaist');
  assert.ok(/ウエスト/.test(v.text));
});
t('判定：ウエスト未記録で体脂肪率が下がらない体重減は水分・筋肉の注意', function () {
  var l4 = logs.map(function (x) { return Object.assign({}, x, { waist: null, fat: 25.0 }); });
  assert.strictEqual(B.trendVerdict(B.weeklyTrend(l4, today, 5, 4), 3).code, 'waterOrLeanNoWaist');
});
t('判定：体重の記録が1週分しかなければ判定しない', function () {
  assert.strictEqual(B.trendVerdict(B.weeklyTrend([day('2026/11/23', 65, 25, null)], today, 5, 4), 3).code, 'noData');
});
t('日平均にウエストが含まれる', function () {
  var d = B.daily([{ date: '2026/11/20', id: 'a', waist: 82.0, tags: [] }, { date: '2026/11/20', id: 'b', waist: 82.6, tags: [] }]);
  assert.strictEqual(d[0].waist, 82.3);
});
console.log(n + ' passed');
