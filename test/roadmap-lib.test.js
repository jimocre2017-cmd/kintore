/* node test/roadmap-lib.test.js で実行（外部ライブラリ不要） */
var assert = require('assert');
var R = require('../roadmap-lib.js');
var n = 0;
function t(name, fn) { fn(); n++; console.log('ok  ' + name); }

t('日付からフェーズが決まる', function () {
  assert.strictEqual(R.current('2026/11/18').phase.key, 'recomp');
  assert.strictEqual(R.current('2027/04/30').phase.key, 'recomp');
  assert.strictEqual(R.current('2027/05/01').phase.key, 'leanbulk');
  assert.strictEqual(R.current('2027/06/30').phase.key, 'leanbulk');
  assert.strictEqual(R.current('2027/07/01'), null);
  assert.strictEqual(R.current('2027/04/30').daysLeft, 0);
  assert.strictEqual(R.current('2027/04/20').daysLeft, 10);
});
t('第1期の食事目標は表の範囲の中央を目安にする', function () {
  var g = R.mealGoals(R.ROADMAP.phases[0]);
  assert.deepStrictEqual(g, { kcal: 1730, kcalMin: 1660, kcalMax: 1800, protein: 125, proteinMin: 120, proteinMax: 130, fat: 45, fatMin: 40, fatMax: 50 });
});
t('第2期はたんぱく質・脂質を送らない（今の値を残す）', function () {
  var g = R.mealGoals(R.ROADMAP.phases[1]);
  assert.strictEqual(g.kcalMin, 1950); assert.strictEqual(g.kcalMax, 2100); assert.strictEqual(g.kcal, 2030);
  assert.ok(!('protein' in g) && !('fat' in g));
});
t('目標との差：体脂肪率は下回れば到達、LBMは上回れば到達', function () {
  var p = R.progress(R.ROADMAP.phases[0], { fatPct: 25.0, leanKg: 48.6 });
  assert.deepStrictEqual(p.map(function (x) { return x.key; }), ['fatPct', 'leanKg']);
  assert.strictEqual(p[0].gap, -10); assert.strictEqual(p[0].reached, false);
  assert.strictEqual(p[1].gap, 1.4); assert.strictEqual(p[1].reached, false);
  assert.strictEqual(R.progress(R.ROADMAP.phases[0], { fatPct: 15, leanKg: 50 }).every(function (x) { return x.reached; }), true);
  assert.strictEqual(R.progress(R.ROADMAP.phases[0], {})[0].gap, null);
});
t('食事の平均が範囲の下・中・上のどこか', function () {
  var m = R.mealCheck(R.ROADMAP.phases[0], { kcal: 1500, protein: 125, fat: 60 });
  assert.deepStrictEqual(m.map(function (x) { return x.state; }), ['under', 'in', 'over']);
});
t('AIに渡す要約', function () {
  var b = R.brief('2026/11/20', { fatPct: 25, leanKg: 48.6 }, { kcal: 1700, protein: 110, fat: 45 }, { fat7: null, decision: '' });
  assert.strictEqual(b.nowPhaseKey, 'recomp');
  assert.strictEqual(b.nextPhase.label, '第2期 選択1：リーンバルク仕上げ');
  assert.strictEqual(b.rules.length, 3);
  assert.strictEqual(b.waitingForUserChoice, false);
});
t('直近7日の体脂肪率平均：3日未満は判断しない', function () {
  var d = [{ date: '2027/03/01', fat: 15.4 }, { date: '2027/03/02', fat: 14.8 }, { date: '2027/02/20', fat: 12 }, { date: '2027/03/03', fat: null }];
  assert.strictEqual(R.fat7(d, '2027/03/03'), null);
  d.push({ date: '2027/03/03', fat: 15.0 });
  var f = R.fat7(d, '2027/03/03');
  assert.deepStrictEqual(f, { avg: 15.1, days: 3 }); // 7日より前の12%は入らない
});
t('15%に届いたら選ぶ状態になり、自動では切り替わらない', function () {
  var rd = { avg: 15.0, days: 5 }, no = { avg: 15.2, days: 5 };
  var a = R.resolve('2027/03/10', { fat7: rd, decision: '' });
  assert.strictEqual(a.ready, true); assert.strictEqual(a.needChoice, true); assert.strictEqual(a.phase.key, 'recomp');
  assert.strictEqual(R.resolve('2027/03/10', { fat7: no, decision: '' }).needChoice, false);
  assert.strictEqual(R.resolve('2027/06/01', { fat7: no, decision: '' }).phase.key, 'recomp'); // 日付だけでは第2期にならない
  assert.strictEqual(R.resolve('2027/06/01', { fat7: no, decision: '' }).overdue, true);
});
t('進む／据え置くの選択', function () {
  var rd = { avg: 14.9, days: 7 };
  var adv = R.resolve('2027/03/10', { fat7: rd, decision: 'advance' });
  assert.strictEqual(adv.phase.key, 'leanbulk'); assert.strictEqual(adv.needChoice, false);
  var hold = R.resolve('2027/03/10', { fat7: rd, decision: 'hold' });
  assert.strictEqual(hold.phase.key, 'recomp'); assert.strictEqual(hold.needChoice, false); assert.strictEqual(hold.decision, 'hold');
  assert.strictEqual(R.brief('2027/03/10', {}, null, { fat7: rd, decision: 'hold' }).userChoice, 'hold');
});
t('有酸素：第1期は時速の範囲、第2期は週の回数', function () {
  var logs = [
    { date: '2026/11/17', type: 'ウォーキング', km: 3.6, mins: 40 },   // 5.4 → 範囲内
    { date: '2026/11/18', type: 'ウォーキング', km: 4.0, mins: 40 },   // 6.0 → 速すぎ
    { date: '2026/11/19', type: 'ウォーキング', km: 3.0, mins: 40 },   // 4.5 → 遅め
    { date: '2026/11/12', type: 'ウォーキング', km: 4.0, mins: 40 },   // 7日より前
    { date: '2026/11/19', type: 'ウォーキング', km: 0, mins: 30 }      // 距離なし → 判定なし
  ];
  var c = R.cardioCheck(R.ROADMAP.phases[0], logs, '2026/11/19');
  assert.strictEqual(c.mode, 'speed'); assert.strictEqual(c.sessions.length, 4);
  assert.deepStrictEqual(c.sessions.map(function (x) { return x.state; }), ['in', 'fast', 'slow', null]);
  assert.strictEqual(c.outside, 2);
  var f = R.cardioCheck(R.ROADMAP.phases[1], logs, '2026/11/19');
  assert.strictEqual(f.mode, 'frequency'); assert.strictEqual(f.days, 3); assert.strictEqual(f.state, 'over');
  assert.strictEqual(R.cardioCheck(R.ROADMAP.phases[1], [], '2026/11/19').state, 'under');
});
t('今週のバランス：第1期（減量）', function () {
  var P0 = R.ROADMAP.phases[0];
  var b = R.balance(P0, { meal: { kcal: 1500, protein: 125, fat: 60, carbs: 150 }, sets: { chest: 13, legs: 4 }, cardio: { mode: 'speed', sessions: [{ state: 'fast' }] } });
  var st = {}; b.items.forEach(function (x) { st[x.key] = x.state; });
  assert.deepStrictEqual(st, { kcal: 'under', protein: 'in', fat: 'over', chest: 'over', legs: 'under', cardio: 'over' });
  assert.strictEqual(b.under, 2); assert.strictEqual(b.over, 3); assert.strictEqual(b['in'], 1);
  assert.ok(b.items[0].advice.indexOf('筋量') >= 0);               // 減量期の食事不足は筋量低下の助言
  assert.strictEqual(R.balance(P0, { sets: { chest: 12, legs: 9.6 } }).items.filter(function (x) { return x.key === 'chest' || x.key === 'legs'; }).every(function (x) { return x.state === 'in'; }), true); // 上限の+20%まではちょうど
  assert.strictEqual(R.balance(P0, { sets: { chest: 12.1, legs: 9.7 } }).over, 2);
  assert.strictEqual(R.balance(P0, {}).nodata, 5); // カロリー・たんぱく質・脂質・胸・脚（有酸素はデータなしなら項目に出さない）
});
t('今週のバランス：第2期（増量）は同じ「少ない」でも助言が変わる', function () {
  var P1 = R.ROADMAP.phases[1];
  var b = R.balance(P1, { meal: { kcal: 1700, carbs: 200 }, sets: null, cardio: { mode: 'frequency', min: 1, max: 2, days: 4, state: 'over' } });
  var st = {}; b.items.forEach(function (x) { st[x.key] = x.state; });
  assert.deepStrictEqual(st, { kcal: 'under', carbs: 'under', cardio: 'over' });
  assert.ok(b.items[0].advice.indexOf('増量') >= 0);
  assert.notStrictEqual(b.items[0].advice, R.balance(R.ROADMAP.phases[0], { meal: { kcal: 1500 } }).items[0].advice);
});

(function () {
  var R = require('../roadmap-lib.js'), assert = require('assert'), rd = { avg: 14.9, days: 5 };
  var m = R.resolve('2027/03/10', { fat7: rd, decision: 'maintain' });
  assert.strictEqual(m.phase.key, 'maintain'); assert.strictEqual(m.needChoice, false); assert.strictEqual(m.decision, 'maintain');
  assert.strictEqual(R.resolve('2027/03/10', { fat7: rd, decision: '' }).needChoice, true, '未選択なら選ぶ状態');
  assert.strictEqual(R.ROADMAP.phases.length, 2, '日付で決まる期は2つのまま');
  var b = R.brief('2027/03/10', {}, null, { fat7: rd, decision: 'maintain' });
  assert.strictEqual(b.userChoice, 'maintain'); assert.strictEqual(b.nowPhaseKey, 'maintain');
  assert.deepStrictEqual(R.mealGoals(m.phase).kcal, undefined, '維持期はカロリーを固定しない');
  assert.ok(R.mealGoals(m.phase).protein > 0);
  assert.ok(R.balance(m.phase, { meal: { protein: 125, fat: 45 } }).items.every(function (x) { return x.state === 'in'; }));
  console.log('ok  maintain decision');
})();

(function () {
  var R = require('../roadmap-lib.js'), assert = require('assert');
  var k = function (o) { return R.advice(o).map(function (x) { return x.key; }); };
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 14.9, days: 5 }, decision: '' }), ['choose']);
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 14.6, days: 5 }, decision: 'maintain', planPhase: 'maintain', floorFat: 13 }), ['maint-over'], '最低13＋1.5=14.5を超えたら');
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 14.5, days: 5 }, decision: 'maintain', planPhase: 'maintain', floorFat: 13 }), [], '許容帯の中');
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 12.5, days: 5 }, decision: 'maintain', planPhase: 'maintain', floorFat: 13 }), ['maint-below']);
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 18.1, days: 5 }, decision: 'advance' }), ['bulk-over']);
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: { avg: 17.5, days: 5 }, decision: 'advance' }), []);
  assert.deepStrictEqual(k({ date: '2027/03/10', fat7: null, decision: 'maintain' }), [], '測定が足りないときは出さない');
  assert.strictEqual(R.MAINT_BAND_PCT, 1.5);
  console.log('ok  advice rules');
})();
(function () {
  var a = function (o) { o.date = '2026/11/19'; return R.autoMealGoals(o); };
  // 第1期：カロリーは消費（基礎代謝1400×1.35＝1890）の75〜90%＝1420〜1700。体脂肪率が無いとき、たんぱく質は控えの120〜130g
  var cut = a({ weightKg: 60, bmr: 1400, adoptedKcal: 1600 }).goals;
  assert.deepStrictEqual([cut.kcalMin, cut.kcal, cut.kcalMax, cut.proteinMin, cut.protein, cut.proteinMax], [1420, 1600, 1700, 120, 125, 130], '第1期：消費に連動＋採用カロリー');
  assert.deepStrictEqual([cut.fatMin, cut.fatMax], [40, 52], '脂質はカロリー範囲の中央の20〜30%（下限40g）');
  // 食事画面の脂質の範囲は、計画画面（RoadmapLib.effective）と同じ（採用カロリーがあっても）
  var ef = R.effective(R.ROADMAP.phases[0], { kcal: 1890, bmr: 1400 }, { weightKg: 60 });
  assert.deepStrictEqual([cut.fatMin, cut.fatMax], [ef.fat.min, ef.fat.max], '脂質：食事画面＝計画画面');
  assert.ok(cut.fat >= cut.fatMin && cut.fat <= cut.fatMax);
  assert.strictEqual(a({ weightKg: 60, bmr: 1400, adoptedKcal: 1320 }).goals.kcal, 1420, '採用値が範囲の外なら範囲に収める');
  assert.strictEqual(a({ weightKg: 60, bmr: 1400 }).goals.kcal, 1560, '採用値が無ければ範囲の中央');
  var lp = a({ weightKg: 64.8, fatPct: 25, bmr: 1530, tdeeKcal: 2218, tdeeBasis: 'observed' });
  assert.deepStrictEqual([lp.goals.kcalMin, lp.goals.kcalMax, lp.goals.proteinMin, lp.goals.protein, lp.goals.proteinMax], [1660, 2000, 112, 126, 151], '実測2218kcal→1660〜2000、除脂肪量48.6kg×2.3〜3.1g');
  assert.ok(/2218kcal（記録からの実測）の75〜90%/.test(lp.summary) && /除脂肪量48.6kg/.test(lp.summary), '根拠を要約に出す：' + lp.summary);
  var fl = a({ weightKg: 60, bmr: 1600, tdeeKcal: 1900, tdeeBasis: 'observed' });
  assert.deepStrictEqual([fl.goals.kcalMin, fl.goals.kcalMax], [1600, 1750], '下限は基礎代謝を割らない・幅は最低150kcal');
  assert.ok(/基礎代謝1600kcalで止めています/.test(fl.summary), fl.summary);
  var fb = a({}).goals;
  assert.deepStrictEqual([fb.kcalMin, fb.kcalMax, fb.proteinMin, fb.proteinMax, fb.fatMin, fb.fatMax], [1660, 1800, 120, 130, 40, 50], '消費も体組成も無いときは控えの固定値');
  // 第2期バルク：カロリーは消費（基礎代謝1520×1.35＝2050）の+5〜10%＝2150〜2260、炭水化物は230g〜カロリーの55%
  var bulk = a({ decision: 'advance', weightKg: 60, bmr: 1520, adoptedKcal: 2200, fatPct: 15 }).goals;
  assert.deepStrictEqual([bulk.kcalMin, bulk.kcal, bulk.kcalMax, bulk.proteinMin, bulk.protein, bulk.proteinMax], [2150, 2200, 2260, 96, 108, 132], 'バルク：カロリーは消費に連動、たんぱく質は体重基準');
  assert.ok(bulk.fat >= bulk.fatMin && bulk.fat <= bulk.fatMax, '脂質は残りから逆算して範囲内');
  assert.strictEqual(a({ decision: 'advance', weightKg: 60, bmr: 1520, adoptedKcal: 1950, fatPct: 15 }).goals.kcal, 2150, '古い固定範囲の採用値は消費連動の下限に引き上げる');
  var top = a({ decision: 'advance', weightKg: 60, bmr: 1520, adoptedKcal: 2260, fatPct: 15 }).goals;
  assert.ok(top.fat <= top.fatMax, '脂質は上限(30%)まで');
  var nobody = a({ decision: 'advance', weightKg: 60, fatPct: 15, adoptedKcal: 2000 }).goals;
  assert.deepStrictEqual([nobody.kcalMin, nobody.kcalMax], [1950, 2100], '消費が分からないときは控えの固定範囲');
  var hi = a({ decision: 'advance', weightKg: 70, bmr: 1520, adoptedKcal: 2000, fatPct: 22 }).goals;
  assert.deepStrictEqual([hi.proteinMin, hi.protein, hi.proteinMax], [109, 120, 137], '体脂肪率20%以上は除脂肪量基準（70kg×78%＝54.6kg）');
  assert.strictEqual(a({ decision: 'advance', weightKg: 70, bmr: 1520, adoptedKcal: 2000, fat7: { avg: 15, days: 5 }, fatPct: 22 }).goals.protein, 126, '7日平均の体脂肪率があればそれを使う');
  var mt = a({ decision: 'maintain', weightKg: 60, bmr: 1400, adoptedKcal: 1700 }).goals;
  assert.deepStrictEqual([mt.kcalMin, mt.kcal, mt.kcalMax, mt.protein, mt.fat], [1740, 1890, 2040, 125, 45], '維持：基礎代謝×1.35±150（古い採用値は使わない）');
  assert.strictEqual(a({ planPhase: 'maintain', weightKg: 60, bmr: 1520 }).goals.kcal, 2050, '減量計画が維持期でも維持');
  var none = a({ decision: 'maintain' }).goals;
  assert.strictEqual(none.kcal, undefined, '体組成が無い維持期はカロリーを出さない（今の値を残す）');
  assert.strictEqual(none.protein, 125);
  assert.strictEqual(a({ decision: 'hold', weightKg: 60, bmr: 1400 }).phaseKey, 'recomp', '据え置きは第1期');
  console.log('ok  autoMealGoals');
})();
(function () {
  // 消費カロリー・たんぱく質・計画の点検（全画面で共通の計算）
  assert.deepStrictEqual(R.energy({ bmr: 1530 }), { kcal: 2070, basis: 'estimated', activity: 1.35, bmr: 1530 }, '基礎代謝も返す（範囲の下限に使う）');
  assert.deepStrictEqual(R.energy({ bmr: 1530, tdeeKcal: 2010, tdeeBasis: 'observed' }), { kcal: 2010, basis: 'observed', bmr: 1530 }, '実測があれば実測');
  assert.strictEqual(R.energy({}), null);
  assert.deepStrictEqual(R.adjustCfg('', 'cut', null, { weightKg: 64.8, fatPct: 25 }).protein, { min: 112, target: 126, max: 151 }, '第1期は除脂肪量（64.8kg×75%＝48.6kg）×2.3〜3.1g');
  assert.deepStrictEqual(R.adjustCfg('', 'cut').protein, { min: 120, target: 125, max: 130 }, '体組成が無ければ控えの範囲');
  assert.deepStrictEqual([R.adjustCfg('', 'cut', null, {}, { kcal: 2218 }).kcalMin, R.adjustCfg('', 'cut', null, {}, { kcal: 2218 }).kcalMax], [1660, 2000], '第1期のカロリー範囲も消費に連動');
  assert.deepStrictEqual(R.adjustCfg('advance', 'cut', null, { weightKg: 60, fatPct: 15 }).protein, { min: 96, target: 108, max: 132 }, 'バルクは体組成から（食事の目標と同じ）');
  assert.strictEqual(R.adjustCfg('advance', 'cut').protein, null);
  var mt = R.autoMealGoals({ date: '2026/11/19', decision: 'maintain', bmr: 1530, tdeeKcal: 2010, tdeeBasis: 'observed' }).goals;
  assert.deepStrictEqual([mt.kcalMin, mt.kcal, mt.kcalMax], [1860, 2010, 2160], '維持期は実測の消費を中心に');
  assert.strictEqual(R.autoMealGoals({ date: '2026/11/19', decision: 'maintain', bmr: 1530, adoptedKcal: 1950, adoptedMode: 'maintain' }).goals.kcal, 1950, '減量計画が維持期として採用した値を優先');
  assert.strictEqual(R.autoMealGoals({ date: '2026/11/19', decision: 'maintain', bmr: 1530, adoptedKcal: 1660, adoptedMode: 'cut' }).goals.kcal, 2070, '減量期の採用値は維持期に持ち込まない');
  var c = R.planCheck({ date: '2026/11/19', energy: R.energy({ bmr: 1530 }), state: { weightKg: 64.8, fatPct: 25 } });
  var by = {}; c.forEach(function (x) { by[x.key] = x; });
  assert.strictEqual(by.pace.level, 'ok'); assert.ok(/1710kcal/.test(by.pace.body) && /2027\/04\/20/.test(by.pace.body), by.pace.body);
  assert.strictEqual(by.lean.level, 'info');
  assert.strictEqual(by['bulk-surplus'].level, 'ok', '第2期は消費に連動するので余剰が確保される');
  assert.ok(/2170〜2280/.test(by['bulk-surplus'].body), by['bulk-surplus'].body);
  var ef = R.effective(R.ROADMAP.phases[1], { kcal: 2218 });
  assert.deepStrictEqual([ef.kcal.min, ef.kcal.max, ef.carbs.min, ef.carbs.max], [2330, 2440, 230, 336]);
  assert.strictEqual(R.ROADMAP.phases[1].kcal.max, 2100, '元の表は書き換えない');
  var e1 = R.effective(R.ROADMAP.phases[0], { kcal: 2218 });
  assert.deepStrictEqual([e1.kcal.min, e1.kcal.max, e1.fat.min, e1.fat.max], [1660, 2000, 41, 61], '第1期：消費の75〜90%、脂質は中央1830kcalの20〜30%');
  assert.strictEqual(R.effective(R.ROADMAP.phases[0], null), R.ROADMAP.phases[0], '消費も体組成も無ければ元の表のまま');
  assert.strictEqual(R.ROADMAP.phases[0].kcal.max, 1800, '元の表（控え）は書き換えない');
  assert.strictEqual(R.kcalRuleText(R.ROADMAP.phases[0]), '消費の75〜90%（不足10〜25%）');
  assert.strictEqual(R.kcalRuleText(R.ROADMAP.phases[1]), '消費の+5〜10%');
  assert.deepStrictEqual([R.adjustCfg('advance', 'cut', null, {}, { kcal: 2218 }).kcalMin, R.adjustCfg('advance', 'cut', null, {}, { kcal: 2218 }).kcalMax], [2330, 2440]);
  var late = R.planCheck({ date: '2026/11/19', energy: { kcal: 1750, basis: 'observed', bmr: 1600 }, state: { weightKg: 64.8, fatPct: 25 } }).filter(function (x) { return x.key === 'pace'; })[0];
  assert.strictEqual(late.level, 'warn', '消費が基礎代謝に近く、範囲の下限が止まると期限に間に合わない');
  var tight = R.planCheck({ date: '2026/11/19', energy: { kcal: 1700, basis: 'observed', bmr: 1600 }, state: {} }).filter(function (x) { return x.key === 'cut-deficit'; })[0];
  assert.ok(tight && /基礎代謝に近く/.test(tight.body), '基礎代謝で下限が止まり、赤字が小さすぎる');
  assert.ok(!R.planCheck({ date: '2026/11/19', energy: { kcal: 1800, basis: 'observed' }, state: {} }).some(function (x) { return x.key === 'cut-deficit'; }), '消費に連動するので、通常は赤字が確保される');
  assert.ok(R.planCheck({ date: '2026/11/19', energy: { kcal: 2218, basis: 'observed' }, state: {} }).some(function (x) { return x.key === 'cut-range' && /1660〜2000kcal/.test(x.body); }), '第1期の範囲の根拠を点検に出す');
  assert.strictEqual(R.planCheck({ date: '2026/11/19', energy: null })[0].key, 'energy');
  var b = R.brief('2026/11/19', { weightKg: 64.8, fatPct: 25, leanKg: 48.6 }, null, { energy: { kcal: 2070, basis: 'estimated' } });
  assert.ok(b.planCheck && b.planCheck.length >= 2, '総合コーチにも点検結果を渡す');
  console.log('ok  energy / proteinFor / planCheck');
})();
/* ---- 絞り込み期（12%→8%・微増筋） ---- */
t('絞り込み期：選ぶと期になり、日付では入らない。第1期より赤字が小さい', function () {
  var r = R.resolve('2026/12/01', { decision: 'shred', fat7: { avg: 14, days: 5 } });
  assert.strictEqual(r.phase.key, 'shred'); assert.strictEqual(r.needChoice, false); assert.strictEqual(r.overdue, false);
  assert.strictEqual(R.resolve('2026/12/01', { decision: 'shred8' }).phase.key, 'shred8');
  assert.strictEqual(R.resolve('2026/12/01', { decision: '' }).phase.key, 'recomp');
  var en = { kcal: 2200, basis: 'observed', bmr: 1500 }, body = { weightKg: 60, fatPct: 14 };
  var cut = R.effective(R.ROADMAP.phases[0], en, body), sh = R.effective(R.ROADMAP.shredPhase, en, body), s8 = R.effective(R.ROADMAP.shred8Phase, en, body);
  assert.ok(sh.kcal.min > cut.kcal.max - 1 || sh.kcal.min >= cut.kcal.max, '絞り込み期の下限は減量期の上限付近以上：' + sh.kcal.min + ' / ' + cut.kcal.max);
  assert.deepStrictEqual([sh.kcal.min, sh.kcal.max], [1980, 2130]); assert.deepStrictEqual([s8.kcal.min, s8.kcal.max], [2020, 2160]);
  assert.ok(sh.protein.target > cut.protein.target, 'たんぱく質は減量期より高め'); assert.ok(sh.carbs.min >= 160 && !cut.carbs, '炭水化物の下限がある');
  assert.ok(R.ROADMAP.shredPhase.sets.chest.min > R.ROADMAP.phases[0].sets.chest.min && R.ROADMAP.shredPhase.sets.legs.min > R.ROADMAP.phases[0].sets.legs.min, '胸・脚のセットは減量期より多い');
  assert.strictEqual(R.ROADMAP.shredPhase.targets.fatPct, 12); assert.strictEqual(R.ROADMAP.shred8Phase.targets.fatPct, 8);
});
t('絞り込み期：マスタープランのモードと食事の目標', function () {
  var en = { kcal: 2200, basis: 'observed', bmr: 1500 }, body = { weightKg: 60, fatPct: 14 };
  assert.strictEqual(R.adjustCfg('shred', 'cut', null, body, en).mode, 'shred');
  assert.strictEqual(R.adjustCfg('shred8', 'cut', null, body, en).floorFat, 8);
  assert.strictEqual(R.adjustCfg('shred', 'maintain', null, body, en).mode, 'shred', '絞り込みを選べば、計画が維持期の設定でも絞り込み');
  assert.strictEqual(R.adjustCfg('maintain', 'cut', null, body, en).mode, 'maintain');
  var g = R.autoMealGoals({ date: '2026/12/01', decision: 'shred', planPhase: 'cut', weightKg: 60, fatPct: 14, bmr: 1500, tdeeKcal: 2200, tdeeBasis: 'observed' });
  assert.strictEqual(g.phaseKey, 'shred'); assert.strictEqual(g.goals.kcalMin, 1980); assert.strictEqual(g.goals.kcalMax, 2130);
  assert.ok(g.goals.proteinMin >= 125 && g.goals.fatMin >= 40);
});
t('絞り込み期：到達・下がりすぎ・8%の注意を、助言と計画の点検で出す', function () {
  var k = function (a) { return a.map(function (x) { return x.key; }); };
  assert.ok(k(R.advice({ date: '2026/12/01', decision: 'shred', fat7: { avg: 11.9, days: 5 } })).indexOf('shred-reached') >= 0);
  assert.ok(k(R.advice({ date: '2026/12/01', decision: 'shred8', fat7: { avg: 8, days: 5 } })).indexOf('shred8-reached') >= 0);
  assert.ok(k(R.advice({ date: '2026/12/01', decision: 'shred', fat7: { avg: 10.5, days: 5 } })).indexOf('shred-below') >= 0);
  assert.strictEqual(R.advice({ date: '2026/12/01', decision: 'shred', fat7: { avg: 15, days: 5 } }).length, 0, '途中は静か');
  var pc = k(R.planCheck({ date: '2026/12/01', decision: 'shred8', energy: { kcal: 2200, basis: 'observed', bmr: 1500 }, state: { weightKg: 60, fatPct: 14 } }));
  assert.ok(pc.indexOf('shred-range') >= 0 && pc.indexOf('shred-pace') >= 0 && pc.indexOf('shred-lean') >= 0 && pc.indexOf('shred-8warn') >= 0);
  assert.strictEqual(k(R.planCheck({ date: '2026/12/01', decision: 'shred', energy: { kcal: 2200, basis: 'observed', bmr: 1500 }, state: { weightKg: 60, fatPct: 14 } })).indexOf('shred-8warn'), -1, '8%の注意は仕上げのときだけ');
});
t('絞り込み期：今週のバランスと総合コーチへの要約', function () {
  var ph = R.effective(R.ROADMAP.shredPhase, { kcal: 2200, basis: 'observed', bmr: 1500 }, { weightKg: 60, fatPct: 14 });
  var b = R.balance(ph, { meal: { kcal: 1800, protein: 140, fat: 55, carbs: 200 }, sets: { chest: 6, legs: 9 }, cardio: { mode: 'frequency', min: 2, max: 3, days: 4, state: 'over' } });
  var by = {}; b.items.forEach(function (x) { by[x.key] = x; });
  assert.strictEqual(by.kcal.state, 'under'); assert.ok(by.kcal.advice.indexOf('絞り込み期') >= 0);
  assert.strictEqual(by.chest.state, 'under'); assert.strictEqual(by.legs.state, 'in'); assert.strictEqual(by.cardio.state, 'over');
  var br = R.brief('2026/12/01', { weightKg: 60, fatPct: 14, leanKg: 51.6 }, null, { decision: 'shred', energy: { kcal: 2200, basis: 'observed', bmr: 1500 } });
  assert.strictEqual(br.nowPhaseKey, 'shred'); assert.strictEqual(br.targets.fatPct, 12);
});
t('次のステップを選ぶ段階までの案内（第1期→第2期、絞り込み12%→8%）', function () {
  var a = R.approach({ decision: '', fat7: { avg: 18, days: 5 } });
  assert.strictEqual(a.kind, 'cut'); assert.strictEqual(a.goal, 15); assert.strictEqual(a.gap, 3); assert.strictEqual(a.near, false); assert.strictEqual(a.weeks, null);
  var b = R.approach({ decision: '', fat7: { avg: 16.5, days: 5 }, weightKg: 60, lossKgPerWeek: 0.2 });
  assert.strictEqual(b.near, true); assert.ok(b.weeks >= 1 && b.text.indexOf('もうすぐ') >= 0 && b.text.indexOf('週間') >= 0);
  var c = R.approach({ decision: 'shred', fat7: { avg: 11.8, days: 5 } });
  assert.strictEqual(c.reached, true); assert.ok(c.text.indexOf('8%') >= 0);
  var d = R.approach({ decision: 'shred', fat7: { avg: 15, days: 5 }, weightKg: 60, lossKgPerWeek: 0.1 });
  assert.strictEqual(d.near, false); assert.strictEqual(d.kind, 'shred');
  assert.strictEqual(R.approach({ decision: 'maintain', fat7: { avg: 14, days: 5 } }), null);
  assert.strictEqual(R.approach({ decision: 'advance', fat7: { avg: 14, days: 5 } }), null);
  assert.strictEqual(R.approach({ decision: '', fat7: null }), null);
  var k = R.advice({ date: '2026/12/01', decision: 'shred', fat7: { avg: 13.2, days: 5 } }).map(function (x) { return x.key; });
  assert.ok(k.indexOf('approach-shred') >= 0, 'あと2%以内で、選ぶ段階が近いと知らせる');
  assert.strictEqual(R.advice({ date: '2026/12/01', decision: 'shred', fat7: { avg: 14.5, days: 5 } }).length, 0, 'まだ遠いときは静か');
});
t('一貫性：絞り込み中は計画が維持期でも絞り込み扱い・バルクの点検は第1期かバルク中だけ', function () {
  var k = function (a) { return a.map(function (x) { return x.key; }); };
  assert.strictEqual(k(R.advice({ date: '2026/12/01', decision: 'shred', planPhase: 'maintain', floorFat: 15, fat7: { avg: 13, days: 5 } })).indexOf('maint-below'), -1);
  var en = { kcal: 2200, basis: 'observed', bmr: 1500 }, st = { weightKg: 60, fatPct: 14 };
  assert.strictEqual(k(R.planCheck({ date: '2026/12/01', decision: 'shred', energy: en, state: st })).indexOf('bulk-surplus'), -1);
  assert.strictEqual(k(R.planCheck({ date: '2026/12/01', decision: 'maintain', energy: en, state: st })).indexOf('bulk-surplus'), -1);
  assert.ok(k(R.planCheck({ date: '2026/12/01', decision: '', energy: en, state: st })).indexOf('bulk-surplus') >= 0);
  assert.ok(k(R.planCheck({ date: '2026/12/01', decision: 'advance', energy: en, state: st })).indexOf('bulk-surplus') >= 0);
});
console.log(n + ' 件OK');
(function () {
  // 全画面共通の「今の体」：体重＝最新、体脂肪率＝直近7日平均（3日以上）→ 無ければ最新
  var L = [{ date: '2026/11/22', weight: 65, fat: 23.5 }, { date: '2026/11/21', weight: 65.2, fat: 25.5 }, { date: '2026/11/20', weight: 65.4, fat: 26 }];
  var s = R.bodyState(L, '2026/11/22');
  assert.deepStrictEqual([s.weightKg, s.fatPct, s.leanKg, s.fatBasis], [65, 25, 48.8, '7日平均']);
  var s2 = R.bodyState(L.slice(0, 2), '2026/11/22');
  assert.deepStrictEqual([s2.fatPct, s2.fatBasis], [23.5, '最新'], '3日未満は最新');
  assert.deepStrictEqual(R.bodyState([], '2026/11/22'), {});
  // 食事画面（autoMealGoals）と減量計画（adjustCfg）のたんぱく質が一致する
  var en = { kcal: 2218, basis: 'observed', bmr: 1530 };
  var meal = R.autoMealGoals({ date: '2026/11/22', weightKg: s.weightKg, fatPct: 23.5, fat7: R.fat7(L, '2026/11/22'), tdeeKcal: 2218, tdeeBasis: 'observed', bmr: 1530 }).goals;
  var plan = R.adjustCfg('', 'cut', null, s, en).protein;
  assert.deepStrictEqual([meal.proteinMin, meal.proteinMax], [plan.min, plan.max], 'たんぱく質：食事画面＝減量計画');
  console.log('ok  体の状態は全画面で同じ（体脂肪率は7日平均）');
})();
