/* 写真：週ごとの選び方（スワイプ表示で使う）。node test/photo-swipe.test.js */
var assert = require('assert'), PL = require('../photo-lib.js');
assert.strictEqual(PL.weekStart('2026/11/16'), '2026/11/16'); // 月曜
assert.strictEqual(PL.weekStart('2026/11/22'), '2026/11/16'); // 日曜は同じ週
assert.strictEqual(PL.weekStart('2026/11/14'), '2026/11/09'); // 土曜
assert.strictEqual(PL.weekStart('2026/11/09'), '2026/11/09');
function P(id, date, time, angle) { return { id: id, date: date, time: time, angle: angle }; }
var ph = [P('a1', '2026/11/08', '09:28', '前'), P('a2', '2026/11/09', '01:38', '前'), P('a3', '2026/11/12', '22:14', '前'), P('a4', '2026/11/20', '08:00', '前'), P('y', '2026/11/12', '22:15', '横')];
var w = PL.weekly(ph, '前');
// 11/8（日）は前の週、11/9〜11/12 は同じ週（最も新しい11/12を採用）、11/20 は次の週
assert.deepStrictEqual(w.map(function (x) { return x.photo.id; }), ['a1', 'a3', 'a4']);
assert.deepStrictEqual(w.map(function (x) { return x.week; }), ['2026/11/02', '2026/11/09', '2026/11/16']);
assert.deepStrictEqual(PL.weekly(ph, '横').map(function (x) { return x.photo.id; }), ['y']);
assert.deepStrictEqual(PL.weekly(ph, '後ろ'), []);
console.log('OK');
