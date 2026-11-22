/* 朝の提案（MealLib.morningBrief）と、gas/MealLib.gs が meal-lib.js と同じであること。node test/morning-brief.test.js */
var assert = require('assert'), fs = require('fs'), path = require('path');
var ML = require('../meal-lib.js');
var G = { kcal: 1750, kcalMin: 1660, kcalMax: 1980, protein: 150, proteinMin: 130, proteinMax: 180, fat: 50, fatMin: 40, fatMax: 65 };
function L(date, kcal, p, f, n) { var a = []; n = n || 3; for (var i = 0; i < n; i++) a.push({ date: date, kcal: kcal / n, protein: p / n, fat: f / n, carbs: 0 }); return a; }

// 月曜：収支なし。目安どおり。昨日（日曜）の判定が出る
var mon = ML.morningBrief({ logs: L('2026/11/22', 2116, 150.9, 72.6, 1), today: '2026/11/23', goals: G, phaseLabel: '第1期' });
assert.strictEqual(mon.targets.kcal.ref, 1750); assert.ok(mon.headline.indexOf('月曜') >= 0);
assert.strictEqual(mon.yesterday.state.kcal, 'over');

// 昨日が未記録：yesterday は null（記録忘れの知らせは既存の「記録忘れの可能性」カードの担当）
var z = ML.morningBrief({ logs: [], today: '2026/11/24', goals: G });
assert.strictEqual(z.yesterday, null); assert.strictEqual(z.alerts, undefined);

// 「これで全部」の印だけの日は、昨日の判定を出さない
var mk = ML.morningBrief({ logs: [ML.markEntry('x', '2026/11/23')], today: '2026/11/24', goals: G });
assert.strictEqual(mk.yesterday, null);

// 週の途中で多め：今日の目安が下がる（割り戻し）。範囲の下限で止まるときは「無理に削らず」
var over = ML.morningBrief({ logs: L('2026/11/23', 2300, 150, 60), today: '2026/11/24', goals: G });
assert.ok(over.targets.kcal.ref < 1750 && over.headline.indexOf('多め') >= 0);
var way = ML.morningBrief({ logs: L('2026/11/23', 3200, 150, 60), today: '2026/11/24', goals: G });
assert.strictEqual(way.targets.kcal.clamp, 'lo'); assert.ok(way.headline.indexOf('無理に削らず') >= 0);

// 少なめ：目安が上がる
var under = ML.morningBrief({ logs: L('2026/11/23', 1200, 150, 40), today: '2026/11/24', goals: G });
assert.ok(under.targets.kcal.ref > 1750 && under.headline.indexOf('少なめ') >= 0);

// 目標なしなら提案は出さない（headline 空）
assert.strictEqual(ML.morningBrief({ logs: [], today: '2026/11/24', goals: {} }).headline, '');

// GAS 側のコピーが元と同じ
var src = fs.readFileSync(path.join(__dirname, '..', 'meal-lib.js'), 'utf8'), gs = fs.readFileSync(path.join(__dirname, '..', 'gas', 'MealLib.gs'), 'utf8');
assert.ok(gs.replace(/\r\n/g, '\n').indexOf(src.replace(/\r\n/g, '\n')) > 0, 'gas/MealLib.gs が meal-lib.js と違います。node tools/sync-planlib.js を実行してください');
console.log('morning-brief ok');
