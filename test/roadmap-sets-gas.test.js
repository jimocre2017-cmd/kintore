/* Apps Script（Plan.gs の roadmapSets7_）が、YKトレーニングと同じ数え方で胸・脚の直近7日セット数を出すか。node test/roadmap-sets-gas.test.js */
var assert = require('assert'), vm = require('vm'), fs = require('fs'), path = require('path');
function load(f) { return fs.readFileSync(path.join(__dirname, '..', 'gas', f), 'utf8'); }
var logs = [];
function add(date, exId, n) { for (var i = 0; i < n; i++) logs.push({ date: date, exId: exId }); }
add('2026/11/11', 'E001', 5); // 7日より前（数えない）。11/12〜11/18が直近7日
add('2026/11/14', 'E001', 4); // 胸（メイン）4セット
add('2026/11/18', 'E001', 3); // 胸 3セット → 合計7
add('2026/11/16', 'E008', 5); // 脚 5セット
var sb = {
  getLogs_: function (from, to) { return logs.filter(function (l) { return l.date >= from && l.date <= to; }); },
  getSettings_: function () { return {}; },
  getExercises_: function () { return [{ id: 'E001', part: '大胸筋', secondary: [] }, { id: 'E008', part: '大腿四頭筋', secondary: [] }]; },
  getParts_: function () { return [{ part: '大胸筋', group: '胸' }, { part: '大腿四頭筋', group: '脚' }]; },
  addDays_: function (s, n) { var p = s.split('/'), d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000); return d.getUTCFullYear() + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + ('0' + d.getUTCDate()).slice(-2); },
  console: console
};
vm.createContext(sb);
vm.runInContext(load('YkLib.gs') + '\n' + load('Plan.gs') + '\nthis.__f = roadmapSets7_;', sb);
var r = sb.__f('2026/11/18');
assert.deepStrictEqual(JSON.parse(JSON.stringify(r)), { chest: 7, legs: 5 });
console.log('ok  直近7日の胸・脚のセット数（7日より前は数えない）');
