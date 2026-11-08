/**
 * YKトレーニング（山本KID化計画）
 *
 * ・今日のメニューは端末側（yk-lib.js）がルールで決める＝オフラインでも動く。ここ（Apps Script）はその周辺：
 *     ykHistFrom_   … 直近35日の「日付×種目のセット数」を getInitData に載せる（不足度の計算用）
 *     ykAdvise      … 決まったメニューを Gemini が解説し、絞り期→増量期の移行タイミングを助言する（種目・数値は変えない）
 *     ykSetPhase    … フェーズ（0＝絞り期／1＝増量期）を設定シートに保存する
 *     ykInstallTemplate … 固定テンプレート「YKトレーニング」（タグ設定シート＋種目のタグ）を作る（エディタから1回実行）
 * ・目標セット数などは設定シートの YK_ で始まるキー（初回に自動で追加される）
 */

var YK_TAG = 'YKトレーニング';
// 固定テンプレートの並び（肩インナー → 最優先部位 → シルエットの象徴）と目安
var YK_TEMPLATE = [
  ['E009', '肩の準備。軽めで12〜15回×2。引き切ったら肘を外へ回す'],
  ['E014', '肩の準備（フェイスプルと日替わりでも可）。15回×2'],
  ['E001', '胸。8〜12回×3〜4。上限に届いたら重さを一段上げる'],
  ['E041', '胸の上部。8〜12回×3。肩に違和感がある日は外す'],
  ['E018', '前鋸筋。押し切った最後に背中をもう一段押し上げる。10〜15回×2'],
  ['E008', '脚。10〜15回×3〜4。20kgで頭打ちなら3秒かけて下ろす'],
  ['E033', '脚（片脚）。8〜12回×3。足の高さ・片脚化で負荷を上げる'],
  ['E027', '背中。6〜12回×3'],
  ['E042', '背中（オーバーハンド）。肩に違和感がある日は外す'],
  ['E012', '僧帽筋・首回り。10〜15回×3'],
  ['E017', '僧帽筋・肩。T・Wのみ（Yはしない）。10〜12回×2'],
  ['E007', '体幹。6〜12回×3'],
  ['E021', '体幹（側面）。6〜12回×3']
];

/** getInitData 用：今日より前の直近35日を {d:日付, e:種目ID, n:セット数} にまとめる */
function ykHistFrom_(logs, today) {
  var from = addDays_(today, -35), by = {}, out = [];
  (logs || []).forEach(function (l) {
    if (l.date < from || l.date >= today) return;
    var k = l.date + '|' + l.exId;
    if (!by[k]) { by[k] = { d: l.date, e: l.exId, n: 0 }; out.push(by[k]); }
    by[k].n++;
  });
  return out;
}

/** フェーズの保存：0＝絞り期 / 1＝増量期 */
function ykSetPhase(phase) {
  var v = Number(phase) === 1 ? 1 : 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(SH.SETTINGS), all = rows_(SH.SETTINGS), found = false;
    for (var i = 0; i < all.length; i++) {
      if (String(all[i][0]).trim() === 'YK_フェーズ') { sh.getRange(i + 2, 2).setValue(v); found = true; break; }
    }
    if (!found) sh.appendRow(['YK_フェーズ', v, 'YKトレーニング：0＝絞り期／1＝増量期']);
    invalidate_(SH.SETTINGS);
  } finally { lock.releaseLock(); }
  return { phase: v };
}

/* ============================================================
 * AI（Gemini）：解説とフェーズ助言。メニューの中身は変えない
 * ============================================================ */

function ykStr_(v, n) { return String(v === null || v === undefined ? '' : v).replace(/\s+/g, ' ').trim().slice(0, n); }

function ykAdviseSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      headline: { type: 'STRING' },
      why: { type: 'ARRAY', items: { type: 'STRING' } },
      coaching: { type: 'ARRAY', items: { type: 'STRING' } },
      shoulder: { type: 'STRING' },
      phase: {
        type: 'OBJECT',
        properties: { verdict: { type: 'STRING' }, reason: { type: 'STRING' } },
        required: ['verdict', 'reason']
      }
    },
    required: ['headline', 'why', 'coaching', 'shoulder', 'phase']
  };
}

function ykAdviseSystem_() {
  return [
    'あなたは、右肩インピンジメント歴のあるユーザーを見る、経験豊富なパーソナルトレーナー兼リハビリ担当です。',
    'ユーザーの目標は、山本KID徳郁のような「厚い僧帽筋・広背筋・分厚い胸板・強い体幹・スプリンターの下半身」を、絞れた状態で作ることです。',
    '今日のメニューは、アプリがルールで確定済みです（plan）。あなたの役割は、その解説と、絞り期から増量期へ移るタイミングの助言だけです。',
    '',
    '## 守るルール',
    '- plan の種目・セット数・重さ・回数を変更しない。足したり外したりも勧めない（変えたい場合は「肩の状態を『違和感』にする」等、アプリ側の操作を案内する）。',
    '- 数値（セット数・日数・体脂肪率）は与えられた値をそのまま引用し、自分で計算し直さない。',
    '- headline：今日のメニューを一言で（40字以内）。why：なぜこの部位・順番なのかを、areas と reasons の数値を根拠に2〜3点。',
    '- coaching：フォームや意識する点を2〜3点（休憩は多関節90〜180秒、肩の準備は軽く）。ダンベルは片手20kgが上限なので、頭打ちの種目は回数・テンポ・片脚化で上げる。',
    '- shoulder：肩の状態（shoulder）に応じた注意を1〜2文。痛みが続く・夜間痛・腕が上がらない場合はトレーニングを控え、整形外科など医療機関に相談するよう勧める。診断はしない。',
    '- phase：絞り期（phase=cut）から増量期（bulk）へ移るのに適した時期かの助言。verdict は keep_cut / consider_bulk / in_bulk のいずれか。',
    '  consider_bulk にしてよいのは、readiness.ready が true（直近4週のうち胸・脚が目標の9割以上の週が3つ以上＝新しい量に慣れた）で、かつ body があり、体脂肪率が目標に近づいている（body.plan の数値で判断）か、減量の停滞が見える時だけ。',
    '  body が null なら体組成の記録が足りないので keep_cut とし、記録を続けるよう一言添える。増量期（phase=bulk）なら in_bulk とし、体脂肪率の上がり方が速すぎないかを見る。',
    '  reason は根拠の数値を1〜2文で。増量期への移行は本人が決めるので、断定せず「検討」の表現にする。',
    '- 健康状態を診断しない。極端な減量や過度な負荷は勧めない。日本語で、簡潔に。'
  ].join('\n');
}

/**
 * 解説と助言を作る
 * @param {Object} req { plan:{mode,phase,shoulder,estMinutes,areas,items,reasons,warnings}, readiness:{metWeeks,of,ready,weeks} }
 */
function ykAdvise(req) {
  req = req || {};
  var p = req.plan || {};
  if (!(p.items || []).length) throw new Error('メニューが空です');
  var today = today_();
  var plan = {
    mode: p.mode === 'reboot' ? 'reboot' : 'normal',
    phase: p.phase === 'bulk' ? 'bulk' : 'cut',
    shoulder: { ok: 'ok', uneasy: 'uneasy', pain: 'pain' }[p.shoulder] || 'ok',
    estMinutes: Math.round(num_(p.estMinutes)),
    areas: (p.areas || []).slice(0, 6).map(function (a) {
      return { label: ykStr_(a.label, 20), target: num_(a.target), done: num_(a.done), daysSince: a.daysSince === null || a.daysSince === undefined ? null : num_(a.daysSince) };
    }),
    items: (p.items || []).slice(0, 10).map(function (it) {
      return { exId: ykStr_(it.exId, 10), name: ykStr_(it.name, 40), role: it.role === 'warmup' ? 'warmup' : 'main', sets: num_(it.sets), load: num_(it.load), reps: num_(it.reps), note: ykStr_(it.note, 80) };
    }),
    reasons: (p.reasons || []).slice(0, 6).map(function (s) { return ykStr_(s, 120); }),
    warnings: (p.warnings || []).slice(0, 4).map(function (s) { return ykStr_(s, 120); })
  };
  var rd = req.readiness || {};
  var readiness = { metWeeks: num_(rd.metWeeks), of: num_(rd.of) || 4, ready: rd.ready === true, weeks: (rd.weeks || []).slice(0, 4) };
  var body = null;
  try { body = aiBody_(today); } catch (e) { body = null; }

  var user = '# 今日のメニュー（確定済み）と充足度\n' + JSON.stringify({ today: today, plan: plan, readiness: readiness, body: body });
  var res = gemini_(ykAdviseSystem_(), user, ykAdviseSchema_());
  var v = String((res.phase || {}).verdict || '');
  if (['keep_cut', 'consider_bulk', 'in_bulk'].indexOf(v) < 0) v = plan.phase === 'bulk' ? 'in_bulk' : 'keep_cut';
  // 準備度が足りない時にAIが増量期への移行を勧めても採用しない（ルールが先）
  if (v === 'consider_bulk' && !readiness.ready) v = 'keep_cut';
  return {
    createdAt: Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm'),
    headline: ykStr_(res.headline, 80),
    why: (res.why || []).slice(0, 3).map(function (s) { return ykStr_(s, 200); }),
    coaching: (res.coaching || []).slice(0, 3).map(function (s) { return ykStr_(s, 200); }),
    shoulder: ykStr_(res.shoulder, 300),
    phase: { verdict: v, reason: ykStr_((res.phase || {}).reason, 300) },
    model: aiModelUsed_
  };
}

/* ============================================================
 * 固定テンプレート「YKトレーニング」（タグ設定シート＋種目のタグ）
 * エディタから関数 ykInstallTemplate を1回実行する。何度実行しても同じ結果（上書き）
 * ============================================================ */

function ykInstallTemplate() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensurePrograms_();
    var exs = {};
    getExercises_(true).forEach(function (e) { exs[e.id] = e; });
    var found = YK_TEMPLATE.filter(function (t) { return exs[t[0]]; });
    var missing = YK_TEMPLATE.filter(function (t) { return !exs[t[0]]; }).map(function (t) { return t[0]; });
    if (!found.length) throw new Error('種目マスタにテンプレートの種目（E009・E001 など）が見つかりません');
    var sh = sheet_(PROG_SHEET);
    var rows = [[YK_TAG, 0, '', '（説明）', 'YKトレーニング（山本KID化計画）の固定テンプレート。気まぐれな日は、画面最上部の「今日のYK推奨セッション」が不足している部位から自動で組みます。肩の準備（フェイスプル・外旋）→胸・脚→背中・僧帽筋・体幹の順。痛みの出ない範囲で。']];
    found.forEach(function (t, i) { rows.push([YK_TAG, i + 1, t[0], exs[t[0]].name, t[1]]); });
    aiRemoveProgRows_(sh, YK_TAG);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, PROG_HEAD.length).setValues(rows);
    var keep = {};
    found.forEach(function (t) { keep[t[0]] = 1; });
    aiSetExerciseTag_(YK_TAG, keep);
    var msg = '#' + YK_TAG + ' を作りました（' + found.length + '種目）' + (missing.length ? '／種目マスタに無いID：' + missing.join('・') : '');
    Logger.log(msg);
    return { tag: YK_TAG, count: found.length, missing: missing };
  } finally { lock.releaseLock(); }
}

/** エディタから実行：種目IDの実在と、直近の履歴の取り出しを確認する */
function ykTest() {
  var ids = {};
  YK_TEMPLATE.forEach(function (t) { ids[t[0]] = 1; });
  var exs = {};
  getExercises_(true).forEach(function (e) { exs[e.id] = e; });
  var ng = Object.keys(ids).filter(function (id) { return !exs[id]; });
  var logs = getLogs_(addDays_(today_(), -35), today_());
  var hist = ykHistFrom_(logs, today_());
  Logger.log('テンプレートの種目：' + Object.keys(ids).length + '件中、種目マスタに無い：' + (ng.length ? ng.join('・') : 'なし'));
  Logger.log('直近35日の履歴（日付×種目）：' + hist.length + '行');
  Logger.log('設定：' + JSON.stringify(Object.keys(getSettings_()).filter(function (k) { return k.indexOf('YK_') === 0; })));
  return { missing: ng, hist: hist.length };
}
