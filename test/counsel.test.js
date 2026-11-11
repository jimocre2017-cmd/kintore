/* カウンセリングシート：質問→前提メモの変換（counsel-lib.js）と、保存・期限（Counsel.gs）。node test/counsel.test.js */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
var C = require('../counsel-lib.js');
var n = 0; function t(name, f) { f(); n++; console.log('ok  ' + name); }
var EQ = ['ダンベル', 'ベンチ', 'チューブ', '懸垂バー', 'バーベル'];

t('質問：痛みの部位ごとに、「今ある」のときだけ動作の質問が出る', function () {
  var secs = C.sections(EQ), body = secs.filter(function (s) { return s.id === 'body'; })[0];
  var mv = body.items.filter(function (i) { return i.id === 'move:肩（右）'; })[0];
  assert.ok(!C.isShown(mv, { 'pain:肩（右）': 'なし' }));
  assert.ok(!C.isShown(mv, { 'pain:肩（右）': '過去にあった' }));
  assert.ok(C.isShown(mv, { 'pain:肩（右）': '今ある' }));
  assert.deepStrictEqual(secs.filter(function (s) { return s.id === 'gear'; })[0].items[0].options, EQ);
});

t('変換：回答にあることだけを書き、無い器具の種目は勧めないと明記する', function () {
  var txt = C.compile({
    purpose: '脂肪を落とす', freq: '3〜4回', equipment: ['ダンベル', 'チューブ'],
    doctor: { v: 'no' }, numb: { v: 'no' },
    'pain:肩（右）': '今ある', 'move:肩（右）': '腕を上げると引っかかる', 'pain:膝': '過去にあった', 'hist:膝': '10年前に半月板', 'pain:首': 'なし',
    work: '立ち・歩きが多い', diet: { v: 'other', t: '乳製品が苦手' }, memo: '運動は久しぶり'
  }, EQ, '2026/11/11');
  assert.ok(txt.indexOf('目的：脂肪を落とす') >= 0 && txt.indexOf('週3〜4回') >= 0);
  assert.ok(txt.indexOf('使える：ダンベル、チューブ') >= 0 && txt.indexOf('無い：ベンチ、懸垂バー、バーベル') >= 0 && txt.indexOf('勧めない') >= 0);
  assert.ok(txt.indexOf('今ある痛み・違和感：肩（右）（腕を上げると引っかかる）') >= 0);
  assert.ok(txt.indexOf('過去のけが・既往（再発に注意）：膝（10年前に半月板）') >= 0);
  assert.ok(txt.indexOf('首') < 0 || txt.indexOf('首（') < 0, '「なし」の部位は書かない');
  assert.ok(txt.indexOf('その他（乳製品が苦手）') >= 0 && txt.indexOf('運動は久しぶり') >= 0);
  assert.ok(txt.indexOf('2026/11/11 時点') >= 0);
  assert.ok(txt.indexOf('睡眠') < 0, '答えていない項目は書かない');
});

t('変換：何も答えていなければ空。医師の制限・しびれ・夜間痛は最初の注意として出す', function () {
  assert.strictEqual(C.compile({}, EQ, '2026/11/11'), '');
  var a = { doctor: { v: 'yes' }, numb: { v: 'yes' } };
  assert.strictEqual(C.redFlags(a).length, 2);
  var txt = C.compile(a, EQ, '2026/11/11');
  assert.ok(txt.indexOf('注意：医師から運動を控える') >= 0 && txt.indexOf('注意：しびれや夜間の痛み') >= 0);
  assert.strictEqual(C.redFlags({ doctor: { v: 'no' } }).length, 0);
});

t('器具を何も選ばなければ「自重のみ」、長すぎる回答は1800字以内に収める', function () {
  assert.ok(C.compile({ equipment: [] }, EQ, '2026/11/11').indexOf('自重のみ') >= 0);
  var long = C.compile({ memo: 'あ'.repeat(5000) }, EQ, '2026/11/11');
  assert.ok(long.length <= 1800);
});

t('期限：未回答は初回、90日で見直し、不要にした人は聞かない', function () {
  assert.strictEqual(C.status('', '2026/11/11').state, 'first');
  assert.strictEqual(C.status('2026/11/11', '2027/02/08').state, 'ok');
  var d = C.status('2026/11/11', '2027/02/09');
  assert.strictEqual(d.state, 'due'); assert.strictEqual(d.daysSince, 90);
  assert.strictEqual(C.status('', '2026/11/11', true).state, 'skipped');
});

t('見直し用の要約：前回の回答を1行で（「なし」の部位は出さない）', function () {
  var sec = C.sections(EQ).filter(function (s) { return s.id === 'body'; })[0];
  var s = C.sectionSummary(sec, { doctor: { v: 'no' }, 'pain:肩（右）': '今ある', 'move:肩（右）': '上げると痛い', 'pain:首': 'なし' });
  assert.ok(s.indexOf('肩（右）：今ある') >= 0 && s.indexOf('上げると痛い') >= 0 && s.indexOf('首') < 0);
});

/* ---- サーバー側 ---- */
var props = {}, today = '2026/11/11';
var ctx = vm.createContext({
  console: console, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number, isNaN: isNaN,
  PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] === undefined ? null : props[k]; }, setProperty: function (k, v) { props[k] = String(v); }, deleteProperty: function (k) { delete props[k]; } }; } },
  today_: function () { return today; },
  toDays_: function (s) { var p = s.split('/'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); },
  addDays_: function (s, k) { var d = new Date((ctx.toDays_(s) + k) * 86400000); return d.getUTCFullYear() + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + ('0' + d.getUTCDate()).slice(-2); }
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'Counsel.gs'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'gas', 'Coach.gs'), 'utf8'), ctx);
var run = function (c) { return vm.runInContext(c, ctx); };

t('サーバー：最初は first。保存すると ok になり、次回は90日後。不要にもできる', function () {
  var g = run('counselGet()'); assert.strictEqual(g.state, 'first'); assert.strictEqual(g.answers, null);
  ctx.__p = { answers: { purpose: '脂肪を落とす' }, chart: '【目的と習慣】目的：脂肪を落とす' };
  var r = run('counselSave(__p)');
  assert.strictEqual(r.state, 'ok'); assert.strictEqual(r.updatedAt, '2026/11/11'); assert.strictEqual(r.nextDue, '2027/02/09');
  assert.strictEqual(r.answers.purpose, '脂肪を落とす');
  today = '2027/02/09'; assert.strictEqual(run('counselGet()').state, 'due'); today = '2026/11/11';
  props = {}; var s = run('counselSkip()'); assert.strictEqual(s.state, 'skipped');
  run('counselSave(__p)'); assert.strictEqual(run('counselGet()').state, 'ok'); // 後から回答すれば不要が解除される
});

t('サーバー：不正・長すぎる入力は保存しない', function () {
  props = {};
  ['null', '{answers: 5}', '{answers: [1]}', '{answers: {a: "x".repeat(9000)}}', '{answers: {a: 1}, chart: "x".repeat(2000)}'].forEach(function (src) {
    assert.throws(function () { run('counselSave(' + src + ')'); }, /回答|前提メモ/);
  });
  assert.strictEqual(run('counselGet()').state, 'first');
});

t('AIへ渡すカルテ：手書き＋カウンセリングの前提メモ。手書き欄の編集には前提メモが混ざらない', function () {
  props = { COACH_CHART: '右肩にインピンジメント' };
  assert.strictEqual(run('coachChart_()'), '右肩にインピンジメント');
  ctx.__p = { answers: { a: 1 }, chart: '【目的と習慣】目的：脂肪を落とす' }; run('counselSave(__p)');
  var c = run('coachChart_()');
  assert.ok(c.indexOf('右肩にインピンジメント') === 0 && c.indexOf('＜カウンセリングシートの回答＞') > 0 && c.indexOf('目的：脂肪を落とす') > 0);
  assert.strictEqual(run('coachChartGet()').text, '右肩にインピンジメント');
});
console.log('\n' + n + ' 件すべて成功');
