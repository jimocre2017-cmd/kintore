/**
 * 筋トレトラッカー（ジモカフェPOS型） - バックエンド
 * スプレッドシート：設定 / 部位マスタ / 種目マスタ / 記録データ / 日次集計
 * 集計の正本は「記録データ」（状態=確定のみ）。日次集計は記録のたびに自動再計算。
 */

var TZ = 'Asia/Tokyo';
var SH = {
  SETTINGS: '設定',
  PARTS: '部位マスタ',
  EX: '種目マスタ',
  LOG: '記録データ',
  DAILY: '日次集計'
};

var HEAD = {
  SETTINGS: ['キー', '値', '説明'],
  PARTS: ['部位', '部位グループ', '表示順'],
  EX: ['種目ID', '種目名', '部位', '器具', '計測', '負荷タイプ', '負荷倍率', '回数倍率', '強度', '既定負荷', '負荷最小', '負荷最大', '負荷刻み', '表示順', '有効', '総負荷量に含める', '付随部位', '参考リンク', 'プログラム専用', 'タグ'],
  LOG: ['記録ID', '日時', '日付', '種目ID', '種目名', '部位', '部位グループ', '器具', 'セット番号', '負荷kg', '強度', '回数', '秒', '集計レップ', '集計秒', '総負荷量', '状態', '取消日時', '備考'],
  DAILY: ['日付', '部位グループ', '部位', 'セット数', '集計レップ', '集計秒', '総負荷量', '種目数']
};

// 記録データの列番号（0始まり）
var L = { ID: 0, AT: 1, DATE: 2, EXID: 3, EXNAME: 4, PART: 5, GROUP: 6, EQUIP: 7, SETNO: 8, LOAD: 9, INTENSITY: 10, REPS: 11, SECS: 12, AREPS: 13, ASECS: 14, VOL: 15, STATUS: 16, CANCELED: 17, MEMO: 18 };

var EQUIPMENTS = ['ダンベル', 'チューブ', '自重', 'ハンドグリップ', 'パワーボール', 'その他'];
var MEASURES = ['回数', '秒'];
var LOAD_TYPES = ['kg', '加重', '強度固定', 'なし'];

// 設定シートの既定値（キー, 値, 説明）
var SETTING_DEFAULTS = [
  ['インターバル秒', 90, 'セット間の休憩タイマー（秒）。入力画面から変更すると自動で保存されます'],
  ['部位色_日_普通', 4, '部位マップ（日表示）：その日のセット数がこの値以上で黄色（普通）。未満は青（ウォームアップ）'],
  ['部位色_日_追い込み', 8, '部位マップ（日表示）：その日のセット数がこの値以上で赤（追い込み）'],
  ['部位色_週_普通', 6, '部位マップ（週・月・四半期・年）：1週あたりのセット数がこの値以上で黄色（普通）'],
  ['部位色_週_追い込み', 12, '部位マップ（週・月・四半期・年）：1週あたりのセット数がこの値以上で赤（追い込み）'],
  ['秒種目_準備秒', 3, '秒種目のストップウォッチを始める前のカウントダウン（秒）。0にするとすぐ計測開始'],
  ['秒種目_持ち替え秒', 4, '左右で行う秒種目（パワーボール等）で、片側のカウントが終わってから反対側を始めるまでの持ち替え時間（秒）']
];

// 器具ごとの既定値（種目追加時に使う）
var EQUIP_DEFAULTS = {
  'ダンベル':       { measure: '回数', loadType: 'kg',       wMult: 2, rMult: 1, intensity: '',     def: 5,  min: 2.5, max: 20, step: 2.5 },
  'チューブ':       { measure: '回数', loadType: '強度固定', wMult: 1, rMult: 1, intensity: 'シングル（低負荷）', def: 0,  min: 0,   max: 0,  step: 0 },
  '自重':           { measure: '回数', loadType: '加重',     wMult: 1, rMult: 1, intensity: '',     def: 0,  min: 0,   max: 30, step: 2.5 },
  'ハンドグリップ': { measure: '回数', loadType: 'kg',       wMult: 1, rMult: 2, intensity: '',     def: 20, min: 20,  max: 50, step: 5, inVol: false },
  'パワーボール':   { measure: '秒',   loadType: 'なし',     wMult: 1, rMult: 2, intensity: '',     def: 0,  min: 0,   max: 0,  step: 0 },
  'その他':         { measure: '回数', loadType: 'kg',       wMult: 1, rMult: 1, intensity: '',     def: 0,  min: 0,   max: 100, step: 2.5 }
};

/* ============================================================
 * Web App
 * ============================================================ */

/** スクリプトの持ち主（自分）が Google ログインで開いているか */
function isOwner_() {
  try {
    var a = Session.getActiveUser().getEmail();
    return !!a && a === Session.getEffectiveUser().getEmail();
  } catch (err) {
    return false;
  }
}

function doGet(e) {
  // アプリ版用に「全員」公開のデプロイがあるため、画面は持ち主のログイン時だけ表示する
  if (!isOwner_()) return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">このページは表示できません。</p>');
  // 記録・分析はアプリ版（PWA）に一本化。ここはアプリ版を開くための起動ページ
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('筋トレトラッカー')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('筋トレ管理')
    .addItem('初期セットアップ（シート作成）', 'setupSpreadsheet')
    .addItem('日次集計を全件再計算', 'rebuildAllDaily')
    .addItem('ウェブアプリのURLを表示', 'showAppUrl')
    .addToUi();
}

function showAppUrl() {
  var url = ScriptApp.getService().getUrl();
  SpreadsheetApp.getUi().alert(url ? ('アプリ版の起動ページ（ここからスマホ・タブレットに設定できます）：\n' + url) : 'まだウェブアプリとしてデプロイされていません。');
}

/* ============================================================
 * 共通ヘルパー
 * ============================================================ */

function ss_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('シート「' + name + '」がありません。メニュー「筋トレ管理 > 初期セットアップ」を実行してください。');
  return sh;
}

// 1回の実行内でシートの読み込みを使い回す（同じシートを何度も読まない＝高速化）
var ROWS_CACHE = {};
function rows_(name) {
  if (ROWS_CACHE[name]) return ROWS_CACHE[name];
  var sh = sheet_(name);
  var last = sh.getLastRow();
  var v = last < 2 ? [] : sh.getRange(2, 1, last - 1, sh.getLastColumn()).getValues();
  ROWS_CACHE[name] = v;
  return v;
}
function invalidate_(name) { delete ROWS_CACHE[name]; }

function num_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  var n = Number(v);
  return isNaN(n) ? 0 : n;
}

function bool_(v) {
  if (v === true) return true;
  if (v === false) return false;
  var s = String(v).trim().toUpperCase();
  return !(s === 'FALSE' || s === '0' || s === '無効' || s === 'いいえ');
}

/** セル値（Date or 文字列）を 'yyyy/MM/dd' に正規化 */
function ymd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy/MM/dd');
  var s = String(v || '').trim();
  var m = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (!m) return '';
  return m[1] + '/' + ('0' + m[2]).slice(-2) + '/' + ('0' + m[3]).slice(-2);
}

function today_() {
  return Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd');
}

// 日付計算は 'yyyy/MM/dd' ⇔ UTC日数 で行い、タイムゾーンの影響を受けないようにする
function toDays_(s) {
  var p = s.split('/');
  return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
}
function fromDays_(d) {
  var dt = new Date(d * 86400000);
  return dt.getUTCFullYear() + '/' + ('0' + (dt.getUTCMonth() + 1)).slice(-2) + '/' + ('0' + dt.getUTCDate()).slice(-2);
}
function addDays_(s, n) { return fromDays_(toDays_(s) + n); }
function dow_(s) { return new Date(toDays_(s) * 86400000).getUTCDay(); } // 0=日
function ymdParts_(s) { var p = s.split('/'); return { y: +p[0], m: +p[1], d: +p[2] }; }
function mk_(y, m, d) {
  // 月の繰り上がり・繰り下がりを吸収
  var dt = new Date(Date.UTC(y, m - 1, d));
  return fromDays_(Math.round(dt.getTime() / 86400000));
}

function uuid_() { return Utilities.getUuid(); }

/** A列（ID）が入っている最終データ行数（見出しを除く） */
function exDataRows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]).trim() !== '') return i + 1;
  return 0;
}

function r1_(n) { return Math.round(n * 10) / 10; }

/* ============================================================
 * マスタ読み込み
 * ============================================================ */

function getSettings_() {
  var out = {};
  SETTING_DEFAULTS.forEach(function (d) { out[d[0]] = d[1]; });
  rows_(SH.SETTINGS).forEach(function (r) {
    if (r[0] !== '') out[String(r[0]).trim()] = r[1];
  });
  SETTING_DEFAULTS.forEach(function (d) {
    var v = out[d[0]];
    out[d[0]] = (v === '' || v === null || v === undefined || isNaN(Number(v))) ? d[1] : Number(v);
  });
  return out;
}

/** 設定シートに無いキーを既定値で追加する（新機能の設定行を自動で用意） */
function ensureSettings_() {
  var sh = sheet_(SH.SETTINGS);
  var keys = rows_(SH.SETTINGS).map(function (r) { return String(r[0]).trim(); });
  var added = false;
  SETTING_DEFAULTS.forEach(function (d) { if (keys.indexOf(d[0]) < 0) { sh.appendRow(d); added = true; } });
  if (added) invalidate_(SH.SETTINGS);
}

// 後から増やした部位：部位マスタに無ければ自動で追加する [部位, 部位グループ, この部位の直後に並べる]
var PART_ADDITIONS = [
  ['大円筋', '背中', '広背筋'],
  ['菱形筋', '背中', '大円筋'],
  ['前鋸筋', '胸', '大胸筋'],
  ['腱板（インナーマッスル）', '肩', '三角筋']
];

function ensureParts_() {
  var rows = rows_(SH.PARTS);
  var have = {}, orderOf = {};
  rows.forEach(function (r, i) {
    var p = String(r[0]).trim();
    if (p) { have[p] = 1; orderOf[p] = r[2] === '' ? 999 + i : num_(r[2]); }
  });
  var sh = null, added = false;
  PART_ADDITIONS.forEach(function (a) {
    if (have[a[0]]) return;
    sh = sh || sheet_(SH.PARTS);
    orderOf[a[0]] = orderOf[a[2]] !== undefined ? orderOf[a[2]] + 0.1 : 999;
    sh.appendRow([a[0], a[1], orderOf[a[0]]]);
    have[a[0]] = 1;
    added = true;
  });
  if (added) invalidate_(SH.PARTS);
}

/* =============================================================
 * プログラム（目的別の種目セット）
 * 「プログラム」シート：プログラム名 / 順番 / 種目ID / 種目名（参考） / 目安・メモ
 * 種目IDが空の行は、そのプログラムの説明（準備・注意点）として表示
 * ============================================================= */
var PROG_SHEET = 'タグ設定'; // 旧名「プログラム」。タグごとの順番・目安・説明
var OLD_PROG_SHEET = 'プログラム';
var PROG_HEAD = ['タグ', '順番', '種目ID', '種目名（参考）', '目安・メモ'];
var PROG_SEED = [
  ['肩リハ', 0, '', '準備：胸鎖乳突筋・小胸筋を指先でやさしくリリース → 顎を斜め45°上へ上げる首前側のストレッチ。すべて痛みの出ない範囲・軽い負荷・ゆっくりで。可動域を試すテスト挙上はしない'],
  ['肩リハ', 1, 'E006', '後頭部付近でジャイロ回転。インナーマッスルを起こして骨頭を関節の中央へ'],
  ['肩リハ', 2, 'E014', 'シングル。肘を脇につけたまま前腕を外へ開く。15〜20回×2〜3'],
  ['肩リハ', 3, 'E015', '2.5kg。横向きに寝て肘を脇腹に固定し前腕を上げる。15回×2'],
  ['肩リハ', 4, 'E016', 'シングル。胸の高さで引き、肩甲骨を寄せて下げる。15回×3'],
  ['肩リハ', 5, 'E017', '自重から。T字・W字のみ（Y字はしない）。10〜12回×2'],
  ['肩リハ', 6, 'E018', '壁から。押し切った最後に背中をもう一段押し上げる。10〜15回×2'],
  ['肩リハ', 7, 'E003', '頭の後ろへ引き下げ、肩甲骨を下制・後傾。12〜15回×3'],
  ['肩リハ', 8, 'E009', '軽めで。引き切ったら肘を外へ回す。12〜15回×2']
];

/** プログラムシートが無ければ作って初期プログラムを入れる */
function ensurePrograms_() {
  var ss = ss_();
  if (ss.getSheetByName(PROG_SHEET)) return;
  // 旧「プログラム」シートがあれば「タグ設定」に移行（【リハビリ：肩】→ 肩リハ）
  var old = ss.getSheetByName(OLD_PROG_SHEET);
  if (old) {
    old.setName(PROG_SHEET);
    old.getRange(1, 1, 1, PROG_HEAD.length).setValues([PROG_HEAD]);
    var last = old.getLastRow();
    if (last >= 2) {
      var a = old.getRange(2, 1, last - 1, 1).getValues().map(function (r) {
        var v = String(r[0]).trim();
        return [v === '【リハビリ：肩】' ? '肩リハ' : v.replace(/^#/, '')];
      });
      old.getRange(2, 1, a.length, 1).setValues(a);
    }
    return;
  }
  var sh = ss.insertSheet(PROG_SHEET);
  sh.getRange(1, 1, 1, PROG_HEAD.length).setValues([PROG_HEAD]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  var names = {};
  getExercises_(true).forEach(function (e) { names[e.id] = e.name; });
  var rows = PROG_SEED.map(function (r) { return [r[0], r[1], r[2], r[2] ? (names[r[2]] || '') : '（説明）', r[3]]; });
  sh.getRange(2, 1, rows.length, PROG_HEAD.length).setValues(rows);
  sh.setColumnWidth(1, 150); sh.setColumnWidth(2, 50); sh.setColumnWidth(3, 70); sh.setColumnWidth(4, 220); sh.setColumnWidth(5, 480);
}

function getPrograms_() {
  var sh = ss_().getSheetByName(PROG_SHEET);
  if (!sh) return [];
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, PROG_HEAD.length).getValues();
  var map = {}, order = [];
  vals.forEach(function (r) {
    var name = String(r[0]).trim();
    if (!name) return;
    if (!map[name]) { map[name] = { name: name, note: '', items: [] }; order.push(name); }
    var id = String(r[2]).trim();
    if (!id) { map[name].note = String(r[4] || '').trim(); return; }
    map[name].items.push({ exId: id, order: num_(r[1]), note: String(r[4] || '').trim() });
  });
  return order.map(function (n) {
    var p = map[n];
    p.items.sort(function (a, b) { return a.order - b.order; });
    return p;
  });
}

function splitTags_(v) {
  var seen = {}, out = [];
  String(v === null || v === undefined ? '' : v).split(/[,、，\s]+/).forEach(function (s) {
    s = s.replace(/^[#＃]/, '').trim();
    if (s && !seen[s]) { seen[s] = 1; out.push(s); }
  });
  return out;
}

function getParts_() {
  return rows_(SH.PARTS).filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r, i) {
    return { part: String(r[0]).trim(), group: String(r[1]).trim() || 'その他', order: r[2] === '' ? 999 + i : num_(r[2]) };
  }).sort(function (a, b) { return a.order - b.order; });
}

function exFromRow_(r) {
  return {
    id: String(r[0]).trim(),
    name: String(r[1]).trim(),
    part: String(r[2]).trim(),
    equipment: String(r[3]).trim(),
    measure: String(r[4]).trim() === '秒' ? '秒' : '回数',
    loadType: LOAD_TYPES.indexOf(String(r[5]).trim()) >= 0 ? String(r[5]).trim() : 'なし',
    wMult: num_(r[6]) || 1,
    rMult: num_(r[7]) || 1,
    intensity: String(r[8] || '').trim(),
    def: num_(r[9]),
    min: num_(r[10]),
    max: num_(r[11]),
    step: num_(r[12]),
    order: r[13] === '' ? 999 : num_(r[13]),
    active: bool_(r[14]),
    inVol: (r[15] === '' || r[15] === undefined) ? true : bool_(r[15]), // 総負荷量に含めるか（空欄は含める）
    secondary: splitParts_(r[16], String(r[2]).trim()), // 付随部位（カンマ区切り。集計は0.5換算）
    link: /^https?:\/\//.test(String(r[17] || '').trim()) ? String(r[17]).trim() : '', // 参考リンク（やり方の解説ページ）
    progOnly: r[18] === true || String(r[18]).trim().toUpperCase() === 'TRUE', // プログラム専用（種目一覧には出さず、プログラムからだけ選ぶ）
    tags: splitTags_(r[19]) // タグ（カンマ区切り。例：肩リハ,チューブ）
  };
}

function getExercises_(includeInactive) {
  return rows_(SH.EX)
    .filter(function (r) { return String(r[0]).trim() !== '' && String(r[1]).trim() !== ''; })
    .map(exFromRow_)
    .filter(function (e) { return includeInactive || e.active; })
    .sort(function (a, b) { return a.order - b.order || (a.id < b.id ? -1 : 1); });
}

function partGroupMap_() {
  var m = {};
  getParts_().forEach(function (p) { m[p.part] = p.group; });
  return m;
}

/* 付随部位（サブで使う筋肉）
 * 種目マスタQ列「付随部位」にカンマ区切りで登録。部位別の集計ではメイン部位=1セット、付随部位=0.5セット
 * （レップ・秒・総負荷量も0.5倍）として加算する。全体の合計（セット数・総負荷量など）は二重に数えない。 */
var SECONDARY_WEIGHT = 0.5;

function splitParts_(v, main) {
  var seen = {}, out = [];
  String(v === null || v === undefined ? '' : v).split(/[,、，・\/\s]+/).forEach(function (s) {
    s = s.trim();
    if (s && s !== main && !seen[s]) { seen[s] = 1; out.push(s); }
  });
  return out;
}

function secondaryMap_() {
  var m = {};
  getExercises_(true).forEach(function (e) { m[e.id] = e.secondary; });
  return m;
}

/** 1セットを部位ごとの持ち分に展開：[{part, w}]（メイン×1、付随×0.5） */
function partShares_(l) {
  var out = [{ part: l.part, w: 1 }];
  (l.secondary || []).forEach(function (p) { out.push({ part: p, w: SECONDARY_WEIGHT }); });
  return out;
}

/** 部位別に、重み付きの記録へ振り分ける（agg_ にそのまま渡せる形） */
function groupShares_(logs) {
  var m = {};
  logs.forEach(function (l) {
    partShares_(l).forEach(function (s) {
      (m[s.part] = m[s.part] || []).push({ date: l.date, aReps: l.aReps, aSecs: l.aSecs, vol: l.vol, w: s.w });
    });
  });
  return m;
}

/* ============================================================
 * 記録データ読み込み
 * ============================================================ */

function logObj_(r, rowIndex) {
  return {
    row: rowIndex,
    id: String(r[L.ID]),
    at: r[L.AT] instanceof Date ? Utilities.formatDate(r[L.AT], TZ, 'yyyy/MM/dd HH:mm:ss') : String(r[L.AT]),
    date: ymd_(r[L.DATE]) || ymd_(r[L.AT]),
    exId: String(r[L.EXID]),
    exName: String(r[L.EXNAME]),
    part: String(r[L.PART]),
    group: String(r[L.GROUP]) || 'その他',
    equipment: String(r[L.EQUIP]),
    setNo: num_(r[L.SETNO]),
    load: num_(r[L.LOAD]),
    intensity: String(r[L.INTENSITY] || ''),
    reps: num_(r[L.REPS]),
    secs: num_(r[L.SECS]),
    aReps: num_(r[L.AREPS]),
    aSecs: num_(r[L.ASECS]),
    vol: num_(r[L.VOL]),
    status: String(r[L.STATUS]).trim(),
    memo: String(r[L.MEMO] === undefined || r[L.MEMO] === null ? '' : r[L.MEMO])
  };
}

/** 確定済みの記録を返す（from/to は 'yyyy/MM/dd'、省略可） */
function getLogs_(from, to) {
  var out = [], secMap = secondaryMap_();
  rows_(SH.LOG).forEach(function (r, i) {
    if (String(r[L.ID]).trim() === '') return;
    var o = logObj_(r, i + 2);
    if (o.status !== '確定' || !o.date) return;
    if (from && o.date < from) return;
    if (to && o.date > to) return;
    o.secondary = (secMap[o.exId] || []).filter(function (p) { return p !== o.part; });
    out.push(o);
  });
  out.sort(function (a, b) { return a.at < b.at ? -1 : a.at > b.at ? 1 : 0; });
  return out;
}

/* ============================================================
 * 集計値の計算（1セット分）
 * ============================================================ */

function calcSet_(ex, load, reps, secs) {
  var aReps = 0, aSecs = 0, vol = 0;
  if (ex.measure === '秒') {
    aSecs = secs * ex.rMult;
  } else {
    aReps = reps * ex.rMult;
    if ((ex.loadType === 'kg' || ex.loadType === '加重') && ex.inVol !== false) {
      vol = load * ex.wMult * reps * ex.rMult;
    }
  }
  return { aReps: aReps, aSecs: aSecs, vol: r1_(vol) };
}

/* ============================================================
 * 入力画面 API
 * ============================================================ */

function getInitData() {
  ensureSettings_();
  ensureParts_();
  ensurePrograms_();
  var today = today_();
  var exercises = getExercises_(false);
  var logs = getLogs_(null, null);

  // 種目ごとの「前回」（今日より前の最新日のセット一覧）と「今日」のセット
  var prev = {}, todaySets = {};
  logs.forEach(function (l) {
    if (l.date === today) {
      (todaySets[l.exId] = todaySets[l.exId] || []).push(setView_(l));
    } else if (l.date < today) {
      var p = prev[l.exId];
      if (!p || l.date > p.date) prev[l.exId] = { date: l.date, sets: [setView_(l)] };
      else if (l.date === p.date) p.sets.push(setView_(l));
    }
  });

  return {
    today: today,
    exercises: exercises,
    parts: getParts_(),
    equipments: EQUIPMENTS,
    measures: MEASURES,
    loadTypes: LOAD_TYPES,
    equipDefaults: EQUIP_DEFAULTS,
    settings: getSettings_(),
    prev: prev,
    todaySets: todaySets,
    programs: getPrograms_(),
    todaySummary: summarizeDay_(logs.filter(function (l) { return l.date === today; }))
  };
}

function setView_(l) {
  return { id: l.id, at: l.at, setNo: l.setNo, load: l.load, intensity: l.intensity, reps: l.reps, secs: l.secs, aReps: l.aReps, aSecs: l.aSecs, vol: l.vol, memo: l.memo };
}

/** 備考の整形（500文字まで。先頭が = + - @ の場合は数式として解釈されないよう ' を付ける） */
function memo_(v) {
  var s = String(v === undefined || v === null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, 500);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function summarizeDay_(logs) {
  var byPart = {}, tot = { sets: 0, reps: 0, secs: 0, vol: 0 };
  var gmap = partGroupMap_();
  logs.forEach(function (l) {
    partShares_(l).forEach(function (s) {
      var k = s.part;
      var p = byPart[k] = byPart[k] || { part: k, group: gmap[k] || (s.w === 1 ? l.group : 'その他'), sets: 0, reps: 0, secs: 0, vol: 0 };
      p.sets += s.w; p.reps += l.aReps * s.w; p.secs += l.aSecs * s.w; p.vol += l.vol * s.w;
    });
    tot.sets++; tot.reps += l.aReps; tot.secs += l.aSecs; tot.vol += l.vol;
  });
  var order = {};
  getParts_().forEach(function (p, i) { order[p.part] = i; });
  var parts = Object.keys(byPart).map(function (k) { var p = byPart[k]; p.vol = r1_(p.vol); p.sets = r1_(p.sets); p.reps = r1_(p.reps); p.secs = r1_(p.secs); return p; })
    .sort(function (a, b) { return (order[a.part] === undefined ? 999 : order[a.part]) - (order[b.part] === undefined ? 999 : order[b.part]); });
  tot.vol = r1_(tot.vol);
  return { total: tot, parts: parts };
}

/**
 * 1セットを記録する
 * @param {Object} p {clientId, exerciseId, load, reps, secs}
 */
function recordSet(p) {
  if (!p || !p.exerciseId) throw new Error('種目が指定されていません');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ex = getExercises_(true).filter(function (e) { return e.id === String(p.exerciseId); })[0];
    if (!ex) throw new Error('種目IDが見つかりません：' + p.exerciseId);

    var load = (ex.loadType === 'kg' || ex.loadType === '加重') ? num_(p.load) : 0;
    var reps = ex.measure === '回数' ? Math.round(num_(p.reps)) : 0;
    var secs = ex.measure === '秒' ? Math.round(num_(p.secs)) : 0;
    if (load < 0) throw new Error('負荷がマイナスです');
    if (ex.measure === '回数' && reps <= 0) throw new Error('回数を1以上にしてください');
    if (ex.measure === '秒' && secs <= 0) throw new Error('秒数を1以上にしてください');
    if (reps > 1000 || secs > 36000 || load > 1000) throw new Error('値が大きすぎます。入力を確認してください');

    var sh = sheet_(SH.LOG);
    var id = String(p.clientId || uuid_());
    var all = rows_(SH.LOG);
    var today = today_();
    // アプリ版（オフライン記録）は端末側の日時を使う。明らかにおかしい日付は今日扱い
    var date = ymd_(p.date) || today;
    if (date > addDays_(today, 1) || date < addDays_(today, -60)) date = today;
    var atDate = parseAt_(p.at) || new Date();

    // 二重送信防止（同じ clientId が既にあれば記録しない）
    for (var i = 0; i < all.length; i++) {
      if (String(all[i][L.ID]) === id) {
        return afterWrite_(ex.id, today, null);
      }
    }

    // セット番号は「今日の確定セットの最大番号＋1」（途中を取消しても番号が重複しないように）
    var setNo = 1;
    all.forEach(function (r) {
      if (String(r[L.EXID]) === ex.id && String(r[L.STATUS]).trim() === '確定' && (ymd_(r[L.DATE]) || ymd_(r[L.AT])) === date) setNo = Math.max(setNo, num_(r[L.SETNO]) + 1);
    });

    var c = calcSet_(ex, load, reps, secs);
    var group = partGroupMap_()[ex.part] || 'その他';
    var row = [id, atDate, date, ex.id, ex.name, ex.part, group, ex.equipment, setNo,
      (ex.loadType === 'kg' || ex.loadType === '加重') ? load : '',
      ex.loadType === '強度固定' ? (String(p.intensity || '').trim().slice(0, 40) || ex.intensity) : '', // チューブはシングル／ダブルを記録ごとに選択
      ex.measure === '回数' ? reps : '',
      ex.measure === '秒' ? secs : '',
      c.aReps, c.aSecs, c.vol, '確定', '', memo_(p.memo)];
    var at = sh.getLastRow() + 1;
    sh.getRange(at, L.DATE + 1).setNumberFormat('@'); // 日付は文字列で保持（自動で日付型にならないように先に書式を設定）
    sh.getRange(at, 1, 1, row.length).setValues([row]);
    all.push(row); // 読み込み済みデータにも反映（シートを読み直さない）

    rebuildDailyForDate_(date);
    return afterWrite_(ex.id, today, id);
  } finally {
    lock.releaseLock();
  }
}

function afterWrite_(exId, today, recordedId) {
  var logs = getLogs_(today, today);
  return {
    recordedId: recordedId,
    today: today,
    exerciseId: exId,
    sets: logs.filter(function (l) { return l.exId === exId; }).map(setView_),
    todaySummary: summarizeDay_(logs)
  };
}

/** 記録を取消（状態=取消）。行は削除せず残す（POSと同じ方針） */
function cancelRecord(recordId) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(SH.LOG);
    var all = rows_(SH.LOG);
    for (var i = 0; i < all.length; i++) {
      if (String(all[i][L.ID]) === String(recordId)) {
        var o = logObj_(all[i], i + 2);
        if (o.status !== '取消') {
          sh.getRange(i + 2, L.STATUS + 1, 1, 2).setValues([['取消', new Date()]]);
          all[i][L.STATUS] = '取消';
          rebuildDailyForDate_(o.date);
        }
        return afterWrite_(o.exId, today_(), null);
      }
    }
    throw new Error('記録が見つかりません：' + recordId);
  } finally {
    lock.releaseLock();
  }
}

/** 記録済みセットの備考を書き換える */
function updateMemo(recordId, memo) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(SH.LOG);
    var all = rows_(SH.LOG);
    for (var i = 0; i < all.length; i++) {
      if (String(all[i][L.ID]) === String(recordId)) {
        var mv = memo_(memo);
        sh.getRange(i + 2, L.MEMO + 1).setValue(mv);
        all[i][L.MEMO] = mv;
        return afterWrite_(String(all[i][L.EXID]), today_(), null);
      }
    }
    throw new Error('記録が見つかりません：' + recordId);
  } finally {
    lock.releaseLock();
  }
}

/** インターバル秒の保存 */
function saveInterval(secs) {
  var v = Math.max(5, Math.min(900, Math.round(num_(secs))));
  var sh = sheet_(SH.SETTINGS);
  var all = rows_(SH.SETTINGS);
  for (var i = 0; i < all.length; i++) {
    if (String(all[i][0]).trim() === 'インターバル秒') {
      sh.getRange(i + 2, 2).setValue(v);
      return v;
    }
  }
  sh.appendRow(['インターバル秒', v, 'セット間の休憩タイマー（秒）']);
  return v;
}

/* =============================================================
 * アプリ版（PWA・オフライン対応）用 API
 * 「全員」公開のデプロイに POST で呼ばれる。トークン（スクリプトプロパティ API_TOKEN）で認証
 * ============================================================= */

// アプリ版の置き場所と、API 用デプロイの URL（スクリプトプロパティ APP_URL / API_URL）
function appConfig_() {
  var pr = PropertiesService.getScriptProperties();
  return { app: pr.getProperty('APP_URL') || '', api: pr.getProperty('API_URL') || '' };
}

function apiToken_() {
  var pr = PropertiesService.getScriptProperties();
  var t = pr.getProperty('API_TOKEN');
  if (!t) {
    t = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
    pr.setProperty('API_TOKEN', t);
  }
  return t;
}

/** 記録画面（Google ログイン版）から呼ぶ：アプリ版の設定用リンクを返す */
function getMobileSetup() {
  if (!isOwner_()) throw new Error('権限がありません');
  var c = appConfig_();
  if (!c.app || !c.api) return { ready: false };
  return { ready: true, app: c.app, api: c.api, token: apiToken_(), sheetUrl: ss_().getUrl() };
}

function parseAt_(s) {
  if (!s) return null;
  try {
    var d = Utilities.parseDate(String(s), TZ, 'yyyy/MM/dd HH:mm:ss');
    return isNaN(d.getTime()) ? null : d;
  } catch (err) {
    return null;
  }
}

/**
 * オフライン中にたまった操作をまとめて反映し、最新の初期データを返す
 * op: {qid, type:'record'|'cancel'|'memo'|'interval', ...}
 * 記録は clientId で二重登録を防ぐので、同じ操作を何度送っても安全
 */
function syncOps(ops) {
  var results = [];
  (ops || []).forEach(function (op) {
    try {
      if (op.type === 'record') recordSet(op);
      else if (op.type === 'cancel') cancelRecord(op.id);
      else if (op.type === 'memo') updateMemo(op.id, op.memo);
      else if (op.type === 'interval') saveInterval(op.secs);
      else throw new Error('不明な操作：' + op.type);
      results.push({ qid: op.qid, ok: true });
    } catch (err) {
      results.push({ qid: op.qid, ok: false, error: String(err && err.message || err) });
    }
  });
  return { results: results, init: getInitData() };
}

function doPost(e) {
  var out;
  try {
    var req = JSON.parse(e.postData.contents);
    var tok = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
    if (!tok || req.token !== tok) throw new Error('AUTH: 認証に失敗しました（設定をやり直してください）');
    var fns = {
      ping: function () { return { today: today_() }; },
      getInitData: getInitData,
      syncOps: syncOps,
      getAnalytics: getAnalytics,
      addExercise: addExercise,
      updateExerciseSecondary: updateExerciseSecondary,
      updateExercisePart: updateExercisePart,
      updateExerciseLinks: updateExerciseLinks,
      updateExerciseFields: updateExerciseFields,
      updateExerciseTags: updateExerciseTags,
      // AIトレーナー（AiTrainer.gs）
      aiConsult: aiConsult,
      aiApplyProgram: aiApplyProgram,
      aiDeleteProgram: aiDeleteProgram
    };
    var f = fns[String(req.fn || '')];
    if (!f) throw new Error('不明な操作：' + req.fn);
    out = { ok: true, data: f.apply(null, req.args || []) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/**
 * 種目のメイン部位を変更する（過去の記録の部位・部位グループも書き換え、日次集計を作り直す）
 * @param {string} exId
 * @param {string} part 新しいメイン部位
 * @param {string[]=} secondary 付随部位（省略時は変更しない）
 */
function updateExercisePart(exId, part, secondary) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    part = String(part || '').trim();
    var gmap = partGroupMap_();
    if (!gmap[part]) throw new Error('部位マスタにない部位です：' + part);
    var exSh = sheet_(SH.EX), exRows = rows_(SH.EX), found = -1;
    for (var i = 0; i < exRows.length; i++) if (String(exRows[i][0]).trim() === String(exId)) { found = i; break; }
    if (found < 0) throw new Error('種目が見つかりません：' + exId);
    exSh.getRange(found + 2, 3).setValue(part);
    if (secondary) {
      ensureExHeader_(exSh);
      var sec = secondary.map(String).filter(function (p, j, a) { return gmap[p] && p !== part && a.indexOf(p) === j; });
      exSh.getRange(found + 2, 17).setValue(sec.join(','));
    }
    invalidate_(SH.EX);
    // 記録データの部位・部位グループ列をまとめて書き換え
    var logs = rows_(SH.LOG), n = 0;
    if (logs.length) {
      var cols = logs.map(function (r) {
        if (String(r[L.EXID]) === String(exId) && (String(r[L.PART]) !== part || String(r[L.GROUP]) !== gmap[part])) { n++; return [part, gmap[part]]; }
        return [r[L.PART], r[L.GROUP]];
      });
      if (n) sheet_(SH.LOG).getRange(2, L.PART + 1, cols.length, 2).setValues(cols);
    }
    invalidate_(SH.LOG);
    rebuildAllDaily();
    return { updatedLogs: n, exercises: getExercises_(false) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 種目の参考リンク（R列）をまとめて設定する
 * @param {Object} map { 種目ID: URL }
 */
function updateExerciseLinks(map) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(SH.EX), rows = rows_(SH.EX), n = 0;
    var h = sh.getRange(1, 18);
    if (String(h.getValue()).trim() !== '参考リンク') { h.setValue('参考リンク').setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff'); sh.setColumnWidth(18, 320); }
    for (var i = 0; i < rows.length; i++) {
      var id = String(rows[i][0]).trim();
      if (map && map[id] !== undefined) {
        var url = String(map[id] || '').trim();
        if (url && !/^https?:\/\//.test(url)) continue;
        sh.getRange(i + 2, 18).setValue(url);
        n++;
      }
    }
    invalidate_(SH.EX);
    return { updated: n, exercises: getExercises_(false) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 種目の名前・プログラム専用フラグを変更する
 * @param {string} exId
 * @param {Object} f { name?: string, progOnly?: boolean }
 */
function updateExerciseFields(exId, f) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(SH.EX), rows = rows_(SH.EX), found = -1;
    for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === String(exId)) { found = i; break; }
    if (found < 0) throw new Error('種目が見つかりません：' + exId);
    f = f || {};
    if (f.name !== undefined) {
      var name = String(f.name).trim();
      if (!name) throw new Error('種目名が空です');
      rows.forEach(function (r, j) { if (j !== found && String(r[1]).trim() === name) throw new Error('同じ名前の種目が既にあります：' + name); });
      sh.getRange(found + 2, 2).setValue(name);
    }
    if (f.progOnly !== undefined) {
      var h = sh.getRange(1, 19);
      if (String(h.getValue()).trim() !== 'プログラム専用') { h.setValue('プログラム専用').setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff'); sh.setColumnWidth(19, 110); }
      var c = sh.getRange(found + 2, 19);
      c.insertCheckboxes();
      c.setValue(!!f.progOnly);
    }
    invalidate_(SH.EX);
    return { exercises: getExercises_(false) };
  } finally {
    lock.releaseLock();
  }
}

/**
 * 種目のタグ（T列）を設定する
 * @param {string} exId
 * @param {string[]} tags
 */
function updateExerciseTags(exId, tags) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(SH.EX), rows = rows_(SH.EX), found = -1;
    for (var i = 0; i < rows.length; i++) if (String(rows[i][0]).trim() === String(exId)) { found = i; break; }
    if (found < 0) throw new Error('種目が見つかりません：' + exId);
    var h = sh.getRange(1, 20);
    if (String(h.getValue()).trim() !== 'タグ') { h.setValue('タグ').setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff'); sh.setColumnWidth(20, 160); }
    sh.getRange(found + 2, 20).setValue(splitTags_((tags || []).join(',')).join(','));
    invalidate_(SH.EX);
    return { exercises: getExercises_(false) };
  } finally {
    lock.releaseLock();
  }
}

/** 種目マスタに「付随部位」列（Q列）の見出しが無ければ作る */
function ensureExHeader_(sh) {
  var c = sh.getRange(1, 17);
  if (String(c.getValue()).trim() !== '付随部位') {
    c.setValue('付随部位').setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setColumnWidth(17, 200);
  }
}

/**
 * 種目の付随部位を更新する（過去の記録にもさかのぼって反映し、日次集計を作り直す）
 * @param {string} exId
 * @param {string[]} list 付随部位の配列
 */
function updateExerciseSecondary(exId, list) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(SH.EX);
    var rows = rows_(SH.EX);
    var valid = {};
    getParts_().forEach(function (p) { valid[p.part] = 1; });
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i][0]).trim() === String(exId)) {
        var main = String(rows[i][2]).trim();
        var v = (list || []).map(String).filter(function (p, j, a) { return valid[p] && p !== main && a.indexOf(p) === j; });
        ensureExHeader_(sh);
        sh.getRange(i + 2, 17).setValue(v.join(','));
        invalidate_(SH.EX);
        rebuildAllDaily();
        var today = today_();
        return { exercises: getExercises_(false), todaySummary: summarizeDay_(getLogs_(today, today)) };
      }
    }
    throw new Error('種目が見つかりません：' + exId);
  } finally {
    lock.releaseLock();
  }
}

/**
 * 種目を追加する
 * @param {Object} p {name, part, equipment, measure, loadType, wMult, rMult, intensity, def, min, max, step}
 */
function addExercise(p) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var name = String(p && p.name || '').trim();
    if (!name) throw new Error('種目名を入力してください');
    var part = String(p.part || '').trim();
    var parts = getParts_().map(function (x) { return x.part; });
    if (parts.indexOf(part) < 0) throw new Error('部位を選択してください');
    var equipment = EQUIPMENTS.indexOf(p.equipment) >= 0 ? p.equipment : 'その他';
    var d = EQUIP_DEFAULTS[equipment];

    var all = getExercises_(true);
    all.forEach(function (e) {
      if (e.name === name) throw new Error('同じ名前の種目が既にあります：' + name);
    });

    var maxNo = 0, maxOrder = 0;
    all.forEach(function (e) {
      var m = e.id.match(/(\d+)/);
      if (m) maxNo = Math.max(maxNo, +m[1]);
      if (e.order < 999) maxOrder = Math.max(maxOrder, e.order);
    });
    var id = 'E' + ('00' + (maxNo + 1)).slice(-3);

    var measure = MEASURES.indexOf(p.measure) >= 0 ? p.measure : d.measure;
    var loadType = LOAD_TYPES.indexOf(p.loadType) >= 0 ? p.loadType : d.loadType;
    if (measure === '秒' && (loadType === 'kg' || loadType === '加重')) {
      // 秒種目は総負荷量に入らない。負荷は記録だけ残す
    }
    var wMult = p.wMult !== undefined && p.wMult !== '' ? (num_(p.wMult) || 1) : d.wMult;
    var rMult = p.rMult !== undefined && p.rMult !== '' ? (num_(p.rMult) || 1) : d.rMult;
    var min = p.min !== undefined && p.min !== '' ? num_(p.min) : d.min;
    var max = p.max !== undefined && p.max !== '' ? num_(p.max) : d.max;
    var step = p.step !== undefined && p.step !== '' ? num_(p.step) : d.step;
    var def = p.def !== undefined && p.def !== '' ? num_(p.def) : d.def;
    var intensity = loadType === '強度固定' ? (String(p.intensity || '').trim() || d.intensity || '固定') : '';
    var inVol = (p.inVol === undefined || p.inVol === '') ? (d.inVol !== false) : bool_(p.inVol);

    var exSh = sheet_(SH.EX);
    var newRow = exDataRows_(exSh) + 2;
    var secondary = (p.secondary || []).map(String).filter(function (x, i, a) { return parts.indexOf(x) >= 0 && x !== part && a.indexOf(x) === i; });
    ensureExHeader_(exSh);
    exSh.getRange(newRow, 1, 1, 17).setValues([[id, name, part, equipment, measure, loadType, wMult, rMult, intensity, def, min, max, step, maxOrder + 1, true, inVol, secondary.join(',')]]);
    exSh.getRange(newRow, 15, 1, 2).insertCheckboxes();
    var tg = splitTags_((p.tags || []).join ? p.tags.join(',') : String(p.tags || ''));
    if (tg.length) { var th = exSh.getRange(1, 20); if (String(th.getValue()).trim() !== 'タグ') th.setValue('タグ').setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff'); exSh.getRange(newRow, 20).setValue(tg.join(',')); }
    invalidate_(SH.EX);
    return { id: id, exercises: getExercises_(false) };
  } finally {
    lock.releaseLock();
  }
}

/* ============================================================
 * 日次集計シート
 * ============================================================ */

function dailyRowsFor_(logs) {
  var by = {};
  var gmap = partGroupMap_();
  logs.forEach(function (l) {
    partShares_(l).forEach(function (s) {
      var k = l.date + '|' + s.part;
      var o = by[k] = by[k] || { date: l.date, group: gmap[s.part] || (s.w === 1 ? l.group : 'その他'), part: s.part, sets: 0, reps: 0, secs: 0, vol: 0, ex: {} };
      o.sets += s.w; o.reps += l.aReps * s.w; o.secs += l.aSecs * s.w; o.vol += l.vol * s.w; o.ex[l.exId] = 1;
    });
  });
  return Object.keys(by).map(function (k) {
    var o = by[k];
    return [o.date, o.group, o.part, r1_(o.sets), r1_(o.reps), r1_(o.secs), r1_(o.vol), Object.keys(o.ex).length];
  });
}

/** fromDate を渡すと、その日付以降の行だけ書き換える（毎回シート全体を書き直さない＝高速化） */
function writeDaily_(rows, fromDate) {
  var sh = sheet_(SH.DAILY);
  var order = {};
  getParts_().forEach(function (p, i) { order[p.part] = i; });
  rows.sort(function (a, b) {
    if (a[0] !== b[0]) return a[0] < b[0] ? -1 : 1;
    return (order[a[2]] === undefined ? 999 : order[a[2]]) - (order[b[2]] === undefined ? 999 : order[b[2]]);
  });
  var oldN = Math.max(0, sh.getLastRow() - 1);
  var start = 0;
  if (fromDate) while (start < rows.length && rows[start][0] < fromDate) start++;
  var n = rows.length - start;
  if (oldN > start + n) sh.getRange(2 + start + n, 1, oldN - start - n, HEAD.DAILY.length).clearContent();
  if (n > 0) {
    sh.getRange(2 + start, 1, n, 1).setNumberFormat('@');
    sh.getRange(2 + start, 1, n, HEAD.DAILY.length).setValues(rows.slice(start));
  }
  invalidate_(SH.DAILY);
}

function rebuildDailyForDate_(date) {
  var keep = rows_(SH.DAILY).filter(function (r) { return ymd_(r[0]) && ymd_(r[0]) !== date; })
    .map(function (r) { r = r.slice(0, HEAD.DAILY.length); r[0] = ymd_(r[0]); return r; });
  var fresh = dailyRowsFor_(getLogs_(date, date));
  writeDaily_(keep.concat(fresh), date);
}

function rebuildAllDaily() {
  writeDaily_(dailyRowsFor_(getLogs_(null, null)));
}

/* ============================================================
 * 分析 API
 * ============================================================ */

/**
 * 期間の範囲を返す
 * type: day | week | month | quarter | year
 */
function periodRange_(type, anchor) {
  var a = ymdParts_(anchor), start, end, label;
  if (type === 'day') {
    start = end = anchor;
    label = a.y + '年' + a.m + '月' + a.d + '日（' + '日月火水木金土'.charAt(dow_(anchor)) + '）';
  } else if (type === 'week') {
    var back = (dow_(anchor) + 6) % 7; // 月曜始まり
    start = addDays_(anchor, -back);
    end = addDays_(start, 6);
    var s = ymdParts_(start), e = ymdParts_(end);
    label = s.y + '年' + s.m + '/' + s.d + '（月）〜' + (e.y !== s.y ? e.y + '年' : '') + e.m + '/' + e.d + '（日）';
  } else if (type === 'month') {
    start = mk_(a.y, a.m, 1);
    end = mk_(a.y, a.m + 1, 0);
    label = a.y + '年' + a.m + '月';
  } else if (type === 'quarter') {
    var q = Math.floor((a.m - 1) / 3);
    start = mk_(a.y, q * 3 + 1, 1);
    end = mk_(a.y, q * 3 + 4, 0);
    label = a.y + '年 第' + (q + 1) + '四半期（' + (q * 3 + 1) + '〜' + (q * 3 + 3) + '月）';
  } else {
    type = 'year';
    start = mk_(a.y, 1, 1);
    end = mk_(a.y, 12, 31);
    label = a.y + '年';
  }
  return { type: type, start: start, end: end, label: label };
}

function shiftAnchor_(type, anchor, n) {
  var a = ymdParts_(anchor);
  if (type === 'day') return addDays_(anchor, n);
  if (type === 'week') return addDays_(anchor, 7 * n);
  if (type === 'month') return mk_(a.y, a.m + n, 1);
  if (type === 'quarter') return mk_(a.y, a.m + 3 * n, 1);
  return mk_(a.y + n, 1, 1);
}

function agg_(logs) {
  var t = { sets: 0, reps: 0, secs: 0, vol: 0, days: 0 };
  var days = {};
  logs.forEach(function (l) {
    var w = (l.w === undefined) ? 1 : l.w; // 付随部位は0.5
    t.sets += w; t.reps += l.aReps * w; t.secs += l.aSecs * w; t.vol += l.vol * w; days[l.date] = 1;
  });
  t.days = Object.keys(days).length;
  t.vol = r1_(t.vol); t.sets = r1_(t.sets); t.reps = r1_(t.reps); t.secs = r1_(t.secs);
  return t;
}

function groupBy_(logs, keyFn) {
  var m = {};
  logs.forEach(function (l) { var k = keyFn(l); (m[k] = m[k] || []).push(l); });
  return m;
}

function trendBuckets_(range) {
  var b = [];
  if (range.type === 'week' || range.type === 'month') {
    for (var d = range.start; d <= range.end; d = addDays_(d, 1)) {
      var p = ymdParts_(d);
      b.push({ key: d, from: d, to: d, label: range.type === 'week' ? '月火水木金土日'.charAt((dow_(d) + 6) % 7) + ' ' + p.d : String(p.d) });
    }
  } else if (range.type === 'quarter') {
    var s = range.start;
    var back = (dow_(s) + 6) % 7;
    for (var w = addDays_(s, -back); w <= range.end; w = addDays_(w, 7)) {
      var from = w < range.start ? range.start : w;
      var to = addDays_(w, 6) > range.end ? range.end : addDays_(w, 6);
      var fp = ymdParts_(from);
      b.push({ key: from, from: from, to: to, label: fp.m + '/' + fp.d + '〜' });
    }
  } else if (range.type === 'year') {
    var y = ymdParts_(range.start).y;
    for (var m = 1; m <= 12; m++) b.push({ key: m, from: mk_(y, m, 1), to: mk_(y, m + 1, 0), label: m + '月' });
  }
  return b;
}

function getAnalytics(type, anchor) {
  anchor = ymd_(anchor) || today_();
  var cur = periodRange_(type, anchor);
  var prv = periodRange_(cur.type, shiftAnchor_(cur.type, anchor, -1));
  var all = getLogs_(prv.start, cur.end);
  var curLogs = all.filter(function (l) { return l.date >= cur.start && l.date <= cur.end; });
  var prvLogs = all.filter(function (l) { return l.date >= prv.start && l.date <= prv.end; });

  // 部位別
  var parts = getParts_();
  var order = {}; parts.forEach(function (p, i) { order[p.part] = i; });
  var gmap = partGroupMap_();
  var cp = groupShares_(curLogs); // メイン×1＋付随×0.5
  var pp = groupShares_(prvLogs);
  var partKeys = Object.keys(cp).concat(Object.keys(pp).filter(function (k) { return !cp[k]; }));
  var byPart = partKeys.map(function (k) {
    return { part: k, group: gmap[k] || 'その他', cur: agg_(cp[k] || []), prev: agg_(pp[k] || []) };
  }).sort(function (a, b) { return (order[a.part] === undefined ? 999 : order[a.part]) - (order[b.part] === undefined ? 999 : order[b.part]); });

  // 種目別
  // 強度固定（チューブのシングル／ダブル等）は強度ごとに別の行にする
  var exKey = function (l) { return l.exId + (l.intensity ? '|' + l.intensity : ''); };
  var ce = groupBy_(curLogs, exKey);
  var pe = groupBy_(prvLogs, exKey);
  var exMeta = {}; getExercises_(true).forEach(function (e, i) { exMeta[e.id] = { e: e, i: i }; });
  var byExercise = Object.keys(ce).map(function (k) {
    var ls = ce[k];
    var maxLoad = 0, best = null;
    ls.forEach(function (l) {
      if (l.load > maxLoad) maxLoad = l.load;
      var score = l.vol || l.aReps || l.aSecs;
      if (!best || score > best.score) best = { score: score, load: l.load, reps: l.reps, secs: l.secs, date: l.date };
    });
    var meta = exMeta[ls[0].exId];
    return {
      id: k, name: ls[ls.length - 1].exName, part: ls[0].part,
      measure: meta ? meta.e.measure : (ls[0].secs ? '秒' : '回数'),
      loadType: meta ? meta.e.loadType : '',
      intensity: ls[ls.length - 1].intensity,
      cur: agg_(ls), prev: agg_(pe[k] || []), maxLoad: maxLoad, best: best,
      order: meta ? meta.i : 999
    };
  }).sort(function (a, b) {
    return (order[a.part] === undefined ? 999 : order[a.part]) - (order[b.part] === undefined ? 999 : order[b.part]) || a.order - b.order;
  });

  // 推移
  var trend = trendBuckets_(cur).map(function (bk) {
    var a = agg_(curLogs.filter(function (l) { return l.date >= bk.from && l.date <= bk.to; }));
    return { label: bk.label, from: bk.from, to: bk.to, sets: a.sets, reps: a.reps, secs: a.secs, vol: a.vol, days: a.days };
  });

  // 日計
  var cd = groupBy_(curLogs, function (l) { return l.date; });
  var daily = Object.keys(cd).sort().reverse().map(function (d) {
    var ls = cd[d];
    var partsOfDay = {};
    ls.forEach(function (l) { partsOfDay[l.part] = 1; });
    var a = agg_(ls);
    return {
      date: d, dow: '日月火水木金土'.charAt(dow_(d)), sets: a.sets, reps: a.reps, secs: a.secs, vol: a.vol,
      parts: Object.keys(partsOfDay).sort(function (x, y) { return (order[x] === undefined ? 999 : order[x]) - (order[y] === undefined ? 999 : order[y]); })
    };
  });

  // 日単位のときはセット明細も返す
  var sets = cur.type === 'day' ? curLogs.map(function (l) {
    return { at: l.at.slice(11, 16), exName: l.exName, part: l.part, setNo: l.setNo, load: l.load, intensity: l.intensity, reps: l.reps, secs: l.secs, aReps: l.aReps, aSecs: l.aSecs, vol: l.vol, memo: l.memo };
  }) : [];

  // 期間内の備考一覧（新しい順）
  var memos = curLogs.filter(function (l) { return l.memo !== ''; }).reverse().slice(0, 300).map(function (l) {
    return { date: l.date, at: l.at.slice(11, 16), exName: l.exName, part: l.part, setNo: l.setNo, memo: l.memo };
  });

  return {
    type: cur.type, anchor: anchor, today: today_(),
    range: cur, prevRange: prv,
    total: { cur: agg_(curLogs), prev: agg_(prvLogs) },
    byPart: byPart, byExercise: byExercise, trend: trend, daily: daily, sets: sets, memos: memos,
    periodDays: toDays_(cur.end) - toDays_(cur.start) + 1,
    heat: heatmap_(cur, byPart)
  };
}

/** 部位マップの色レベル（0=未実施 1=ウォームアップ 2=普通 3=追い込み） */
function heatmap_(range, byPart) {
  var st = getSettings_(), today = today_();
  var isDay = range.type === 'day';
  var lo = isDay ? st['部位色_日_普通'] : st['部位色_週_普通'];
  var hi = isDay ? st['部位色_日_追い込み'] : st['部位色_週_追い込み'];
  if (hi < lo) hi = lo;
  // 月・四半期・年は1週あたり平均に換算（進行中の期間は今日までの日数で割る）
  var perWeek = range.type === 'month' || range.type === 'quarter' || range.type === 'year';
  var weeks = 1;
  if (perWeek) {
    var end = range.end < today ? range.end : today;
    var days = end < range.start ? 1 : toDays_(end) - toDays_(range.start) + 1;
    weeks = Math.max(1, days / 7);
  }
  var parts = {};
  byPart.forEach(function (p) {
    var sets = p.cur.sets;
    var v = perWeek ? Math.round(sets / weeks * 10) / 10 : sets;
    parts[p.part] = { sets: sets, value: v, level: sets === 0 ? 0 : v >= hi ? 3 : v >= lo ? 2 : 1 };
  });
  return { basis: isDay ? 'day' : 'week', perWeek: perWeek, weeks: r1_(weeks), normal: lo, hard: hi, parts: parts };
}

/* ============================================================
 * 初期セットアップ
 * ============================================================ */

function setupSpreadsheet() {
  var ss = ss_();
  function ensure(name, head, widths) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.getRange(1, 1, 1, head.length).setValues([head]); // 見出しは常に最新に揃える（列追加に対応）
    sh.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    if (widths) widths.forEach(function (w, i) { if (w) sh.setColumnWidth(i + 1, w); });
    return sh;
  }

  var st = ensure(SH.SETTINGS, HEAD.SETTINGS, [140, 80, 320]);
  ensureSettings_();

  var pt = ensure(SH.PARTS, HEAD.PARTS, [140, 110, 70]);
  if (pt.getLastRow() < 2) {
    var parts = [
      ['大胸筋', '胸'],
      ['広背筋', '背中'], ['大円筋', '背中'], ['僧帽筋', '背中'], ['脊柱起立筋', '背中'],
      ['三角筋', '肩'],
      ['上腕二頭筋', '腕'], ['上腕三頭筋', '腕'], ['前腕筋', '腕'],
      ['腹直筋', '腹'], ['腹斜筋', '腹'],
      ['大臀筋', '脚'], ['大腿四頭筋', '脚'], ['ハムストリングス', '脚'], ['内転筋', '脚'], ['下腿三頭筋', '脚']
    ].map(function (r, i) { return [r[0], r[1], i + 1]; });
    pt.getRange(2, 1, parts.length, 3).setValues(parts);
  }

  var ex = ensure(SH.EX, HEAD.EX, [70, 160, 110, 110, 60, 80, 70, 70, 130, 70, 70, 70, 70, 60, 50, 110, 200]);
  if (ex.getLastRow() < 2) {
    var seed = [
      // ID, 種目名, 部位, 器具, 計測, 負荷タイプ, 負荷倍率, 回数倍率, 強度, 既定負荷, 最小, 最大, 刻み, 表示順, 有効, 総負荷量に含める
      ['E001', 'ダンベルプレス', '大胸筋', 'ダンベル', '回数', 'kg', 2, 1, '', 10, 2.5, 20, 2.5, 1, true, true],
      ['E002', 'プッシュアップ', '大胸筋', '自重', '回数', '加重', 1, 1, '', 0, 0, 30, 2.5, 2, true, true],
      ['E003', 'バックラットプル', '広背筋', 'チューブ', '回数', '強度固定', 1, 1, 'ハード（エルガム黒）', 0, 0, 0, 0, 3, true, true],
      ['E004', 'アーノルドプレス', '三角筋', 'ダンベル', '回数', 'kg', 2, 1, '', 7.5, 2.5, 20, 2.5, 4, true, true],
      ['E005', 'ハンドグリップ', '前腕筋', 'ハンドグリップ', '回数', 'kg', 1, 2, '', 20, 20, 50, 5, 5, true, false],
      ['E006', 'パワーボール', '前腕筋', 'パワーボール', '秒', 'なし', 1, 2, '', 0, 0, 0, 0, 6, true, true],
      ['E007', 'ドラゴンフラッグ', '腹直筋', '自重', '回数', '加重', 1, 1, '', 0, 0, 30, 2.5, 7, true, true],
      ['E008', 'ダンベルスクワット', '大腿四頭筋', 'ダンベル', '回数', 'kg', 2, 1, '', 10, 2.5, 20, 2.5, 8, true, true]
    ];
    ex.getRange(2, 1, seed.length, seed[0].length).setValues(seed);
  }
  var exLast = Math.max(ex.getMaxRows() - 1, 1);
  ex.getRange(2, 3, exLast, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(pt.getRange('A2:A200'), true).build());
  ex.getRange(2, 4, exLast, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(EQUIPMENTS, true).build());
  ex.getRange(2, 5, exLast, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(MEASURES, true).build());
  ex.getRange(2, 6, exLast, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(LOAD_TYPES, true).build());
  // チェックボックスはデータ行だけに入れる（空行に入れるとFALSEが入り、最終行がずれるため）
  var exN = exDataRows_(ex);
  if (ex.getMaxRows() > exN + 1) ex.getRange(exN + 2, 15, ex.getMaxRows() - exN - 1, 2).removeCheckboxes().clearContent();
  if (exN > 0) {
    // 「総負荷量に含める」が空欄の既存行を埋める（ハンドグリップは握力の強度なので含めない）
    var exVals = ex.getRange(2, 1, exN, 16).getValues();
    exVals.forEach(function (r, i) {
      if (String(r[0]).trim() !== '' && (r[15] === '' || r[15] === null)) ex.getRange(i + 2, 16).setValue(String(r[3]).trim() !== 'ハンドグリップ');
    });
    ex.getRange(2, 15, exN, 2).insertCheckboxes();
  }

  var lg = ensure(SH.LOG, HEAD.LOG, [280, 150, 90, 60, 150, 100, 80, 100, 70, 60, 130, 50, 50, 80, 70, 80, 50, 150, 300]);
  lg.getRange('C:C').setNumberFormat('@');
  lg.getRange('B:B').setNumberFormat('yyyy/MM/dd HH:mm:ss');
  lg.getRange('R:R').setNumberFormat('yyyy/MM/dd HH:mm:ss');
  lg.getRange(1, 1, 1, HEAD.LOG.length).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');

  var dl = ensure(SH.DAILY, HEAD.DAILY, [100, 100, 130, 70, 80, 70, 90, 70]);
  dl.getRange('A:A').setNumberFormat('@');
  dl.getRange(1, 1, 1, HEAD.DAILY.length).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');

  // 不要な初期シート「シート1」「Sheet1」を削除（空の場合のみ）
  ['シート1', 'Sheet1'].forEach(function (n) {
    var s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });

  // 並び順
  [SH.LOG, SH.DAILY, SH.EX, SH.PARTS, SH.SETTINGS].forEach(function (n, i) {
    ss.setActiveSheet(ss.getSheetByName(n));
    ss.moveActiveSheet(i + 1);
  });
  ss.setActiveSheet(ss.getSheetByName(SH.LOG));

  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  return 'セットアップ完了';
}



