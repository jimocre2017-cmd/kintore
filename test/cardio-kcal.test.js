/* 有酸素の消費カロリー：
 *  - サーバー(gas/Cardio.gs)と端末(cardio-lib.js)の式が一致すること
 *  - 記録画面の本日の合計(summarizeDay_)と分析(getAnalytics)に、筋トレ＋有酸素が合算されること
 *  - 端末側(api.js)の本日の合計に、端末にある有酸素と送信待ちが入ること
 * node test/cardio-kcal.test.js */
var vm = require('vm'), fs = require('fs'), path = require('path'), assert = require('assert');
var CardioLib = require('../cardio-lib.js');
var root = path.join(__dirname, '..');

function newCtx(extra) {
  var base = {
    console: console, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number, isNaN: isNaN,
    SpreadsheetApp: { getActiveSpreadsheet: function () { return { getSheetByName: function () { return null; } }; } },
    Utilities: { formatDate: function () { return '2026/11/11'; } }
  };
  Object.keys(extra || {}).forEach(function (k) { base[k] = extra[k]; });
  return vm.createContext(base);
}

var n = 0;
var pending = [];
// 同期テストはその場で、Promise を返すテストは最後まで待って数える
function ok(name, f) {
  var r = f();
  if (r && typeof r.then === 'function') pending.push(r.then(function () { n++; }, function (e) { e.message = '[' + name + '] ' + e.message; throw e; }));
  else n++;
}
function near(a, b, eps, msg) { assert.ok(Math.abs(a - b) <= (eps || 1e-9), (msg || '') + ' ' + a + ' vs ' + b); }

/* ---------- サーバー側（Code.gs + Cardio.gs）を偽のシートで動かす ---------- */
var ctx = newCtx();
vm.runInContext(fs.readFileSync(path.join(root, 'gas', 'Code.gs'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(root, 'gas', 'Cardio.gs'), 'utf8'), ctx);
var rowsByName = {};
ctx.rows_ = function (name) { return rowsByName[name] || []; };
ctx.ensureCardio_ = function () {};

// 有酸素ログの行：ID, 日付, 種類, 記録元, 開始, 終了, 所要分, 距離km, 平均時速, 出発地, 到着地, コースID, ルート種別, 備考, 登録日時, ルート
function crow(id, date, type, start, end, mins, km) {
  return [id, date, type, '手動', start, end, mins, km, '', '', '', '', 'なし', '', '', ''];
}

ok('MET：表の点はそのまま、間は線形補間、両端は頭打ち', function () {
  near(ctx.cardioMetOf_('ウォーキング', 4.8), 3.5);
  near(ctx.cardioMetOf_('ウォーキング', 5.0), 3.7, 1e-9);
  near(ctx.cardioMetOf_('ウォーキング', 6.4), 5.0);
  near(ctx.cardioMetOf_('ウォーキング', 1.0), 2.3); // 遅すぎる時は最小
  near(ctx.cardioMetOf_('ランニング', 8.0), 8.3);
  near(ctx.cardioMetOf_('ランニング', 10.5), 9.8 + (11.0 - 9.8) * (10.5 - 9.7) / (11.3 - 9.7), 1e-9);
  near(ctx.cardioMetOf_('ランニング', 25), 19.0); // 速すぎる時は最大
});

ok('kcal：ウォーキング5km/h×60分×70kg ＝ 259、ランニング10km/h×60分×70kg ＝ 702', function () {
  assert.strictEqual(ctx.cardioKcalOf_({ type: 'ウォーキング', km: 5, mins: 60 }, {}, 70), 259);
  assert.strictEqual(ctx.cardioKcalOf_({ type: 'ランニング', km: 10, mins: 60 }, {}, 70), 702);
});

ok('距離か時間が欠けた記録は既定時速で補う。両方無ければ0', function () {
  // 時間なし：2km÷4.8km/h＝25分 → MET3.5×65×25/60
  assert.strictEqual(ctx.cardioKcalOf_({ type: 'ウォーキング', km: 2, mins: 0 }, {}, 65), Math.round(3.5 * 65 * 25 / 60));
  // 距離なし：30分、時速は既定の4.8 → MET3.5
  assert.strictEqual(ctx.cardioKcalOf_({ type: 'ウォーキング', km: 0, mins: 30 }, {}, 65), Math.round(3.5 * 65 * 0.5));
  assert.strictEqual(ctx.cardioKcalOf_({ type: 'ウォーキング', km: 0, mins: 0 }, {}, 65), 0);
  // 設定の既定時速が効く（6.4km/h→MET5.0）
  assert.strictEqual(ctx.cardioKcalOf_({ type: 'ウォーキング', km: 3.2, mins: 0 }, { 'kcal_ウォーキング既定時速': 6.4 }, 70), 175);
});

ok('設定の既定値に有酸素の既定時速が入っている', function () {
  var st = ctx.getSettings_();
  assert.strictEqual(st['kcal_ウォーキング既定時速'], 4.8);
  assert.strictEqual(st['kcal_ランニング既定時速'], 8);
});

ok('サーバー(Cardio.gs)と端末(cardio-lib.js)の結果が全パターンで一致', function () {
  var st = { 'kcal_ウォーキング既定時速': 5, 'kcal_ランニング既定時速': 9 };
  var types = ['ウォーキング', 'ランニング'], kms = [0, 0.5, 1, 2.5, 5, 10, 21.1], mins = [0, 10, 30, 60, 125], ws = [50, 65, 80];
  var cnt = 0;
  types.forEach(function (t) { kms.forEach(function (km) { mins.forEach(function (m) { ws.forEach(function (w) {
    [{}, st].forEach(function (s) {
      var l = { type: t, km: km, mins: m };
      assert.strictEqual(ctx.cardioKcalOf_(l, s, w), CardioLib.kcalOf(l, w, s), JSON.stringify([t, km, m, w, s]));
      cnt++;
    });
  }); }); }); });
  assert.ok(cnt > 400);
});

ok('端末の kcalSum：期間内だけを合計', function () {
  var logs = [
    { date: '2026/11/10', type: 'ウォーキング', km: 5, mins: 60 },
    { date: '2026/11/11', type: 'ウォーキング', km: 5, mins: 60 },
    { date: '2026/11/12', type: 'ウォーキング', km: 5, mins: 60 }
  ];
  assert.strictEqual(CardioLib.kcalSum(logs, '2026/11/10', '2026/11/11', 70), 259 * 2);
});

ok('本日の集計：筋トレ＋有酸素の合計と内訳（summarizeDay_）', function () {
  rowsByName[ctx.CSH.LOG] = [
    crow('c1', '2026/11/11', 'ウォーキング', '07:00', '07:45', 45, 3.6),  // 4.8km/h → MET3.5 → 170.6 → 171
    crow('c2', '2026/11/10', 'ランニング', '07:00', '07:30', 30, 5)       // 別の日
  ];
  var strength = [{ part: '大胸筋', group: '胸', aReps: 15, aSecs: 0, vol: 300, secondary: [] }];
  var st = ctx.getSettings_();
  var ks = Math.round(ctx.kcalOfSet_(15, 0, st, 65));
  var s = ctx.summarizeDay_(strength, '2026/11/11');
  assert.strictEqual(s.total.kcal, ks);            // kcal は従来どおり筋トレ分
  assert.strictEqual(s.total.kcalStrength, ks);
  assert.strictEqual(s.total.kcalCardio, 171);
  assert.strictEqual(s.total.kcalTotal, ks + 171);
  // 筋トレなしの日でも有酸素は入る
  var c = ctx.summarizeDay_([], '2026/11/11');
  assert.strictEqual(c.total.kcalStrength, 0); assert.strictEqual(c.total.kcalTotal, 171);
  // 日付を渡さない従来の呼び方は筋トレだけ（互換）
  var old = ctx.summarizeDay_(strength);
  assert.strictEqual(old.total.kcalCardio, 0); assert.strictEqual(old.total.kcalTotal, ks);
});

ok('分析（日）：合計・筋トレ・有酸素と、その日の有酸素の明細', function () {
  var logs = [{
    row: 2, id: 'r1', at: '2026/11/11 07:10:00', date: '2026/11/11', exId: 'E1', exName: 'ダンベルプレス', part: '大胸筋', group: '胸', equipment: 'ダンベル',
    setNo: 1, load: 10, intensity: '', reps: 10, secs: 0, aReps: 15, aSecs: 0, vol: 300, status: '確定', memo: '', secondary: []
  }];
  ctx.getLogs_ = function () { return logs; };
  var st = ctx.getSettings_();
  var ks = Math.round(ctx.kcalOfSet_(15, 0, st, 65));
  var d = ctx.getAnalytics('day', '2026/11/11');
  assert.strictEqual(d.total.cur.kcalStrength, ks);
  assert.strictEqual(d.total.cur.kcalCardio, 171);
  assert.strictEqual(d.total.cur.kcalTotal, ks + 171);
  assert.strictEqual(d.total.cur.kcal, ks);        // 従来の kcal は筋トレ分のまま
  assert.strictEqual(d.total.cur.cardioCount, 1);
  assert.strictEqual(d.total.cur.cardioMins, 45);
  // 前日（ランニング10km/h×30分 → MET10.025×65×0.5 ＝ 325.8 → 326）
  assert.strictEqual(d.total.prev.kcalCardio, 326);
  assert.strictEqual(d.total.prev.kcalStrength, 0);
  assert.strictEqual(d.cardio.length, 1);
  assert.strictEqual(d.cardio[0].kcal, 171);
  assert.strictEqual(d.cardio[0].type, 'ウォーキング');
});

ok('分析（週）：有酸素だけの日も日計に出る／推移に積み上げ用の kcalS・kcalC', function () {
  var d = ctx.getAnalytics('week', '2026/11/11'); // 月曜始まり：11/09〜11/15
  var dates = d.daily.map(function (r) { return r.date; });
  assert.strictEqual(dates.join(','), '2026/11/11,2026/11/10');
  var cardioOnly = d.daily[1];
  assert.strictEqual(cardioOnly.sets, 0); assert.strictEqual(cardioOnly.kcalS, 0);
  assert.strictEqual(cardioOnly.kcalC, 326); assert.strictEqual(cardioOnly.kcal, 326);
  assert.strictEqual(d.cardio.length, 0); // 日表示以外は明細を返さない
  var t10 = d.trend.filter(function (t) { return t.from === '2026/11/10'; })[0];
  assert.strictEqual(t10.kcalC, 326); assert.strictEqual(t10.kcal, 326);
  assert.strictEqual(d.total.cur.kcalCardio, 171 + 326);
});

ok('Cardio.gs が無い環境でも筋トレ側の集計は動く（有酸素は0）', function () {
  var c2 = newCtx();
  vm.runInContext(fs.readFileSync(path.join(root, 'gas', 'Code.gs'), 'utf8'), c2);
  c2.rows_ = function () { return []; };
  var s = c2.summarizeDay_([{ part: '大胸筋', group: '胸', aReps: 15, aSecs: 0, vol: 300, secondary: [] }], '2026/11/11');
  assert.strictEqual(s.total.kcalCardio, 0);
  assert.strictEqual(s.total.kcalTotal, s.total.kcalStrength);
});

ok('有酸素シートが読めない時は空で返す（筋トレを止めない）', function () {
  var saved = ctx.rows_;
  ctx.rows_ = function () { throw new Error('シートがありません'); };
  assert.strictEqual(ctx.cardioLogsWithKcal_('2026/11/01', '2026/11/30', {}, 65).length, 0);
  ctx.rows_ = saved;
});

/* ---------- 端末側（api.js）：本日の合計に、端末の有酸素と送信待ちが入る ---------- */
ok('端末の本日の合計：筋トレ＋端末の有酸素＋送信待ちの有酸素', function () {
  var mem = {};
  var d0 = new Date(), p2 = function (x) { return ('0' + x).slice(-2); };
  var TODAY = d0.getFullYear() + '/' + p2(d0.getMonth() + 1) + '/' + p2(d0.getDate());
  var win = { addEventListener: function () {}, CardioLib: CardioLib };
  var sandbox = {
    console: console, JSON: JSON, Math: Math, Date: Date, Object: Object, Array: Array, String: String, Number: Number, Promise: Promise, isNaN: isNaN,
    setTimeout: function () { return 0; }, clearTimeout: function () {}, setInterval: function () { return 0; },
    window: win, document: { addEventListener: function () {}, hidden: false },
    location: { hash: '', pathname: '/' }, history: { replaceState: function () {} },
    navigator: { onLine: true },
    localStorage: {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
      key: function (i) { return Object.keys(mem)[i] || null; },
      get length() { return Object.keys(mem).length; }
    }
  };
  var c3 = vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(root, 'api.js'), 'utf8'), c3);
  var set = function (k, v) { mem[k] = JSON.stringify(v); };
  set('kt_init', {
    today: TODAY, exercises: [{ id: 'E1', name: 'ダンベルプレス', part: '大胸筋', secondary: [], measure: '回数', loadType: 'kg', rMult: 1, wMult: 2 }],
    parts: [{ part: '大胸筋', group: '胸' }],
    settings: { 'kcal_動作MET': 6, 'kcal_休憩MET': 2, 'kcal_1レップ秒': 4, 'インターバル秒': 90 },
    kcalWeight: 65, prev: {},
    todaySets: { E1: [{ id: 's1', setNo: 1, load: 10, reps: 10, secs: 0, aReps: 15, aSecs: 0, vol: 300 }] },
    todaySummary: { total: { sets: 1, reps: 15, secs: 0, vol: 300, kcal: 10, kcalStrength: 10, kcalCardio: 0, kcalTotal: 10 }, parts: [] }
  });
  // 端末にある有酸素（ウォーキング 3.6km/45分 → 171）
  set('kt_cardio', { today: TODAY, logs: [{ id: 'c1', date: TODAY, type: 'ウォーキング', km: 3.6, mins: 45, start: '07:00' }], courses: [], places: [] });
  // 送信待ち：ランニング 5km/30分 → 326
  set('kt_queue', [{ qid: 'q1', type: 'cardioSave', entry: { id: 'c9', date: TODAY, type: 'ランニング', km: 5, mins: 30, start: '18:00' } }]);

  var res;
  c3.KT.call('getInitData').then(function (v) { res = v; });
  // Promise は同期的には解決しないので、解決を待つ
  return new Promise(function (resolve, reject) {
    setImmediate(function () {
     try {
      var t = res.todaySummary.total;
      assert.strictEqual(t.kcal, 10);
      assert.strictEqual(t.kcalStrength, 10);
      assert.strictEqual(t.kcalCardio, 171 + 326);
      assert.strictEqual(t.kcalTotal, 10 + 171 + 326);
      // 端末に有酸素のデータが無い時は、サーバーが数えた値をそのまま使う（0にしない）
      delete mem['kt_cardio']; set('kt_queue', [{ qid: 'q2', type: 'interval', secs: 90 }]);
      var init = JSON.parse(mem['kt_init']); init.todaySummary.total.kcalCardio = 250; set('kt_init', init);
      c3.KT.call('getInitData').then(function (v2) {
        assert.strictEqual(v2.todaySummary.total.kcalCardio, 250);
        assert.strictEqual(v2.todaySummary.total.kcalTotal, 10 + 250);
        resolve();
      }).catch(reject);
     } catch (e) { reject(e); }
    });
  });
});

Promise.all(pending).then(function () {
  console.log('\n' + n + ' 件すべて成功');
}, function (e) {
  console.error(e);
  process.exit(1);
});
