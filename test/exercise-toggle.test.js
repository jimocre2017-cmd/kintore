/* 種目の表示オン／オフ（setExercisesActive）。Code.gs を偽のシートで動かす。node test/exercise-toggle.test.js */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
var data = [
  ['E1', 'ダンベルカール', '上腕二頭筋', 'ダンベル', '回数', 'kg', 1, 1, '', 5, 2.5, 20, 2.5, 1, true],
  ['E2', 'チューブロー', '広背筋', 'チューブ', '回数', 'なし', 1, 1, '', 0, 0, 0, 1, 2, true],
  ['E3', '懸垂', '広背筋', '懸垂バー', '回数', 'なし', 1, 1, '', 0, 0, 0, 1, 3, 'TRUE'],
  ['E4', 'ベンチプレス', '大胸筋', 'ベンチ', '回数', 'kg', 1, 1, '', 5, 2.5, 20, 2.5, 4, false]
];
var colO = function () { return data.map(function (r) { return [r[14]]; }); };
var fakeSheet = {
  getRange: function (r, c, nr, nc) {
    return {
      getValues: function () { return colO(); },
      setValues: function (v) { v.forEach(function (x, i) { data[i][14] = x[0]; }); }
    };
  }
};
var ctx = vm.createContext({
  console: console, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number, isNaN: isNaN,
  SpreadsheetApp: { getActiveSpreadsheet: function () { return { getSheetByName: function () { return null; } }; } },
  Utilities: { formatDate: function () { return '2026/11/11'; } },
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8'), ctx);
ctx.rows_ = function () { return data; };
ctx.sheet_ = function () { return fakeSheet; };
ctx.invalidate_ = function () {};
var n = 0; function t(name, f) { f(); n++; console.log('ok  ' + name); }

t('一覧は、オフの種目も含めて全部返す', function () {
  var a = ctx.exerciseListAll().all;
  assert.strictEqual(a.length, 4);
  assert.strictEqual(a.filter(function (x) { return x.active; }).length, 3);
});
t('オフにすると、画面用の種目一覧から外れる（記録・集計用の全件には残る）', function () {
  var r = ctx.setExercisesActive(['E2', 'E3'], false);
  assert.strictEqual(r.changed, 2);
  assert.deepStrictEqual(r.exercises.map(function (e) { return e.id; }), ['E1']);
  assert.strictEqual(ctx.getExercises_(true).length, 4);
  assert.strictEqual(r.all.length, 4);
});
t('オンに戻せる。文字の TRUE も正しく扱う', function () {
  var r = ctx.setExercisesActive(['E2', 'E4'], true);
  assert.deepStrictEqual(r.exercises.map(function (e) { return e.id; }).sort(), ['E1', 'E2', 'E4']);
});
t('すべてオフ・対象なし・存在しないIDはエラー（変更しない）', function () {
  var before = JSON.stringify(colO());
  assert.throws(function () { ctx.setExercisesActive(['E1', 'E2', 'E3', 'E4'], false); }, /すべてオフ/);
  assert.throws(function () { ctx.setExercisesActive([], false); }, /対象/);
  assert.throws(function () { ctx.setExercisesActive(['ZZ'], false); }, /見つかりません/);
  assert.strictEqual(JSON.stringify(colO()), before);
});
console.log('\n' + n + ' 件すべて成功');
