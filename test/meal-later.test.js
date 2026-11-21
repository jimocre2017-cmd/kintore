/* 「名前だけ記録 → あとでAI分析」の変換（MealLib.fromEstimate / dropSaved）。node test/meal-later.test.js */
var ML = require('../meal-lib.js'), assert = require('assert');
var later = { id: 'm1', date: '2026/11/21', time: '12:30', type: '昼食', text: 'ざるそば、天ぷら2個', at: 1 };
var r = { total: { kcal: 612.4, protein: 21.26, fat: 18, carbs: 88.04 }, confidence: '中', note: '天ぷらの油で幅あり',
  items: [{ name: 'ざるそば', line: 'ざるそば（1人前） 330kcal P12 F2 C66' }, { name: '天ぷら', line: '天ぷら（2個） 282kcal P9 F16 C22' }] };
var e = ML.fromEstimate(later, r);
assert.strictEqual(e.id, 'm1'); assert.strictEqual(e.date, '2026/11/21'); assert.strictEqual(e.time, '12:30'); assert.strictEqual(e.type, '昼食');
assert.strictEqual(e.text, 'ざるそば、天ぷら2個');
assert.strictEqual(e.kcal, 612); assert.strictEqual(e.protein, 21.3); assert.strictEqual(e.fat, 18); assert.strictEqual(e.carbs, 88);
assert.ok(e.items.indexOf('ざるそば（1人前）') === 0 && e.items.split('\n').length === 2);
assert.ok(/^確からしさ：中/.test(e.note) && /あとからAIが分析/.test(e.note) && e.note.length <= 300);
assert.strictEqual(e.pending, undefined);                         // 端末側の印は送らない
var e2 = ML.fromEstimate({ id: 'x', date: '2026/11/20', text: 'プロテイン' }, { total: {}, items: [] });
assert.strictEqual(e2.kcal, 0); assert.strictEqual(e2.type, 'その他'); assert.strictEqual(e2.time, '');
// 保存済みの記録と同じIDの分析待ちは外す
var L = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
assert.deepStrictEqual(ML.dropSaved(L, [{ id: 'b' }]).map(function (x) { return x.id; }), ['a', 'c']);
assert.deepStrictEqual(ML.dropSaved(null, []), []);
console.log('meal-later ok');
