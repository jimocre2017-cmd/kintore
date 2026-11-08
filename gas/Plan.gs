/**
 * 減量計画（目標体脂肪率に対する日・週・月のずれ、次週のカロリー調整）- バックエンド
 * 計算はすべて PlanLib（plan-lib.js のコピー＝PlanLib.gs）で確定し、AI（Gemini）は文章にするだけ。
 * 設定はスクリプトのプロパティ：BODY_GOAL_FAT（目標の体脂肪率・体組成と共通）、PLAN_START、PLAN_WEEKLY_LOSS、PLAN_DEADLINE、PLAN_ACTIVITY
 * シート「減量調整履歴」：次週の調整案の履歴。「採用」が「はい」の行が、その週からの1日の目標カロリーになる
 */

var PLAN_SHEET = '減量調整履歴';
var PLAN_HEAD = ['作成日時', '対象週（月曜）', '状態', '提案kcal', '前回の目標', '採用', '採用kcal', '根拠（JSON）', '助言（JSON）'];

function planSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(PLAN_SHEET);
  if (!sh) {
    sh = ss.insertSheet(PLAN_SHEET);
    sh.getRange(1, 1, 1, PLAN_HEAD.length).setValues([PLAN_HEAD]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(1, 2, sh.getMaxRows(), 1).setNumberFormat('@');
    sh.setColumnWidth(8, 360); sh.setColumnWidth(9, 480);
  }
  return sh;
}

function planSettings_() {
  var p = PropertiesService.getScriptProperties();
  var g = Number(p.getProperty('BODY_GOAL_FAT')) || 0;
  return {
    goalFat: g > 0 ? g : 0,
    startDate: p.getProperty('PLAN_START') || '',
    weeklyLossKg: Number(p.getProperty('PLAN_WEEKLY_LOSS')) || PlanLib.DEFAULTS.weeklyLossKg,
    deadline: p.getProperty('PLAN_DEADLINE') || '',
    activity: Number(p.getProperty('PLAN_ACTIVITY')) || PlanLib.DEFAULTS.activity
  };
}

/** 採用した目標カロリーの履歴 → [{from:'yyyy/MM/dd', kcal}] */
function planTargets_() {
  var sh = planSheet_(), last = sh.getLastRow(), out = [];
  if (last < 2) return out;
  sh.getRange(2, 1, last - 1, PLAN_HEAD.length).getValues().forEach(function (r) {
    if (String(r[5]) === 'はい' && Number(r[6]) > 0) out.push({ from: String(r[1]), kcal: Number(r[6]) });
  });
  return out;
}

function planLatestAdvice_() {
  var sh = planSheet_(), last = sh.getLastRow();
  if (last < 2) return null;
  var r = sh.getRange(last, 1, 1, PLAN_HEAD.length).getValues()[0];
  try {
    return { createdAt: Utilities.formatDate(new Date(r[0]), TZ, 'yyyy/MM/dd HH:mm'), effectiveFrom: String(r[1]), status: String(r[2]), suggested: Number(r[3]), adopted: String(r[5]) === 'はい', adoptedKcal: Number(r[6]) || null, adjust: JSON.parse(r[7] || 'null'), advice: JSON.parse(r[8] || 'null') };
  } catch (e) { return null; }
}

function planGet() {
  var today = today_();
  return { today: today, plan: planSettings_(), defaultStart: PlanLib.nextMonday(today), targets: planTargets_(), latest: planLatestAdvice_() };
}

function planSetDate_(v, label, allowEmpty) {
  var s = String(v || '').trim();
  if (!s && allowEmpty) return '';
  var m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
  if (!m) throw new Error(label + 'の日付が正しくありません');
  return m[1] + '/' + ('0' + m[2]).slice(-2) + '/' + ('0' + m[3]).slice(-2);
}

/** 計画の設定：{goalFat, startDate, weeklyLossKg, deadline, activity} */
function planSet(p) {
  p = p || {};
  var goal = Number(p.goalFat), weekly = Number(p.weeklyLossKg), act = Number(p.activity);
  if (isNaN(goal) || goal < 5 || goal > 40) throw new Error('目標の体脂肪率は5〜40で入力してください');
  var start = planSetDate_(p.startDate, '開始日', false);
  var deadline = planSetDate_(p.deadline, '期限', true);
  if (deadline && toDays_(deadline) <= toDays_(start)) throw new Error('期限は開始日より後にしてください');
  if (isNaN(weekly) || weekly < 0.1 || weekly > 1.0) throw new Error('週あたりの脂肪の減量は0.1〜1.0kgで入力してください');
  if (isNaN(act) || act < 1.2 || act > 2.0) throw new Error('活動係数は1.2〜2.0で入力してください');
  var pr = PropertiesService.getScriptProperties();
  pr.setProperty('BODY_GOAL_FAT', String(Math.round(goal * 10) / 10));
  pr.setProperty('PLAN_START', start);
  pr.setProperty('PLAN_WEEKLY_LOSS', String(Math.round(weekly * 100) / 100));
  pr.setProperty('PLAN_DEADLINE', deadline);
  pr.setProperty('PLAN_ACTIVITY', String(Math.round(act * 100) / 100));
  return planGet();
}

function planView_() {
  var today = today_(), pl = planSettings_(), body = bodyGet(), meal = mealGet();
  return PlanLib.view({ today: today, daily: body.logs, meals: meal.logs, plan: pl, targets: planTargets_(), mealGoalKcal: meal.goals.kcal });
}

function planAdviceSystem_() {
  return [
    'あなたは減量中の人を支えるコーチです。計算はすべて済んでいるので、渡された adjust の数値を使って、来週の目標カロリーの理由と、守りやすい行動を日本語で簡潔に伝えます。',
    '',
    '## 守るルール',
    '- adjust.target（来週の1日の目標kcal）、adjust.weeklyBudget、adjust.deltaFromPrevious、adjust.protein、adjust.floorKcal は決定済み。変更・再計算・別の数値の提案をしない。文中で引用するときはそのまま使う。',
    '- adjust.status：on_track＝計画どおり（目標を維持）、behind＝計画より遅れ、ahead＝計画より速い（筋肉が落ちやすいので緩める）、learning＝実測がまだ足りず計画値で運用、insufficient＝記録不足で調整しない。それぞれに合う言い方にする。',
    '- 遅れの原因は adjust.reasons と実績（adjust.actual、weeks、meals7）から読み取る。摂取が目標より多いのが主因なら「目標は変えず、守る工夫」を書く。目標を下げすぎる提案をしない。',
    '- adjust.leanWarning がある場合は、筋トレの重さ・回数が落ちていないか確認し、たんぱく質を確保するよう伝える。診断はしない。',
    '- 食べ物の例は meals7（実際に食べたもの）を踏まえ、身近な食品・外食・コンビニで選べるものにする。極端な制限や、特定の食品の禁止はしない。',
    '- 食事の記録は概算で、記録の抜けは摂取を少なく見せることを前提にする。細かい数字の差を責めない。',
    '- 週予算（weeklyBudget）の考え方（外食の日があっても他の日で調整できる）を、weeks の最新週の remainingKcal・perDayRemaining があれば使って具体的に伝える。',
    '- 体組成は測れた時に測ればよい。ただし同じ条件（起床後など）が多いほど傾向が正確になることを、必要なら一言添える。',
    '- 診断・医療的な断定をしない。体調不良や強い疲労があれば無理をしないよう伝える。',
    '- 数値は adjust から正確に引用する。データに無いことを断定しない。',
    '',
    '## 出力',
    '- headline：来週の方針を1文（例：来週は1日1,850kcalで計画どおり進めます）。',
    '- summary：今週の振り返りを2〜3文。',
    '- whyTarget：この目標カロリーにした理由を1〜2文。',
    '- actions：来週やることを3つ（title は短く、detail は1〜2文）。',
    '- foodSwaps：置き換えの具体例を最大3つ。',
    '- watch：気をつける点を最大2つ。',
    '- nextCheck：次の見直しまでに揃えたい記録（例：食事を5日以上、体組成を3日以上）を1文。'
  ].join('\n');
}

function planAdviceSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      headline: { type: 'STRING' }, summary: { type: 'STRING' }, whyTarget: { type: 'STRING' },
      actions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, detail: { type: 'STRING' } }, required: ['title', 'detail'] } },
      foodSwaps: { type: 'ARRAY', items: { type: 'STRING' } },
      watch: { type: 'ARRAY', items: { type: 'STRING' } },
      nextCheck: { type: 'STRING' }
    },
    required: ['headline', 'summary', 'whyTarget', 'actions', 'foodSwaps', 'watch', 'nextCheck']
  };
}

function planFixedAdvice_(adj) {
  return {
    headline: '今週は目標を変えず、記録を揃えます',
    summary: (adj.reasons || []).join('。') + '。',
    whyTarget: adj.target ? '調整に必要な記録が足りないため、今の目標（1日' + adj.target + 'kcal）を続けます。' : '調整に必要な記録が足りません。',
    actions: [
      { title: '食事を毎日記録する', detail: '食べたらその場で入力すると抜けにくくなります。記録の抜けは摂取を少なく見せます。' },
      { title: '体組成を測れる日に測る', detail: '時間は生活のリズムで構いません。1日に何回測っても、その日の平均で見ます。' }
    ],
    foodSwaps: [], watch: [], nextCheck: '食事を5日以上、体組成を3日以上そろえると、調整案が出せます。'
  };
}

function planStr_(v, max) { return String(v || '').replace(/\r\n?/g, '\n').trim().slice(0, max); }
function planArr_(v, n, max) { return (v || []).map(function (x) { return planStr_(x, max); }).filter(function (x) { return x; }).slice(0, n); }

/** 次週のカロリー調整案：数値は PlanLib で確定し、Gemini は文章にする。履歴シートに保存する */
function planAdvise() {
  var v = planView_();
  if (!v.configured) throw new Error('先に「計画の設定」で目標の体脂肪率と開始日を決めてください');
  if (v.noBody || !v.adjust) throw new Error('体組成の記録がまだありません');
  var today = v.today, adj = v.adjust, from = PlanLib.nextMonday(today);
  var advice;
  if (adj.status === 'insufficient') {
    advice = planFixedAdvice_(adj);
  } else {
    var meal = mealGet(), since = addDays_(today, -6);
    var meals7 = meal.logs.filter(function (l) { return l.date >= since && l.date <= today; }).map(function (l) {
      return { date: l.date, type: l.type, text: planStr_(l.text, 60), kcal: l.kcal };
    });
    var data = {
      today: today, nextWeekStart: from, adjust: adj,
      plan: { goalFat: v.built.goalFat, deadline: v.built.deadline, weeklyLossKg: PlanLib.r2(v.built.weeklyLossKg), toLoseKg: PlanLib.r1(v.built.toLoseKg) },
      now: v.now ? { fatPct: PlanLib.r1(v.now.fat), plannedFatPct: PlanLib.r1(v.now.plannedFat), gapKg: PlanLib.r2(v.now.gapKg), remainingKg: PlanLib.r1(v.now.remainingKg) } : null,
      weeks: v.weeks.slice(-3), meals7: meals7
    };
    var res = gemini_(planAdviceSystem_(), '# 記録データ（JSON）\n' + JSON.stringify(data), planAdviceSchema_());
    advice = {
      headline: planStr_(res.headline, 200), summary: planStr_(res.summary, 600), whyTarget: planStr_(res.whyTarget, 400),
      actions: (res.actions || []).slice(0, 4).map(function (a) { return { title: planStr_(a.title, 60), detail: planStr_(a.detail, 300) }; }),
      foodSwaps: planArr_(res.foodSwaps, 3, 200), watch: planArr_(res.watch, 2, 200), nextCheck: planStr_(res.nextCheck, 200)
    };
  }
  var createdAt = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm');
  planSheet_().appendRow([new Date(), from, adj.status, adj.target || '', adj.previousTarget || '', '', '', JSON.stringify(adj).slice(0, 45000), JSON.stringify(advice).slice(0, 45000)]);
  return { createdAt: createdAt, effectiveFrom: from, status: adj.status, suggested: adj.target || null, adopted: false, adjust: adj, advice: advice, model: aiModelUsed_ };
}

/** 提案（または手で変えた値）を、次週からの1日の目標カロリーとして採用する。食事画面の目標にも反映する */
function planApply(p) {
  p = p || {};
  var kcal = Math.round(Number(p.kcal)), from = planSetDate_(p.from, '開始週', false);
  if (isNaN(kcal) || kcal < 1000 || kcal > 4500) throw new Error('目標カロリーは1000〜4500で入力してください');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = planSheet_(), last = sh.getLastRow(), row = 0;
    if (last >= 2) {
      var vals = sh.getRange(2, 1, last - 1, PLAN_HEAD.length).getValues();
      for (var i = vals.length - 1; i >= 0; i--) if (String(vals[i][1]) === from) { row = i + 2; break; }
    }
    if (!row) { sh.appendRow([new Date(), from, '手入力', kcal, '', 'はい', kcal, '', '']); }
    else { sh.getRange(row, 6, 1, 2).setValues([['はい', kcal]]); }
    // 食事画面の目標：今日から有効にするため、開始週が今日以前（今週の月曜など）の場合だけ反映する
    var pr = PropertiesService.getScriptProperties();
    if (from <= today_()) {
      pr.setProperty('MEAL_GOAL_KCAL', String(kcal));
    } else {
      pr.setProperty('MEAL_GOAL_KCAL_NEXT', JSON.stringify({ from: from, kcal: kcal }));
    }
    var prot = Number(p.protein);
    if (prot > 0 && !Number(pr.getProperty('MEAL_GOAL_P'))) pr.setProperty('MEAL_GOAL_P', String(Math.round(prot)));
  } finally { lock.releaseLock(); }
  return planGet();
}
