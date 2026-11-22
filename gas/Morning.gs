/**
 * 朝の提案（今日の目標と方針）
 *
 * 目的：毎朝、今日の目標（週の収支から割り戻した値）と方針を、式だけで（AIは使わず）出す。
 * 計算本体は MealLib.morningBrief（meal-lib.js のコピー。画面と共通）。
 *   ・アプリ：mealGet が毎回 morning を返す（画面は「☀️ 今朝の提案」として最初に表示。昨夜の遅い記録も反映される）
 *   ・このファイル：毎朝5時ごろに、その日の提案を「朝の提案」シートへ1日1行で記録する（あとで「提案どおりだったか」を見返せる）
 *
 * 導入：Apps Script に「Morning」と「MealLib」ファイルを作って貼る → Meal.gs を差し替える
 *       → morningDryRun を実行（ログで確認）→ morningInstall を実行（毎朝の記録を設定）→ 新バージョンでデプロイ
 */

var MORN_SH = '朝の提案';
var MORN_HEAD = ['日付', '期', '今日の目安kcal', 'kcal下限', 'kcal上限', 'たんぱく質g', '脂質g', '提案', '昨日の判定', '作成日時'];

/** 食事ログの直近 days 日ぶん（週の収支の計算には今週の月曜から昨日までが要るので、14日で足りる） */
function morningLogs_(days) {
  ensureMeal_();
  var from = addDays_(today_(), -(days || 14));
  return rows_(MSH).filter(function (r) { return String(r[0]).trim() !== '' && ymd_(r[1]) >= from; }).map(mealObj_);
}

/** mealGet からも使う。出せないときは null（アプリは自分で計算する） */
function morningBrief_(logs, goals, auto) {
  try {
    return MealLib.morningBrief({ logs: logs, today: today_(), goals: goals, phaseLabel: auto ? auto.phaseLabel : '' });
  } catch (e) { return null; }
}

function morningBuildNow_() {
  ROWS_CACHE = {};
  var ap = null;
  try { ap = mealAutoGoals_(); } catch (e) {}
  return morningBrief_(morningLogs_(14), mealGoals_(), ap);
}

/** 毎朝のトリガーから呼ぶ：今日の提案を「朝の提案」シートに記録（同じ日は上書き） */
function morningRun() {
  var b = morningBuildNow_();
  if (!b) return;
  var ss = ss_(), sh = ss.getSheetByName(MORN_SH);
  if (!sh) {
    sh = ss.insertSheet(MORN_SH);
    sh.getRange(1, 1, 1, MORN_HEAD.length).setValues([MORN_HEAD]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');
  }
  var k = b.targets.kcal || {}, p = b.targets.protein || {}, f = b.targets.fat || {};
  var row = [b.date, b.phase, k.ref || '', k.lo || '', k.hi || '', p.ref || '', f.ref || '', b.headline, b.yesterday ? b.yesterday.head : '', Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm')];
  var last = sh.getLastRow(), at = 0;
  if (last >= 2) {
    var ds = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = 0; i < ds.length; i++) if (String(ds[i][0]) === b.date) { at = i + 2; break; }
  }
  sh.getRange(at || last + 1, 1, 1, row.length).setValues([row]);
}

/** 確認用：シートに書かずに、できあがりをログに出す */
function morningDryRun() {
  var b = morningBuildNow_();
  if (!b) { Logger.log('提案を作れませんでした（食事の目標が未設定の可能性）'); return; }
  Logger.log(b.date + '（' + b.phase + '）');
  Logger.log(b.headline);
  b.lines.forEach(function (x) { Logger.log('  ' + x); });
  if (b.yesterday) Logger.log('昨日：' + b.yesterday.head + ' / ' + b.yesterday.lines.join(' '));
}

/** 毎朝5時ごろの自動記録を設定（何度実行しても1本だけ）。今すぐ1回記録もする */
function morningInstall() {
  morningUninstall();
  ScriptApp.newTrigger('morningRun').timeBased().everyDays(1).atHour(5).create();
  morningRun();
  Logger.log('毎朝5時ごろに「' + MORN_SH + '」シートへ記録する設定をし、今すぐ1回記録しました');
}

function morningUninstall() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'morningRun') ScriptApp.deleteTrigger(t); });
}
