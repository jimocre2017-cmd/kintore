/**
 * 総合コーチ（ワンクリックAI）- バックエンド
 * 食事・筋トレ・有酸素・体組成・減量計画（目標の体脂肪率と期間）を1回で読み、
 * 「今のペースで間に合うか」を率直に言う。数値は全て GAS 側で確定し、AI（Gemini）は文章にするだけ。
 * 前提：Plan.gs / PlanLib.gs / Body.gs / Meal.gs / Cardio.gs / AiTrainer.gs（gemini_ を使う）が同じプロジェクトにあること。
 * 履歴シート「総合コーチ履歴」：日時・判定・見出し・助言（JSON）。前回の「今日やること」を次回の診断に渡して、守れたかを見る。
 */

var COACH_SHEET = '総合コーチ履歴';
var COACH_HEAD = ['日時', '判定', '見出し', '助言（JSON）'];

function coachSheet_() {
  var ss = ss_(), sh = ss.getSheetByName(COACH_SHEET);
  if (!sh) {
    sh = ss.insertSheet(COACH_SHEET);
    sh.getRange(1, 1, 1, COACH_HEAD.length).setValues([COACH_HEAD]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.setColumnWidth(4, 520);
  }
  return sh;
}

function coachLast_() {
  try {
    var sh = coachSheet_(), last = sh.getLastRow();
    if (last < 2) return null;
    var r = sh.getRange(last, 1, 1, COACH_HEAD.length).getValues()[0];
    var adv = JSON.parse(r[3] || 'null');
    return { at: Utilities.formatDate(new Date(r[0]), TZ, 'yyyy/MM/dd HH:mm'), advice: adv };
  } catch (e) { return null; }
}

/** 直近28日の筋トレ・有酸素の実績（日ごとの消費kcalつき）。読めなければ null */
function coachTraining_(today) {
  try {
    var from = addDays_(today, -27), st = getSettings_(), kw = kcalWeight_();
    var days = {};
    function day(d) { return days[d] = days[d] || { date: d, strengthSets: 0, strengthKcal: 0, cardioKm: 0, cardioKcal: 0 }; }
    getLogs_(from, today).forEach(function (l) {
      var x = day(l.date); x.strengthSets++; x.strengthKcal += kcalOfSet_(l.aReps, l.aSecs, st, kw);
    });
    var cardio = typeof cardioLogsWithKcal_ === 'function' ? cardioLogsWithKcal_(from, today, st, kw) : [];
    cardio.forEach(function (l) { var x = day(l.date); x.cardioKm += l.km || 0; x.cardioKcal += l.kcal || 0; });
    var list = Object.keys(days).sort().map(function (k) {
      var x = days[k];
      return { date: x.date, strengthSets: x.strengthSets, strengthKcal: Math.round(x.strengthKcal), cardioKm: r1_(x.cardioKm), cardioKcal: Math.round(x.cardioKcal) };
    });
    function sum(arr, f) { return arr.reduce(function (a, b) { return a + b[f]; }, 0); }
    var last7 = list.filter(function (x) { return x.date >= addDays_(today, -6); });
    return {
      weightUsedForKcalKg: kw,
      last7Days: {
        strengthDays: last7.filter(function (x) { return x.strengthSets > 0; }).length,
        cardioDays: last7.filter(function (x) { return x.cardioKm > 0 || x.cardioKcal > 0; }).length,
        strengthKcal: Math.round(sum(last7, 'strengthKcal')), cardioKcal: Math.round(sum(last7, 'cardioKcal')), cardioKm: r1_(sum(last7, 'cardioKm'))
      },
      last28Days: {
        strengthDays: list.filter(function (x) { return x.strengthSets > 0; }).length,
        cardioDays: list.filter(function (x) { return x.cardioKm > 0 || x.cardioKcal > 0; }).length,
        strengthKcal: Math.round(sum(list, 'strengthKcal')), cardioKcal: Math.round(sum(list, 'cardioKcal')), cardioKm: r1_(sum(list, 'cardioKm'))
      },
      today: (function () { var t = days[today]; return t ? { strengthSets: t.strengthSets, strengthKcal: Math.round(t.strengthKcal), cardioKm: r1_(t.cardioKm), cardioKcal: Math.round(t.cardioKcal) } : { strengthSets: 0, strengthKcal: 0, cardioKm: 0, cardioKcal: 0 }; })(),
      daily: list.slice(-14),
      note: 'kcalは体重と運動強度(MET)からの概算（安静時の分を含む総消費）。実測ではない'
    };
  } catch (e) { return null; }
}

/** 期限までの必要ペース（確定値）。期限未設定・体組成なしなら null */
function coachDeadline_(v, today, userDeadline) {
  try {
    if (!v || !v.configured || v.noBody || !v.now || !v.built || !v.built.deadline) return null;
    var daysLeft = PlanLib.toDays(v.built.deadline) - PlanLib.toDays(today);
    var remain = v.now.remainingKg, weight = v.now.weight;
    // userSet=false のとき deadline は「週あたりの減量ペースから計算した到達予定日」で、本人が決めた期限ではない
    var out = { deadline: v.built.deadline, userSetDeadline: !!userDeadline, daysLeft: daysLeft, remainingFatKg: PlanLib.r1(remain) };
    if (daysLeft <= 0) { out.expired = true; return out; }
    var perWeek = remain / (daysLeft / 7), safe = weight * 0.01;
    out.requiredFatKgPerWeek = PlanLib.r2(perWeek);
    out.safeMaxKgPerWeek = PlanLib.r2(safe);
    out.requiredDeficitKcalPerDay = Math.round(remain * PlanLib.KCAL_PER_KG / daysLeft);
    out.feasibleWithinSafeRate = perWeek <= safe;
    return out;
  } catch (e) { return null; }
}

function coachData_() {
  var today = today_(), now = Utilities.formatDate(new Date(), TZ, 'HH:mm');
  var pl = planSettings_(), v = null;
  try { v = planView_(); } catch (e) { v = null; }
  var body = aiBody_(today), meal = aiMeal_(today), train = coachTraining_(today);
  var gaps = [];
  if (!body) gaps.push('体組成の記録がありません');
  if (!meal) gaps.push('直近7日の食事の記録がありません');
  else if (meal.daysLogged < 5) gaps.push('食事の記録が直近7日で' + meal.daysLogged + '日分のみ（摂取は実際より少なく見える）');
  if (!train || (!train.last28Days.strengthDays && !train.last28Days.cardioDays)) gaps.push('直近28日の運動記録がありません');
  if (!pl.goalFat) gaps.push('目標の体脂肪率が未設定です');
  if (pl.goalFat && !pl.deadline) gaps.push('目標の期限が未設定です（間に合うかは判定できない）');
  if (pl.goalFat && !pl.startDate) gaps.push('減量計画の開始日が未設定です');

  var plan = null;
  if (v && v.configured && !v.noBody && v.built) {
    plan = {
      goalFat: v.built.goalFat, startDate: pl.startDate, deadline: v.built.deadline || null,
      plannedWeeklyLossKg: PlanLib.r2(v.built.weeklyLossKg), toLoseKgFromStart: PlanLib.r1(v.built.toLoseKg),
      now: v.now ? { fatPct: PlanLib.r1(v.now.fat), plannedFatPct: PlanLib.r1(v.now.plannedFat), gapKgVsPlan: PlanLib.r2(v.now.gapKg), remainingFatKg: PlanLib.r1(v.now.remainingKg) } : null,
      last3Weeks: (v.weeks || []).slice(-3), adjust: v.adjust
    };
  }
  var meals = [];
  try {
    var since = addDays_(today, -2);
    mealGet().logs.forEach(function (l) { if (l.date >= since && l.date <= today) meals.push({ date: l.date, type: l.type, text: String(l.text || '').slice(0, 50), kcal: l.kcal, protein: l.protein }); });
    meals = meals.slice(-30);
  } catch (e) { meals = []; }
  var last = coachLast_();
  return {
    today: today, nowTime: now,
    goal: { goalFatPct: pl.goalFat || null, deadline: pl.deadline || null },
    plan: plan, deadlineCheck: coachDeadline_(v, today, pl.deadline),
    body: body, meal: meal, mealsLast3Days: meals, training: train,
    previous: last && last.advice ? { at: last.at, headline: last.advice.headline, todayActions: (last.advice.todayActions || []).map(function (a) { return a.title; }) } : null,
    dataGaps: gaps
  };
}

function coachSystem_() {
  return [
    'あなたは、目標の体脂肪率と期限に向けて減量中の本人に、遠慮なく本音で伝える専属コーチです。',
    '耳が痛くても必要なことは言う。ただし人格や努力を責めず、事実（数値）と次の一手で語る。慰めで終わらせない。',
    '',
    '## 守るルール',
    '- 数値はすべて渡されたJSONからそのまま引用する。再計算・推測値の追加・別の目標の提案をしない。データに無いことを断定しない。',
    '- 「間に合うか」は deadlineCheck（必要ペース requiredFatKgPerWeek と安全上限 safeMaxKgPerWeek、feasibleWithinSafeRate）と plan.now（計画との差 gapKgVsPlan）で判断する。',
    '  deadlineCheck.userSetDeadline が false のときの deadline は、計画の減量ペースから計算した到達予定日で、本人が決めた期限ではない。「期限」とは呼ばず「今のペースの到達予定日」と言い、期限を決めると判定が正確になると促す。',
    '  期限が安全なペースで間に合わないなら、はっきりそう言い、期限を延ばすか目標を段階に分けることを勧める。無理な食事制限・極端な運動で間に合わせる提案は絶対にしない。',
    '- 食事の記録は概算で、記録の抜けは摂取を少なく見せる。meal.daysLogged が少ないときは、判断が不確かだと明言する。nowTime が昼なら、今日の夕食がまだ無いことを責めない。',
    '- 運動の消費kcalは概算。有酸素と筋トレの「合計」と「内訳」の両方を見て、食事の摂取とのバランスで語る（筋トレの消費は小さいので、減量の主役は食事＋有酸素＋日常の活動だと正直に言ってよい）。',
    '- たんぱく質は body.plan や plan.adjust.protein の目安と比べる。筋肉量（muscle）が落ちている兆候があれば、最優先で警告する。',
    '- 体脂肪率は体重計の推定値で、日々±1%程度ぶれる。1〜2日の増減で一喜一憂させず、週平均の傾向で語る。',
    '- previous があれば、前回の todayActions が実績（食事・運動の記録）から守れていそうかを一言触れる。守れた/守れていないを決めつけず、記録から言える範囲で。',
    '- dataGaps があれば、最後にそれを埋めるよう具体的に促す（判断の精度に直結するため）。',
    '- 診断・医療的断定をしない。強い疲労・痛み・体調不良の記録があれば無理をさせない。',
    '- 日本語。1文は短く。専門用語は避ける。',
    '',
    '## 出力',
    '- verdict：次のいずれか1つ。on_track（間に合う見込み）/ slightly_behind（少し遅れ）/ behind（このままでは間に合わない）/ ahead（速すぎ・筋肉が心配）/ unknown（記録不足で判定不能）。',
    '- headline：判定を一言で断定する見出し（例：「このペースだと期限に2kg届かない。主因は食事」）。40字程度。',
    '- goalCheck：目標と期限に対する現在地を2〜3文。必要ペースと今のペースの差を数値で。',
    '- meal：食事の評価を2文（摂取kcal・たんぱく質・記録の抜け）。',
    '- exercise：運動の評価を2文（筋トレ・有酸素の頻度と合計消費kcal）。',
    '- body：体組成の傾向を1〜2文（体重・体脂肪率・筋肉量の週単位の動き）。',
    '- todayActions：今日〜明日にやることを3つ。title は短く、detail は1〜2文で具体的（身近な食品・時間・距離など）。',
    '- blunt：一番耳が痛いが一番大事なことを1文。',
    '- dataGaps：記録を足すべき点（dataGaps をそのまま・言い換えて）。無ければ空配列。'
  ].join('\n');
}

function coachSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      verdict: { type: 'STRING', enum: ['on_track', 'slightly_behind', 'behind', 'ahead', 'unknown'] },
      headline: { type: 'STRING' }, goalCheck: { type: 'STRING' }, meal: { type: 'STRING' }, exercise: { type: 'STRING' }, body: { type: 'STRING' },
      todayActions: { type: 'ARRAY', items: { type: 'OBJECT', properties: { title: { type: 'STRING' }, detail: { type: 'STRING' } }, required: ['title', 'detail'] } },
      blunt: { type: 'STRING' },
      dataGaps: { type: 'ARRAY', items: { type: 'STRING' } }
    },
    required: ['verdict', 'headline', 'goalCheck', 'meal', 'exercise', 'body', 'todayActions', 'blunt', 'dataGaps']
  };
}

var COACH_VERDICTS = ['on_track', 'slightly_behind', 'behind', 'ahead', 'unknown'];

/** ワンクリックの総合診断。結果を履歴シートに残して返す */
function coachJudge() {
  var data = coachData_();
  var tr0 = data.training, hasTrain = tr0 && (tr0.last28Days.strengthDays || tr0.last28Days.cardioDays);
  if (!data.body && !data.meal && !hasTrain) throw new Error('記録がまだありません。体組成・食事・運動のどれかを記録してから使ってください');
  var res = gemini_(coachSystem_(), '# 記録データ（JSON）\n' + JSON.stringify(data), coachSchema_());
  var out = {
    verdict: COACH_VERDICTS.indexOf(res.verdict) >= 0 ? res.verdict : 'unknown',
    headline: planStr_(res.headline, 120), goalCheck: planStr_(res.goalCheck, 600), meal: planStr_(res.meal, 500),
    exercise: planStr_(res.exercise, 500), body: planStr_(res.body, 400),
    todayActions: (res.todayActions || []).slice(0, 4).map(function (a) { return { title: planStr_(a.title, 60), detail: planStr_(a.detail, 300) }; }),
    blunt: planStr_(res.blunt, 300), dataGaps: planArr_(res.dataGaps, 4, 150)
  };
  var at = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm');
  try { coachSheet_().appendRow([new Date(), out.verdict, out.headline, JSON.stringify(out).slice(0, 45000)]); } catch (e) { /* 履歴の保存に失敗しても診断は返す */ }
  out.createdAt = at; out.model = aiModelUsed_;
  // 画面に出す根拠の数字（AIの文章ではなく確定値）
  var dc = data.deadlineCheck, tr = data.training;
  out.facts = {
    goalFat: data.goal.goalFatPct, deadline: data.goal.deadline, projectedDate: dc && !dc.userSetDeadline ? dc.deadline : null, daysLeft: dc && dc.daysLeft != null ? dc.daysLeft : null,
    remainingFatKg: dc ? dc.remainingFatKg : null, requiredKgPerWeek: dc ? dc.requiredFatKgPerWeek : null, safeMaxKgPerWeek: dc ? dc.safeMaxKgPerWeek : null,
    avgIntakeKcal: data.meal ? data.meal.averagePerLoggedDay.kcal : null, mealDays: data.meal ? data.meal.daysLogged : 0,
    burn7: tr ? { strength: tr.last7Days.strengthKcal, cardio: tr.last7Days.cardioKcal } : null
  };
  return out;
}

/** エディタから実行：AIに渡す前の確定データを確認する */
function coachTest() {
  var d = coachData_();
  Logger.log(JSON.stringify(d).slice(0, 6000));
  return d;
}
