/**
 * 有酸素（ウォーキング・ランニング）記録 - バックエンド
 * スプレッドシート：有酸素ログ / コース / 地点（初回の呼び出し時に自動で作られる）
 * ルートは「エンコード済みポリライン」（座標列を短い文字列にしたもの）で1セルに保存する。
 * 記録・編集・削除は id で上書き/削除するので、オフライン中の操作を何度送り直しても安全。
 */

var CSH = { LOG: '有酸素ログ', COURSE: 'コース', PLACE: '地点' };
var CHEAD = {
  LOG: ['ID', '日付', '種類', '記録元', '開始', '終了', '所要分', '距離km', '平均時速', '出発地', '到着地', 'コースID', 'ルート種別', '備考', '登録日時', 'ルート'],
  COURSE: ['コースID', '名前', '距離km', '出発地', '到着地', 'ルート'],
  PLACE: ['地点ID', '地点名', '緯度', '経度']
};
var CTYPES = ['ウォーキング', 'ランニング'];
var CSOURCES = ['GPS', '手動'];
var CKINDS = ['実測', '推定', 'なし'];
var C_ROUTE_MAX = 45000; // セル1つの文字数上限(50000)に余裕を持たせる

var CARDIO_READY = false;

function ensureCardio_() {
  if (CARDIO_READY) return;
  var ss = ss_();
  function ensure(name, head, textCols) {
    var sh = ss.getSheetByName(name);
    var created = false;
    if (!sh) { sh = ss.insertSheet(name); created = true; }
    sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
    sh.setFrozenRows(1);
    if (created) textCols.forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); });
    return sh;
  }
  // 日付・開始・終了は文字列のまま保存する（シートが時刻や日付に自動変換しないように）
  ensure(CSH.LOG, CHEAD.LOG, [2, 5, 6, 15]);
  ensure(CSH.COURSE, CHEAD.COURSE, []);
  ensure(CSH.PLACE, CHEAD.PLACE, []);
  CARDIO_READY = true;
}

function hm_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'HH:mm');
  var m = String(v || '').trim().match(/^(\d{1,2}):(\d{2})/);
  return m ? ('0' + m[1]).slice(-2) + ':' + m[2] : '';
}

function cLogObj_(r, withRoute) {
  var o = {
    id: String(r[0]), date: ymd_(r[1]), type: String(r[2]), source: String(r[3]),
    start: hm_(r[4]), end: hm_(r[5]), mins: num_(r[6]), km: num_(r[7]), avg: r[8] === '' ? null : num_(r[8]),
    from: String(r[9] || ''), to: String(r[10] || ''), courseId: String(r[11] || ''),
    routeKind: String(r[12] || 'なし'), memo: String(r[13] || ''), hasRoute: String(r[15] || '') !== ''
  };
  if (withRoute) o.route = String(r[15] || '');
  return o;
}

function cardioGet() {
  ensureCardio_();
  var logs = rows_(CSH.LOG).filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) { return cLogObj_(r, false); });
  logs.sort(function (a, b) { return a.date === b.date ? (a.start < b.start ? 1 : -1) : (a.date < b.date ? 1 : -1); });
  var courses = rows_(CSH.COURSE).filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) {
    return { id: String(r[0]), name: String(r[1]), km: num_(r[2]), from: String(r[3] || ''), to: String(r[4] || ''), route: String(r[5] || '') };
  });
  var places = rows_(CSH.PLACE).filter(function (r) { return String(r[0]).trim() !== ''; }).map(function (r) {
    return { id: String(r[0]), name: String(r[1]), lat: num_(r[2]), lng: num_(r[3]) };
  });
  return { today: today_(), logs: logs, courses: courses, places: places };
}

/** 1件分のルート（長いので一覧とは別に取る） */
function cardioRoute(id) {
  ensureCardio_();
  var rs = rows_(CSH.LOG);
  for (var i = 0; i < rs.length; i++) if (String(rs[i][0]) === String(id)) return String(rs[i][15] || '');
  return '';
}

/** id の行を上書き、無ければ末尾に追加。build(旧行 or null) が新しい行を返す */
function cUpsert_(name, id, build) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(name);
    var last = sh.getLastRow(), rowIdx = 0, old = null;
    if (last >= 2) {
      var ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) { rowIdx = i + 2; break; }
      if (rowIdx) old = sh.getRange(rowIdx, 1, 1, sh.getLastColumn()).getValues()[0];
    }
    var row = build(old);
    if (rowIdx) sh.getRange(rowIdx, 1, 1, row.length).setValues([row]);
    else sh.getRange(Math.max(last, 1) + 1, 1, 1, row.length).setValues([row]);
    invalidate_(name);
  } finally {
    lock.releaseLock();
  }
}

function cDelete_(name, id) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(name);
    var last = sh.getLastRow();
    if (last < 2) return;
    var ids = sh.getRange(2, 1, last - 1, 1).getValues();
    for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) sh.deleteRow(i + 2);
    invalidate_(name);
  } finally {
    lock.releaseLock();
  }
}

function cStr_(v, max) { return String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim().slice(0, max); }
function cHm_(v) {
  var s = String(v || '').trim();
  if (!s) return '';
  var m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (!m || +m[1] > 23 || +m[2] > 59) throw new Error('時刻は 07:30 のように入力してください');
  return ('0' + m[1]).slice(-2) + ':' + m[2];
}
function cMin_(hm) { var p = hm.split(':'); return +p[0] * 60 + +p[1]; }

function cardioSave(p) {
  ensureCardio_();
  p = p || {};
  var id = cStr_(p.id, 80) || uuid_();
  var date = ymd_(p.date);
  if (!date) throw new Error('日付が正しくありません');
  if (toDays_(date) > toDays_(today_())) throw new Error('未来の日付は記録できません');
  var type = String(p.type || '');
  if (CTYPES.indexOf(type) < 0) throw new Error('種類はウォーキングかランニングです');
  var source = CSOURCES.indexOf(String(p.source)) >= 0 ? String(p.source) : '手動';
  var start = cHm_(p.start), end = cHm_(p.end);
  var mins = Math.round(num_(p.mins));
  if (!mins && start && end) mins = (cMin_(end) - cMin_(start) + 1440) % 1440;
  var km = Math.round(num_(p.km) * 100) / 100;
  if (mins < 0 || mins > 1440) throw new Error('所要時間は24時間以内にしてください');
  if (km < 0 || km > 500) throw new Error('距離が大きすぎます。入力を確認してください');
  var route = String(p.route || '');
  if (route.length > C_ROUTE_MAX) throw new Error('ルートのデータが大きすぎます');
  var kind = CKINDS.indexOf(String(p.routeKind)) >= 0 ? String(p.routeKind) : (route ? '推定' : 'なし');
  if (!route) kind = 'なし';
  var avg = km > 0 && mins > 0 ? Math.round(km / (mins / 60) * 10) / 10 : '';

  cUpsert_(CSH.LOG, id, function (old) {
    var created = old ? old[14] : Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss');
    return [id, date, type, source, start, end, mins || '', km || '', avg, cStr_(p.from, 40), cStr_(p.to, 40), cStr_(p.courseId, 80), kind, cStr_(p.memo, 500), created, route];
  });
  return id;
}

function cardioDelete(id) {
  ensureCardio_();
  cDelete_(CSH.LOG, cStr_(id, 80));
  return true;
}

function cardioSavePlace(p) {
  ensureCardio_();
  p = p || {};
  var id = cStr_(p.id, 80) || uuid_();
  var name = cStr_(p.name, 30);
  var lat = Number(p.lat), lng = Number(p.lng);
  if (!name) throw new Error('地点の名前を入力してください');
  if (isNaN(lat) || isNaN(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) throw new Error('緯度・経度が正しくありません');
  cUpsert_(CSH.PLACE, id, function () { return [id, name, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]; });
  return id;
}

function cardioDeletePlace(id) {
  ensureCardio_();
  cDelete_(CSH.PLACE, cStr_(id, 80));
  return true;
}

function cardioSaveCourse(p) {
  ensureCardio_();
  p = p || {};
  var id = cStr_(p.id, 80) || uuid_();
  var name = cStr_(p.name, 30);
  var route = String(p.route || '');
  if (!name) throw new Error('コースの名前を入力してください');
  if (route.length > C_ROUTE_MAX) throw new Error('ルートのデータが大きすぎます');
  var km = Math.round(num_(p.km) * 100) / 100;
  if (km < 0 || km > 500) throw new Error('距離が大きすぎます');
  cUpsert_(CSH.COURSE, id, function () { return [id, name, km || '', cStr_(p.from, 40), cStr_(p.to, 40), route]; });
  return id;
}

function cardioDeleteCourse(id) {
  ensureCardio_();
  cDelete_(CSH.COURSE, cStr_(id, 80));
  return true;
}

/** 動作確認用：エディタから実行して、シートが作られ読み書きできるか確かめる */
function cardioTest() {
  var id = cardioSave({ date: today_(), type: 'ウォーキング', source: '手動', start: '07:00', end: '07:30', km: 2.5, memo: 'テスト' });
  var d = cardioGet();
  Logger.log('記録数: ' + d.logs.length + ' / 最新: ' + JSON.stringify(d.logs[0]));
  cardioDelete(id);
  Logger.log('テスト記録を削除しました');
}

/**
 * AIトレーナー（AiTrainer.gs）に渡す有酸素の要約。記録が無い・読めない場合は null
 * 今月の回数・距離・時間・平均時速、直近8週の週別距離、継続日数、最後の記録からの空き日数
 */
function aiCardio_(today) {
  try {
    var all = cardioGet().logs;
    if (!all.length) return null;
    var tp = ymdParts_(today), monthStart = mk_(tp.y, tp.m, 1);
    var weekStart = addDays_(today, -((dow_(today) + 6) % 7));
    var weeks = [], w;
    for (w = 7; w >= 0; w--) weeks.push(addDays_(weekStart, -7 * w));
    var weekKm = weeks.map(function () { return 0; }), weekCnt = weeks.map(function () { return 0; });
    var mCount = 0, mKm = 0, mMins = 0, mAvgKm = 0, mAvgMins = 0, mDays = {}, set = {}, last = '';
    all.forEach(function (l) {
      set[l.date] = 1;
      if (l.date > last) last = l.date;
      if (l.date > today) return;
      var wi = -1;
      for (var i = weeks.length - 1; i >= 0; i--) if (l.date >= weeks[i]) { wi = i; break; }
      if (wi >= 0) { weekKm[wi] = r1_(weekKm[wi] + l.km); weekCnt[wi]++; }
      if (l.date >= monthStart) {
        mCount++; mKm += l.km; mMins += l.mins; mDays[l.date] = 1;
        if (l.km > 0 && l.mins > 0) { mAvgKm += l.km; mAvgMins += l.mins; }
      }
    });
    var d = set[today] ? today : addDays_(today, -1), streak = 0;
    while (set[d]) { streak++; d = addDays_(d, -1); }
    return {
      thisMonth: { sessions: mCount, days: Object.keys(mDays).length, km: r1_(mKm), minutes: mMins, avgKmh: mAvgMins > 0 ? r1_(mAvgKm / (mAvgMins / 60)) : null },
      last8Weeks: { weekStarts: weeks, kmPerWeek: weekKm, sessionsPerWeek: weekCnt },
      streakDays: streak,
      daysSinceLast: last ? toDays_(today) - toDays_(last) : null
    };
  } catch (err) {
    return null;
  }
}
