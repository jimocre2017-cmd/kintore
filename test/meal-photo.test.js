/* 食事の写真見積もり（Now.gs）：入力の検証、質問は確信度が高くないときだけ、見積もり直し。node test/meal-photo.test.js */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
var n = 0; function t(name, f) { f(); n++; console.log('ok  ' + name); }
var calls = [], reply = null;
var ctx = vm.createContext({
  console: console, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number, isNaN: isNaN,
  gemini_: function (sys, user, schema, images) { calls.push({ sys: sys, user: user, schema: schema, images: images }); return reply; },
  today_: function () { return '2026/11/18'; }, TZ: 'Asia/Tokyo',
  Utilities: { formatDate: function () { return '07:30'; } },
  aiBody_: function () { return null; }, planSettings_: function () { return {}; }
});
['Meal.gs', 'Now.gs'].forEach(function (f) { vm.runInContext(fs.readFileSync(path.join(__dirname, '../gas', f), 'utf8'), ctx, { filename: f }); });
vm.runInContext('mealFoods_ = function () { return []; };', ctx);
var IMG = { mime: 'image/jpeg', data: new Array(300).join('A') };
function est(req) { ctx.__r = req; return vm.runInContext('mealPhotoEstimate(__r)', ctx); }
var ITEM = { name: '鮭定食', amount: '1人前', kcal: 600, protein: 30, fat: 15, carbs: 80, alcohol: 0 };

t('写真を画像として渡し、写っているものだけを見積もる指示とスキーマに質問を含める', function () {
  reply = { items: [ITEM], confidence: '高', note: '', questions: [{ question: 'ご飯の量は？', options: ['普通', '大盛り'] }] };
  var r = est({ image: IMG, type: '昼食' });
  assert.strictEqual(calls[0].images[0].mime, 'image/jpeg');
  assert.ok(calls[0].sys.indexOf('写っているものだけ') >= 0);
  assert.ok(calls[0].schema.properties.questions);
  assert.strictEqual(r.total.kcal, 600);
  assert.strictEqual(r.questions.length, 0, '確信度が高いときは質問しない');
});
t('確信度が低いときだけ質問を返す（最大2つ・選択肢2〜4つ・選択肢が1つ以下は捨てる）', function () {
  reply = { items: [ITEM], confidence: '低', note: '量が不明', questions: [
    { question: 'ご飯の量は？', options: ['普通', '大盛り', '少なめ', '半分', '多すぎる選択肢'] },
    { question: '油は？', options: ['多い'] }, { question: 'ソースは？', options: ['かけた', 'かけない'] }, { question: '4つめ', options: ['a', 'b'] }] };
  var r = est({ image: IMG, type: '夕食' });
  assert.strictEqual(r.confidence, '低');
  assert.strictEqual(r.questions.length, 1, '先頭2件のうち、選択肢が足りない1件は捨てる');
  assert.strictEqual(r.questions[0].options.length, 4);
});
t('答えを渡すと、質問と回答がAIへの入力に入る', function () {
  reply = { items: [ITEM], confidence: '中', note: '', questions: [] };
  est({ image: IMG, type: '夕食', qa: [{ q: 'ご飯の量は？', a: '大盛り' }] });
  var u = calls[calls.length - 1].user;
  assert.ok(u.indexOf('ご飯の量は？ → 大盛り') >= 0);
});
t('画像が無い・形式が違う・大きすぎる・読み取れない場合はAIを呼ばずにエラー', function () {
  var before = calls.length;
  assert.throws(function () { est({ type: '朝食' }); }, /形式/);
  assert.throws(function () { est({ image: { mime: 'image/gif', data: IMG.data } }); }, /形式/);
  assert.throws(function () { est({ image: { mime: 'image/jpeg', data: 'abc' } }); }, /読み取れません|もう一度/);
  assert.throws(function () { est({ image: { mime: 'image/jpeg', data: new Array(3600000).join('A') } }); }, /大きすぎ/);
  assert.strictEqual(calls.length, before);
});
t('食事に見えない写真（items空）は、理由つきのエラー', function () {
  reply = { items: [], confidence: '低', note: '食事が写っていません', questions: [] };
  assert.throws(function () { est({ image: IMG }); }, /食事が写っていません/);
});
console.log('\n' + n + ' 件すべて成功');
