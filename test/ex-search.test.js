/* 種目の検索（ExSearch）。node test/ex-search.test.js */
var assert = require('assert'), S = require('../ex-search-lib.js');
var L = [
  { id: 'A', name: 'ダンベルショルダープレス', part: '三角筋前部', equipment: 'ダンベル', secondary: ['上腕三頭筋'], tags: [] },
  { id: 'B', name: 'フェイスプル', part: '三角筋後部', equipment: 'チューブ', secondary: ['僧帽筋'], tags: ['肩リハ'] },
  { id: 'C', name: 'チューブロー', part: '広背筋', equipment: 'チューブ', tags: [] },
  { id: 'D', name: 'Face Pull（ケーブル）', part: '三角筋後部', equipment: 'その他', tags: [] }
];
function ids(q) { return S.filter(L, q).map(function (e) { return e.id; }).join(','); }
assert.strictEqual(ids('フェイスプル'), 'B');
assert.strictEqual(ids('ふぇいすぷる'), 'B');
assert.strictEqual(ids('ﾌｪｲｽﾌﾟﾙ'), 'B');
assert.strictEqual(ids('フェイス プル'), 'B');
assert.strictEqual(ids('face'), 'D');
assert.strictEqual(ids('ＦＡＣＥ ＰＵＬＬ'), 'D');
assert.strictEqual(ids('チューブ'), 'C,B');           // 名前の先頭一致が先、器具だけ一致は後
assert.strictEqual(ids('三角筋 チューブ'), 'B');       // 複数の言葉はすべて含むもの
assert.strictEqual(ids('肩リハ'), 'B');               // タグ
assert.strictEqual(ids('僧帽'), 'B');                 // 付随部位
assert.strictEqual(ids('  '), '');
assert.strictEqual(ids('スクワット'), '');
console.log('ex-search ok');
