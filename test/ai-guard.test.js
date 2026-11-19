/* AiTrainer.gs の Gemini 呼び出し（軽量モデル・429のやり直し・モデル切替・結果キャッシュ）を、偽の環境で確認する。node test/ai-guard.test.js */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert'), crypto = require('crypto');
var src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'AiTrainer.gs'), 'utf8');

function env() {
  var props = { GEMINI_API_KEY: 'k' }, sheets = {}, sleeps = [], fetches = [], script = [];
  function fakeSheet() {
    var rows = [];
    return {
      rows: rows, getLastRow: function () { return rows.length; },
      getRange: function (r, c, nr, nc) {
        return {
          setValues: function (v) { v.forEach(function (row, i) { rows[r - 1 + i] = row.slice(); }); return this; },
          getValues: function () { var out = []; for (var i = 0; i < nr; i++) out.push((rows[r - 1 + i] || []).slice(c - 1, c - 1 + nc)); return out; },
          setFontWeight: function () { return this; }, setBackground: function () { return this; }, setFontColor: function () { return this; }
        };
      },
      appendRow: function (row) { rows.push(row.slice()); }, setFrozenRows: function () {}, setColumnWidth: function () {},
      deleteRows: function (from, n) { rows.splice(from - 1, n); }
    };
  }
  var models = ['models/gemini-3.6-flash', 'models/gemini-3.5-flash', 'models/gemini-3.5-flash-lite', 'models/gemini-3.6-flash-lite', 'models/gemini-3.6-flash-image', 'models/gemini-3.6-flash-lite-preview-09-2026'];
  var sb = {
    console: console, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number, isNaN: isNaN, TZ: 'Asia/Tokyo',
    PropertiesService: { getScriptProperties: function () { return { getProperty: function (k) { return props[k] === undefined ? null : props[k]; }, setProperty: function (k, v) { props[k] = String(v); }, deleteProperty: function (k) { delete props[k]; } }; } },
    Utilities: {
      sleep: function (ms) { sleeps.push(ms / 1000); }, formatDate: function () { return '2026/11/18 12:00'; },
      computeDigest: function (alg, s) { return Array.prototype.slice.call(crypto.createHash('sha256').update(s, 'utf8').digest()).map(function (b) { return b > 127 ? b - 256 : b; }); },
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' }
    },
    ss_: function () { return { getSheetByName: function (n) { return sheets[n] || null; }, insertSheet: function (n) { return (sheets[n] = fakeSheet()); } }; },
    today_: function () { return sb._today; }, _today: '2026/11/18',
    UrlFetchApp: {
      fetch: function (url, opt) {
        fetches.push(url);
        if (/\/models\?pageSize/.test(url)) {
          return resp(200, { models: models.map(function (n) { return { name: n, supportedGenerationMethods: ['generateContent'] }; }) });
        }
        return script.shift()(url, opt);
      }
    }
  };
  function resp(code, obj) { return { getResponseCode: function () { return code; }, getContentText: function () { return JSON.stringify(obj); } }; }
  vm.createContext(sb); vm.runInContext(src, sb);
  var okBody = { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] };
  return {
    sb: sb, props: props, sheets: sheets, sleeps: sleeps, fetches: fetches, resp: resp,
    ok: function () { return function () { return resp(200, okBody); }; },
    e429: function (daily, retry) {
      return function () {
        var d = [{ '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [{ quotaId: daily ? 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' : 'GenerateRequestsPerMinutePerProjectPerModel-FreeTier' }] }];
        if (retry) d.push({ '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: retry + 's' });
        return resp(429, { error: { message: 'quota', details: d } });
      };
    },
    queue: function () { Array.prototype.slice.call(arguments).forEach(function (f) { script.push(f); }); },
    generated: function () { return fetches.filter(function (u) { return /:generateContent/.test(u); }).map(function (u) { return u.match(/models\/([^:]+):/)[1]; }); }
  };
}
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

t('軽量モデル：flash-lite の安定版（preview でない最新）を選ぶ。メインは今まで通り', function () {
  var e = env(); e.queue(e.ok(), e.ok());
  e.sb.gemini_('s', 'u', null, null, { lite: true });
  e.sb.gemini_('s', 'u', null, null);
  assert.deepStrictEqual(e.generated(), ['gemini-3.6-flash-lite', 'gemini-3.6-flash']);
  assert.strictEqual(e.props.GEMINI_MODEL_LITE_PICK, 'gemini-3.6-flash-lite');
});

t('軽量モデル：GEMINI_MODEL_LITE が設定されていればそれを使う', function () {
  var e = env(); e.props.GEMINI_MODEL_LITE = 'models/my-lite'; e.queue(e.ok());
  e.sb.gemini_('s', 'u', null, null, { lite: true });
  assert.deepStrictEqual(e.generated(), ['my-lite']);
});

t('429（毎分）：5秒→10秒と間隔を空けて再試行し、成功すれば結果を返す', function () {
  var e = env(); e.queue(e.e429(false), e.e429(false), e.ok());
  var r = e.sb.gemini_('s', 'u', null, null);
  assert.strictEqual(r.a, 1);
  assert.deepStrictEqual(e.sleeps, [5, 10]);
  assert.strictEqual(e.generated().length, 3);
});

t('429：Google が待ち時間を指定していればそれに従う（最大20秒）', function () {
  var e = env(); e.queue(e.e429(false, 12), e.e429(false, 60), e.ok());
  e.sb.gemini_('s', 'u', null, null);
  assert.deepStrictEqual(e.sleeps, [12, 20]);
});

t('429（1日の上限）：待たずに、もう一方のモデル（軽量）へ切り替える', function () {
  var e = env(); e.queue(e.e429(true), e.ok());
  var r = e.sb.gemini_('s', 'u', null, null);
  assert.strictEqual(r.a, 1);
  assert.deepStrictEqual(e.sleeps, []);
  assert.deepStrictEqual(e.generated(), ['gemini-3.6-flash', 'gemini-3.6-flash-lite']);
  assert.strictEqual(e.sb.aiModelUsed_, 'gemini-3.6-flash-lite');
});

t('429（1日の上限）が両方のモデルで続く：「1日の無料枠」の案内で失敗する（「利用上限」を含む）', function () {
  var e = env(); e.queue(e.e429(true), e.e429(true));
  assert.throws(function () { e.sb.gemini_('s', 'u', null, null); }, function (er) { return /利用上限/.test(er.message) && /1日/.test(er.message); });
  assert.strictEqual(e.generated().length, 2);
});

t('429（毎分）が続く：やり直しと切替のあと、「1〜2分待って」の案内で失敗する', function () {
  var e = env(); e.queue(e.e429(false), e.e429(false), e.e429(false), e.e429(false), e.e429(false));
  assert.throws(function () { e.sb.gemini_('s', 'u', null, null); }, function (er) { return /利用上限/.test(er.message) && /待って/.test(er.message); });
  assert.ok(e.sleeps.reduce(function (a, b) { return a + b; }, 0) <= 40, '待ち時間が長すぎない');
});

t('429 以外のエラー（キー無効）は、やり直さずそのまま失敗', function () {
  var e = env(); e.queue(function () { return e.resp(403, { error: { message: 'bad key' } }); });
  assert.throws(function () { e.sb.gemini_('s', 'u', null, null); }, /API キーが無効/);
  assert.strictEqual(e.generated().length, 1);
});

t('キャッシュ：同じ日・同じ入力は fn を呼ばず保存済みを返す（cached:true）。force・別入力・別の日は呼ぶ', function () {
  var e = env(), calls = 0;
  function fn() { calls++; return { v: calls }; }
  var a = e.sb.aiCached_('coach', { x: 1 }, false, fn);
  var b = e.sb.aiCached_('coach', { x: 1 }, false, fn);
  assert.strictEqual(calls, 1); assert.strictEqual(b.v, 1); assert.strictEqual(b.cached, true); assert.ok(!a.cached);
  e.sb.aiCached_('coach', { x: 2 }, false, fn); assert.strictEqual(calls, 2);
  var f = e.sb.aiCached_('coach', { x: 1 }, true, fn); assert.strictEqual(calls, 3); assert.strictEqual(f.v, 3);
  e.sb.aiCached_('now', { x: 1 }, false, fn); assert.strictEqual(calls, 4); // 種別が違えば別
  e.sb._today = '2026/11/19'; e.sb.aiCached_('coach', { x: 1 }, false, fn); assert.strictEqual(calls, 5); // 翌日は当日分ではない
  assert.strictEqual(e.sheets['AIキャッシュ'].rows.length, 1 + 5, '見出し＋5件の保存');
});

t('キャッシュ：force で作り直したあとは、新しい結果が再表示される', function () {
  var e = env(), k = 0;
  function fn() { return { v: ++k }; }
  e.sb.aiCached_('coach', { x: 1 }, false, fn);
  e.sb.aiCached_('coach', { x: 1 }, true, fn);
  assert.strictEqual(e.sb.aiCached_('coach', { x: 1 }, false, fn).v, 2);
});

t('キャッシュ：保存が古くなったら削除して肥大化させない（400行超で古い200行を削る）', function () {
  var e = env();
  for (var i = 0; i < 405; i++) e.sb.aiCached_('k', { i: i }, false, function () { return { i: i }; });
  assert.ok(e.sheets['AIキャッシュ'].rows.length <= 400, '行数 ' + e.sheets['AIキャッシュ'].rows.length);
});

t('キャッシュ：シートやハッシュが使えなくても、そのまま関数を実行して結果を返す（失敗しても止まらない）', function () {
  var e = env();
  e.sb.Utilities.computeDigest = undefined;
  assert.strictEqual(e.sb.aiCached_('coach', { x: 1 }, false, function () { return { v: 7 }; }).v, 7);
});

function body(opt) { return JSON.parse(opt.payload); }
function e400think(e) { return function () { return e.resp(400, { error: { message: 'Unknown name "thinking_level": Cannot find field.' } }); }; }

t('fast：thinkingLevel=low を付けて呼ぶ。通ったら記憶して、次回もそれで始める', function () {
  var e = env(), seen = [];
  e.queue(function (u, o) { seen.push(body(o).generationConfig.thinkingConfig); return e.resp(200, { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }); },
          function (u, o) { seen.push(body(o).generationConfig.thinkingConfig); return e.resp(200, { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }); });
  e.sb.gemini_('s', 'u', null, null, { fast: true }); e.sb.gemini_('s', 'u', null, null, { fast: true });
  assert.deepStrictEqual(seen, [{ thinkingLevel: 'low' }, { thinkingLevel: 'low' }]);
});

t('fast：thinking の指定が通らないモデルは、thinkingBudget → 指定なし の順に切り替え、通った指定を記憶する', function () {
  var e = env(), seen = [];
  function rec(code) { return function (u, o) { seen.push(body(o).generationConfig.thinkingConfig || null); return code === 200 ? e.resp(200, { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }) : e400think(e)(); }; }
  e.queue(rec(400), rec(400), rec(200));
  var r = e.sb.gemini_('s', 'u', null, null, { fast: true });
  assert.strictEqual(r.a, 1);
  assert.deepStrictEqual(seen, [{ thinkingLevel: 'low' }, { thinkingBudget: 512 }, null]);
  assert.strictEqual(e.props['GEMINI_THINK_gemini-3.6-flash'], '2');
  seen.length = 0; e.queue(rec(200));
  e.sb.gemini_('s', 'u', null, null, { fast: true });
  assert.deepStrictEqual(seen, [null], '次回は指定なしから始める（無駄な400を出さない）');
});

t('fast を付けない呼び出し（写真など）は、thinking の指定を付けない', function () {
  var e = env(), cfg;
  e.queue(function (u, o) { cfg = body(o).generationConfig; return e.resp(200, { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }); });
  e.sb.gemini_('s', 'u', null, null);
  assert.ok(!('thinkingConfig' in cfg));
});

t('thinking と無関係の 400（スキーマ非対応）は、これまで通りスキーマ無しでやり直す', function () {
  var e = env(), cfgs = [];
  function r(code) { return function (u, o) { cfgs.push(body(o).generationConfig); return code === 200 ? e.resp(200, { candidates: [{ content: { parts: [{ text: '{"a":1}' }] } }] }) : e.resp(400, { error: { message: 'response schema not supported' } }); }; }
  e.queue(r(400), r(200));
  e.sb.gemini_('s', 'u', { type: 'OBJECT' }, null, { fast: true });
  assert.ok(cfgs[0].responseSchema && !cfgs[1].responseSchema);
  assert.deepStrictEqual(cfgs[1].thinkingConfig, { thinkingLevel: 'low' }, 'thinking は外さない');
});

console.log('\n' + n + ' passed');
