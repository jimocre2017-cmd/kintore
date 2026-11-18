/**
 * AI用サマリ（Gemini のノートブック／チャットに読ませる専用タブ）
 *
 * 目的：記録データ・食事ログなどは行数が増え、AIが読むと「先頭だけ」で切れて最新日が見えなくなる。
 * そこで「新しい日が上」の小さな集計タブを自動で作り、AIにはこのタブだけを読ませる。
 *   ・AI用_直近14日 … 1日1行。体組成・食事・筋トレ・有酸素
 *   ・AI用_週平均   … 上に比較（今週／先週／直近4週／3か月）、下に週別13週
 * 数値の計算は既存の関数を再利用（体組成＝bodyDaily_、消費kcal＝kcalOfSet_／cardioLogsWithKcal_）。
 * 元のシートは一切書き換えない。このファイルが作るのは上の2タブだけ。
 *
 * 導入：Apps Script に「AiSummary」ファイルを作って貼る → aiSummaryDryRun を実行（確認）→ aiSummaryInstall を実行（1時間ごとに自動更新）
 * 前提：Code.gs / Body.gs / Meal.gs / Cardio.gs が同じプロジェクトにあること
 */

var AIS_DAILY = 'AI用_直近14日';
var AIS_WEEKLY = 'AI用_週平均';
var AIS_DAYS = 14;
var AIS_WEEKS = 13; // 週別の表に出す週数（今週＋過去12週）
var AIS_BACK_WEEKS = 52; // 1年前まで遡って集める
// 比較に使う「過去の週」（何週前か）
var AIS_PAST = [[4, '1か月前の週（4週前）'], [8, '2か月前の週（8週前）'], [13, '3か月前の週（13週前）'], [26, '半年前の週（26週前）'], [52, '1年前の週（52週前）']];
var AIS_DOW = ['日', '月', '火', '水', '木', '金', '土'];

var AIS_DAILY_HEAD = ['日付', '曜日', '体重kg', '体脂肪率%', '骨格筋率%', '内臓脂肪', '体組成測定回数',
  '摂取kcal', 'たんぱく質g', '脂質g', '炭水化物g', '食事記録件数',
  '筋トレセット数', '筋トレ消費kcal', '有酸素km', '有酸素消費kcal', '運動消費合計kcal', '備考'];

var AIS_WEEKLY_HEAD = ['区分', '期間開始', '期間終了', '経過日数', '体組成記録日数（週あたり）', '体重kg平均', '体脂肪率%平均', '骨格筋率%平均',
  '食事記録日数（週あたり）', '摂取kcal平均', 'たんぱく質g平均', '脂質g平均', '炭水化物g平均',
  '筋トレ日数（週あたり）', '筋トレセット（週あたり）', '有酸素日数（週あたり）', '有酸素km（週あたり）', '運動消費kcal/日平均'];

// 差を出す列（0始まり）。平均値の列だけ。日数・回数・合計の列は差を出さない
var AIS_DIFF_COLS = [5, 6, 7, 9, 10, 11, 12, 17];

function aisMonday_(s) { return addDays_(s, -((dow_(s) + 6) % 7)); } // 週は月曜始まり

function aisDayMap_(from, to) {
  var map = {}, d = from;
  while (d <= to) {
    map[d] = { date: d, weight: null, fat: null, muscle: null, visceral: null, bodyN: 0,
      kcal: 0, protein: 0, mealFat: 0, carbs: 0, mealN: 0, sets: 0, sKcal: 0, cKm: 0, cKcal: 0 };
    d = addDays_(d, 1);
  }
  return map;
}

/** from〜to の日ごとの値を集める。読めなかった項目は errs に残す（黙って欠けないように） */
function aisCollect_(from, to) {
  var map = aisDayMap_(from, to), errs = [], st = getSettings_(), kw = kcalWeight_();
  try {
    bodyDaily_(bodyEntries_()).forEach(function (b) {
      var d = map[b.date]; if (!d) return;
      d.weight = b.weight; d.fat = b.fat; d.muscle = b.muscle; d.visceral = b.visceral; d.bodyN = b.count;
    });
  } catch (e) { errs.push('体組成'); Logger.log('体組成の読み込み失敗: ' + e); }
  try {
    rows_(MSH).forEach(function (r) {
      if (String(r[0]).trim() === '') return;
      var o = mealObj_(r), d = map[o.date]; if (!d) return;
      d.kcal += o.kcal; d.protein += o.protein; d.mealFat += o.fat; d.carbs += o.carbs; d.mealN++;
    });
  } catch (e) { errs.push('食事'); Logger.log('食事の読み込み失敗: ' + e); }
  try {
    getLogs_(from, to).forEach(function (l) {
      var d = map[l.date]; if (!d) return;
      d.sets++; d.sKcal += kcalOfSet_(l.aReps, l.aSecs, st, kw);
    });
  } catch (e) { errs.push('筋トレ'); Logger.log('筋トレの読み込み失敗: ' + e); }
  try {
    cardioLogsWithKcal_(from, to, st, kw).forEach(function (l) {
      var d = map[l.date]; if (!d) return;
      d.cKm += l.km || 0; d.cKcal += l.kcal || 0;
    });
  } catch (e) { errs.push('有酸素'); Logger.log('有酸素の読み込み失敗: ' + e); }
  return { map: map, errs: errs };
}

function aisDaysOf_(map, from, to) {
  var out = [], d = from;
  while (d <= to) { if (map[d]) out.push(map[d]); d = addDays_(d, 1); }
  return out;
}

/** 日の配列 → 週平均タブの数値列（AIS_WEEKLY_HEAD の4列目以降）。weeks＝週あたりに直すときの週数 */
function aisAgg_(days, weeks) {
  function sum(f) { return days.reduce(function (a, d) { return a + d[f]; }, 0); }
  function cnt(ok) { var n = days.filter(ok).length; return weeks === 1 ? n : r1_(n / weeks); }
  function avg(f, ok, int) {
    var s = 0, n = 0;
    days.forEach(function (d) { if (ok(d)) { s += d[f]; n++; } });
    if (!n) return '';
    return int ? Math.round(s / n) : r1_(s / n);
  }
  var hasWeight = function (d) { return d.weight !== null; };
  var hasFat = function (d) { return d.fat !== null; };
  var hasMuscle = function (d) { return d.muscle !== null; };
  var hasMeal = function (d) { return d.kcal > 0; };
  return [
    days.length,
    cnt(hasWeight), avg('weight', hasWeight), avg('fat', hasFat), avg('muscle', hasMuscle),
    cnt(hasMeal), avg('kcal', hasMeal, true), avg('protein', hasMeal), avg('mealFat', hasMeal), avg('carbs', hasMeal),
    cnt(function (d) { return d.sets > 0; }), days.length ? r1_(sum('sets') / weeks) : '',
    cnt(function (d) { return d.cKm > 0 || d.cKcal > 0; }), days.length ? r1_(sum('cKm') / weeks) : '',
    days.length ? Math.round((sum('sKcal') + sum('cKcal')) / days.length) : ''
  ];
}

function aisRow_(label, from, to, days, weeks) {
  return [label, from, to].concat(aisAgg_(days, weeks));
}

function aisDiff_(label, a, b) {
  var row = [label, '', ''];
  for (var i = 3; i < a.length; i++) {
    row.push(AIS_DIFF_COLS.indexOf(i) >= 0 && typeof a[i] === 'number' && typeof b[i] === 'number' ? r1_(a[i] - b[i]) : '');
  }
  return row;
}

function aisNote_(errs, extra) {
  var t = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm');
  return '【AI用サマリ】最終更新 ' + t + '（自動更新）。新しい日・週が上。体組成と食事は記録のある日だけで平均（未記録は空欄で、0ではない）。kcalは概算。' +
    (extra ? ' ' + extra : '') + (errs.length ? ' ※読み込めなかった項目: ' + errs.join('・') : '');
}

/** 複数週の平均の行。最初の記録がある日より前（記録開始前の空白）は含めず、その日以降の日数で「週あたり」に直す */
function aisPooled_(label, map, from, to) {
  var days = aisDaysOf_(map, from, to), i = 0;
  function has(d) { return d.bodyN > 0 || d.mealN > 0 || d.sets > 0 || d.cKm > 0 || d.cKcal > 0; }
  while (i < days.length && !has(days[i])) i++;
  days = days.slice(i);
  var weeks = days.length ? Math.max(days.length / 7, 1) : 1;
  return aisRow_(label, days.length ? days[0].date : from, to, days, weeks);
}

/** 2つのタブの中身を作る（シートには書かない） */
function aisBuild_() {
  var today = today_(), thisMon = aisMonday_(today);
  var from = addDays_(thisMon, -7 * AIS_BACK_WEEKS); // 1年前の週の先頭の月曜（直近14日より必ず古い）
  var c = aisCollect_(from, today), map = c.map;

  // 直近14日（新しい日が上）
  var dailyGrid = [[aisNote_(c.errs)], AIS_DAILY_HEAD.slice()];
  for (var i = 0; i < AIS_DAYS; i++) {
    var ds = addDays_(today, -i), d = map[ds];
    var memo = [];
    if (i === 0) memo.push('本日（途中）');
    if (d.weight === null) memo.push('体組成なし');
    if (!d.mealN) memo.push('食事記録なし');
    dailyGrid.push([ds, AIS_DOW[dow_(ds)],
      d.weight === null ? '' : d.weight, d.fat === null ? '' : d.fat, d.muscle === null ? '' : d.muscle, d.visceral === null ? '' : d.visceral, d.bodyN || '',
      d.mealN ? Math.round(d.kcal) : '', d.mealN ? r1_(d.protein) : '', d.mealN ? r1_(d.mealFat) : '', d.mealN ? r1_(d.carbs) : '', d.mealN || '',
      d.sets, Math.round(d.sKcal), r1_(d.cKm), Math.round(d.cKcal), Math.round(d.sKcal + d.cKcal), memo.join('・')]);
  }

  // 週別（今週は途中）
  function weekRow(k, label) {
    var ws = addDays_(thisMon, -7 * k), we = addDays_(ws, 6);
    if (we > today) we = today;
    var days = aisDaysOf_(map, ws, we), r = aisRow_(label, ws, we, days, 1);
    if (!r[4] && !r[8] && !r[13] && !r[15]) { // 体組成・食事・筋トレ・有酸素のどれも無い週＝その時期のデータが無い
      r[0] = label + '【記録なし】';
      for (var j = 13; j <= 17; j++) r[j] = ''; // 0と誤読されないよう空欄にする（比較の差も出ない）
    }
    return r;
  }
  var weekRows = [];
  for (var k = 0; k < AIS_WEEKS; k++) weekRows.push(weekRow(k, k === 0 ? '今週（途中）' : (k === 1 ? '先週' : k + '週前')));

  // 比較（今週を、過去の平均・過去の週と並べる）
  var past4 = aisPooled_('直近4週平均（今週を除く）', map, addDays_(thisMon, -28), addDays_(thisMon, -1));
  var past12 = aisPooled_('3か月平均（直近12週・今週を除く）', map, addDays_(thisMon, -84), addDays_(thisMon, -1));
  var pastWeeks = AIS_PAST.map(function (p) { return weekRow(p[0], p[1]); });
  var cmp = [weekRows[0], weekRows[1], past4, past12].concat(pastWeeks);
  cmp.push(aisDiff_('差：今週−先週', weekRows[0], weekRows[1]));
  cmp.push(aisDiff_('差：今週−直近4週平均', weekRows[0], past4));
  cmp.push(aisDiff_('差：今週−3か月平均', weekRows[0], past12));
  AIS_PAST.forEach(function (p, i) { cmp.push(aisDiff_('差：今週−' + p[1].split('（')[0], weekRows[0], pastWeeks[i])); });

  var weeklyGrid = [[aisNote_(c.errs, '週は月曜始まり。過去の週は「1週間まるごと」と今週（途中）を比べる。【記録なし】の行はその時期のデータがまだ無い。「（週あたり）」の列は、複数週の行は1週あたりに直した値、今週・先週・週別の行はその週の合計（今週は現時点まで）。日数の列も同じ。直近4週・3か月の行は、最初の記録がある日より前を含めずに集計。')],
    AIS_WEEKLY_HEAD.slice()].concat(cmp);
  weeklyGrid.push(['']);
  weeklyGrid.push(['▼週別（新しい週が上）']);
  var weekHeadRow = weeklyGrid.length + 1;
  weeklyGrid.push(AIS_WEEKLY_HEAD.slice());
  weeklyGrid = weeklyGrid.concat(weekRows);

  return {
    daily: { grid: dailyGrid, headerRows: [2], textCols: [1] },
    weekly: { grid: weeklyGrid, headerRows: [2, weekHeadRow], textCols: [2, 3] }
  };
}

function aisPut_(name, t) {
  var ss = ss_(), sh = ss.getSheetByName(name) || ss.insertSheet(name);
  var W = 0;
  t.grid.forEach(function (r) { if (r.length > W) W = r.length; });
  var grid = t.grid.map(function (r) { var x = r.slice(); while (x.length < W) x.push(''); return x; });
  sh.clear();
  if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
  if (sh.getMaxRows() < grid.length) sh.insertRowsAfter(sh.getMaxRows(), grid.length - sh.getMaxRows());
  t.textCols.forEach(function (c) { sh.getRange(1, c, grid.length, 1).setNumberFormat('@'); }); // 日付を日付型に変えない
  sh.getRange(1, 1, grid.length, W).setValues(grid);
  t.headerRows.forEach(function (r) {
    sh.getRange(r, 1, 1, W).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  });
  sh.getRange(1, 1).setFontColor('#6b7280');
  sh.setFrozenRows(2);
  sh.setColumnWidth(1, 150);
}

/** 本番：2タブを作り直す（トリガーからも呼ばれる） */
function aiSummaryUpdate() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) { Logger.log('他の処理が動いているため今回はスキップ'); return; }
  try {
    ROWS_CACHE = {}; // 最新を読む
    var b = aisBuild_();
    aisPut_(AIS_DAILY, b.daily);
    aisPut_(AIS_WEEKLY, b.weekly);
    Logger.log('更新しました: ' + AIS_DAILY + ' / ' + AIS_WEEKLY);
  } finally { lock.releaseLock(); }
}

/** 確認用：シートに書かずに、できあがりをログに出す */
function aiSummaryDryRun() {
  ROWS_CACHE = {};
  var b = aisBuild_();
  Logger.log('--- ' + AIS_DAILY + ' ---');
  b.daily.grid.forEach(function (r) { Logger.log(r.join(' | ')); });
  Logger.log('--- ' + AIS_WEEKLY + ' ---');
  b.weekly.grid.forEach(function (r) { Logger.log(r.join(' | ')); });
}

/** 1時間ごとの自動更新を設定（何度実行しても1本だけ） */
function aiSummaryInstall() {
  aiSummaryUninstall();
  ScriptApp.newTrigger('aiSummaryUpdate').timeBased().everyHours(1).create();
  aiSummaryUpdate();
  Logger.log('1時間ごとの自動更新を設定し、今すぐ1回更新しました');
}

function aiSummaryUninstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'aiSummaryUpdate') ScriptApp.deleteTrigger(t); });
}
