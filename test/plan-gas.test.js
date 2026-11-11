/* Apps Script（Plan.gs）を、シート・プロパティ・Geminiを偽物に差し替えて動かす確認。node test/plan-gas.test.js */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
var B = require('../body-lib.js');
function load(f) { return fs.readFileSync(path.join(__dirname, '..', 'gas', f), 'utf8'); }

// ---- 偽の Apps Script 環境 ----
var props = { BODY_GOAL_FAT: '12', PLAN_START: '2026/11/09', PLAN_WEEKLY_LOSS: '0.5', MEAL_GOAL_KCAL: '1850', MEAL_GOAL_P: '0' };
var sheets = {};
function fakeSheet(name) {
  var rows = [];
  return {
    rows: rows, getLastRow: function () { return rows.length; }, getMaxRows: function () { return 1000; },
    getRange: function (r, c, nr, nc) {
      return {
        setValues: function (v) { v.forEach(function (row, i) { var tgt = rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach(function (x, j) { tgt[c - 1 + j] = x; }); }); return this; },
        getValues: function () { var out = []; for (var i = 0; i < nr; i++) out.push((rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return out; },
        setFontWeight: function () { return this; }, setBackground: function () { return this; }, setFontColor: function () { return this; }, setNumberFormat: function () { return this; }
      };
    },
    appendRow: function (row) { rows.push(row.slice()); }, setFrozenRows: function () {}, setColumnWidth: function () {}
  };
}
var calls = [];
var sandbox = {
  console: console, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number, isNaN: isNaN,
  TZ: 'Asia/Tokyo',
  PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] === undefined ? null : props[k]; }, setProperty: function (k, v) { props[k] = String(v); }, deleteProperty: function (k) { delete props[k]; } }; } },
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
  Utilities: { formatDate: function (d, tz, f) { var x = new Date(d.getTime() + 9 * 3600000), p = function (n) { return ('0' + n).slice(-2); }; var s = x.getUTCFullYear() + '/' + p(x.getUTCMonth() + 1) + '/' + p(x.getUTCDate()); return f.indexOf('HH') >= 0 ? s + ' ' + p(x.getUTCHours()) + ':' + p(x.getUTCMinutes()) : s; } },
  ss_: function () { return { getSheetByName: function (n) { return sheets[n] || null; }, insertSheet: function (n) { return (sheets[n] = fakeSheet(n)); } }; },
  today_: function () { return '2026/11/22'; },
  toDays_: function (s) { var p = s.split('/'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); },
  addDays_: function (s, n) { var d = new Date((sandbox.toDays_(s) + n) * 86400000); return d.getUTCFullYear() + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + ('0' + d.getUTCDate()).slice(-2); },
  aiModelUsed_: 'fake-model',
  gemini_: function (system, user, schema) {
    calls.push({ system: system, user: user });
    return { headline: '来週は1日' + JSON.parse(user.split('\n')[1]).adjust.target + 'kcalで進めます', summary: 'まとめ', whyTarget: '理由', actions: [{ title: 'a', detail: 'b' }], foodSwaps: ['x'], watch: [], nextCheck: 'n' };
  }
};
// 食事・体組成は、2週間分の合成データ
var entries = [], meals = [], i;
for (i = 0; i < 14; i++) {
  var ds = sandbox.addDays_('2026/11/09', i), fm = 17.1 - i * 0.07, w = 48.6 + fm;
  entries.push({ date: ds, time: '08:00', id: 'e' + i, weight: w, fat: fm / w * 100, muscle: 32, bmr: 1525, tags: ['起床後'] });
  [0, 1, 2].forEach(function (k) { meals.push({ date: ds, type: '朝食', text: '食事' + k, kcal: 600, protein: 40, fat: 20, carbs: 50 }); });
}
sandbox.bodyGet = function () { return { logs: B.daily(entries) }; };
sandbox.mealGet = function () { return { logs: meals, goals: { kcal: Number(props.MEAL_GOAL_KCAL) || 0 } }; };
vm.createContext(sandbox);
vm.runInContext(load('PlanLib.gs') + '\n' + load('Plan.gs'), sandbox);
var run = function (code) { return vm.runInContext(code, sandbox); };

var n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

t('planSet：入力を検証して保存する', function () {
  assert.throws(function () { run('planSet({goalFat: 3, startDate: "2026/11/09", weeklyLossKg: 0.5, activity: 1.55})'); }, /体脂肪率/);
  assert.throws(function () { run('planSet({goalFat: 12, startDate: "2026/11/09", weeklyLossKg: 2, activity: 1.55})'); }, /減量/);
  assert.throws(function () { run('planSet({goalFat: 12, startDate: "2026/11/09", deadline: "2026/11/01", weeklyLossKg: 0.5, activity: 1.55})'); }, /期限/);
  var r = run('planSet({goalFat: 12, startDate: "2026-11-9", weeklyLossKg: 0.5, activity: 1.55})');
  assert.strictEqual(r.plan.startDate, '2026/11/09');
  assert.strictEqual(r.defaultStart, '2026/11/23'); // 11/22(日)の次の月曜
});

t('planAdvise：数値はコードで確定し、Geminiの文章を付けて履歴に残す', function () {
  var r = run('planAdvise()');
  assert.strictEqual(r.effectiveFrom, '2026/11/23');
  assert.strictEqual(r.adjust.target, r.suggested);
  assert.ok(r.advice.headline.indexOf(String(r.suggested)) >= 0);
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].user.indexOf('meals7') >= 0);
  assert.strictEqual(sheets['減量調整履歴'].rows.length, 2); // 見出し + 1件
  assert.strictEqual(r.status, 'on_track' === r.status ? 'on_track' : r.status);
});

t('planApply：採用すると履歴と食事の目標に反映される（開始週が未来なら予約）', function () {
  var r = run('planApply({kcal: 1900, from: "2026/11/23", protein: 131})');
  assert.strictEqual(r.targets.length, 1);
  assert.strictEqual(r.targets[0].kcal, 1900);
  assert.strictEqual(props.MEAL_GOAL_KCAL, '1850'); // まだ今週
  assert.ok(props.MEAL_GOAL_KCAL_NEXT);
  assert.strictEqual(props.MEAL_GOAL_P, '131');
  assert.strictEqual(r.latest.adopted, true);
  assert.strictEqual(r.latest.adoptedKcal, 1900);
});

t('シートの日付セルが Date で返っても、日付文字列にそろえて読む', function () {
  var rows = sheets['減量調整履歴'].rows;
  rows[rows.length - 1][1] = new Date('2026-11-22T15:00:00Z'); // 11/23(JST)
  var r = run('planGet()');
  assert.strictEqual(r.targets[0].from, '2026/11/23');
  assert.strictEqual(r.latest.effectiveFrom, '2026/11/23');
  var r2 = run('planApply({kcal: 1880, from: "2026/11/23"})'); // 同じ週は新しい行を足さず上書き
  assert.strictEqual(r2.targets.length, 1);
  assert.strictEqual(r2.targets[0].kcal, 1880);
});

t('記録不足の時はGeminiを呼ばず、固定の案内を返す', function () {
  meals.length = 0; calls.length = 0;
  var r = run('planAdvise()');
  assert.strictEqual(r.status, 'insufficient');
  assert.strictEqual(calls.length, 0);
  assert.ok(r.advice.headline.indexOf('記録') >= 0);
});

t('目標未設定ならエラー', function () {
  props.PLAN_START = ''; props.BODY_GOAL_FAT = '';
  assert.throws(function () { run('planAdvise()'); }, /計画の設定/);
});

t('planSet：曲線・維持期・最低体脂肪率の検証と保存（既定は緩やかな曲線）', function () {
  assert.strictEqual(run('planSettings_()').shape, 'ease');
  assert.throws(function () { run('planSet({goalFat: 12, startDate: "2026/11/09", weeklyLossKg: 0.5, activity: 1.55, phase: "maintain"})'); }, /最低体脂肪率/);
  assert.throws(function () { run('planSet({goalFat: 12, startDate: "2026/11/09", weeklyLossKg: 0.5, activity: 1.55, floorFat: 15})'); }, /目標の体脂肪率以下/);
  var r = run('planSet({goalFat: 12, startDate: "2026/11/09", deadline: "2027/04/30", weeklyLossKg: 0.5, activity: 1.55, shape: "linear", floorFat: 10})');
  assert.strictEqual(r.plan.shape, 'linear'); assert.strictEqual(r.plan.floorFat, 10); assert.strictEqual(r.plan.phase, 'cut');
  r = run('planSet({goalFat: 12, startDate: "2026/11/09", deadline: "2027/04/30", weeklyLossKg: 0.5, activity: 1.55, shape: "ease", phase: "maintain", floorFat: 12})');
  assert.strictEqual(r.plan.phase, 'maintain');
  r = run('planSet({goalFat: 12, startDate: "2026/11/09", deadline: "2027/04/30", weeklyLossKg: 0.5, activity: 1.55, shape: "ease", floorFat: ""})');
  assert.strictEqual(r.plan.phase, 'cut'); assert.strictEqual(r.plan.floorFat, 0);
});

t('planPauseApply：サーバー側で検証し、休止期間を追加・取消できる', function () {
  var bad = function (c, re) { assert.throws(function () { sandbox.__c = c; run('planPauseApply(__c)'); }, re); };
  bad({ action: 'add_pause', from: '2026/11/01', to: '2026/11/05' }, /今日以降/);
  bad({ action: 'add_pause', from: '2026/12/28', to: '2026/12/20' }, /終了日/);
  bad({ action: 'add_pause', from: '2026/12/01', to: '2026/12/30' }, /21日/);
  bad({ action: 'add_pause', from: '2027/05/10', to: '2027/05/12' }, /期限/);
  bad({ action: 'drop', from: '2026/12/01', to: '2026/12/03' }, /種類/);
  sandbox.__c = { action: 'add_pause', from: '2026/12/28', to: '2027/01/05', reason: '年末年始' };
  var r = run('planPauseApply(__c)');
  assert.deepStrictEqual(JSON.parse(JSON.stringify(r.plan.pauses)), [{ from: '2026/12/28', to: '2027/01/05', reason: '年末年始' }]);
  bad({ action: 'add_pause', from: '2027/01/03', to: '2027/01/08' }, /重なって/);
  sandbox.__c = { action: 'remove_pause', from: '2026/12/28', to: '2027/01/05' };
  r = run('planPauseApply(__c)');
  assert.strictEqual(r.plan.pauses.length, 0);
});

console.log('\n' + n + ' 件すべて成功');
