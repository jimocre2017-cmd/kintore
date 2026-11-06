/**
 * 筋トレトラッカー - AIトレーナー（Gemini）
 *
 * Code.gs と同じ Apps Script プロジェクトに「AiTrainer.gs」として追加して使う。
 * 必要なスクリプトプロパティ：
 *   GEMINI_API_KEY … Google AI Studio で発行した API キー（必須。アプリ側には絶対に置かない）
 *   GEMINI_MODEL   … 使うモデル名（任意。空なら利用可能な Flash 系モデルを自動で選ぶ）
 *
 * 流れ：アプリ → aiConsult（記録をまとめて Gemini に相談）→ 提案を表示
 *       → 「プログラムに追加」で aiApplyProgram（タグ設定シート＋種目のタグに書き込み）
 */

var AI_HISTORY_SHEET = 'AI提案履歴';
var AI_TAG_PREFIX = 'AI';

// トレーニング環境（Gemini に渡す前提条件）。器具が増えたらここを書き換える
var AI_PROFILE = [
  '自宅トレーニング。器具：IROTEC 可変式ダンベル（片手 2.5〜20kg、2.5kg 刻み）、フラットベンチ、',
  'トレーニングチューブ2本（1本＝シングル＝低負荷、2本＝ダブル＝高負荷）、可変式ハンドグリップ（20〜50kg）、パワーボール。',
  'バーベル・ケーブルマシン・懸垂バーは無い。タブレットで1セットごとに記録している。'
].join('');

var AI_MODES = {
  review: '今月のワークアウトの振り返り',
  focus: '指定した部位の集中強化',
  bulk: 'バルクアップ（筋肥大）'
};

/* ============================================================
 * アプリから呼ぶ API
 * ============================================================ */

/**
 * AIに相談する
 * @param {Object} req { mode:'review'|'focus'|'bulk', focus:[部位グループ], days:週の回数, minutes:1回の分数, note:要望・体調 }
 */
function aiConsult(req) {
  req = req || {};
  var mode = AI_MODES[req.mode] ? req.mode : 'review';
  var focus = (req.focus || []).map(String).filter(function (s) { return s; }).slice(0, 6);
  var days = Math.max(1, Math.min(7, Math.round(num_(req.days)) || 3));
  var minutes = Math.max(10, Math.min(120, Math.round(num_(req.minutes)) || 45));
  var note = String(req.note || '').replace(/\r\n?/g, '\n').trim().slice(0, 500);

  var ctx = aiContext_();
  var exIds = {};
  ctx.exercises.forEach(function (e) { exIds[e.id] = e; });

  var user = [
    '# 相談内容',
    '目的：' + AI_MODES[mode],
    focus.length ? '集中したい部位：' + focus.join('・') : '集中したい部位：指定なし（記録から判断）',
    '週のトレーニング回数：' + days + '回',
    '1回あたりの時間：' + minutes + '分',
    note ? '要望・体調：' + note : '要望・体調：特になし',
    '',
    '# トレーニング環境',
    AI_PROFILE,
    '',
    '# 記録データ（JSON）',
    JSON.stringify(ctx.data)
  ].join('\n');

  var res = gemini_(aiSystemPrompt_(), user, aiSchema_());
  var out = aiNormalize_(res, exIds);
  out.mode = mode;
  out.focus = focus;
  out.createdAt = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm');
  out.model = aiModelUsed_;
  aiLog_(mode, focus, days, minutes, note, out);
  return out;
}

/**
 * 提案プログラムを「タグ設定」シートに書き込み、対象種目にタグを付ける
 * 同じ名前のAIプログラムがあれば置き換える
 * @param {Object} prog { name, note, items:[{exId, sets, reps, load, rest, point}] }
 */
function aiApplyProgram(prog) {
  if (!prog || !(prog.items || []).length) throw new Error('プログラムの内容が空です');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensurePrograms_();
    var exs = {};
    getExercises_(true).forEach(function (e) { exs[e.id] = e; });
    var items = prog.items.filter(function (it) { return exs[String(it.exId)]; });
    if (!items.length) throw new Error('プログラムの種目が種目マスタに見つかりません');
    var tag = aiTagName_(prog.name);

    // タグ設定シート：同じタグの行を消して書き直す
    var sh = sheet_(PROG_SHEET);
    var rows = [];
    rows.push([tag, 0, '', '（説明）', String(prog.note || '').slice(0, 1000)]);
    items.forEach(function (it, i) {
      var id = String(it.exId);
      rows.push([tag, i + 1, id, exs[id].name, aiItemNote_(it)]);
    });
    aiRemoveProgRows_(sh, tag);
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, PROG_HEAD.length).setValues(rows);

    // 種目マスタのタグ（T列）：プログラムの種目にだけ付け、外れた種目からは外す
    var keep = {};
    items.forEach(function (it) { keep[String(it.exId)] = 1; });
    aiSetExerciseTag_(tag, keep);
    return { tag: tag, count: items.length };
  } finally {
    lock.releaseLock();
  }
}

/** AIが作ったプログラム（タグ名が AI で始まるもの）を削除する */
function aiDeleteProgram(tag) {
  tag = String(tag || '').trim();
  if (tag.indexOf(AI_TAG_PREFIX) !== 0) throw new Error('AIが作ったプログラムだけ削除できます');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = ss_().getSheetByName(PROG_SHEET);
    if (sh) aiRemoveProgRows_(sh, tag);
    aiSetExerciseTag_(tag, {});
    return { tag: tag };
  } finally {
    lock.releaseLock();
  }
}

/** スプレッドシートのエディタから実行：Gemini につながるか確認する */
function aiTest() {
  var r = gemini_('短く答えてください。', '「接続OK」とだけ JSON の message で返して', {
    type: 'OBJECT', properties: { message: { type: 'STRING' } }, required: ['message']
  });
  Logger.log('モデル：' + aiModelUsed_ + ' / 応答：' + JSON.stringify(r));
  return r;
}

/* ============================================================
 * Gemini に渡す記録データ
 * ============================================================ */

function aiContext_() {
  var today = today_();
  var tp = ymdParts_(today);
  var monthStart = mk_(tp.y, tp.m, 1);
  var from = addDays_(today, -55); // 直近8週
  if (monthStart < from) from = monthStart;
  var gmap = partGroupMap_();
  var exercises = getExercises_(false);
  var logs = getLogs_(from, today);

  // 種目ごとの実績
  var byEx = {};
  logs.forEach(function (l) {
    var s = byEx[l.exId] = byEx[l.exId] || { dates: {}, sets: 0, last: '', lastSets: [], bestLoad: 0, bestReps: 0 };
    s.dates[l.date] = 1; s.sets++;
    if (l.date > s.last) { s.last = l.date; s.lastSets = []; }
    if (l.date === s.last) s.lastSets.push(aiSetText_(l));
    if (l.load > s.bestLoad || (l.load === s.bestLoad && l.reps > s.bestReps)) { s.bestLoad = l.load; s.bestReps = l.reps; }
  });

  var exList = exercises.map(function (e) {
    var s = byEx[e.id];
    var o = {
      id: e.id, name: e.name, part: e.part, group: gmap[e.part] || 'その他', equipment: e.equipment,
      measure: e.measure, loadType: e.loadType
    };
    if (e.loadType === 'kg' || e.loadType === '加重') { o.loadRange = e.min + '〜' + e.max + 'kg（' + (e.step || 2.5) + '刻み' + (e.wMult > 1 ? '・片手の重さ' : '') + '）'; }
    if (e.loadType === '強度固定') o.intensity = e.equipment === 'チューブ' ? 'シングル／ダブルを選択' : e.intensity;
    if (e.rMult > 1) o.side = '左右それぞれ';
    if (e.secondary.length) o.secondary = e.secondary;
    if (e.progOnly) o.programOnly = true;
    if (s) {
      o.recent = { days: Object.keys(s.dates).length, sets: s.sets, lastDate: s.last, lastSets: s.lastSets.slice(0, 8) };
      if (s.bestLoad) o.recent.best = s.bestLoad + 'kg×' + s.bestReps;
    }
    return o;
  });

  // 部位グループ別：週ごとのセット数（付随部位は0.5換算）
  var weekStart = addDays_(today, -((dow_(today) + 6) % 7)); // 今週の月曜
  var weeks = [];
  for (var w = 7; w >= 0; w--) weeks.push(addDays_(weekStart, -7 * w));
  var weekly = {}, month = {};
  logs.forEach(function (l) {
    partShares_(l).forEach(function (sh) {
      var g = gmap[sh.part] || 'その他';
      var wi = -1;
      for (var i = weeks.length - 1; i >= 0; i--) if (l.date >= weeks[i]) { wi = i; break; }
      if (wi >= 0) {
        var arr = weekly[g] = weekly[g] || weeks.map(function () { return 0; });
        arr[wi] = r1_(arr[wi] + sh.w);
      }
      if (l.date >= monthStart) {
        var m = month[g] = month[g] || { sets: 0, reps: 0, vol: 0 };
        m.sets = r1_(m.sets + sh.w); m.reps = r1_(m.reps + l.aReps * sh.w); m.vol = r1_(m.vol + l.vol * sh.w);
      }
    });
  });

  var trainDays = {}, monthDays = {};
  logs.forEach(function (l) { trainDays[l.date] = 1; if (l.date >= monthStart) monthDays[l.date] = 1; });

  var memos = logs.filter(function (l) { return String(l.memo).trim(); }).slice(-25).map(function (l) {
    return l.date + ' ' + l.exName + '：' + String(l.memo).trim().slice(0, 120);
  });

  return {
    exercises: exercises,
    data: {
      today: today,
      thisMonth: { from: monthStart, trainingDays: Object.keys(monthDays).length, byGroup: month },
      last8Weeks: { weekStarts: weeks, trainingDays: Object.keys(trainDays).length, weeklySetsByGroup: weekly },
      exercises: exList,
      recentMemos: memos,
      cardio: aiCardio_(today), // ウォーキング・ランニングの要約（無ければ null）
      body: aiBody_(today), // 体重計の数値の推移（無ければ null）
      meal: aiMeal_(today) // 食事（カロリー・たんぱく質・脂質・炭水化物）の記録（無ければ null）
    }
  };
}

function aiSetText_(l) {
  var load = l.load ? l.load + 'kg×' : (l.intensity ? l.intensity.replace(/（.*?）/, '') + '×' : '');
  return l.secs ? load + l.secs + '秒' : load + l.reps;
}

/* ============================================================
 * プロンプト・出力形式
 * ============================================================ */

function aiSystemPrompt_() {
  return [
    'あなたは自宅トレーニングを指導する経験豊富なパーソナルトレーナーです。ユーザーの記録データを読み、根拠のある具体的な提案をします。',
    '',
    '## 守るルール',
    '- プログラムに入れる種目は、記録データ exercises にある種目 id だけを使う。無い種目を勧めたい場合は advice に「種目マスタに追加すると良い」として書く。',
    '- 重さは各種目の loadRange の範囲と刻みに合わせる。ダンベルは片手の重さで書く。チューブはシングル／ダブルで指定する。自重は「自重」または加重kg。秒で計る種目は秒数で書く。',
    '- 筋肥大の目安：1部位あたり週10〜20セット（記録が少ない部位や再開直後は10前後から）。各部位を週2回以上刺激する。限界の1〜3回手前まで行う。',
    '- レップの目安：多関節種目は6〜12回、単関節・補助種目は10〜20回。休憩は多関節90〜180秒、単関節60〜90秒。',
    '- 漸進性過負荷：前回の記録（lastSets）を基準に、重さ→回数→セット数の順で少しずつ上げる。ダンベル片手20kgの上限に届いた種目は、回数を増やす（〜20回以上）、下ろす動作を3秒かける、片側ずつ行う、休憩を短くする等で負荷を上げる。',
    '- 1回あたりの時間に収まるように組む（1セット約1分＋休憩で概算し、ウォームアップも含める）。',
    '- recentMemos に痛み・違和感の記述があれば、その部位は負荷を下げるか避け、無理をしない内容にする。痛みが続く場合は医療機関への相談を勧める。診断はしない。',
    '- cardio（ウォーキング・ランニング）がある場合は、疲労や回復への影響（脚の日の前後に長いランニングが重なっていないか等）と、継続や空き日数を summary・advice で短く触れる。cardio が null なら触れない。',
    '- body がある場合は、体重だけでなく体脂肪率・骨格筋率の動きと合わせて読み、日々の変動は誤差として扱う。診断はしない。body が null なら触れない。',
    '- body.plan がある場合は、専属のカイロプラクター・リハビリ担当の視点で、目標の体脂肪率に向けた分析を summary・findings・advice に入れる：①除脂肪体重と体脂肪量、目標体重、落とす脂肪量（plan の数値をそのまま引用。自分で計算し直さない）②scenarios の各ペース（月あたりの減少量と到達までの月数）を比べ、筋肉を守れる安全なペースを勧める（過度な制限は勧めない）③内臓脂肪レベルの目安（オムロン表示で10〜14は標準の上限〜やや高め）と有酸素への反応④毎日歩く場合の足首・股関節などへの着地負荷と、入浴後のセルフケア（足裏のボール転がし、ふくらはぎのストレッチ等）⑤減量中は筋力トレーニングの高強度刺激を維持し、たんぱく質を確保する。⑥食事の状況（糖質・脂質・お酒など）は data に無いので推測せず、advice の最後に1点だけ確認として尋ねる。plan が null なら目標未設定なので、目標体脂肪率を設定すると試算できると一言だけ添える。',
    '- body.comparisons（1週間前・2週間前・1か月前・3か月前・半年前との差）がある場合は、体重・体脂肪率・骨格筋率・基礎代謝・内臓脂肪レベルの変化を期間ごとに比べ、「体重は減ったが筋肉も減っていないか」「脂肪が減って筋肉が保てているか」を読み取って findings に入れる。差はそのまま引用し、短期（1〜2週間）の変化は日内変動の影響が大きいので、1か月以上の傾向を重視する。',
    '- meal（食事の記録）がある場合は、averagePerLoggedDay（記録した日の平均）を goals や body.plan.proteinGramsPerDay と比べる。たんぱく質が目安に足りているか、脂質のエネルギー比（fatEnergyPercent、20〜30%が目安）、摂取カロリーが body.plan の scenarios の前提（食事を今のまま／-300／-500kcal）と合っているかを読み取り、足りない栄養と具体的な食べ物の例（身近な食品・コンビニで買えるもの）を advice に入れる。daysLogged が少ない場合は記録が足りないので断定せず、記録を続けるよう促す。食事の見積もりは概算であることを踏まえ、数値の細かい差を評価しない。食事の記録だけで摂食障害や栄養不足を診断しない。極端に少ない摂取（1日1200kcal未満が続く等）が見えたら、減量を急がず十分に食べるよう勧める。',
    '- 精度のルール：body.plan の各数値（除脂肪体重・目標体重・脂肪量・必要エネルギー・ペース別の月数・たんぱく質量・安全な減量速度）は計算済みなので、そのまま引用して再計算しない。latestRecordDate が today から14日以上前なら、数値が古いと明記する。体重・体脂肪率は日内変動があるので、1回の測定の増減で断定せず、last8Weeks の週平均の傾向で判断する。scenarios の withinSafeRate が false のペースは勧めない。',
    '- 減量・増量の方針は、筋力トレーニングの実績（exercises の recent、weeklySetsByGroup）と結びつけて書く。減量中は、主要なプル・プッシュ・脚の種目の重さと回数が落ちていないかを見る基準（例：前回比で回数が2回以上減ったら減量ペースを緩める）を nextStep に入れる。',
    '- 有酸素の着地負荷（cardioKmLast28Days）が多い場合は、足首・股関節・ふくらはぎのケア（入浴後のストレッチ等）を具体的に1〜2個勧める。recentMemos に足の痛み等があれば強度を下げる。',
    '- データに無いことを推測で断定しない。記録が少ない場合はそう書く。',
    '- 数値は記録データから正確に引用する。',
    '- 日本語で、簡潔に。専門用語には短い説明を添える。',
    '',
    '## 出力',
    '- summary：今月の振り返り（実施日数、よくできている点、偏りや不足している部位）を3〜5文で。',
    '- findings：記録から読み取れる気づきを2〜5個。',
    '- advice：今後の方針を2〜5個。',
    '- program：次回すぐ実施できる1回分のプログラム。name は全角10文字以内の短い名前（空白・記号なし。例：肩集中、上半身バルクA）。note は準備・全体の注意点。items は実施順に並べる。',
    '- nextStep：次回以降、どうなったら重さや回数を上げるかの基準。'
  ].join('\n');
}

function aiSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      summary: { type: 'STRING' },
      findings: { type: 'ARRAY', items: { type: 'STRING' } },
      advice: { type: 'ARRAY', items: { type: 'STRING' } },
      program: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          note: { type: 'STRING' },
          items: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                exId: { type: 'STRING' },
                sets: { type: 'INTEGER' },
                reps: { type: 'STRING', description: '例：8〜12回、30秒' },
                load: { type: 'STRING', description: '例：片手12.5kg、ダブル、自重' },
                rest: { type: 'INTEGER', description: '休憩秒' },
                point: { type: 'STRING', description: 'フォームや意識するポイント、選んだ理由' }
              },
              required: ['exId', 'sets', 'reps', 'load', 'rest', 'point']
            }
          }
        },
        required: ['name', 'note', 'items']
      },
      nextStep: { type: 'STRING' }
    },
    required: ['summary', 'findings', 'advice', 'program', 'nextStep']
  };
}

/** Gemini の出力を整え、存在しない種目を取り除く */
function aiNormalize_(r, exIds) {
  r = r || {};
  var arr = function (v) { return (v || []).map(String).filter(function (s) { return s.trim(); }).slice(0, 8); };
  var p = r.program || {};
  var dropped = [];
  var items = (p.items || []).filter(function (it) {
    if (it && exIds[String(it.exId)]) return true;
    if (it && it.exId) dropped.push(String(it.exId));
    return false;
  }).slice(0, 15).map(function (it) {
    var e = exIds[String(it.exId)];
    return {
      exId: e.id, name: e.name, part: e.part,
      sets: Math.max(1, Math.min(10, Math.round(num_(it.sets)) || 3)),
      reps: String(it.reps || '').slice(0, 30),
      load: String(it.load || '').slice(0, 30),
      rest: Math.max(0, Math.min(600, Math.round(num_(it.rest)) || 90)),
      point: String(it.point || '').slice(0, 300)
    };
  });
  var advice = arr(r.advice);
  if (dropped.length) advice.push('（記録にない種目の提案は除外しました：' + dropped.join('、') + '）');
  return {
    summary: String(r.summary || ''),
    findings: arr(r.findings),
    advice: advice,
    program: { name: aiTagName_(p.name), note: String(p.note || '').slice(0, 1000), items: items },
    nextStep: String(r.nextStep || '')
  };
}

/** タグ名：AI で始め、空白・区切り記号を除いて短くする（タグは空白・カンマで区切られるため） */
function aiTagName_(name) {
  var n = String(name || '').replace(/^[#＃]+/, '').replace(/[\s,、，#＃]+/g, '').slice(0, 16);
  if (n.indexOf(AI_TAG_PREFIX) === 0) n = n.slice(AI_TAG_PREFIX.length);
  return AI_TAG_PREFIX + (n || 'プログラム');
}

function aiItemNote_(it) {
  var a = [];
  a.push((num_(it.sets) || 3) + 'セット×' + String(it.reps || ''));
  if (it.load) a.push(String(it.load));
  if (it.rest) a.push('休憩' + num_(it.rest) + '秒');
  var s = a.join('・');
  if (it.point) s += '。' + String(it.point);
  return s.slice(0, 500);
}

/* ============================================================
 * シート書き込み
 * ============================================================ */

function aiRemoveProgRows_(sh, tag) {
  var last = sh.getLastRow();
  if (last < 2) return;
  var vals = sh.getRange(2, 1, last - 1, PROG_HEAD.length).getValues();
  var keep = vals.filter(function (r) { return String(r[0]).trim() !== tag; });
  if (keep.length === vals.length) return;
  sh.getRange(2, 1, vals.length, PROG_HEAD.length).clearContent();
  if (keep.length) sh.getRange(2, 1, keep.length, PROG_HEAD.length).setValues(keep);
}

/** 種目マスタT列のタグ：keep にある種目には tag を付け、それ以外からは外す */
function aiSetExerciseTag_(tag, keep) {
  var sh = sheet_(SH.EX), rows = rows_(SH.EX);
  var h = sh.getRange(1, 20);
  if (String(h.getValue()).trim() !== 'タグ') { h.setValue('タグ').setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff'); sh.setColumnWidth(20, 160); }
  if (!rows.length) return;
  var changed = false;
  var col = rows.map(function (r) {
    var id = String(r[0]).trim();
    var tags = splitTags_(r[19]);
    var has = tags.indexOf(tag) >= 0;
    if (id && keep[id] && !has) { tags.push(tag); changed = true; }
    else if (has && !(id && keep[id])) { tags = tags.filter(function (t) { return t !== tag; }); changed = true; }
    return [tags.join(',')];
  });
  if (changed) sh.getRange(2, 20, col.length, 1).setValues(col);
  invalidate_(SH.EX);
}

function aiLog_(mode, focus, days, minutes, note, out) {
  try {
    var ss = ss_();
    var sh = ss.getSheetByName(AI_HISTORY_SHEET);
    if (!sh) {
      sh = ss.insertSheet(AI_HISTORY_SHEET);
      sh.getRange(1, 1, 1, 6).setValues([['日時', '相談内容', '集中部位', '条件', '要望・体調', '提案（JSON）']])
        .setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
      sh.setFrozenRows(1);
      sh.setColumnWidth(6, 480);
    }
    sh.appendRow([new Date(), AI_MODES[mode], focus.join(','), '週' + days + '回・' + minutes + '分', memo_(note), JSON.stringify(out).slice(0, 45000)]);
  } catch (err) {
    // 履歴の保存に失敗しても提案は返す
  }
}

/* ============================================================
 * Gemini 呼び出し
 * ============================================================ */

var GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/';
var aiModelUsed_ = '';

function geminiKey_() {
  var k = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!k) throw new Error('Gemini の API キーが未設定です（スクリプトプロパティ GEMINI_API_KEY）');
  return k;
}

// 自動選択で優先するモデル（上から順に、使えるものを選ぶ）。
// 2026-10 時点：gemini-3.7 / 3.8-flash は Apps Script からの generateContent が応答しないことを確認したため外している
var AI_MODEL_PREFS = ['gemini-3.6-flash', 'gemini-3.5-flash'];

/** 使うモデル：GEMINI_MODEL が設定されていればそれ。無ければ AI_MODEL_PREFS → Flash 系の順で自動選択して記憶 */
function aiModel_(exclude) {
  var pr = PropertiesService.getScriptProperties();
  var fixed = pr.getProperty('GEMINI_MODEL');
  if (fixed) return { name: fixed.replace(/^models\//, ''), auto: false };
  if (pr.getProperty('GEMINI_MODEL_AUTO')) pr.deleteProperty('GEMINI_MODEL_AUTO'); // 旧版の記憶を破棄
  var cached = pr.getProperty('GEMINI_MODEL_PICK');
  if (cached && cached !== exclude) return { name: cached, auto: true };

  var res = UrlFetchApp.fetch(GEMINI_BASE + 'models?pageSize=1000', { headers: { 'x-goog-api-key': geminiKey_() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error(aiHttpError_(res));
  var models = (JSON.parse(res.getContentText()).models || []).filter(function (m) {
    var n = String(m.name || '');
    return (m.supportedGenerationMethods || []).indexOf('generateContent') >= 0 && /gemini/i.test(n) &&
      !/image|tts|audio|live|embed|robot|computer|learnlm|gemma|transcribe|omni/i.test(n) && n.replace(/^models\//, '') !== exclude;
  });
  var names = models.map(function (m) { return String(m.name).replace(/^models\//, ''); });
  var name = AI_MODEL_PREFS.filter(function (n) { return names.indexOf(n) >= 0; })[0];
  if (!name) {
    var score = function (n) {
      var v = (n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1];
      var flash = /flash/i.test(n) && !/lite/i.test(n) ? 2 : /flash/i.test(n) ? 1 : 0;
      var stable = /preview|exp|latest|\d{2}-\d{2}/i.test(n) ? 0 : 1;
      return flash * 10000 + stable * 1000 + Number(v) * 10;
    };
    names.sort(function (a, b) { return score(b) - score(a); });
    name = names[0];
  }
  if (!name) throw new Error('使える Gemini モデルが見つかりません（スクリプトプロパティ GEMINI_MODEL にモデル名を設定してください）');
  pr.setProperty('GEMINI_MODEL_PICK', name);
  return { name: name, auto: true };
}

function gemini_(system, user, schema) {
  var key = geminiKey_();
  var model = aiModel_();
  var useSchema = true;
  for (var attempt = 0; attempt < 3; attempt++) {
    var gen = { responseMimeType: 'application/json' };
    if (useSchema && schema) gen.responseSchema = schema;
    var body = {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user + (useSchema ? '' : '\n\n出力は次の JSON スキーマに従う JSON のみ：' + JSON.stringify(schema)) }] }],
      generationConfig: gen
    };
    var res = UrlFetchApp.fetch(GEMINI_BASE + 'models/' + encodeURIComponent(model.name) + ':generateContent', {
      method: 'post', contentType: 'application/json', headers: { 'x-goog-api-key': key },
      payload: JSON.stringify(body), muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code === 200) {
      aiModelUsed_ = model.name;
      return aiParse_(JSON.parse(res.getContentText()));
    }
    if (code === 404 && model.auto) { model = aiModel_(model.name); continue; } // 自動選択したモデルが廃止された
    if (code === 400 && useSchema) { useSchema = false; continue; }              // スキーマ指定に非対応のモデル
    if ((code === 503 || code === 500) && attempt < 2) { Utilities.sleep(2000 * (attempt + 1)); continue; } // 一時的な混雑：少し待って再試行
    throw new Error(aiHttpError_(res));
  }
  throw new Error('Gemini の呼び出しに失敗しました');
}

function aiParse_(j) {
  var c = (j.candidates || [])[0];
  if (!c) throw new Error('Gemini から応答がありませんでした' + (j.promptFeedback && j.promptFeedback.blockReason ? '（' + j.promptFeedback.blockReason + '）' : ''));
  var text = ((c.content && c.content.parts) || []).filter(function (p) { return p.text && !p.thought; }).map(function (p) { return p.text; }).join('');
  try { return JSON.parse(text); } catch (e) {}
  var m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch (e2) {} }
  throw new Error('Gemini の応答を読み取れませんでした。もう一度お試しください');
}

function aiHttpError_(res) {
  var code = res.getResponseCode(), msg = '';
  try { msg = JSON.parse(res.getContentText()).error.message; } catch (e) { msg = res.getContentText().slice(0, 200); }
  if (code === 429) return 'Gemini の利用上限に達しました。しばらく待ってからお試しください';
  if (code === 401 || code === 403) return 'Gemini の API キーが無効です（スクリプトプロパティ GEMINI_API_KEY を確認してください）';
  return 'Gemini エラー（' + code + '）：' + msg;
}
