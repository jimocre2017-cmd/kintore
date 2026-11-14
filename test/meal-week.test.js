/* 週の平均から割り戻す「今日の目標」。node test/meal-week.test.js */
var assert = require('assert'), ML = require('../meal-lib.js');
function L(date, kcal, protein, fat) { return { date: date, kcal: kcal, protein: protein, fat: fat, carbs: 0 }; }
// 2026/11/09 は月曜
assert.strictEqual(ML.fromDays(ML.weekStart('2026/11/14')), '2026/11/09');
assert.strictEqual(ML.fromDays(ML.weekStart('2026/11/09')), '2026/11/09');
assert.strictEqual(ML.fromDays(ML.weekStart('2026/11/15')), '2026/11/09');
// 月曜はまだ実績が無いので、目安どおり
var p = ML.weekPlan([], '2026/11/09', 50, 0, 0, 'fat', 1);
assert.strictEqual(p.target, 50); assert.strictEqual(p.diff, 0);
// 脂質が多かった週：月〜金に60gずつ → 土曜は (350-300)/2 = 25g、日曜も含めて残り2日
var logs = ['09', '10', '11', '12', '13'].map(function (d) { return L('2026/11/' + d, 2000, 100, 60); });
p = ML.weekPlan(logs, '2026/11/14', 50, 0, 0, 'fat', 1);
assert.strictEqual(p.target, 25); assert.strictEqual(p.avg, 60); assert.strictEqual(p.left, 2); assert.strictEqual(p.diff, -25);
// 下限で止まる（脂質の下限40g）
p = ML.weekPlan(logs, '2026/11/14', 50, 40, 0, 'fat', 1);
assert.strictEqual(p.target, 40); assert.strictEqual(p.clamp, 'lo'); assert.strictEqual(p.raw, 25);
// 少なかった週は多めに許される。上限で止まる
var low = ['09', '10', '11'].map(function (d) { return L('2026/11/' + d, 1500, 100, 30); });
p = ML.weekPlan(low, '2026/11/12', 50, 0, 60, 'fat', 1); // 残4日：(350-90)/4=65 → 上限60
assert.strictEqual(p.target, 60); assert.strictEqual(p.clamp, 'hi');
// 記録の無い日は目安どおり食べた扱い（ずれを作らない）
p = ML.weekPlan([L('2026/11/09', 2000, 100, 60)], '2026/11/12', 50, 0, 0, 'fat', 1); // 月60、火水は目安50 → (350-160)/4=47.5→48
assert.strictEqual(p.target, 48); assert.strictEqual(p.days, 1);
// カロリーは10刻み、目安が未設定なら null
p = ML.weekPlan([L('2026/11/09', 2300, 0, 0)], '2026/11/10', 2000, 0, 0, 'kcal', 10); // (14000-2300)/6=1950
assert.strictEqual(p.target, 1950);
assert.strictEqual(ML.weekPlan(logs, '2026/11/14', 0, 0, 0, 'fat', 1), null);
// 前の週の記録は混ざらない
p = ML.weekPlan([L('2026/11/08', 3000, 0, 99)], '2026/11/09', 50, 0, 0, 'fat', 1);
assert.strictEqual(p.target, 50);
console.log('OK');
