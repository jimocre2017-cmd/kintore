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

console.log('\n' + n + ' 件すべて成功');
