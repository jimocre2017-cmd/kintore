/* 食事の目標（目安・下限・上限）。Apps Script（Meal.gs の目標まわり）を偽の環境で動かす。node test/meal-goals.test.js */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
var ML = require('../meal-lib.js');
var props = {};
var sb = {
  console: console, Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array, Number: Number, String: String, isNaN: isNaN,
  PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] === undefined ? null : props[k]; }, setProperty: function (k, v) { props[k] = String(v); }, deleteProperty: function (k) { delete props[k]; } }; } },
  today_: function () { return '2026/11/14'; }
};
vm.createContext(sb);
var src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Meal.gs'), 'utf8');
var i = src.indexOf('function mealGoals_()'), j = src.indexOf('/** 体組成の最新値から');
vm.runInContext(src.slice(i, j), sb);
var k = src.indexOf('function mealSetGoals(g)'), l = src.indexOf('/* ====', k);
vm.runInContext(src.slice(k, l), sb);

var r = sb.mealSetGoals({ kcal: 1850, protein: 110, fat: 50, kcalMin: 1700, kcalMax: 2000, proteinMin: 100, proteinMax: 140 });
assert.strictEqual(r.kcalMin, 1700); assert.strictEqual(r.kcalMax, 2000); assert.strictEqual(r.fatMin, 0);
// 送られなかった項目は今のまま（古いアプリ版）
r = sb.mealSetGoals({ kcal: 1900, protein: 110, fat: 50 });
assert.strictEqual(r.kcalMin, 1700); assert.strictEqual(r.kcal, 1900);
// 0＝設定なしに戻せる
r = sb.mealSetGoals({ kcalMin: 0, kcalMax: '' });
assert.strictEqual(r.kcalMin, 0); assert.strictEqual(r.kcalMax, 0);
// 範囲の矛盾
assert.throws(function () { sb.mealSetGoals({ kcalMin: 2100, kcalMax: 2000 }); }, /下限が上限より/);
assert.throws(function () { sb.mealSetGoals({ kcal: 1900, kcalMin: 2000, kcalMax: 0 }); }, /下限が目安より/);
assert.throws(function () { sb.mealSetGoals({ kcal: 2100, kcalMax: 2000 }); }, /目安が上限より/);
assert.throws(function () { sb.mealSetGoals({ kcalMax: 7000 }); }, /0〜6000/);
// 失敗した保存では何も変わらない
assert.strictEqual(sb.mealGoals_().kcalMin, 0);
// 目標カロリーが変わったら、下限・上限も同じ幅だけずれる
sb.mealSetGoals({ kcal: 1900, kcalMin: 1700, kcalMax: 2100 });
var pr = sb.PropertiesService.getScriptProperties();
sb.mealShiftKcalRange_(pr, 1900, 1700); pr.setProperty('MEAL_GOAL_KCAL', '1700');
r = sb.mealGoals_(); assert.strictEqual(r.kcalMin, 1500); assert.strictEqual(r.kcalMax, 1900); assert.strictEqual(r.kcal, 1700);
// 画面側の判定
assert.strictEqual(ML.status(1400, 1500, 1900), 'under'); assert.strictEqual(ML.status(1600, 1500, 1900), 'in'); assert.strictEqual(ML.status(2000, 1500, 1900), 'over'); assert.strictEqual(ML.status(10, 0, 0), null);
console.log('OK');
