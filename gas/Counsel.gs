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
  if (p.profile && (p.profile.sex || p.profile.age)) profileSet(p.profile);
  return counselGet();
}

/** 「不要」にする（自分用の既存ユーザーなど）。後からいつでも回答できる */
function counselSkip() {
  PropertiesService.getScriptProperties().setProperty('COUNSEL_SKIP', today_());
  return counselGet();
}

/**
 * 性別・年齢（FFMIを同性・同年代と比べるのに使う）。カウンセリングシートの回答か、体組成画面の入力から保存する。
 * 年齢は「入力した日」の年齢として保存し、経過年数ぶん自動で加算する。
 */
function profileGet() {
  var sex = counselProp_('PROFILE_SEX'), age = Number(counselProp_('PROFILE_AGE')) || null, at = counselProp_('PROFILE_AT');
  if (age && at) age += Math.floor((toDays_(today_()) - toDays_(at)) / 365.25);
  return { sex: sex === 'M' || sex === 'F' ? sex : '', age: age, setOn: at || null };
}

/** {sex:'M'|'F', age:数字}。空の項目は変更しない */
function profileSet(p) {
  p = p || {};
  var pr = PropertiesService.getScriptProperties(), cur = profileGet();
  var sex = p.sex === 'M' || p.sex === 'F' ? p.sex : '';
  var age = Math.round(Number(p.age));
  if (p.age !== undefined && p.age !== null && p.age !== '' && !(age >= 10 && age <= 100)) throw new Error('年齢は10〜100の数字で入力してください');
  if (sex) pr.setProperty('PROFILE_SEX', sex);
  if (age >= 10 && age <= 100) { pr.setProperty('PROFILE_AGE', String(age)); pr.setProperty('PROFILE_AT', today_()); }
  else if (!cur.setOn && sex) pr.setProperty('PROFILE_AT', today_());
  return profileGet();
}
