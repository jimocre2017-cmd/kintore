/**
 * 体つき写真（前・横・後ろ）- バックエンド
 * 写真の本体は Google ドライブの専用フォルダ（自分だけが見られる非公開）に保存し、
 * スプレッドシート「体つき写真」には日付・向き・ファイルIDなどの情報だけを書く。
 * 写真は端末側で縮小・再エンコードしてから送る（位置情報などのメタデータは含まれない）。
 * 1枚＝1行。同じID（写真ごとのID）で送り直しても、ファイルは増えない。
 */

var PHSH = '体つき写真';
var PHEAD = ['ID', '日付', '時刻', '向き', '写真ファイルID', 'サムネイルID', '備考', '登録日時', '撮影セットID'];
var PANGLES = ['前', '横', '後ろ'];
var PHOTO_FOLDER_NAME = '筋トレトラッカー_体つき写真';
var PHOTO_READY = false;

function ensurePhoto_() {
  if (PHOTO_READY) return;
  var ss = ss_(), sh = ss.getSheetByName(PHSH), created = false;
  if (!sh) { sh = ss.insertSheet(PHSH); created = true; }
  sh.getRange(1, 1, 1, PHEAD.length).setValues([PHEAD]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (created) [2, 3, 8].forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); }); // 日付・時刻は文字列のまま
  PHOTO_READY = true;
}

function photoFolder_() {
  var pr = PropertiesService.getScriptProperties(), id = pr.getProperty('PHOTO_FOLDER_ID');
  if (id) { try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (e) {} }
  var it = DriveApp.getFoldersByName(PHOTO_FOLDER_NAME), folder = it.hasNext() ? it.next() : DriveApp.createFolder(PHOTO_FOLDER_NAME);
  pr.setProperty('PHOTO_FOLDER_ID', folder.getId());
  return folder;
}

function photoObj_(r) {
  return { id: String(r[0]), date: ymd_(r[1]), time: bTime_(r[2]), angle: String(r[3] || ''), memo: String(r[6] || ''), setId: String(r[8] || '') };
}

function photoSort_(list) {
  return list.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    if (a.time !== b.time) return a.time < b.time ? 1 : -1;
    return PANGLES.indexOf(a.angle) - PANGLES.indexOf(b.angle);
  });
}

// 写真の一覧（本体は含まない。画像は photoImages で取る）
function photoGet() {
  ensurePhoto_();
  var list = rows_(PHSH).filter(function (r) { return String(r[0]).trim() !== ''; }).map(photoObj_);
  return { today: today_(), photos: photoSort_(list), angles: PANGLES };
}

function photoBlob_(dataUrl, name, maxBytes) {
  var m = String(dataUrl || '').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+\/=]+)$/);
  if (!m) throw new Error('写真のデータが正しくありません');
  var bytes = Utilities.base64Decode(m[2]);
  if (bytes.length > maxBytes) throw new Error('写真のサイズが大きすぎます（縮小してから送ってください）');
  return Utilities.newBlob(bytes, m[1], name);
}

/**
 * 写真を1枚保存。p = { id, setId, date, time, angle, memo, image(dataURL), thumb(dataURL) }
 * 既にあるIDなら、日付・時刻・向き・備考だけを更新する（画像は送り直さなくてよい）
 */
function photoSave(p) {
  ensurePhoto_();
  p = p || {};
  var id = String(p.id || '').trim();
  if (!id || id.length > 80) throw new Error('写真のIDが正しくありません');
  var date = ymd_(p.date);
  if (!date) throw new Error('日付が正しくありません');
  if (toDays_(date) > toDays_(today_())) throw new Error('未来の日付は記録できません');
  var angle = String(p.angle || '');
  if (PANGLES.indexOf(angle) < 0) throw new Error('向きは「前・横・後ろ」から選んでください');
  var time = bTime_(p.time), memo = String(p.memo == null ? '' : p.memo).replace(/\r\n?/g, '\n').trim().slice(0, 200);
  var setId = String(p.setId || '').slice(0, 80);

  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = sheet_(PHSH), last = sh.getLastRow(), rowIdx = 0, row;
    if (last >= 2) {
      var ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) { rowIdx = i + 2; break; }
    }
    if (rowIdx) {
      row = sh.getRange(rowIdx, 1, 1, PHEAD.length).getValues()[0];
      row[1] = date; row[2] = time; row[3] = angle; row[6] = memo;
      sh.getRange(rowIdx, 1, 1, row.length).setValues([row]);
    } else {
      var folder = photoFolder_();
      var img = folder.createFile(photoBlob_(p.image, id + '.jpg', 6 * 1024 * 1024));
      var th = folder.createFile(photoBlob_(p.thumb, id + '_t.jpg', 300 * 1024));
      row = [id, date, time, angle, img.getId(), th.getId(), memo, Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss'), setId];
      sh.getRange(Math.max(last, 1) + 1, 1, 1, row.length).setValues([row]);
    }
    invalidate_(PHSH);
  } finally {
    lock.releaseLock();
  }
  return id;
}

function photoRow_(id) {
  var rows = rows_(PHSH);
  for (var i = 0; i < rows.length; i++) if (String(rows[i][0]) === id) return rows[i];
  return null;
}

/** 画像をdataURLで返す。ids は10件まで、kind は 'thumb' か 'full'。見つからない写真は null */
function photoImages(ids, kind) {
  ensurePhoto_();
  ids = (ids || []).slice(0, 10);
  var out = {};
  ids.forEach(function (id) {
    out[id] = null;
    var r = photoRow_(String(id));
    if (!r) return;
    try {
      var blob = DriveApp.getFileById(String(kind === 'full' ? r[4] : r[5])).getBlob();
      out[id] = 'data:' + (blob.getContentType() || 'image/jpeg') + ';base64,' + Utilities.base64Encode(blob.getBytes());
    } catch (e) { out[id] = null; }
  });
  return out;
}

function photoDelete(id) {
  ensurePhoto_();
  id = String(id || '').trim();
  if (!id) return true;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = sheet_(PHSH), last = sh.getLastRow();
    if (last >= 2) {
      var ds = sh.getRange(2, 1, last - 1, PHEAD.length).getValues();
      for (var i = ds.length - 1; i >= 0; i--) {
        if (String(ds[i][0]) !== id) continue;
        [ds[i][4], ds[i][5]].forEach(function (fid) { try { if (fid) DriveApp.getFileById(String(fid)).setTrashed(true); } catch (e) {} });
        sh.deleteRow(i + 2);
      }
    }
    invalidate_(PHSH);
  } finally {
    lock.releaseLock();
  }
  return true;
}

/** その日付以前で最も新しい体組成（日平均）。無ければ null */
function photoBodyAt_(logs, date) {
  for (var i = 0; i < logs.length; i++) if (logs[i].date <= date) return logs[i]; // logs は新しい順
  return null;
}

/**
 * 2枚の写真をAI（Gemini）が見比べて所見を返す。req = { a: 古い方の写真ID, b: 新しい方の写真ID }
 * 体重・体脂肪率などの数値は計算済みのものを渡し、AIは写真から体重などを推測しない
 */
function photoCompare(req) {
  ensurePhoto_();
  req = req || {};
  var ra = photoRow_(String(req.a || '')), rb = photoRow_(String(req.b || ''));
  if (!ra || !rb) throw new Error('写真が見つかりません。一覧を更新してからやり直してください');
  var A = photoObj_(ra), B = photoObj_(rb);
  if (A.date > B.date || (A.date === B.date && A.time > B.time)) { var t = A; A = B; B = t; t = ra; ra = rb; rb = t; } // 古い方を before にする
  var logs = [];
  try { logs = bodyGet().logs; } catch (e) {}
  function snap(o) {
    var b = photoBodyAt_(logs, o.date), body = null;
    if (b) {
      body = { measuredOn: b.date, weightKg: b.weight, fatPercent: b.fat, musclePercent: b.muscle, visceral: b.visceral, bmi: b.bmi, bmr: b.bmr, measurementsThatDay: b.count };
      if (b.weight !== null && b.fat !== null) { body.leanMassKg = r1_(b.weight * (1 - b.fat / 100)); body.fatMassKg = r1_(b.weight * b.fat / 100); }
    }
    return { date: o.date, angle: o.angle, memo: o.memo || null, body: body };
  }
  var sb = snap(A), sa = snap(B), change = null;
  if (sb.body && sa.body) {
    change = {};
    ['weightKg', 'fatPercent', 'musclePercent', 'visceral', 'leanMassKg', 'fatMassKg'].forEach(function (k) {
      if (sb.body[k] != null && sa.body[k] != null) change[k] = r1_(sa.body[k] - sb.body[k]);
    });
  }
  // 2枚の間の体組成の推移（日平均、最大30点）と有酸素の実績
  var from = sb.body ? sb.body.measuredOn : A.date; // before の体組成を測った日から
  var trend = logs.filter(function (l) { return l.date >= from && l.date <= B.date; }).reverse().map(function (l) { return { date: l.date, weightKg: l.weight, fatPercent: l.fat, musclePercent: l.muscle }; });
  if (trend.length > 30) { var st = trend.length / 30; trend = Array.apply(null, Array(30)).map(function (_, i) { return trend[Math.min(trend.length - 1, Math.round(i * st))]; }); }
  var cardio = null;
  try {
    var km = 0, n = 0;
    cardioGet().logs.forEach(function (l) { if (l.date >= A.date && l.date <= B.date && l.km) { km += l.km; n++; } });
    cardio = { sessions: n, totalKm: r1_(km) };
  } catch (e) {}
  var days = toDays_(B.date) - toDays_(A.date);
  var images = [ra, rb].map(function (r) {
    var blob = DriveApp.getFileById(String(r[4])).getBlob();
    return { mime: blob.getContentType() || 'image/jpeg', data: Utilities.base64Encode(blob.getBytes()) };
  });
  var system = [
    'あなたは筋トレ・減量を見守る、落ち着いた専属トレーナー兼カイロプラクターです。日本語で、やさしく具体的に答えます。',
    '1枚目が before（古い日付）、2枚目が after（新しい日付）の体つきの写真です。同じ向き（前・横・後ろ）の比較が前提です。',
    '写真から見て取れる変化だけを、部位ごとに述べます（例：ウエストまわり、お腹、肩・背中のライン、腕、胸、お尻・脚、姿勢）。見えないものは推測しません。',
    '写真の光・角度・ポーズ・服装・パンプ・姿勢の違いで見え方が変わるので、小さな差は断定せず、「変化が見える」「変化は分かりにくい」とはっきり区別します。',
    '判断は「実際の計測データ」と「写真の見た目」を合わせた総合判断にします。計測データ（before.body・after.body、bodyChange、bodyTrend、cardio。体重・体脂肪率・骨格筋率・除脂肪体重・脂肪量・内臓脂肪）は計算済みなので、そのまま引用し、再計算しません。',
    'まず計測データの動き（脂肪が減ったか、筋肉・除脂肪体重が保てているか）を土台にし、写真でその変化が見た目（ウエスト・背中・肩・腕・姿勢など）に出ているかを確かめます。数値と写真が一致するなら自信を持って伝え、食い違うとき（数値は動いたが写真は変化が小さい、またはその逆）は、測定のタイミング・水分・光・ポーズの違いなど考えられる理由を挙げて、どちらをどの程度信じるかを説明します。',
    '写真を見て新しい体重や体脂肪率の数値を作ることはしません（数値は計測データだけを使う）。見た目の印象は述べてかまいません。計測データが無い・少ないときは、写真だけの判断で精度が下がることを明記します。',
    'overall には、総合判断（verdict）と、その根拠（数値と写真のどちらから何が言えたか）を入れます。',
    '体型を評価・批判する言い方、他人との比較、食事制限を煽る表現はしません。医学的な診断はせず、痛みなどが続く場合は専門家への相談を勧めます。',
    'advice には、次の1〜2か月のための実践的な提案（トレーニング、有酸素、たんぱく質、姿勢ケア、写真の撮り方の改善など）を2〜4個入れます。'
  ].join('\n');
  var user = JSON.stringify({
    daysBetween: days, before: sb, after: sa, bodyChange: change, bodyTrend: trend, cardio: cardio,
    note: '同じ向きの2枚かどうか（angle）を確認し、違う向きなら比較の精度が下がることを最初に伝える'
  });
  var schema = {
    type: 'OBJECT',
    properties: {
      overall: { type: 'OBJECT', properties: { verdict: { type: 'STRING', enum: ['脂肪が減り筋肉も保てている', '減量は進んでいるが筋肉も減った可能性', '変化は小さい', '体重・脂肪が増えている', '判断材料が不足'] }, rationale: { type: 'STRING' }, confidence: { type: 'STRING', enum: ['高い', '中くらい', '低い'] } }, required: ['verdict', 'rationale', 'confidence'] },
      summary: { type: 'STRING' },
      changes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { area: { type: 'STRING' }, observation: { type: 'STRING' }, clarity: { type: 'STRING', enum: ['はっきり', 'わずか', '分かりにくい'] } }, required: ['area', 'observation', 'clarity'] } },
      numbersNote: { type: 'STRING' },
      advice: { type: 'ARRAY', items: { type: 'STRING' } },
      caveats: { type: 'STRING' }
    },
    required: ['overall', 'summary', 'changes', 'advice', 'caveats']
  };
  var out = gemini_(system, user, schema, images);
  out.before = A; out.after = B; out.daysBetween = days;
  return out;
}

/** 動作確認用：エディタから実行して、フォルダ・シート・保存・取得・削除ができるか確かめる（テスト写真は削除される） */
function photoTest() {
  // 1x1 の小さなJPEG
  var jpg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=';
  var id = 'photo-test-' + Utilities.getUuid().slice(0, 8);
  photoSave({ id: id, date: today_(), time: '00:00', angle: '前', image: jpg, thumb: jpg });
  var got = photoGet().photos.filter(function (x) { return x.id === id; })[0];
  Logger.log('テスト写真: ' + JSON.stringify(got));
  var img = photoImages([id], 'thumb')[id];
  Logger.log('画像の取得: ' + (img ? img.slice(0, 30) + '…' : 'NG'));
  photoDelete(id);
  Logger.log('フォルダ: ' + photoFolder_().getUrl() + '（テスト写真は削除しました）');
}
