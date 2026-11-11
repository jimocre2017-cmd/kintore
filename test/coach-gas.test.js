/* Apps Script（Coach.gs）を、シート・プロパティ・Geminiを偽物に差し替えて動かす確認。node test/coach-gas.test.js */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
var B = require('../body-lib.js');
function load(f) { return fs.readFileSync(path.join(__dirname, '..', 'gas', f), 'utf8'); }

// ---- 偽の Apps Script 環境 ----
var props = { BODY_GOAL_FAT: '12', PLAN_START: '2026/11/09', PLAN_WEEKLY_LOSS: '0.5', PLAN_DEADLINE: '2027/01/31', MEAL_GOAL_KCAL: '1850', MEAL_GOAL_P: '0' };
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
  r1_: function (n) { return Math.round(n * 10) / 10; },
  aiBody_: function () { return { latest: { weight: 65.7 }, plan: null }; },
  aiMeal_: function () { return { daysLogged: sandbox._mealDays, averagePerLoggedDay: { kcal: 1800, protein: 120, fat: 50, carbs: 200 } }; },
  _mealDays: 7,
  getSettings_: function () { return {}; }, kcalWeight_: function () { return 65; },
  kcalOfSet_: function (reps) { return reps * 0.5; },
  getLogs_: function () { return [{ date: '2026/11/21', aReps: 20, aSecs: 0 }, { date: '2026/11/21', aReps: 20, aSecs: 0 }, { date: '2026/11/10', aReps: 10, aSecs: 0 }]; },
  cardioLogsWithKcal_: function () { return [{ date: '2026/11/22', km: 5, kcal: 300 }, { date: '2026/11/21', km: 3, kcal: 150 }]; },
  gemini_: function (system, user, schema) {
    calls.push({ system: system, user: user });
    return { verdict: 'behind', headline: '見出し', goalCheck: 'g', meal: 'm', exercise: 'e', body: 'b', todayActions: [{ title: 'a', detail: 'd' }, { title: 'a2', detail: 'd2' }, { title: 'a3', detail: 'd3' }], blunt: 'ズバリ', dataGaps: [] };
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
var geminiStub = sandbox.gemini_;
vm.createContext(sandbox);
vm.runInContext(load('PlanLib.gs') + '\n' + load('Plan.gs') + '\n' + load('Coach.gs') + '\n' + load('AiTrainer.gs'), sandbox);
sandbox.gemini_ = geminiStub; sandbox.aiModelUsed_ = 'fake-model'; // AiTrainer.gs の本物を読み込んだので、偽物に戻す
var run = function (code) { return vm.runInContext(code, sandbox); };

var n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

t('確定データ：期限までの必要ペースと安全上限をコードで出す', function () {
  var d = run('coachData_()');
  var dc = d.deadlineCheck;
  assert.strictEqual(dc.deadline, '2027/01/31'); assert.strictEqual(dc.userSetDeadline, true);
  assert.strictEqual(dc.daysLeft, 70); // 11/22 → 1/31
  assert.ok(dc.remainingFatKg > 0 && dc.requiredFatKgPerWeek > 0 && dc.safeMaxKgPerWeek > 0);
  assert.strictEqual(typeof dc.feasibleWithinSafeRate, 'boolean');
  assert.strictEqual(d.training.last7Days.strengthDays, 1);
  assert.strictEqual(d.training.last7Days.cardioKcal, 450);
  assert.strictEqual(d.training.last7Days.strengthKcal, 20);
  assert.strictEqual(d.training.last28Days.strengthDays, 2);
  assert.strictEqual(d.training.today.cardioKm, 5);
  assert.strictEqual(d.dataGaps.length, 0);
});

t('coachJudge：Geminiに確定データを渡し、判定と根拠の数字を返し、履歴に残す', function () {
  var r = run('coachJudge()');
  assert.strictEqual(calls.length, 1);
  assert.ok(calls[0].user.indexOf('deadlineCheck') >= 0 && calls[0].user.indexOf('"training"') >= 0 && calls[0].user.indexOf('"meal"') >= 0);
  assert.ok(calls[0].system.indexOf('間に合うか') >= 0);
  assert.strictEqual(r.verdict, 'behind');
  assert.strictEqual(r.todayActions.length, 3);
  assert.strictEqual(r.facts.daysLeft, 70);
  assert.strictEqual(r.facts.burn7.cardio, 450);
  assert.strictEqual(r.facts.avgIntakeKcal, 1800);
  assert.strictEqual(sheets['総合コーチ履歴'].rows.length, 2);
});

t('2回目は前回の「今日やること」を渡す', function () {
  run('coachJudge()');
  var d = JSON.parse(calls[1].user.split('\n')[1]);
  assert.strictEqual(d.previous.headline, '見出し');
  assert.strictEqual(d.previous.todayActions.length, 3);
});

t('AIトレーナーに、筋トレ＋有酸素の消費kcal（合計と内訳）を渡す', function () {
  var e = run('aiEnergy_("2026/11/22")');
  assert.strictEqual(e.last7Days.cardioKcal, 450);
  assert.strictEqual(e.last7Days.strengthKcal, 20);
  assert.strictEqual(e.last7Days.totalKcal, 470);
  assert.strictEqual(e.today.totalKcal, 300);
  assert.ok(run('aiSystemPrompt_()').indexOf('energy') >= 0);
  assert.strictEqual(run('typeof aiContext_'), 'function');
});

t('判定が想定外の値なら unknown にする', function () {
  sandbox.gemini_ = function () { return { verdict: 'great', headline: 'h', goalCheck: '', meal: '', exercise: '', body: '', todayActions: [], blunt: '', dataGaps: [] }; };
  assert.strictEqual(run('coachJudge()').verdict, 'unknown');
});

t('期限未設定・食事が少ない時は、記録不足を dataGaps に出す', function () {
  props.PLAN_DEADLINE = ''; sandbox._mealDays = 2;
  var d = run('coachData_()');
  assert.strictEqual(d.deadlineCheck.userSetDeadline, false); // 計算上の到達予定日で、本人の期限ではない
  assert.ok(d.dataGaps.some(function (g) { return g.indexOf('期限') >= 0; }));
  assert.ok(d.dataGaps.some(function (g) { return g.indexOf('2日') >= 0; }));
});

t('何も記録が無ければエラー', function () {
  sandbox.aiBody_ = function () { return null; }; sandbox.aiMeal_ = function () { return null; };
  sandbox.getLogs_ = function () { return []; }; sandbox.cardioLogsWithKcal_ = function () { return []; };
  assert.throws(function () { run('coachJudge()'); }, /記録がまだ/);
});

console.log('\n' + n + ' 件すべて成功');
