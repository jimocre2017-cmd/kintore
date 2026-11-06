/**
 * 体組成（体重計の数値）の記録 - バックエンド
 * スプレッドシート：体組成ログ（初回の呼び出し時に自動で作られる）
 * 1日1件。同じ日付で保存し直すと上書きされる（日付がID）ので、オフライン中の操作を何度送り直しても安全。
 * 項目はオムロンの体重計の表示に合わせている（体重・体脂肪率・骨格筋率・BMI・基礎代謝・内臓脂肪レベル）。
 */

var BSH = '体組成ログ';
var BHEAD = ['日付', '体重kg', '体脂肪率%', '骨格筋率%', 'BMI', '基礎代謝kcal', '内臓脂肪レベル', '身長cm', '備考', '登録日時'];
var BODY_READY = false;

function ensureBody_() {
  if (BODY_READY) return;
  var ss = ss_();
  var sh = ss.getSheetByName(BSH), created = false;
  if (!sh) { sh = ss.insertSheet(BSH); created = true; }
  sh.getRange(1, 1, 1, BHEAD.length).setValues([BHEAD]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  // 日付・登録日時は文字列のまま保存する（シートが日付に自動変換しないように）
  if (created) [1, 10].forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); });
  BODY_READY = true;
}

function bNum_(v) { return v === '' || v === null || v === undefined ? null : Number(v); }

function bodyObj_(r) {
  return {
    date: ymd_(r[0]), weight: bNum_(r[1]), fat: bNum_(r[2]), muscle: bNum_(r[3]), bmi: bNum_(r[4]),
    bmr: bNum_(r[5]), visceral: bNum_(r[6]), height: bNum_(r[7]), memo: String(r[8] || '')
  };
}

function bodyGet() {
  ensureBody_();
  var logs = rows_(BSH).filter(function (r) { return String(r[0]).trim() !== ''; }).map(bodyObj_);
  logs.sort(function (a, b) { return a.date < b.date ? 1 : (a.date > b.date ? -1 : 0); });
  return { today: today_(), logs: logs, goalFat: goalFat_() };
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
      var ds = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ds.length; i++) if (ymd_(ds[i][0]) === date) { rowIdx = i + 2; break; }
      if (rowIdx) created = sh.getRange(rowIdx, 10).getValue();
    }
    if (!created) created = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss');
    function c(v) { return v === null ? '' : v; }
    var row = [date, c(weight), c(fat), c(muscle), c(bmi), c(bmr), c(visceral), c(height), memo, created];
    if (rowIdx) sh.getRange(rowIdx, 1, 1, row.length).setValues([row]);
    else sh.getRange(Math.max(last, 1) + 1, 1, 1, row.length).setValues([row]);
    invalidate_(BSH);
  } finally {
    lock.releaseLock();
  }
  return date;
}

function bodyDelete(date) {
  ensureBody_();
  date = ymd_(date);
  if (!date) return true;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(BSH), last = sh.getLastRow();
    if (last >= 2) {
      var ds = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = ds.length - 1; i >= 0; i--) if (ymd_(ds[i][0]) === date) sh.deleteRow(i + 2);
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
  bodySave({ date: d, weight: 66.3, fat: 25.4, muscle: 33.4, bmr: 1540, visceral: 10, height: 164 });
  var g = bodyGet().logs.filter(function (x) { return x.date === d; })[0];
  Logger.log('テスト記録: ' + JSON.stringify(g));
  bodyDelete(d);
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
  if (latest.height) out.healthyWeightBmi22Kg = r1_(22 * Math.pow(latest.height / 100, 2));
  if (toLose <= 0) { out.note = '現在の体脂肪率は目標以下'; return out; }

  // 直近28日の有酸素による1日あたりの純消費kcal（実績）
  var perDay = 0, sessions = 0;
  try {
    var from = addDays_(today, -27);
    cardioGet().logs.forEach(function (l) {
      if (l.date >= from && l.date <= today && l.km) {
        perDay += l.km * w * (l.type === 'ランニング' ? 1.0 : 0.63);
        sessions++;
      }
    });
    perDay = perDay / 28;
  } catch (e) { perDay = 0; }
  out.cardioKcalPerDayLast28Days = Math.round(perDay);
  out.cardioSessionsLast28Days = sessions;

  function months(daily) { return daily > 0 ? r1_(toLose * 7200 / daily / 30) : null; }
  function lossPerMonth(daily) { return r1_(daily * 30 / 7200); }
  var sc = [];
  [0, 300, 500].forEach(function (diet) {
    var daily = Math.round(perDay) + diet;
    if (daily <= 0) return;
    sc.push({
      name: diet === 0 ? '有酸素のみ（食事は今のまま）' : '有酸素＋食事で-' + diet + 'kcal/日',
      deficitKcalPerDay: daily, lossKgPerMonth: lossPerMonth(daily), monthsToGoal: months(daily)
    });
  });
  out.scenarios = sc;
  out.safetyNote = '減量ペースは体重の約1%/週以内が目安。-500kcal/日の食事制限は筋力が落ちやすいので、たんぱく質は体重×1.6〜2g/日を確保する。';
  return out;
}

/**
 * AIトレーナー（AiTrainer.gs）に渡す体組成の要約。記録が無い・読めない場合は null
 * 最新値、約4週前との差、直近8週の週ごとの平均、目標体脂肪率に向けた試算（plan）
 */
function aiBody_(today) {
  try {
    var logs = bodyGet().logs; // 新しい順
    if (!logs.length) return null;
    var latest = logs[0];
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
      latest: latest,
      changeSince4WeeksAgo: ref ? { from: ref.date, weight: diff('weight'), fat: diff('fat'), muscle: diff('muscle') } : null,
      last8Weeks: { weekStarts: weeks, weightAvg: avgBy('weight'), fatAvg: avgBy('fat'), muscleAvg: avgBy('muscle') },
      plan: bodyPlan_(latest, today)
    };
  } catch (err) {
    return null;
  }
}
