/* 体組成の「集計から除外」の確認。node test/body-exclude.test.js */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
var B = require('../body-lib.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

var entries = [
  { date: '2026/11/13', time: '07:00', id: 'a', weight: 66.0, fat: 25.0, tags: ['起床後'] },
  { date: '2026/11/13', time: '14:30', id: 'b', weight: 66.9, fat: 24.0, tags: ['食事後'], exclude: true },
  { date: '2026/11/12', time: '07:00', id: 'c', weight: 65.8, fat: 25.2, tags: ['起床後'] },
  { date: '2026/11/11', time: '07:00', id: 'd', weight: 70.0, fat: 30.0, tags: ['起床後'], exclude: true }
];

t('日平均：除外した測定は平均に入れない', function () {
  var d = B.daily(entries), today = d.filter(function (x) { return x.date === '2026/11/13'; })[0];
  assert.strictEqual(today.count, 1);
  assert.strictEqual(today.weight, 66.0);
});
t('日平均：全部除外した日は一覧に出ない', function () {
  assert.ok(!B.daily(entries).some(function (x) { return x.date === '2026/11/11'; }));
});
t('条件で絞っても除外は入らない', function () {
  var d = B.daily(entries, '食事後');
  assert.strictEqual(d.length, 0);
});
t('除外フラグなしの従来データは今まで通り平均される', function () {
  var d = B.daily([{ date: '2026/11/13', id: 'x', weight: 66, tags: [] }, { date: '2026/11/13', id: 'y', weight: 67, tags: [] }]);
  assert.strictEqual(d[0].weight, 66.5);
});
t('朝→夜の変化：除外した測定は使わない', function () {
  assert.strictEqual(B.intraday(entries, '2026/11/13', 'weight'), null);
});

/* ---- Body.gs（偽のシートで） ---- */
function load(f) { return fs.readFileSync(path.join(__dirname, '..', 'gas', f), 'utf8'); }
var sheets = {};
function fakeSheet() {
  var rows = [];
  return {
    rows: rows, getLastRow: function () { return rows.length; }, getMaxRows: function () { return 1000; }, getLastColumn: function () { return 14; },
    getRange: function (r, c, nr, nc) {
      return {
        setValues: function (v) { v.forEach(function (row, i) { var tgt = rows[r - 1 + i] = rows[r - 1 + i] || []; row.forEach(function (x, j) { tgt[c - 1 + j] = x; }); }); return this; },
        getValues: function () { var out = []; for (var i = 0; i < nr; i++) { var src = rows[r - 1 + i] || [], row = []; for (var j = 0; j < nc; j++) row.push(src[c - 1 + j] === undefined ? '' : src[c - 1 + j]); out.push(row); } return out; },
        getValue: function () { return (rows[r - 1] || [])[c - 1]; },
        setFontWeight: function () { return this; }, setBackground: function () { return this; }, setFontColor: function () { return this; }, setNumberFormat: function () { return this; }
      };
    },
    setFrozenRows: function () {}
  };
}
var sb = {
  console: console, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number, isNaN: isNaN, TZ: 'Asia/Tokyo',
  PropertiesService: { getScriptProperties: function () { return { getProperty: function () { return null; } }; } },
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
  Utilities: { formatDate: function () { return '2026/11/13 14:00:00'; } },
  ss_: function () { return { getSheetByName: function (nm) { return sheets[nm] || null; }, insertSheet: function (nm) { return (sheets[nm] = fakeSheet()); } }; },
  sheet_: function (nm) { return sheets[nm]; },
  rows_: function (nm) { return sheets[nm].rows.slice(1); },
  invalidate_: function () {},
  today_: function () { return '2026/11/13'; },
  toDays_: function (s) { var p = s.split('/'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); },
  addDays_: function (s, k) { var d = new Date((sb.toDays_(s) + k) * 86400000), p = function (x) { return ('0' + x).slice(-2); }; return d.getUTCFullYear() + '/' + p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()); },
  ymd_: function (v) { var m = String(v).match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/); return m ? m[1] + '/' + ('0' + m[2]).slice(-2) + '/' + ('0' + m[3]).slice(-2) : ''; },
  dow_: function (s) { return (sb.toDays_(s) + 4) % 7; },
  r1_: function (x) { return Math.round(x * 10) / 10; }
};
vm.createContext(sb);
vm.runInContext(load('Body.gs'), sb);
var run = function (c) { return vm.runInContext(c, sb); };

t('Body.gs：除外つきで保存→読み出し、平均から外れる', function () {
  run("bodySave({id:'m', date:'2026/11/13', time:'07:00', weight:66.0, fat:25, tags:['起床後']})");
  run("bodySave({id:'n', date:'2026/11/13', time:'14:30', weight:67.0, fat:24, tags:['食事後'], exclude:true})");
  var g = run('bodyGet()');
  var en = g.entries.filter(function (e) { return e.id === 'n'; })[0];
  assert.strictEqual(en.exclude, true);
  assert.strictEqual(g.entries.filter(function (e) { return e.id === 'm'; })[0].exclude, false);
  assert.strictEqual(g.logs[0].count, 1);
  assert.strictEqual(g.logs[0].weight, 66);
});
t('Body.gs：除外を外して保存し直すと平均に戻る', function () {
  run("bodySave({id:'n', date:'2026/11/13', time:'14:30', weight:67.0, fat:24, tags:['食事後'], exclude:false})");
  var g = run('bodyGet()');
  assert.strictEqual(g.logs[0].count, 2);
  assert.strictEqual(g.logs[0].weight, 66.5);
});
t('Body.gs：除外した測定は条件別平均とAIの当日一覧にも入らない', function () {
  run("bodySave({id:'n', date:'2026/11/13', time:'14:30', weight:67.0, fat:24, tags:['食事後'], exclude:true})");
  var ai = run("aiBody_('2026/11/13')");
  assert.strictEqual(ai.latestDayMeasurements.length, 1);
  assert.ok(!ai.conditionSummary.some(function (c) { return c.condition === '食事後'; }));
});
t('Body.gs：旧13列の行（除外列なし）は除外されない', function () {
  var o = run("bodyObj_(['2026/11/10', 66, 25, 33, 24, 1500, 8, 164, '', 'x', 'old', '07:00', '起床後'])");
  assert.strictEqual(o.exclude, false);
});
console.log(n + ' 件OK');
