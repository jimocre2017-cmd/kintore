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

// ---- コメント（多い・少ない → 対処） ----
function tgt(k, ref, lo, hi) { var o = {}; o[k] = { ref: ref, lo: lo || 0, hi: hi || 0 }; return o; }
var tg = { kcal: { ref: 1900, lo: 1700, hi: 2100 }, protein: { ref: 110, lo: 100, hi: 0 }, fat: { ref: 50, lo: 0, hi: 55 } };
// 脂質が多く、カロリーとたんぱく質が少ない
var a = ML.advise({ kcal: 1500, protein: 70, fat: 70 }, tg, false);
assert.deepStrictEqual(a.state, { kcal: 'under', protein: 'under', fat: 'over' });
assert.ok(/脂質を減らしつつ、たんぱく質を足す/.test(a.lines[0])); assert.ok(/炭水化物で補/.test(a.lines[1]));
assert.ok(a.lines.length === 2 && /脂質が多い/.test(a.head) && /カロリーが少ない/.test(a.head));
// 範囲内
a = ML.advise({ kcal: 1900, protein: 112, fat: 50 }, tg, false);
assert.deepStrictEqual(a.state, { kcal: 'ok', protein: 'ok', fat: 'ok' }); assert.ok(/範囲内/.test(a.lines[0]));
// 1日の途中は「少ない」と言わず、残りを案内する
a = ML.advise({ kcal: 600, protein: 30, fat: 20 }, tg, true);
assert.strictEqual(a.state.kcal, 'ok'); assert.ok(/あと1500kcal/.test(a.lines.join('')) && /脂質 あと35gまで/.test(a.lines.join('')));
// 途中でも多ければ言う
a = ML.advise({ kcal: 900, protein: 30, fat: 60 }, tg, true); assert.strictEqual(a.state.fat, 'over');
// 脂質×カロリーの超過
a = ML.advise({ kcal: 2300, protein: 120, fat: 70 }, tg, false); assert.ok(/主な原因は脂質/.test(a.lines[0]));
// 全体に少ない
a = ML.advise({ kcal: 1300, protein: 60, fat: 48 }, tg, false); assert.ok(/全体に少なめ/.test(a.lines[0]));
// 目標なし
a = ML.advise({ kcal: 1300, protein: 60, fat: 30 }, {}, false); assert.strictEqual(a.lines.length, 0);
// 上限なし：目安の1割超で「多い」
a = ML.advise({ kcal: 1, protein: 1, fat: 56 }, { fat: { ref: 50, lo: 0, hi: 0 } }, false); assert.strictEqual(a.state.fat, 'over');
console.log('OK advise');

// ---- 1日の判定・週の収支 ----
assert.strictEqual(ML.judge(50, 40, 55, 46), 'ok'); assert.strictEqual(ML.judge(60, 40, 55, 46), 'over'); assert.strictEqual(ML.judge(30, 40, 55, 46), 'under');
assert.strictEqual(ML.judge(52, 0, 0, 46), 'over'); assert.strictEqual(ML.judge(40, 0, 0, 46), 'under'); assert.strictEqual(ML.judge(46, 0, 0, 46), 'ok'); assert.strictEqual(ML.judge(5, 0, 0, 0), null);
// 月曜は収支なし
assert.strictEqual(ML.weekBalance([], '2026/11/09', 50, 'fat'), null);
// 月〜金（5日）に60gずつ、目安50g → 使った300、ペース250、差+50、週350
var b = ML.weekBalance(logs, '2026/11/14', 50, 'fat');
assert.deepStrictEqual([b.used, b.week, b.pace, b.diff, b.elapsed, b.miss], [300, 350, 250, 50, 5, 0]);
// 未記録の日は目安どおり：月だけ記録(60)、火〜木は未記録(各50)、今日=金 → used 60+150=210、ペース200
b = ML.weekBalance([L('2026/11/09', 2000, 100, 60)], '2026/11/13', 50, 'fat');
assert.deepStrictEqual([b.used, b.pace, b.diff, b.miss], [210, 200, 10, 3]);
assert.strictEqual(ML.weekBalance(logs, '2026/11/14', 0, 'fat'), null);
console.log('OK balance');
