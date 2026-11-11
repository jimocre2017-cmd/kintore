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

/** カルテ：本人が書く、痛み・既往・避けたい動作・リハビリの経過のメモ（スクリプトのプロパティに保存、最大2000字） */
function coachChart_() { return String(PropertiesService.getScriptProperties().getProperty('COACH_CHART') || ''); }
function coachChartGet() { return { text: coachChart_() }; }
function coachChartSet(text) {
  var t = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim();
  if (t.length > 2000) throw new Error('カルテは2000字以内にしてください（現在' + t.length + '字）');
  PropertiesService.getScriptProperties().setProperty('COACH_CHART', t);
  return { text: t };
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
    chart: coachChart_() || null,
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
    '- 役割の分担：あなたの担当は「いま全体としてどうか・期限に間に合うか・今日やること」。来週の1日の目標カロリーを決める（変更を提案する）のは減量計画画面、写真の見た目の評価は「体つき写真」の担当なので、それらは判断しない。必要なら「来週のカロリー調整は計画画面で」「見た目の変化は写真で」と一言だけ促す。',
    '- カルテ（chart）がある場合は、そこに書かれた痛み・既往・避けたい動作を最優先で守る。該当する部位に負担のかかる運動・強度を勧めず、勧める運動は負担の少ない代替にする。カルテに無い痛みを推測しない。痛みが悪化・長引いている記述があれば、無理をさせず専門家への相談を促す。',
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

/* ============================================================
 * 相談（データに基づく質問・テーマ相談）
 * 診断（coachJudge）と同じ確定データを渡し、質問に答える。履歴シート「相談履歴」に残す。
 * ============================================================ */

var ASK_SHEET = '相談履歴';
var ASK_HEAD = ['日時', 'テーマ', '質問', '回答（JSON）'];

// テーマ：キー → [表示名, 質問が空のときの既定の質問, AIへの指示]
var ASK_TOPICS = {
  meal: ['食事の見直し', '直近の食事の記録を見て、目標に向けて見直すポイントを教えて',
    '摂取カロリー・たんぱく質・脂質の比率・記録の抜けを meal と mealsLast3Days から読み、足りない栄養と、身近な食品・コンビニ・外食での具体的な置き換えを出す。食べる量を極端に減らす提案はしない。'],
  plan: ['減量・バルクアップのプラン', '今の状態から、目標に向けたプランを相談したい',
    '本人の目標（goal・plan・deadlineCheck）に沿ってプランを組む。減量なら必要ペースと安全上限、1日の赤字の目安、たんぱく質、運動の配分。バルクアップ（増量）を相談された場合は、一般的な目安（週に体重の0.25〜0.5%程度の増加、+200〜300kcal/日、たんぱく質は体重×1.6〜2.2g）を「一般的な目安」と明記して示し、今の体脂肪率・筋トレ頻度から、いつ減量から切り替えるかの考え方を述べる。切り替え時期は断定せず、条件で示す。'],
  stall: ['体重・体脂肪が動かない（停滞）', '最近、体重や体脂肪率が思うように動かない。原因の候補を教えて',
    'body の週平均の動き、meal の記録日数と平均、training の消費、期間の長さから、停滞の原因の候補を可能性の高い順に2〜4個挙げる。体重は日々±1kg前後ぶれるので、1〜2週間は判断しない。記録の抜けが疑わしい場合はそれを最初に挙げる。'],
  eatout: ['外食・飲み会・旅行の乗り切り方', '外食や飲み会が続く週の、減量を崩さない考え方を教えて',
    'plan.adjust の週予算（weeklyBudget）や週の残り（weeks の remainingKcal）があれば使い、「その日だけで取り返さず、週で調整する」考え方を具体的な数字で示す。飲酒は meal の記録があれば踏まえる。極端な絶食・まとめ食い後の制限は勧めない。'],
  training: ['トレーニング量と回復', '筋トレと有酸素のバランスは今のままでいい？回復は足りてる？',
    'training の筋トレ日数・有酸素日数・消費kcal（合計と内訳）と body の筋肉量の動きから、量が多すぎ／少なすぎ・回復の余裕を読む。減量中は高強度の筋トレを維持しつつ、有酸素は足首・股関節の負担に注意して増やしすぎない。痛みの訴えがあれば無理をさせない。'],
  body: ['体組成の数字の読み方', '体重・体脂肪率・筋肉量の最近の動きを、どう読めばいい？',
    'body の latest・changeSince4WeeksAgo・last8Weeks・comparisons・conditionSummary から、脂肪が減っているか筋肉が保てているかを読む。測定条件（起床後など）が揃っていないときはそれを指摘し、揃えて測る方法を勧める。日内変動を踏まえ、1回の値で断定しない。'],
  condition: ['痛み・コンディション・リハビリ', '今の痛みやコンディションを踏まえて、今日の運動と過ごし方を相談したい',
    'chart（カルテ）と質問に書かれた痛み・違和感を最優先にし、今日の筋トレ・有酸素の可否と強度の目安（避ける動作・代わりの動作）、セルフケアの方向性を、training の直近の量と合わせて示す。診断はしない。鋭い痛み・しびれ・夜間痛・数日続く悪化があれば、運動を控えて整形外科などの受診を勧める。カルテが空で質問にも痛みの記述が無ければ、どこがどう痛むか（いつから・動作・強さ）を最初に聞き返す。'],
  protein: ['たんぱく質の摂り方', 'たんぱく質は足りてる？どう摂ればいい？',
    'meal.averagePerLoggedDay.protein と plan.adjust.protein（または body.plan.proteinGramsPerDay）の目安を比べ、不足なら1日の中でどこで足すか（朝・間食・夕食）を、身近な食品とグラム数で具体的に示す。サプリは記録に無いので推測しない。'],
  free: ['自由相談', '', '質問に直接答える。データで答えられる部分は数値を引用し、データに無いことは「記録に無いので分からない」と言う。']
};
var ASK_ORDER = ['meal', 'plan', 'stall', 'eatout', 'training', 'condition', 'body', 'protein', 'free'];

function askSystem_(topic) {
  return [
    'あなたは、目標の体脂肪率と期限に向けて取り組んでいる本人の相談に、記録データを根拠に答える専属コーチです。率直に、でも責めずに、事実（数値）と次の一手で答える。',
    '',
    '## 守るルール',
    '- 数値は渡されたJSONからそのまま引用する。再計算・推測値の追加をしない。データに無いことを断定しない。一般的な目安を使う場合は「一般的な目安」と明記し、本人のデータの数値と区別する。',
    '- 食事の記録は概算で、記録の抜けは摂取を少なく見せる。meal.daysLogged が少ないときは、判断が不確かだと言う。nowTime が昼なら、今日の夕食が未記録でも責めない。',
    '- 運動のkcalは概算。体脂肪率は日々±1%程度ぶれるので、週平均の傾向で語る。',
    '- カルテ（chart）がある場合は、そこに書かれた痛み・既往・避けたい動作を最優先で守り、該当部位に負担のかかる運動・強度を勧めない（代替を示す）。カルテに無い痛みを推測しない。',
    '- 極端な食事制限・絶食・過度な運動で間に合わせる提案はしない。減量ペースは体重の約1%/週以内。診断・医療的断定をしない。強い疲労・痛み・体調不良があれば無理をさせず、続く場合は専門家への相談を勧める。',
    '- 役割の分担：総合診断は「診断」ボタン、毎週のカロリー調整は減量計画画面、見た目の変化は写真。質問がそれに当たる場合は答えたうえで、そちらも案内する。',
    '- 会話の続きの場合は、history の内容を踏まえて、同じことを繰り返さない。',
    '- 日本語。1文は短く、専門用語は避ける。',
    '',
    '## このテーマの指示（' + ASK_TOPICS[topic][0] + '）',
    ASK_TOPICS[topic][2],
    '',
    '## 出力',
    '- answer：質問への答え。結論を先に、4〜8文。',
    '- points：要点を2〜4個（短く）。',
    '- nextSteps：今日〜今週にやることを最大3つ（具体的に）。',
    '- followups：次に聞くと役に立つ質問を最大3つ（本人の言葉で、1文）。',
    '- dataNote：根拠にしたデータと、足りない記録（無ければ空文字）。'
  ].join('\n');
}

function askSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      answer: { type: 'STRING' },
      points: { type: 'ARRAY', items: { type: 'STRING' } },
      nextSteps: { type: 'ARRAY', items: { type: 'STRING' } },
      followups: { type: 'ARRAY', items: { type: 'STRING' } },
      dataNote: { type: 'STRING' }
    },
    required: ['answer', 'points', 'nextSteps', 'followups', 'dataNote']
  };
}

/** テーマ一覧（画面のボタン用） */
function coachTopics() {
  return ASK_ORDER.map(function (k) { return { key: k, label: ASK_TOPICS[k][0], defaultQuestion: ASK_TOPICS[k][1] }; });
}

/**
 * 相談する
 * @param {Object} req { topic:テーマのキー, question:質問（テーマ指定で空なら既定の質問）, history:[{q, a}]（直近の会話、最大3件） }
 */
function coachAsk(req) {
  req = req || {};
  var topic = ASK_TOPICS[req.topic] ? req.topic : 'free';
  var q = planStr_(req.question, 500) || ASK_TOPICS[topic][1];
  if (q.length < 2) throw new Error('相談したいことを入力するか、テーマを選んでください');
  var hist = (req.history || []).slice(-3).map(function (h) { return { question: planStr_(h && h.q, 300), answer: planStr_(h && h.a, 500) }; });
  var data = coachData_();
  if (!data.body && !data.meal && !(data.training && (data.training.last28Days.strengthDays || data.training.last28Days.cardioDays))) {
    // 記録が無くても、一般的な質問には答える（その旨を dataNote に出させる）
    data.noRecords = true;
  }
  var user = '# 相談\nテーマ：' + ASK_TOPICS[topic][0] + '\n質問：' + q + '\n\n# 会話の履歴（古い順）\n' + JSON.stringify(hist) + '\n\n# 記録データ（JSON）\n' + JSON.stringify(data);
  var res = gemini_(askSystem_(topic), user, askSchema_());
  var out = {
    topic: topic, topicLabel: ASK_TOPICS[topic][0], question: q,
    answer: planStr_(res.answer, 1500), points: planArr_(res.points, 4, 200), nextSteps: planArr_(res.nextSteps, 3, 250),
    followups: planArr_(res.followups, 3, 120), dataNote: planStr_(res.dataNote, 300)
  };
  var at = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm');
  try {
    var ss = ss_(), sh = ss.getSheetByName(ASK_SHEET);
    if (!sh) {
      sh = ss.insertSheet(ASK_SHEET);
      sh.getRange(1, 1, 1, ASK_HEAD.length).setValues([ASK_HEAD]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
      sh.setFrozenRows(1); sh.setColumnWidth(4, 520);
    }
    sh.appendRow([new Date(), ASK_TOPICS[topic][0], q, JSON.stringify(out).slice(0, 45000)]);
  } catch (e) { /* 履歴の保存に失敗しても回答は返す */ }
  out.createdAt = at; out.model = aiModelUsed_;
  return out;
}
