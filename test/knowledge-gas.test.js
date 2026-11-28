/* node test/knowledge-gas.test.js ：Apps Script 側（余力の列・睡眠・同じ重さの推移）を偽のシートで動かす */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
function t(name, fn) { fn(); console.log('ok  ' + name); }
var sheets = {}, props = {};
function fakeSheet() {
  var rows = [], maxCols = 19;
  var sh = {
    rows: rows,
    getLastRow: function () { return rows.length; }, getLastColumn: function () { return rows.reduce(function (m, r) { return Math.max(m, r.length); }, 0); },
    getMaxRows: function () { return 1000; }, getMaxColumns: function () { return maxCols; },
    insertColumnsAfter: function (c, n) { maxCols += n; },
    setFrozenRows: function () {}, setColumnWidth: function () {}, setColumnWidths: function () {}, appendRow: function (r) { rows.push(r.slice()); }, deleteRow: function (i) { rows.splice(i - 1, 1); },
    getRange: function (r, c, nr, nc) {
      nr = nr || 1; nc = nc || 1;
      if (c + nc - 1 > maxCols) maxColsError(c + nc - 1);
      var g = {
        setValues: function (v) { v.forEach(function (row, i) { var x = rows[r - 1 + i] = rows[r - 1 + i] || []; for (var k = 0; k < c - 1; k++) if (x[k] === undefined) x[k] = ''; row.forEach(function (y, j) { x[c - 1 + j] = y; }); }); return g; },
        setValue: function (v) { return g.setValues([[v]]); },
        getValues: function () { var o = []; for (var i = 0; i < nr; i++) { var a = []; for (var j = 0; j < nc; j++) { var x = (rows[r - 1 + i] || [])[c - 1 + j]; a.push(x === undefined ? '' : x); } o.push(a); } return o; },
        getValue: function () { return g.getValues()[0][0]; },
        setFontWeight: function () { return g; }, setBackground: function () { return g; }, setFontColor: function () { return g; }, setNumberFormat: function () { return g; }, setWrap: function () { return g; }, setVerticalAlignment: function () { return g; }
      };
      return g;
    }
  };
  function maxColsError(n) { throw new Error('列の範囲外：' + n + ' > ' + maxCols); }
  sh.setMax = function (n) { maxCols = n; };
  return sh;
}
var ss = { getSheetByName: function (n) { return sheets[n] || null; }, insertSheet: function (n) { var s = sheets[n] = fakeSheet(); s.setMax(26); return s; } };
var sandbox = {
  console: console,
  SpreadsheetApp: { getActiveSpreadsheet: function () { return ss; } },
  PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] === undefined ? null : props[k]; }, setProperty: function (k, v) { props[k] = String(v); }, deleteProperty: function (k) { delete props[k]; } }; } },
  LockService: { getScriptLock: function () { return { waitLock: function () {}, releaseLock: function () {} }; } },
  Utilities: { getUuid: function () { return 'u' + Math.random(); }, formatDate: function (d, tz, f) { var x = new Date(d.getTime() + 9 * 3600000).toISOString(); return f.replace('yyyy', x.slice(0, 4)).replace('MM', x.slice(5, 7)).replace('dd', x.slice(8, 10)).replace('HH', x.slice(11, 13)).replace('mm', x.slice(14, 16)).replace('ss', x.slice(17, 19)); } }
};
vm.createContext(sandbox);
var dir = path.join(__dirname, '..', 'gas');
vm.runInContext(fs.readdirSync(dir).filter(function (f) { return /\.gs$/.test(f); }).sort().map(function (f) { return fs.readFileSync(path.join(dir, f), 'utf8'); }).join('\n;\n'), sandbox);
var run = function (c) { return vm.runInContext(c, sandbox); };
var J = function (x) { return JSON.parse(JSON.stringify(x)); };
function mk(name, rows, cols) { var s = sheets[name] = fakeSheet(); s.setMax(cols || 26); rows.forEach(function (r) { s.rows.push(r); }); return s; }
var SH = run('SH'), HEAD = run('HEAD');
// 以前からの記録シート（19列。「余力」の列が無い）
var old = HEAD.LOG.slice(0, 19);
var today = run('today_()');
function day(n) { return run('addDays_(today_(), ' + n + ')'); }
function oldRow(id, d, load, reps) { return [id, d + ' 10:00:00', d, 'E001', 'ダンベルプレス', '大胸筋', '胸', 'ダンベル', 1, load, '', reps, '', reps, 0, load * reps * 2, '確定', '', '']; }
var log = mk(SH.LOG, [old, oldRow('a', day(-8), 20, 8), oldRow('b', day(-4), 20, 9)], 19);
mk(SH.EX, [HEAD.EX, ['E001', 'ダンベルプレス', '大胸筋', 'ダンベル', '回数', 'kg', 2, 1, '', 10, 2.5, 20, 2.5, 1, true, true]]);
mk(SH.PARTS, [HEAD.PARTS, ['大胸筋', '胸', 1]]);
mk(SH.SETTINGS, [HEAD.SETTINGS].concat(run('SETTING_DEFAULTS').map(function (r) { return r.slice(); })));
mk(SH.DAILY, [HEAD.DAILY]);

t('余力の列：無いシートに足してから記録し、0・空欄も区別して読める', function () {
  run('recordSet({clientId:"c1", exerciseId:"E001", load:20, reps:10, rir:"0"})');
  assert.strictEqual(log.getMaxColumns(), 20);
  assert.strictEqual(log.rows[0][19], '余力');
  run('recordSet({clientId:"c2", exerciseId:"E001", load:20, reps:9, rir:"へんな値"})');
  var logs = run('getLogs_(null, null)');
  assert.deepStrictEqual(J(logs.map(function (l) { return l.rir; })), ['', '', '0', '']);
});

t('分析：同じ重さの推移は期間より前の記録も含む。AIに渡す表記に余力が入る', function () {
  var a = run('getAnalytics("day", null)');
  assert.deepStrictEqual(J(a.byExercise[0].trend.points.map(function (p) { return p.v; })), [8, 9, 10]);
  assert.strictEqual(a.sets[0].rir, '0');
  assert.strictEqual(run('aiSetText_(getLogs_(today_(), today_())[0])'), '20kg×10(余力0)');
});

t('睡眠：体組成に保存して日ごとの値になる。睡眠だけの日があっても試算の体重は残る', function () {
  run('bodySave({id:"w", date:"' + day(-1) + '", time:"07:00", weight:63, fat:18, height:170})');
  run('bodySave({id:"s", date:"' + today + '", time:"07:00", sleep:6.5})');
  var g = run('bodyGet()');
  assert.strictEqual(g.logs[0].sleep, 6.5);
  var f = run('bodyFilled_(bodyGet().logs)');
  assert.deepStrictEqual(J([f.weight, f.fat, f.height, f.date]), [63, 18, 170, day(-1)]);
  assert.throws(function () { run('bodySave({id:"x", date:"' + today + '", sleep:20})'); }, /睡眠時間/);
});
