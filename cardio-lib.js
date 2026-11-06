/* 有酸素：画面に依存しない計算（日付・継続日数・平均時速・ルート） */
var CardioLib = (function () {
  'use strict';

  function p2(n) { return ('0' + n).slice(-2); }
  function r1(n) { return Math.round(n * 10) / 10; }
  function r2(n) { return Math.round(n * 100) / 100; }

  /* ---------- 日付（'yyyy/MM/dd'。タイムゾーンの影響を受けないようUTC日数で扱う） ---------- */
  function toDays(s) {
    var p = String(s).split('/');
    return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000);
  }
  function fromDays(d) {
    var dt = new Date(d * 86400000);
    return dt.getUTCFullYear() + '/' + p2(dt.getUTCMonth() + 1) + '/' + p2(dt.getUTCDate());
  }
  function addDays(s, n) { return fromDays(toDays(s) + n); }
  function dow(s) { return new Date(toDays(s) * 86400000).getUTCDay(); } // 0=日
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); } // m=1..12

  /* ---------- 時間・速度 ---------- */
  function validHm(s) { return /^([01]?\d|2[0-3]):[0-5]\d$/.test(String(s || '').trim()); }
  function hmMin(s) { var p = String(s).split(':'); return +p[0] * 60 + +p[1]; }
  // 開始・終了から所要分（日をまたぐ場合は翌日の終了とみなす）。どちらか欠ければ 0
  function minsBetween(start, end) {
    if (!validHm(start) || !validHm(end)) return 0;
    return (hmMin(end) - hmMin(start) + 1440) % 1440;
  }
  // 平均時速 km/h。距離か時間が無ければ null
  function avgSpeed(km, mins) {
    km = Number(km) || 0; mins = Number(mins) || 0;
    return km > 0 && mins > 0 ? r1(km / (mins / 60)) : null;
  }
  function fmtDur(mins) {
    mins = Math.round(Number(mins) || 0);
    if (mins <= 0) return '—';
    var h = Math.floor(mins / 60), m = mins % 60;
    return h ? h + '時間' + (m ? m + '分' : '') : m + '分';
  }
  function fmtClock(sec) {
    sec = Math.max(0, Math.floor(sec));
    var h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
    return (h ? h + ':' + p2(m) : m) + ':' + p2(s);
  }

  /* ---------- 継続日数・空き日数 ---------- */
  // logs: [{date:'yyyy/MM/dd'}]。今日まだ記録がなければ昨日までの連続を数える（今日はまだ間に合うため）
  function streakInfo(logs, today) {
    var set = {}, last = null;
    (logs || []).forEach(function (l) {
      if (!l.date) return;
      set[l.date] = true;
      if (last === null || l.date > last) last = l.date;
    });
    if (last === null) return { streak: 0, last: null, gap: null, doneToday: false, best: 0 };
    var doneToday = !!set[today];
    var d = doneToday ? today : addDays(today, -1), n = 0;
    while (set[d]) { n++; d = addDays(d, -1); }
    // 過去最長
    var days = Object.keys(set).map(toDays).sort(function (a, b) { return a - b; });
    var best = 0, run = 0;
    for (var i = 0; i < days.length; i++) {
      run = (i > 0 && days[i] === days[i - 1] + 1) ? run + 1 : 1;
      if (run > best) best = run;
    }
    return { streak: n, last: last, gap: toDays(today) - toDays(last), doneToday: doneToday, best: best };
  }

  // 指定月の「記録がある日」: {'2026/11/06': {count, km}}
  function monthMap(logs, y, m) {
    var pre = y + '/' + p2(m) + '/', out = {};
    (logs || []).forEach(function (l) {
      if (!l.date || l.date.indexOf(pre) !== 0) return;
      var o = out[l.date] = out[l.date] || { count: 0, km: 0 };
      o.count++; o.km += Number(l.km) || 0;
    });
    return out;
  }

  /* ---------- 集計（日・週(月曜始まり)・月・四半期(暦年)・年） ---------- */
  function periodRange(type, anchor) {
    var p = anchor.split('/'), y = +p[0], m = +p[1];
    if (type === 'day') return { from: anchor, to: anchor };
    if (type === 'week') {
      var back = (dow(anchor) + 6) % 7, from = addDays(anchor, -back);
      return { from: from, to: addDays(from, 6) };
    }
    if (type === 'month') return { from: y + '/' + p2(m) + '/01', to: y + '/' + p2(m) + '/' + p2(daysInMonth(y, m)) };
    if (type === 'quarter') {
      var q0 = Math.floor((m - 1) / 3) * 3 + 1, q1 = q0 + 2;
      return { from: y + '/' + p2(q0) + '/01', to: y + '/' + p2(q1) + '/' + p2(daysInMonth(y, q1)) };
    }
    return { from: y + '/01/01', to: y + '/12/31' };
  }
  function aggregate(logs, from, to) {
    var a = { count: 0, km: 0, mins: 0, days: 0, walk: { count: 0, km: 0 }, run: { count: 0, km: 0 } }, seen = {};
    (logs || []).forEach(function (l) {
      if (!l.date || l.date < from || l.date > to) return;
      a.count++; a.km += Number(l.km) || 0; a.mins += Number(l.mins) || 0;
      if (!seen[l.date]) { seen[l.date] = true; a.days++; }
      var t = l.type === 'ランニング' ? a.run : a.walk;
      t.count++; t.km += Number(l.km) || 0;
    });
    a.km = r2(a.km); a.walk.km = r2(a.walk.km); a.run.km = r2(a.run.km);
    // 全体の平均時速は「距離も時間もある記録」だけで出す（片方欠けた記録が平均を下げないように）
    var k = 0, mn = 0;
    (logs || []).forEach(function (l) {
      if (!l.date || l.date < from || l.date > to) return;
      if ((Number(l.km) || 0) > 0 && (Number(l.mins) || 0) > 0) { k += Number(l.km); mn += Number(l.mins); }
    });
    a.avg = avgSpeed(k, mn);
    return a;
  }

  /* ---------- ルート ---------- */
  // 座標列 [[lat,lng],...] ⇔ エンコード済みポリライン（小数5桁）
  function encodePolyline(pts) {
    var out = '', pl = 0, pg = 0;
    function enc(v) {
      v = v < 0 ? ~(v << 1) : (v << 1);
      var s = '';
      while (v >= 0x20) { s += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; }
      return s + String.fromCharCode(v + 63);
    }
    for (var i = 0; i < pts.length; i++) {
      var la = Math.round(pts[i][0] * 1e5), lg = Math.round(pts[i][1] * 1e5);
      out += enc(la - pl) + enc(lg - pg);
      pl = la; pg = lg;
    }
    return out;
  }
  function decodePolyline(str) {
    var pts = [], i = 0, la = 0, lg = 0;
    str = String(str || '');
    function next() {
      var res = 0, shift = 0, b;
      do { b = str.charCodeAt(i++) - 63; res |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20 && i <= str.length);
      return (res & 1) ? ~(res >> 1) : (res >> 1);
    }
    while (i < str.length) {
      la += next();
      if (i >= str.length) break;
      lg += next();
      pts.push([la / 1e5, lg / 1e5]);
    }
    return pts;
  }

  function haversine(a, b) {
    var R = 6371000, rad = Math.PI / 180;
    var dLa = (b[0] - a[0]) * rad, dLo = (b[1] - a[1]) * rad;
    var x = Math.sin(dLa / 2) * Math.sin(dLa / 2) + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLo / 2) * Math.sin(dLo / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  function routeKm(pts) {
    var m = 0;
    for (var i = 1; i < pts.length; i++) m += haversine(pts[i - 1], pts[i]);
    return r2(m / 1000);
  }
  // 点を間引く：近すぎる点を除き、多すぎる場合は等間隔に減らす（始点・終点は必ず残す）
  function thinRoute(pts, minMeters, maxPoints) {
    minMeters = minMeters == null ? 5 : minMeters; maxPoints = maxPoints || 1500;
    if (pts.length <= 2) return pts.slice();
    var out = [pts[0]], last = pts[0];
    for (var i = 1; i < pts.length - 1; i++) {
      if (haversine(last, pts[i]) >= minMeters) { out.push(pts[i]); last = pts[i]; }
    }
    out.push(pts[pts.length - 1]);
    if (out.length > maxPoints) {
      var step = (out.length - 1) / (maxPoints - 1), res = [];
      for (var j = 0; j < maxPoints - 1; j++) res.push(out[Math.round(j * step)]);
      res.push(out[out.length - 1]);
      out = res;
    }
    return out;
  }

  return {
    toDays: toDays, fromDays: fromDays, addDays: addDays, dow: dow, daysInMonth: daysInMonth,
    validHm: validHm, minsBetween: minsBetween, avgSpeed: avgSpeed, fmtDur: fmtDur, fmtClock: fmtClock,
    streakInfo: streakInfo, monthMap: monthMap, periodRange: periodRange, aggregate: aggregate,
    encodePolyline: encodePolyline, decodePolyline: decodePolyline, haversine: haversine, routeKm: routeKm, thinRoute: thinRoute,
    r1: r1, r2: r2, p2: p2
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CardioLib;
