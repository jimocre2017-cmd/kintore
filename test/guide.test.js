/* 使い方ガイド（guide.js）の中身と、全画面への組み込みの確認。node test/guide.test.js */
var fs = require('fs'), path = require('path'), assert = require('assert');
var G = require('../guide.js');
var dir = path.join(__dirname, '..');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

var pages = fs.readdirSync(dir).filter(function (f) { return /\.html$/.test(f); });

t('全画面に説明があり、全画面で guide.js を coach.js の後に読み込む', function () {
  pages.forEach(function (f) {
    assert.ok(G.PAGES[f], f + ' の説明がありません');
    var s = fs.readFileSync(path.join(dir, f), 'utf8');
    var c = s.indexOf('<script src="coach.js"></script>'), g = s.indexOf('<script src="guide.js"></script>');
    assert.ok(c >= 0 && g > c, f + '：guide.js は coach.js の後に読み込む');
  });
  Object.keys(G.PAGES).forEach(function (k) { assert.ok(pages.indexOf(k) >= 0, k + ' という画面はありません'); });
});

t('オフラインでも開けるよう、Service Worker の保存ファイルに入っている', function () {
  assert.ok(/'\.\/guide\.js'/.test(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8')));
});

t('説明書（AIに渡す）に全画面・用語・AIの使い分けが入り、長さが上限内', function () {
  var m = G.manual();
  Object.keys(G.PAGES).forEach(function (k) { assert.ok(m.indexOf('（' + k + '）') >= 0, k); });
  G.GLOSSARY.forEach(function (g) { assert.ok(m.indexOf(g[0]) >= 0, g[0]); });
  assert.ok(m.indexOf('総合コーチ') >= 0 && m.indexOf('オフライン') >= 0);
  assert.ok(m.length < 9000, '説明書が長すぎます：' + m.length + '字（Coach.gs の上限 9000字）');
});

t('初回ガイド・よくある質問の形', function () {
  assert.ok(G.TOUR.length >= 4 && G.TOUR.length <= 8);
  G.TOUR.forEach(function (x) { assert.ok(x[0] && x[1] && x[2].length); });
  G.FAQ.forEach(function (f) { assert.ok(f[0].length <= 16 && f[1].length >= 10, f[0]); });
});

t('画面名の判定：パス・クエリ付き・不明な画面', function () {
  assert.strictEqual(G.pageKey('/kintore/meal.html?x=1'), 'meal.html');
  assert.strictEqual(G.pageKey('/kintore/'), 'index.html');
  assert.strictEqual(G.pageKey('/kintore/zzz.html'), 'index.html');
});

t('画面に書いたボタン名が、実際の画面にある', function () {
  var labels = { 'index.html': ['＋ 種目を追加', '種目の表示設定', '今日のセット', 'セット記録', '停止'],
    'cardio.html': ['■ 終了して保存', '＋ 手動で追加', 'このルートをコースに登録'],
    'body.html': ['体重計の数値を記録', '目標と試算', '集計から除外'],
    'meal.html': ['1日の目標を設定', 'この内容を品目として覚える', '減らす・増やす方法'],
    'photo.html': ['＋ 体つきを撮る（前・横・後ろ）', 'AIに所見を聞く', 'この2枚を比べる', '前の写真と並べる'],
    'plan.html': ['計画の設定', '終盤を緩やかに'] };
  Object.keys(labels).forEach(function (f) {
    var s = fs.readFileSync(path.join(dir, f), 'utf8');
    labels[f].forEach(function (l) { assert.ok(s.indexOf(l) >= 0, f + ' に「' + l + '」がありません'); });
  });
});

t('用語集：リコンプ・リーンバルク・違い・局面があり、「気になる言葉」の飛び先がすべて存在する', function () {
  var keys = G.GLOSSARY.filter(function (g) { return g[2]; }).map(function (g) { return g[2]; });
  ['recomp', 'leanbulk', 'diff', 'phases'].forEach(function (k) { assert.ok(keys.indexOf(k) >= 0, k); });
  assert.strictEqual(keys.length, new Set(keys).size, '飛び先キーが重複しています');
  G.TERMS.forEach(function (x) { assert.ok(keys.indexOf(x[0]) >= 0, x[0] + ' の用語がありません'); assert.ok(x[1].length <= 14, x[1]); });
  var m = G.manual();
  assert.ok(m.indexOf('リコンプ') >= 0 && m.indexOf('リーンバルク') >= 0, '説明書（AIに渡す）にも入っている');
});

t('画面の ⓘ（data-term）の飛び先は、すべて用語集にある', function () {
  var keys = G.GLOSSARY.filter(function (g) { return g[2]; }).map(function (g) { return g[2]; }), found = 0;
  fs.readdirSync(dir).filter(function (f) { return /\.(html|js)$/.test(f); }).forEach(function (f) {
    var src = fs.readFileSync(path.join(dir, f), 'utf8'), re = /data-term="([a-z]+)"/g, mm;
    while ((mm = re.exec(src))) { found++; assert.ok(keys.indexOf(mm[1]) >= 0, f + '：' + mm[1] + ' の用語がありません'); }
    // マスタープランの期のキー（p.key）で飛ぶ分は、期のキーが用語集にあることを確認
  });
  assert.ok(found >= 2, 'ⓘ が画面に付いている');
  var RL = require('../roadmap-lib.js');
  RL.ROADMAP.phases.forEach(function (p) { assert.ok(keys.indexOf(p.key) >= 0, 'マスタープランの期 ' + p.key + ' の用語がありません'); });
});

console.log('\n' + n + ' 件すべて成功');
