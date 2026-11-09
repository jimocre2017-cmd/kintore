/* node test/yk-lib.test.js で実行（外部ライブラリ不要） */
var assert = require('assert');
var Y = require('../yk-lib.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

var parts = [
  { part: '大胸筋', group: '胸' }, { part: '前鋸筋', group: '胸' },
  { part: '広背筋', group: '背中' }, { part: '僧帽筋', group: '背中' },
  { part: '三角筋', group: '肩' }, { part: '腱板（インナーマッスル）', group: '肩' },
  { part: '上腕二頭筋', group: '腕' }, { part: '腹直筋', group: '腹' },
  { part: '大腿四頭筋', group: '脚' }, { part: '大臀筋', group: '脚' }
];
function ex(id, name, part, o) {
  o = o || {};
  return { id: id, name: name, part: part, equipment: o.equipment || 'ダンベル', measure: o.measure || '回数', loadType: o.loadType || 'kg',
    def: o.def === undefined ? 10 : o.def, min: o.min === undefined ? 2.5 : o.min, max: o.max === undefined ? 20 : o.max, step: o.step === undefined ? 2.5 : o.step,
    intensity: o.intensity || '', secondary: o.secondary || [], active: o.active !== false };
}
var exercises = [
  ex('E001', 'ダンベルプレス', '大胸筋', { secondary: ['三角筋'] }),
  ex('E041', 'インクラインダンベルプレス', '大胸筋'),
  ex('E018', 'プッシュアッププラス', '前鋸筋', { equipment: '自重', loadType: '加重', def: 0, min: 0, max: 30 }),
  ex('E008', 'ダンベルスクワット', '大腿四頭筋', { secondary: ['大臀筋'] }),
  ex('E033', 'ブルガリアンスクワット', '大腿四頭筋'),
  ex('E012', 'シュラッグ', '僧帽筋'),
  ex('E017', 'うつ伏せT・Wレイズ', '僧帽筋', { equipment: '自重', loadType: '加重', def: 0, min: 0, max: 5 }),
  ex('E027', 'ニュートラル・プルアップ', '広背筋', { equipment: '自重', loadType: '加重', def: 0, min: 0, max: 30 }),
  ex('E042', 'オーバーハンド・プルアップ', '広背筋', { equipment: '自重', loadType: '加重', def: 0, min: 0, max: 30 }),
  ex('E003', 'バックラットプル', '広背筋', { equipment: 'チューブ', loadType: '強度固定', def: 0, min: 0, max: 0, step: 0, intensity: 'シングル' }),
  ex('E007', 'ドラゴンフラッグ', '腹直筋', { equipment: '自重', loadType: '加重', def: 0, min: 0, max: 30 }),
  ex('E021', 'サイドフラッグ', '腹直筋', { equipment: '自重', loadType: '加重', def: 0, min: 0, max: 30 }),
  ex('E009', 'フェイスプル', '腱板（インナーマッスル）', { equipment: 'チューブ', loadType: '強度固定', def: 0, min: 0, max: 0, step: 0, intensity: 'シングル' }),
  ex('E014', 'チューブ外旋', '腱板（インナーマッスル）', { equipment: 'チューブ', loadType: '強度固定', def: 0, min: 0, max: 0, step: 0, intensity: 'シングル' })
];
var TODAY = '2026/11/09';
function base(o) {
  return Object.assign({ today: TODAY, exercises: exercises, parts: parts, hist: [], todaySets: {}, prev: {}, settings: {}, shoulder: 'ok', state: {} }, o || {});
}
function ids(plan) { return plan.items.map(function (i) { return i.exId; }); }

// 背中だけ豊富（先週末〜昨日）、胸と脚はゼロ、昨日は背中
var backHeavy = [
  { d: '2026/11/08', e: 'E027', n: 5 }, { d: '2026/11/07', e: 'E042', n: 4 }, { d: '2026/11/06', e: 'E027', n: 4 }
];

t('不足の大きい胸と脚が主働筋に選ばれ、先頭に肩インナー（プレス前は2セット）が入る', function () {
  var p = Y.build(base({ hist: backHeavy }));
  assert.strictEqual(p.mode, 'normal');
  var main = p.items.filter(function (i) { return i.role === 'main'; });
  assert.deepStrictEqual(main.map(function (i) { return i.area; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).sort(), ['chest', 'legs']);
  assert.strictEqual(p.items[0].role, 'warmup');
  assert.ok(['E009', 'E014'].indexOf(p.items[0].exId) >= 0);
  assert.ok(ids(p).indexOf('E001') >= 0, 'ダンベルプレスが入る');
  assert.strictEqual(p.items[0].sets, 2);
  assert.ok(p.estMinutes <= 30, '30分以内：' + p.estMinutes);
});

t('不足度は 優先度×(目標−消化)/目標。胸と脚は重みが大きい', function () {
  var d = Y.deficits(base({ hist: backHeavy }));
  var by = {}; d.areas.forEach(function (a) { by[a.key] = a; });
  assert.strictEqual(by.chest.done, 0);
  assert.strictEqual(by.chest.score, 1.5);
  assert.strictEqual(by.back.done, 13);
  assert.ok(by.back.over, '背中は目標10の1.25倍(12.5)を超えている');
  assert.strictEqual(by.back.daysSince, 1);
});

t('メインのセットは付随0.5で数えるが、同じ区分には二重に数えない', function () {
  var d = Y.deficits(base({ hist: [{ d: '2026/11/08', e: 'E001', n: 4 }] })); // 胸1 + 三角筋0.5（別区分）
  var by = {}; d.areas.forEach(function (a) { by[a.key] = a; });
  assert.strictEqual(by.chest.done, 4);
  assert.strictEqual(by.shoulder.done, 2);
  var d2 = Y.deficits(base({ hist: [{ d: '2026/11/08', e: 'E008', n: 4 }] })); // 脚+大臀筋(同じ脚)
  assert.strictEqual(d2.areas.filter(function (a) { return a.key === 'legs'; })[0].done, 4);
});

t('肩インナー（E009・E014）の実施は週のセット数に数えない', function () {
  var d = Y.deficits(base({ hist: [{ d: '2026/11/08', e: 'E009', n: 6 }] }));
  assert.strictEqual(d.areas.filter(function (a) { return a.key === 'shoulder'; })[0].done, 0);
});

t('7日より前の記録は数えず、今日の端末側セットは数える', function () {
  var d = Y.deficits(base({ hist: [{ d: '2026/11/02', e: 'E008', n: 9 }], todaySets: { E008: [{}, {}, {}] } }));
  assert.strictEqual(d.areas.filter(function (a) { return a.key === 'legs'; })[0].done, 3);
});

t('3日以上空いたら、負荷を1段階落とした全身（脚・胸・背中・体幹）に', function () {
  var p = Y.build(base({
    hist: [{ d: '2026/11/05', e: 'E008', n: 3 }],
    prev: { E008: { date: '2026/11/05', sets: [{ load: 12.5, reps: 12 }] } }
  }));
  assert.strictEqual(p.mode, 'reboot');
  var main = p.items.filter(function (i) { return i.role === 'main'; });
  assert.deepStrictEqual(main.map(function (i) { return i.area; }), ['legs', 'chest', 'back', 'core']);
  var sq = main[0];
  assert.strictEqual(sq.load, 10, '12.5kg → 10kg（1段階下）');
  assert.ok(main.every(function (i) { return i.sets === 2; }));
});

t('復帰メニューを1週間以内にやった後は、また空いても通常メニュー', function () {
  var p = Y.build(base({ hist: [{ d: '2026/11/05', e: 'E008', n: 3 }], state: { lastReboot: '2026/11/05' } }));
  assert.strictEqual(p.mode, 'normal');
});

t('記録がまったく無い時は復帰メニュー', function () {
  assert.strictEqual(Y.build(base()).mode, 'reboot');
});

t('肩が「違和感」ならインクライン・オーバーハンドを外す／「痛い」ならプレス系もプルアップ系も外す', function () {
  var h = [{ d: '2026/11/08', e: 'E008', n: 1 }, { d: '2026/11/07', e: 'E027', n: 1 }];
  var uneasy = Y.build(base({ hist: h, shoulder: 'uneasy', prev: { E041: { sets: [{ load: 10, reps: 10 }] } } }));
  assert.ok(ids(uneasy).indexOf('E041') < 0 && ids(uneasy).indexOf('E042') < 0);
  var pain = Y.build(base({ hist: [{ d: '2026/11/08', e: 'E008', n: 1 }], shoulder: 'pain' }));
  ['E001', 'E041', 'E027', 'E042', 'E004'].forEach(function (id) { assert.ok(ids(pain).indexOf(id) < 0, id + ' は外れる'); });
  assert.ok(pain.warnings.some(function (w) { return /整形外科/.test(w); }));
});

t('プルアップ系が使えない時は、チューブのバックラットプルが背中の代役', function () {
  var list = exercises.filter(function (e) { return e.id !== 'E027' && e.id !== 'E042'; });
  var p = Y.build(base({ exercises: list, hist: [{ d: '2026/11/08', e: 'E001', n: 6 }, { d: '2026/11/08', e: 'E008', n: 6 }] }));
  assert.ok(ids(p).indexOf('E003') >= 0);
});

t('漸進：回数が上限なら重さ+1刻み／重さの上限なら回数を伸ばす', function () {
  var sq = exercises.filter(function (e) { return e.id === 'E008'; })[0], area = Y.AREAS[1];
  var r = Y.recommend(sq, { sets: [{ load: 12.5, reps: 15 }] }, area, 'normal');
  assert.strictEqual(r.load, 15); assert.strictEqual(r.reps, 10);
  var cap = Y.recommend(sq, { sets: [{ load: 20, reps: 15 }] }, area, 'normal');
  assert.strictEqual(cap.load, 20); assert.strictEqual(cap.reps, 16); assert.ok(/上限kg/.test(cap.note));
  var mid = Y.recommend(sq, { sets: [{ load: 12.5, reps: 11 }] }, area, 'normal');
  assert.strictEqual(mid.load, 12.5); assert.strictEqual(mid.reps, 12);
  var first = Y.recommend(sq, null, area, 'normal');
  assert.strictEqual(first.load, 10); assert.strictEqual(first.reps, 10);
});

t('目標をすべて超えた週は維持メニュー（休養も検討の警告）', function () {
  var h = [];
  [['E001', 12], ['E008', 10], ['E027', 14], ['E012', 10], ['E007', 8]].forEach(function (x) { h.push({ d: '2026/11/08', e: x[0], n: x[1] }); });
  var p = Y.build(base({ hist: h }));
  assert.ok(p.warnings.some(function (w) { return /休養/.test(w); }));
  assert.ok(p.items.length > 0);
});

t('設定シートの値で目標とフェーズを変えられる（増量期は目標×1.15）', function () {
  var cfg = Y.configFrom({ 'YK_目標_胸': 12, 'YK_フェーズ': 1, 'YK_ブランク日数': 5 });
  assert.strictEqual(cfg.areas[0].target, 12); assert.strictEqual(cfg.blankDays, 5); assert.strictEqual(cfg.phase, 'bulk');
  var d = Y.deficits(base({ cfg: cfg }));
  assert.strictEqual(d.areas[0].target, 13.8);
});

t('絞り期→増量期の準備度：直近4週のうち胸・脚が目標の9割以上の週が3つ以上で ready', function () {
  var h = [];
  [0, 1, 2].forEach(function (w) {
    var day = Y.addDays(TODAY, -7 * w - 2);
    h.push({ d: day, e: 'E001', n: 9 }, { d: day, e: 'E008', n: 7 });
  });
  var r = Y.readiness(base({ hist: h }));
  assert.strictEqual(r.metWeeks, 3); assert.ok(r.ready);
  assert.ok(!Y.readiness(base({ hist: h.slice(0, 2) })).ready);
});

t('種目マスタに無いIDは missing に出る', function () {
  var list = exercises.filter(function (e) { return e.id !== 'E033' && e.id !== 'E009'; });
  var p = Y.build(base({ exercises: list, hist: backHeavy }));
  assert.ok(p.missing.indexOf('E033') >= 0 && p.missing.indexOf('E009') >= 0);
});

t('既存のプログラム形式（タグ設定）に変換できる', function () {
  var p = Y.build(base({ hist: backHeavy })), prog = Y.toProgram(p);
  assert.strictEqual(prog.name, 'YK今日');
  assert.strictEqual(prog.items.length, p.items.length);
  assert.ok(/セット｜/.test(prog.items[0].note));
});

t('肩インナーは前回30回でも進歩させず、12〜15回の軽めに固定', function () {
  var p = Y.build(base({ hist: backHeavy, prev: { E009: { sets: [{ reps: 30, intensity: 'シングル' }] }, E014: { sets: [{ reps: 30 }] } } }));
  assert.ok(p.items[0].reps >= 12 && p.items[0].reps <= 15, '回数：' + p.items[0].reps);
});

console.log('\n' + n + ' 件 すべて成功');
