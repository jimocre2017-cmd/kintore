/**
 * 体組成（体重計の数値）の記録 - バックエンド
 * スプレッドシート：体組成ログ（初回の呼び出し時に自動で作られる）
 * 1日に何回でも測れる（朝・昼・晩など）。1測定＝1行で、ID（と時刻）を持つ。同じIDで保存し直すと上書きされるので、
 * オフライン中の操作を何度送り直しても安全。日ごとの平均は bodyGet が計算して返す（グラフ・比較・AI分析は日平均で見る）。
 * 以前の「1日1件」の行（IDなし）は 'L'+日付 のIDとして扱う。
 * 項目はオムロンの体重計の表示に合わせている（体重・体脂肪率・骨格筋率・BMI・基礎代謝・内臓脂肪レベル）。
 */

var BSH = '体組成ログ';
var BHEAD = ['日付', '体重kg', '体脂肪率%', '骨格筋率%', 'BMI', '基礎代謝kcal', '内臓脂肪レベル', '身長cm', '備考', '登録日時', 'ID', '時刻', 'タイミング', '集計除外'];
// 測定のタイミング・条件（複数選べる）。同じ条件どうしで比べると体重・体脂肪率のブレが小さくなる
var BTAGS = ['起床後', '午前中', '日中', '午後', '夜', '就寝前', '食事前', '食事後', '排便前', '排便後', '運動前', '運動後', '入浴前', '入浴後', '水分補給前', '水分補給後'];
var BODY_READY = false;

function ensureBody_() {
  if (BODY_READY) return;
  var ss = ss_();
  var sh = ss.getSheetByName(BSH), created = false, hadCols = true;
  if (!sh) { sh = ss.insertSheet(BSH); created = true; }
  else hadCols = sh.getLastColumn() >= 13 && String(sh.getRange(1, 13).getValue()) === 'タイミング';
  sh.getRange(1, 1, 1, BHEAD.length).setValues([BHEAD]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  // 日付・登録日時は文字列のまま保存する（シートが日付に自動変換しないように）
  if (created) [1, 10, 11, 12, 13].forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); });
  else if (!hadCols) [11, 12, 13].forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); }); // 旧シートにID・時刻・タイミングの列を足す
  BODY_READY = true;
}

function bNum_(v) { return v === '' || v === null || v === undefined ? null : Number(v); }

// 「集計除外」の列：1・true・"1" なら除外（平均・グラフ・比較・AI分析に使わない）
function bFlag_(v) { return v === 1 || v === true || String(v == null ? '' : v).trim() === '1'; }

function bTime_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
  var m = String(v == null ? '' : v).trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

function bTags_(v) {
  var a = Array.isArray(v) ? v : String(v == null ? '' : v).split(/[,、]/), out = [];
  a.forEach(function (t) { t = String(t).trim(); if (BTAGS.indexOf(t) >= 0 && out.indexOf(t) < 0) out.push(t); });
  return out;
}

function bodyObj_(r) {
  var date = ymd_(r[0]);
  return {
    id: String(r[10] || '') || ('L' + date), time: bTime_(r[11]), tags: bTags_(r[12]), date: date,
    weight: bNum_(r[1]), fat: bNum_(r[2]), muscle: bNum_(r[3]), bmi: bNum_(r[4]),
    bmr: bNum_(r[5]), visceral: bNum_(r[6]), height: bNum_(r[7]), memo: String(r[8] || ''),
    exclude: bFlag_(r[13])
  };
}

function bodySort_(entries) {
  return entries.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.time !== b.time) return a.time < b.time ? 1 : -1;
    return a.id < b.id ? 1 : (a.id > b.id ? -1 : 0);
  });
}

/** 日ごとの平均（body-lib.js の BodyLib.daily と同じ計算）。新しい日が先頭 */
function bodyDaily_(entries, tag) {
  var byDate = {}, order = [], F = ['weight', 'fat', 'muscle', 'bmi', 'bmr', 'visceral'];
  bodySort_(entries.slice()).forEach(function (e) {
    if (e.exclude) return; // 集計から除外した測定は平均に入れない
    if (tag && e.tags.indexOf(tag) < 0) return;
    if (!byDate[e.date]) { byDate[e.date] = []; order.push(e.date); }
    byDate[e.date].push(e);
  });
  return order.map(function (date) {
    var list = byDate[date].slice().reverse(), out = { date: date, count: list.length, height: null, memo: '', range: {} }, memos = [];
    F.forEach(function (f) {
      var vals = list.map(function (e) { return e[f]; }).filter(function (x) { return x !== null; });
      if (!vals.length) { out[f] = null; return; }
      var sum = vals.reduce(function (a, b) { return a + b; }, 0);
      out[f] = f === 'bmr' ? Math.round(sum / vals.length) : r1_(sum / vals.length);
      out.range[f] = [Math.min.apply(null, vals), Math.max.apply(null, vals)];
    });
    list.forEach(function (e) { if (e.height !== null) out.height = e.height; if (e.memo) memos.push(e.memo); });
    out.memo = memos.join(' / ');
    return out;
  });
}

function bodyEntries_() {
  return bodySort_(rows_(BSH).filter(function (r) { return String(r[0]).trim() !== ''; }).map(bodyObj_));
}

// entries＝測定1回ごと（新しい順）、logs＝日ごとの平均（新しい順）
function bodyGet() {
  ensureBody_();
  var entries = bodyEntries_();
  return { today: today_(), entries: entries, logs: bodyDaily_(entries), goalFat: goalFat_(), tags: BTAGS };
}

// 目標の体脂肪率（%）。スクリプトのプロパティに保存。未設定なら 0（目標なし）
function goalFat_() {
  var v = Number(PropertiesService.getScriptProperties().getProperty('BODY_GOAL_FAT'));
  return v > 0 ? v : 0;
}

function bodySetGoal(v) {
  var n = v === '' || v === null || v === undefined ? 0 : Number(v);
  if (isNaN(n) || n < 0 || n > 60) throw new Error('目標の体脂肪率は0〜60で入力してください（0＝目標なし）');
  PropertiesService.getScriptProperties().setProperty('BODY_GOAL_FAT', String(Math.round(n * 10) / 10));
  return n;
}

// 値の検証。空欄は null。範囲外は理由つきでエラー
function bVal_(v, label, min, max, dec) {
  if (v === '' || v === null || v === undefined) return null;
  var n = Number(v);
  if (isNaN(n)) throw new Error(label + 'は数字で入力してください');
  if (n < min || n > max) throw new Error(label + 'は' + min + '〜' + max + 'の範囲で入力してください');
  var k = Math.pow(10, dec);
  return Math.round(n * k) / k;
}

function bodySave(p) {
  ensureBody_();
  p = p || {};
  var date = ymd_(p.date);
  if (!date) throw new Error('日付が正しくありません');
  var id = String(p.id || '').trim() || ('L' + date); // IDなし（旧版の送信待ち）は、その日の旧1件を上書きする
  var time = bTime_(p.time), tags = bTags_(p.tags), exclude = bFlag_(p.exclude);
  if (toDays_(date) > toDays_(today_())) throw new Error('未来の日付は記録できません');
  var weight = bVal_(p.weight, '体重', 20, 300, 2);
  var fat = bVal_(p.fat, '体脂肪率', 1, 70, 1);
  var muscle = bVal_(p.muscle, '骨格筋率', 5, 70, 1);
  var bmr = bVal_(p.bmr, '基礎代謝', 500, 5000, 0);
  var visceral = bVal_(p.visceral, '内臓脂肪レベル', 1, 59, 1);
  var height = bVal_(p.height, '身長', 100, 230, 1);
  var bmi = bVal_(p.bmi, 'BMI', 8, 80, 1);
  if (bmi === null && weight !== null && height !== null) bmi = Math.round(weight / Math.pow(height / 100, 2) * 10) / 10;
  if (weight === null && fat === null && muscle === null && bmr === null && visceral === null) throw new Error('数値を1つ以上入力してください');
  var memo = String(p.memo == null ? '' : p.memo).replace(/\r\n?/g, '\n').trim().slice(0, 300);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(BSH), last = sh.getLastRow(), rowIdx = 0, created = '';
    if (last >= 2) {
      var ds = sh.getRange(2, 1, last - 1, 11).getValues();
      for (var i = 0; i < ds.length; i++) if (bodyObj_(ds[i].concat([''])).id === id) { rowIdx = i + 2; break; }
      if (rowIdx) created = sh.getRange(rowIdx, 10).getValue();
    }
    if (!created) created = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss');
    function c(v) { return v === null ? '' : v; }
    var row = [date, c(weight), c(fat), c(muscle), c(bmi), c(bmr), c(visceral), c(height), memo, created, id, time, tags.join(','), exclude ? 1 : ''];
    if (rowIdx) sh.getRange(rowIdx, 1, 1, row.length).setValues([row]);
    else sh.getRange(Math.max(last, 1) + 1, 1, 1, row.length).setValues([row]);
    invalidate_(BSH);
  } finally {
    lock.releaseLock();
  }
  return id;
}

// id を渡すとその1測定を、日付（yyyy/MM/dd）を渡すとその日の測定すべてを削除する（旧版の送信待ち用）
function bodyDelete(key) {
  ensureBody_();
  key = String(key == null ? '' : key).trim();
  if (!key) return true;
  var byDate = /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(key) ? ymd_(key) : '';
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(BSH), last = sh.getLastRow();
    if (last >= 2) {
      var ds = sh.getRange(2, 1, last - 1, 11).getValues();
      for (var i = ds.length - 1; i >= 0; i--) {
        var o = bodyObj_(ds[i].concat(['']));
        if (byDate ? o.date === byDate : o.id === key) sh.deleteRow(i + 2);
      }
    }
    invalidate_(BSH);
  } finally {
    lock.releaseLock();
  }
  return true;
}

/** 動作確認用：エディタから実行して、シートが作られ読み書きできるか確かめる（テスト記録は削除される） */
function bodyTest() {
  var d = '2000/01/01';
  bodySave({ id: 'test-a', time: '07:30', date: d, weight: 66.3, fat: 25.4, muscle: 33.4, bmr: 1540, visceral: 10, height: 164 });
  bodySave({ id: 'test-b', time: '21:00', date: d, weight: 67.1, fat: 24.6 });
  var g = bodyGet().logs.filter(function (x) { return x.date === d; })[0];
  Logger.log('テスト記録（2回の平均）: ' + JSON.stringify(g));
  bodyDelete('test-a'); bodyDelete('test-b');
  Logger.log('テスト記録を削除しました');
}

/**
 * 目標の体脂肪率に向けた試算（AIは計算せず、この数値を引用する）
 * 除脂肪体重を維持して脂肪だけ落とす前提。脂肪1kg≒7200kcal。
 * 有酸素の消費は純消費の概算：ウォーキング 0.63kcal/kg/km、ランニング 1.0kcal/kg/km
 */
function bodyPlan_(latest, today) {
  var goal = goalFat_();
  if (!goal || latest.weight === null || latest.fat === null) return null;
  var w = latest.weight, lean = w * (1 - latest.fat / 100), fatMass = w - lean;
  var target = lean / (1 - goal / 100), toLose = Math.max(0, w - target);
  var out = {
    goalFat: goal, leanMassKg: r1_(lean), fatMassKg: r1_(fatMass),
    targetWeightKg: r1_(target), fatToLoseKg: r1_(toLose), energyNeededKcal: Math.round(toLose * 7200),
    method: '除脂肪体重を維持して脂肪のみ減らす前提。脂肪1kg=7200kcal'
  };
  out.proteinGramsPerDay = Math.round(w * 1.6) + '〜' + Math.round(w * 2.0);
  out.maxSafeLossKgPerWeek = r1_(w * 0.01);
  out.latestRecordDate = latest.date;
  if (latest.height) out.healthyWeightBmi22Kg = r1_(22 * Math.pow(latest.height / 100, 2));
  if (toLose <= 0) { out.note = '現在の体脂肪率は目標以下'; return out; }

  // 直近28日の有酸素による1日あたりの純消費kcal（実績）
  var perDay = 0, sessions = 0, km28 = 0;
  try {
    var from = addDays_(today, -27);
    cardioGet().logs.forEach(function (l) {
      if (l.date >= from && l.date <= today && l.km) {
        perDay += l.km * w * (l.type === 'ランニング' ? 1.0 : 0.63);
        sessions++; km28 += l.km;
      }
    });
    perDay = perDay / 28;
  } catch (e) { perDay = 0; }
  out.cardioKcalPerDayLast28Days = Math.round(perDay);
  out.cardioSessionsLast28Days = sessions;
  out.cardioKmLast28Days = r1_(km28); // 着地負荷（足首・股関節）の目安

  function months(daily) { return daily > 0 ? r1_(toLose * 7200 / daily / 30) : null; }
  function lossPerMonth(daily) { return r1_(daily * 30 / 7200); }
  var sc = [];
  [0, 300, 500].forEach(function (diet) {
    var daily = Math.round(perDay) + diet;
    if (daily <= 0) return;
    sc.push({
      name: diet === 0 ? '有酸素のみ（食事は今のまま）' : '有酸素＋食事で-' + diet + 'kcal/日',
      deficitKcalPerDay: daily, lossKgPerMonth: lossPerMonth(daily), monthsToGoal: months(daily),
      lossKgPerWeek: r1_(daily * 7 / 7200), withinSafeRate: daily * 7 / 7200 <= w * 0.01
    });
  });
  out.scenarios = sc;
  out.safetyNote = '減量ペースは体重の約1%/週以内が目安。-500kcal/日の食事制限は筋力が落ちやすいので、たんぱく質は体重×1.6〜2g/日を確保する。';
  return out;
}

/**
 * 1週間前・2週間前・1か月前・3か月前・半年前との比較（各項目の最新値 − その日以前で最も新しい記録）
 * 値が無い項目は省く。AIはこの差をそのまま引用する
 */
function bodyCompare_(logs, today) {
  var fields = ['weight', 'fat', 'muscle', 'bmi', 'bmr', 'visceral'], out = [];
  [[7, '1週間前'], [14, '2週間前'], [30, '1か月前'], [90, '3か月前'], [180, '半年前']].forEach(function (p) {
    var lim = addDays_(today, -p[0]), row = { label: p[1], diffs: {} }, any = false;
    fields.forEach(function (f) {
      var latest = null, ref = null;
      logs.forEach(function (l) { // logs は新しい順
        if (l[f] === null) return;
        if (!latest) latest = l;
        else if (!ref && l.date <= lim) ref = l;
      });
      if (latest && ref) { row.diffs[f] = { from: ref.date, then: ref[f], now: latest[f], diff: Math.round((latest[f] - ref[f]) * 10) / 10 }; any = true; }
    });
    if (any) out.push(row);
  });
  return out;
}

/** 条件（タイミング）ごとの直近28日の平均。同じ条件どうしの比較用。測定が無い条件は省く */
function bodyConditions_(entries, today) {
  var from = addDays_(today, -27), out = [];
  BTAGS.forEach(function (t) {
    var list = entries.filter(function (e) { return !e.exclude && e.date >= from && e.date <= today && e.tags.indexOf(t) >= 0; });
    if (!list.length) return;
    function avg(f) { var v = list.map(function (e) { return e[f]; }).filter(function (x) { return x !== null; }); return v.length ? r1_(v.reduce(function (a, b) { return a + b; }, 0) / v.length) : null; }
    out.push({ condition: t, count: list.length, weightAvg: avg('weight'), fatAvg: avg('fat'), muscleAvg: avg('muscle'), latestDate: list[0].date, latestWeight: list[0].weight });
  });
  return out;
}

/**
 * AIトレーナー（AiTrainer.gs）に渡す体組成の要約。記録が無い・読めない場合は null
 * 最新値、約4週前との差、直近8週の週ごとの平均、目標体脂肪率に向けた試算（plan）
 */
function aiBody_(today) {
  try {
    var g = bodyGet(), logs = g.logs; // 日ごとの平均（新しい順）
    if (!logs.length) return null;
    var latest = logs[0], entries = g.entries;
    var dayList = entries.filter(function (e) { return e.date === latest.date && !e.exclude; }).reverse().map(function (e) {
      return { time: e.time || null, tags: e.tags, weight: e.weight, fat: e.fat, muscle: e.muscle, visceral: e.visceral };
    });
    var weekStart = addDays_(today, -((dow_(today) + 6) % 7)), weeks = [], w;
    for (w = 7; w >= 0; w--) weeks.push(addDays_(weekStart, -7 * w));
    function avgBy(field) {
      var sums = weeks.map(function () { return 0; }), cnt = weeks.map(function () { return 0; });
      logs.forEach(function (l) {
        if (l[field] === null || l.date > today) return;
        for (var i = weeks.length - 1; i >= 0; i--) if (l.date >= weeks[i]) { sums[i] += l[field]; cnt[i]++; break; }
      });
      return sums.map(function (s, i) { return cnt[i] ? r1_(s / cnt[i]) : null; });
    }
    var ref = null, target = addDays_(today, -28);
    logs.forEach(function (l) { if (l.date <= target && (!ref || l.date > ref.date)) ref = l; });
    function diff(f) { return ref && latest[f] !== null && ref[f] !== null ? r1_(latest[f] - ref[f]) : null; }
    return {
      latest: latest, // 日平均（count＝その日の測定回数、range＝その日の最小・最大）
      conditionSummary: bodyConditions_(entries, today),
      latestDayMeasurements: dayList, // 最新の日の測定を時刻順に（朝→夜の変化を見る）
      changeSince4WeeksAgo: ref ? { from: ref.date, weight: diff('weight'), fat: diff('fat'), muscle: diff('muscle') } : null,
      last8Weeks: { weekStarts: weeks, weightAvg: avgBy('weight'), fatAvg: avgBy('fat'), muscleAvg: avgBy('muscle') },
      comparisons: bodyCompare_(logs, today),
      plan: bodyPlan_(latest, today)
    };
  } catch (err) {
    return null;
  }
}
