/* 食事の相談・AI分析（Meal.gs の mealAsk / mealReview）。Geminiは偽物に差し替えて、渡す文面と整形を確かめる。node test/meal-ai.test.js */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
var calls = [];
var sb = {
  console: console, Math: Math, Date: Date, JSON: JSON, Object: Object, Array: Array, Number: Number, String: String, isNaN: isNaN,
  today_: function () { return '2026/11/14'; },
  mNum_: function (v) { var n = Number(v); return isNaN(n) ? 0 : n; },
  mealGet: function () { return { logs: [
    { id: 'a', date: '2026/11/14', time: '08:00', type: '朝食', text: '卵とご飯', kcal: 500, protein: 25, fat: 15, carbs: 70, items: '卵2個 P12 F10\nご飯 P4 F1' },
    { id: 'b', date: '2026/11/14', time: '12:30', type: '昼食', text: '唐揚げ定食', kcal: 1000, protein: 40, fat: 55, carbs: 90, items: '唐揚げ F30' },
    { id: 'c', date: '2026/11/13', time: '12:00', type: '昼食', text: '別の日', kcal: 700, protein: 30, fat: 20, carbs: 80, items: '' } ],
    suggest: { protein: 120, cutKcal: 1900 } }; },
  aiMeal_: function () { return { averagePerLoggedDay: { kcal: 2000, protein: 100, fat: 60 }, fatEnergyPercent: 27 }; },
  gemini_: function (sys, user) { calls.push({ sys: sys, user: user }); return sb.reply; }
};
vm.createContext(sb);
var src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Meal.gs'), 'utf8');
var i = src.indexOf('function mealAskSystem_()'), j = src.indexOf('/** 動作確認用：エディタから実行して、シートが作られ');
vm.runInContext(src.slice(i, j), sb);

sb.reply = { summary: 'まとめ', sections: [{ title: '行く前', points: ['軽めに'] }, { title: '空', points: [] }], estimate: '1,200kcal前後' };
var r = sb.mealAsk({ question: '今日は同窓会で中華料理のお店に行きます。お酒は飲みません', ctx: { targets: { kcal: { ref: 1900, lo: 0, hi: 2100 }, fat: { ref: 40 } }, totals: { kcal: 1500, protein: 65, fat: 70 } } });
assert.strictEqual(r.sections.length, 1); assert.strictEqual(r.estimate, '1,200kcal前後');
assert.ok(/カロリー：今日の目標 1900kcal（上限2100）、ここまで 1500kcal/.test(calls[0].user)); assert.ok(/唐揚げ定食/.test(calls[0].user)); assert.ok(!/別の日/.test(calls[0].user));
assert.ok(/同窓会/.test(calls[0].user));
assert.throws(function () { sb.mealAsk({ question: 'あ' }); }, /入力/);

sb.reply = { summary: '脂質が多い', causes: ['唐揚げ'], actions: ['焼き鳥に'], nextMeal: '夜は魚' };
r = sb.mealReview({ date: '2026/11/14', ctx: { targets: { fat: { ref: 40, hi: 50 } }, partial: true } });
assert.deepStrictEqual(r.causes, ['唐揚げ']); assert.strictEqual(r.nextMeal, '夜は魚');
var u = calls[1].user; assert.ok(/まだ1日の途中/.test(u) && /唐揚げ F30/.test(u) && /1500kcal/.test(u) && !/別の日/.test(u));
assert.throws(function () { sb.mealReview({ date: '2026/11/01' }); }, /記録がありません/);
console.log('OK ai');
