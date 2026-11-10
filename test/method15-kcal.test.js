/* 1.5法（種目タグ）の負荷反映と、推定消費カロリー。Code.gs を偽の環境で動かす。node test/method15-kcal.test.js */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
var ctx = vm.createContext({
  console: console, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number, isNaN: isNaN,
  SpreadsheetApp: { getActiveSpreadsheet: function () { return { getSheetByName: function () { return null; } }; } },
  Utilities: { formatDate: function () { return '2026/11/11'; } }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8'), ctx);
var rowsByName = {};
ctx.rows_ = function (n) { return rowsByName[n] || []; };

var n = 0;
function ok(name, f) { f(); n++; }

// 種目マスタ行：ID, 名前, 部位, 器具, 計測, 負荷タイプ, 負荷倍率, 回数倍率, 強度, 既定, 最小, 最大, 刻み, 順, 有効, 総負荷, 付随, リンク, 専用, タグ
function row(tags) { return ['E100', 'テスト', '大胸筋', 'ダンベル', '回数', 'kg', 2, 1, '', 5, 2.5, 20, 2.5, 1, true, '', '', '', '', tags]; }

ok('タグ無しは倍率1', function () {
  var e = ctx.exFromRow_(row('肩リハ'));
  assert.strictEqual(e.mult, 1);
  var c = ctx.calcSet_(e, 10, 10, 0);
  assert.strictEqual(c.aReps, 10); assert.strictEqual(c.vol, 200);
});
ok('1.5法タグはレップと総負荷量が1.5倍', function () {
  var e = ctx.exFromRow_(row('肩リハ,1.5法'));
  assert.strictEqual(e.mult, 1.5);
  var c = ctx.calcSet_(e, 10, 10, 0);
  assert.strictEqual(c.aReps, 15); assert.strictEqual(c.vol, 300);
});
ok('設定シートの倍率が効く', function () {
  rowsByName['設定'] = [['1.5法_倍率', 1.4, '']];
  var e = ctx.exFromRow_(row('1.5法'));
  assert.strictEqual(e.mult, 1.4);
  delete rowsByName['設定'];
});
ok('秒種目は倍率を掛けない', function () {
  var r = row('1.5法'); r[4] = '秒'; r[5] = 'なし'; r[7] = 2;
  var c = ctx.calcSet_(ctx.exFromRow_(r), 0, 0, 30);
  assert.strictEqual(c.aSecs, 60); assert.strictEqual(c.aReps, 0);
});
ok('消費kcal：10レップ(40秒)＋休憩90秒・65kg ≒ 8.6kcal', function () {
  var st = ctx.getSettings_();
  var k = ctx.kcalOfSet_(10, 0, st, 65);
  assert.ok(Math.abs(k - (6 * 40 + 2 * 90) / 3600 * 65) < 1e-9, String(k));
});
ok('1.5法は動作時間が1.5倍になりkcalも増える', function () {
  var st = ctx.getSettings_();
  assert.ok(ctx.kcalOfSet_(15, 0, st, 65) > ctx.kcalOfSet_(10, 0, st, 65));
});
ok('日の集計に推定kcalが入る（体組成が無ければ既定体重65kg）', function () {
  var logs = [{ part: '大胸筋', group: '胸', aReps: 15, aSecs: 0, vol: 300, secondary: [] }, { part: '大胸筋', group: '胸', aReps: 0, aSecs: 30, vol: 0, secondary: [] }];
  var s = ctx.summarizeDay_(logs);
  var st = ctx.getSettings_(), want = Math.round(ctx.kcalOfSet_(15, 0, st, 65) + ctx.kcalOfSet_(0, 30, st, 65));
  assert.strictEqual(s.total.kcal, want);
  assert.strictEqual(s.total.sets, 2);
});
console.log('\n' + n + ' 件すべて成功');
