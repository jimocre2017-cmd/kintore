/**
 * 体つき写真の自動取り込み（Google ドライブのフォルダ body_pictures → 筋トレアプリ）
 *
 * body_pictures に写真（スマホのHEICのままでOK）を入れるだけで、一定間隔で自動的に
 *   1) 撮影日時ごとに「1セット（前・横・後ろ）」へまとめ
 *   2) Gemini が写真を見て 前／横／後ろ を判定し
 *   3) アプリの写真記録（Photo.gs の photoSave。シート「体つき写真」＋専用フォルダ）に登録します。
 * 登録できた元ファイルは body_pictures/取込済み に移動します。
 * 向きを判定できなかった・体の写真でない・3枚そろわず迷うものは body_pictures/要確認 に移動し、登録しません
 * （間違った向きで記録しないため。アプリの「体つきを撮る」から手動で入れ直せます）。
 *
 * 前提：AiTrainer.gs の gemini_()、Photo.gs の photoSave() / photoRow_() を使います（スクリプトプロパティ GEMINI_API_KEY が必要）。
 * 導入：このファイルを新規追加 → photoAutoSetup を1回実行（権限の承認と、15分ごとのトリガー作成）。
 * 任意のスクリプトプロパティ：BODYPIC_FOLDER_ID（取り込み元フォルダID。未設定なら下の既定値）
 */

var PHAUTO_FOLDER_ID = '15YCyfOeBFF8fMHOvuptopdNDDOgkYAhq'; // body_pictures
var PHAUTO_DONE_DIR = '取込済み';
var PHAUTO_CHECK_DIR = '要確認';
var PHAUTO_GAP_MIN = 5;          // この分数以内に撮った写真は同じセット
var PHAUTO_SETTLE_FULL = 2;      // 3枚そろったセットは、最後のアップロードからこの分数たてば処理
var PHAUTO_SETTLE_PART = 10;     // 3枚に満たないセットは、この分数待ってから処理（残りの写真を待つ）
var PHAUTO_MAX_GROUPS = 4;       // 1回の実行で処理するセット数の上限（実行時間の制限対策）
var PHAUTO_MAX_FAILS = 3;        // 一時的なエラーでこの回数失敗したセットは「要確認」へ

// ---------- 純粋な計算（node でもテストする） ----------

/** ファイル名（IMG_20261109_013817_9.heic など）→ { date:'yyyy/MM/dd', time:'HH:mm', min:通算分 }。読めなければ null */
function photoAutoParseName_(name) {
  var m = String(name || '').match(/(20\d{2})(\d{2})(\d{2})[_\-\s]?(\d{2})(\d{2})(\d{2})/);
  if (!m) return null;
  var mo = +m[2], d = +m[3], h = +m[4], mi = +m[5];
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59) return null;
  return { date: m[1] + '/' + m[2] + '/' + m[3], time: m[4] + ':' + m[5], min: Math.round(Date.UTC(+m[1], mo - 1, d, h, mi) / 60000) };
}

/** items：[{ id, name, min, ... }] → 撮影時刻順に、間隔が gap 分以内ならまとめ、1セット最大 max 枚で区切る */
function photoAutoGroup_(items, gap, max) {
  var list = items.slice().sort(function (a, b) { return a.min !== b.min ? a.min - b.min : (a.name < b.name ? -1 : 1); });
  var out = [], cur = null;
  list.forEach(function (it) {
    if (!cur || it.min - cur[cur.length - 1].min > gap || cur.length >= max) { cur = []; out.push(cur); }
    cur.push(it);
  });
  return out;
}

/**
 * Gemini の判定 → 各画像の向きの配列。使えない判定なら null。
 * res.items：[{ index, angle }]（angle は 前・横・後ろ・対象外）
 * 条件：全画像が 前/横/後ろ のどれかで、同じ向きが重複しない
 */
function photoAutoAssign_(n, res) {
  var items = res && res.items;
  if (!items || items.length !== n) return null;
  var out = [], seen = {};
  for (var i = 0; i < n; i++) out.push(null);
  for (var k = 0; k < items.length; k++) {
    var idx = Number(items[k].index), a = String(items[k].angle || '');
    if (!(idx >= 0 && idx < n) || idx !== Math.floor(idx) || out[idx] !== null) return null;
    if (['前', '横', '後ろ'].indexOf(a) < 0 || seen[a]) return null;
    seen[a] = true; out[idx] = a;
  }
  return out;
}

// ---------- Drive まわり ----------

function photoAutoRoot_() {
  var id = PropertiesService.getScriptProperties().getProperty('BODYPIC_FOLDER_ID') || PHAUTO_FOLDER_ID;
  return DriveApp.getFolderById(id);
}

function photoAutoSub_(root, name) {
  var it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

/** 取り込み待ちの画像（直下にあるものだけ。サブフォルダは見ない） */
function photoAutoPending_(root) {
  var out = [], it = root.getFiles();
  while (it.hasNext()) {
    var f = it.next(), mime = String(f.getMimeType() || '');
    if (mime.indexOf('image/') !== 0 || f.isTrashed()) continue;
    var created = f.getDateCreated().getTime();
    var p = photoAutoParseName_(f.getName());
    var min;
    if (p) min = p.min;
    else { // ファイル名から撮影日時が読めないときは、アップロード日時（日本時間）で代用
      var s = Utilities.formatDate(f.getDateCreated(), TZ, 'yyyy/MM/dd HH:mm');
      var q = s.match(/(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})/);
      p = { date: q[1] + '/' + q[2] + '/' + q[3], time: q[4] + ':' + q[5], min: Math.round(Date.UTC(+q[1], +q[2] - 1, +q[3], +q[4], +q[5]) / 60000) };
      min = p.min;
    }
    out.push({ id: f.getId(), name: f.getName(), mime: mime, min: min, date: p.date, time: p.time, created: created, file: f });
  }
  return out;
}

/** HEIC などのままでは扱えないので、Drive が作る縮小版（JPEG）を取る。向きは Drive が補正済み */
function photoAutoImage_(fileId, size) {
  var token = ScriptApp.getOAuthToken();
  var meta = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?fields=thumbnailLink&supportsAllDrives=true',
    { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
  if (meta.getResponseCode() === 200) {
    var link = JSON.parse(meta.getContentText()).thumbnailLink;
    if (link) {
      var url = String(link).replace(/=s\d+(-c)?$/, '') + '=s' + size;
      var res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + token }, muteHttpExceptions: true });
      var ct = String(res.getHeaders()['Content-Type'] || res.getHeaders()['content-type'] || '');
      if (res.getResponseCode() === 200 && /^image\/(jpeg|png|webp)/.test(ct)) {
        return { mime: ct.split(';')[0], bytes: res.getContent() };
      }
    }
  }
  var th = DriveApp.getFileById(fileId).getThumbnail(); // 最後の手段（小さい）
  if (!th) throw new Error('画像の縮小版を取得できませんでした');
  return { mime: th.getContentType() || 'image/png', bytes: th.getBytes() };
}

function photoAutoDataUrl_(img) { return 'data:' + img.mime + ';base64,' + Utilities.base64Encode(img.bytes); }

// ---------- 向きの判定（Gemini） ----------

function photoAutoClassify_(images) {
  var n = images.length;
  var system = [
    'あなたは体つき写真（ボディチェック用）を整理するアシスタントです。',
    '渡された画像は、同じ人が同じ日に続けて撮った1セットの写真で、画像は0始まりの番号順に並んでいます。',
    '各画像が、体のどの向きかを判定します：',
    '前＝体の正面がカメラ側（胸・お腹・顔が見える）、横＝体の側面（体の厚みと姿勢の横顔が見える）、後ろ＝背中側がカメラ側（背中・お尻が見える）。',
    '体つきの写真でないもの（風景・食べ物・文書・人物が写っていないなど）は「対象外」にします。',
    '1セット内で同じ向きは重複しません。自信が持てない画像は、無理に当てはめず「対象外」にします。',
    '出力はJSONのみ。'
  ].join('\n');
  var user = 'このセットは' + n + '枚です。全ての画像について、番号（index）と向き（angle：前・横・後ろ・対象外）を返してください。';
  var schema = {
    type: 'OBJECT',
    properties: {
      items: { type: 'ARRAY', items: { type: 'OBJECT', properties: { index: { type: 'INTEGER' }, angle: { type: 'STRING', enum: ['前', '横', '後ろ', '対象外'] } }, required: ['index', 'angle'] } }
    },
    required: ['items']
  };
  var imgs = images.map(function (im) { return { mime: im.mime, data: Utilities.base64Encode(im.bytes) }; });
  return photoAutoAssign_(n, gemini_(system, user, schema, imgs));
}

// ---------- 本体 ----------

function photoAutoFails_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('PHAUTO_FAILS') || '{}'); } catch (e) { return {}; }
}
function photoAutoSetFails_(o) {
  var keys = Object.keys(o);
  if (keys.length > 60) keys.slice(0, keys.length - 60).forEach(function (k) { delete o[k]; });
  PropertiesService.getScriptProperties().setProperty('PHAUTO_FAILS', JSON.stringify(o));
}

/** 1セットを処理。戻り値：'saved' | 'flagged' | 'error' */
function photoAutoOne_(group, root) {
  var first = group[0];
  var imgs = group.map(function (g) { return photoAutoImage_(g.id, 1024); });
  var angles = photoAutoClassify_(imgs);
  if (!angles) {
    group.forEach(function (g) { g.file.moveTo(photoAutoSub_(root, PHAUTO_CHECK_DIR)); });
    return 'flagged';
  }
  var setId = 'auto-' + first.date.replace(/\//g, '') + '-' + first.time.replace(':', '') + '-' + first.id.slice(0, 6);
  var date = first.date;
  if (toDays_(date) > toDays_(today_())) date = today_();
  group.forEach(function (g, i) {
    var pid = 'auto-' + g.id;
    if (photoRow_(pid)) return; // 前回の途中まで登録済み。画像は送り直さない
    var full = photoAutoImage_(g.id, 1280), th = photoAutoImage_(g.id, 360);
    photoSave({ id: pid, setId: setId, date: date, time: g.time, angle: angles[i], memo: '自動取込', image: photoAutoDataUrl_(full), thumb: photoAutoDataUrl_(th) });
  });
  var done = photoAutoSub_(root, PHAUTO_DONE_DIR);
  group.forEach(function (g) { g.file.moveTo(done); });
  return 'saved';
}

/** トリガーから呼ばれる入口。戻り値：{ saved, flagged, waiting, errors } */
function photoAutoRun() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { skipped: true };
  var r = { saved: 0, flagged: 0, waiting: 0, errors: 0 };
  try {
    var root = photoAutoRoot_();
    var pending = photoAutoPending_(root);
    if (!pending.length) return r;
    var groups = photoAutoGroup_(pending, PHAUTO_GAP_MIN, 3);
    var now = Date.now(), fails = photoAutoFails_(), handled = 0;
    groups.forEach(function (g) {
      if (handled >= PHAUTO_MAX_GROUPS || r.rateLimited) { r.waiting++; return; }
      var newest = Math.max.apply(null, g.map(function (x) { return x.created; }));
      var settle = (g.length >= 3 ? PHAUTO_SETTLE_FULL : PHAUTO_SETTLE_PART) * 60000;
      if (now - newest < settle) { r.waiting++; return; } // アップロード中かもしれないので待つ
      handled++;
      var key = g[0].id;
      try {
        var s = photoAutoOne_(g, root);
        if (s === 'saved') r.saved++; else r.flagged++;
        delete fails[key];
      } catch (e) {
        Logger.log('写真の自動取り込みに失敗：' + g.map(function (x) { return x.name; }).join(', ') + ' / ' + e.message);
        r.errors++;
        if (/利用上限/.test(String(e.message))) { r.rateLimited = true; return; } // Gemini の混雑・上限：失敗回数に数えず、次回に回す
        fails[key] = (fails[key] || 0) + 1;
        if (fails[key] >= PHAUTO_MAX_FAILS) {
          g.forEach(function (x) { try { x.file.moveTo(photoAutoSub_(root, PHAUTO_CHECK_DIR)); } catch (e2) {} });
          delete fails[key]; r.flagged++;
        }
      }
    });
    photoAutoSetFails_(fails);
    Logger.log('写真の自動取り込み：登録 ' + r.saved + ' セット／要確認 ' + r.flagged + '／待機 ' + r.waiting + '／エラー ' + r.errors);
    return r;
  } finally {
    lock.releaseLock();
  }
}

/** 最初に1回だけ実行：権限の承認 → 15分ごとのトリガーを作る → すぐ1回取り込む */
function photoAutoSetup() {
  var root = photoAutoRoot_();                         // フォルダへのアクセスを承認
  photoAutoSub_(root, PHAUTO_DONE_DIR); photoAutoSub_(root, PHAUTO_CHECK_DIR);
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'photoAutoRun') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('photoAutoRun').timeBased().everyMinutes(15).create();
  Logger.log('15分ごとの自動取り込みを設定しました。取り込み元：' + root.getUrl());
  return photoAutoRun();
}

/** トリガーを止める */
function photoAutoStop() {
  ScriptApp.getProjectTriggers().forEach(function (t) { if (t.getHandlerFunction() === 'photoAutoRun') ScriptApp.deleteTrigger(t); });
  Logger.log('自動取り込みのトリガーを削除しました');
}
