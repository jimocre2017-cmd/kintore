/**
 * カウンセリングシート（初回の聞き取り＋3か月ごとの見直し）- 保存と期限
 * 質問の定義と「回答→前提メモ」の変換は端末側（counsel-lib.js）。ここは保存・検証・AIへの受け渡しだけ。
 * 保存先（スクリプトのプロパティ）：COUNSEL_JSON（回答）、COUNSEL_CHART（前提メモ）、COUNSEL_AT（最終更新日）、COUNSEL_SKIP（不要にした日）
 * 前提メモは、手書きのカルテ（COACH_CHART）とは別に保存し、AI（診断・相談・AIトレーナー）には両方を渡す。
 */
var COUNSEL_INTERVAL_DAYS = 90;

function counselProp_(k) { return PropertiesService.getScriptProperties().getProperty(k) || ''; }

/** AIに渡す前提メモ（無ければ空文字） */
function counselChart_() { return counselProp_('COUNSEL_CHART'); }

function counselGet() {
  var today = today_(), at = counselProp_('COUNSEL_AT'), skip = counselProp_('COUNSEL_SKIP'), ans = null;
  try { ans = JSON.parse(counselProp_('COUNSEL_JSON') || 'null'); } catch (e) { ans = null; }
  var state = skip && !at ? 'skipped' : !at ? 'first' : (toDays_(today) - toDays_(at) >= COUNSEL_INTERVAL_DAYS ? 'due' : 'ok');
  return { today: today, state: state, answers: ans, chart: counselChart_(), updatedAt: at || null, skippedAt: skip || null, intervalDays: COUNSEL_INTERVAL_DAYS,
    nextDue: at ? addDays_(at, COUNSEL_INTERVAL_DAYS) : null };
}

/** 回答と前提メモを保存する：{answers:{…}, chart:'…'} */
function counselSave(p) {
  p = p || {};
  if (!p.answers || typeof p.answers !== 'object' || Array.isArray(p.answers)) throw new Error('回答が正しくありません');
  var json = JSON.stringify(p.answers);
  if (json.length > 8000) throw new Error('回答が長すぎます（8000字以内）');
  var chart = String(p.chart == null ? '' : p.chart).replace(/\r\n?/g, '\n').trim();
  if (chart.length > 1900) throw new Error('前提メモが長すぎます（1900字以内。自由記入欄を短くしてください）');
  var pr = PropertiesService.getScriptProperties();
  pr.setProperty('COUNSEL_JSON', json);
  pr.setProperty('COUNSEL_CHART', chart);
  pr.setProperty('COUNSEL_AT', today_());
  pr.deleteProperty('COUNSEL_SKIP');
  return counselGet();
}

/** 「不要」にする（自分用の既存ユーザーなど）。後からいつでも回答できる */
function counselSkip() {
  PropertiesService.getScriptProperties().setProperty('COUNSEL_SKIP', today_());
  return counselGet();
}
