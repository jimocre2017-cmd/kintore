/* 筋トレトラッカー アプリ版：通信・オフライン保存・同期
 * - 記録/取消/備考/インターバルは端末に保存して「送信待ち」に並べ、オンラインになったら自動送信
 * - 記録は clientId で二重登録を防ぐので、同じ操作を何度送り直しても安全
 * - 初期データと分析結果は端末にキャッシュし、オフラインでも表示できるようにする
 */
var KT = (function () {
  'use strict';

  /* ---------- 端末内の保存 ---------- */
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  // 設定用リンク（#setup=...）から API の URL と合言葉を保存
  (function () {
    var m = location.hash.match(/^#setup=(.+)$/);
    if (!m) return;
    try {
      var c = JSON.parse(decodeURIComponent(m[1]));
      if (c && c.api && c.token) LS.set('kt_cfg', { api: c.api, token: c.token });
    } catch (e) {}
    try { history.replaceState(null, '', location.pathname); } catch (e) {}
  })();

  function cfg() { return LS.get('kt_cfg', null); }

  /* ---------- 日付 ---------- */
  function p2(n) { return ('0' + n).slice(-2); }
  function today() { var d = new Date(); return d.getFullYear() + '/' + p2(d.getMonth() + 1) + '/' + p2(d.getDate()); }
  function nowStr() { var d = new Date(); return today() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()); }
  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); });
  }
  function r1(n) { return Math.round(n * 10) / 10; }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  /* ---------- サーバー呼び出し ---------- */
  function netErr(msg) { var e = new Error('オフラインのため通信できません'); e.offline = true; e.detail = msg; return e; }

  function api(fn, args, timeoutMs) {
    var c = cfg();
    if (!c) { var e0 = new Error('NOCFG'); e0.nocfg = true; return Promise.reject(e0); }
    if (navigator.onLine === false) return Promise.reject(netErr('offline'));
    var ctl = window.AbortController ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, timeoutMs || 30000);
    return fetch(c.api, {
      method: 'POST',
      body: JSON.stringify({ token: c.token, fn: fn, args: args || [] }),
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      redirect: 'follow',
      credentials: 'omit',
      cache: 'no-store',
      signal: ctl ? ctl.signal : undefined
    }).then(function (r) {
      if (!r.ok) throw netErr('HTTP ' + r.status);
      return r.json().catch(function () { throw netErr('bad json'); });
    }, function (err) {
      throw netErr(err && err.message);
    }).then(function (j) {
      clearTimeout(timer);
      if (!j.ok) {
        var msg = String(j.error || 'エラー');
        var e = new Error(msg.replace(/^AUTH: /, ''));
        if (/^AUTH/.test(msg)) e.auth = true;
        throw e;
      }
      return j.data;
    }, function (err) {
      clearTimeout(timer);
      throw err;
    });
  }

  /* ---------- 送信待ちキュー ---------- */
  function queue() { return LS.get('kt_queue', []); }
  function setQueue(q) { LS.set('kt_queue', q); emitStatus(); }
  function failed() { return LS.get('kt_failed', []); }

  /* ---------- 状態通知 ---------- */
  var status = { online: navigator.onLine !== false, syncing: false, error: null };
  var statusCbs = [], updateCbs = [];
  function statusInfo() {
    return {
      online: status.online, syncing: status.syncing, error: status.error,
      pending: queue().length, failed: failed().length,
      syncedAt: LS.get('kt_synced', 0), configured: !!cfg()
    };
  }
  function emitStatus() { var s = statusInfo(); statusCbs.forEach(function (f) { try { f(s); } catch (e) {} }); }

  /* ---------- 端末側の集計（サーバーと同じルール：付随部位は0.5） ---------- */
  function exMap(view) { var m = {}; (view.exercises || []).forEach(function (e) { m[e.id] = e; }); return m; }

  function calcLocal(ex, load, reps, secs) {
    var aReps = 0, aSecs = 0, vol = 0;
    if (ex.measure === '秒') aSecs = secs * ex.rMult;
    else {
      aReps = reps * ex.rMult;
      if ((ex.loadType === 'kg' || ex.loadType === '加重') && ex.inVol !== false) vol = load * ex.wMult * reps * ex.rMult;
    }
    return { aReps: aReps, aSecs: aSecs, vol: r1(vol) };
  }

  function summarizeLocal(view) {
    var em = exMap(view), gmap = {}, order = {};
    (view.parts || []).forEach(function (p, i) { gmap[p.part] = p.group; order[p.part] = i; });
    var byPart = {}, tot = { sets: 0, reps: 0, secs: 0, vol: 0 };
    Object.keys(view.todaySets || {}).forEach(function (exId) {
      var ex = em[exId];
      (view.todaySets[exId] || []).forEach(function (s) {
        tot.sets++; tot.reps += s.aReps || 0; tot.secs += s.aSecs || 0; tot.vol += s.vol || 0;
        if (!ex) return;
        var shares = [{ part: ex.part, w: 1 }].concat((ex.secondary || []).map(function (p) { return { part: p, w: 0.5 }; }));
        shares.forEach(function (sh) {
          var p = byPart[sh.part] = byPart[sh.part] || { part: sh.part, group: gmap[sh.part] || 'その他', sets: 0, reps: 0, secs: 0, vol: 0 };
          p.sets += sh.w; p.reps += (s.aReps || 0) * sh.w; p.secs += (s.aSecs || 0) * sh.w; p.vol += (s.vol || 0) * sh.w;
        });
      });
    });
    var parts = Object.keys(byPart).map(function (k) {
      var p = byPart[k]; p.sets = r1(p.sets); p.reps = r1(p.reps); p.secs = r1(p.secs); p.vol = r1(p.vol); return p;
    }).sort(function (a, b) { return (order[a.part] === undefined ? 999 : order[a.part]) - (order[b.part] === undefined ? 999 : order[b.part]); });
    tot.vol = r1(tot.vol);
    return { total: tot, parts: parts };
  }

  // 日付が変わっていたら「今日のセット」を「前回」に回す
  function rollDay(view) {
    var t = today();
    if (!view.today || t <= view.today) return false;
    Object.keys(view.todaySets || {}).forEach(function (exId) {
      var sets = view.todaySets[exId];
      if (sets && sets.length) view.prev[exId] = { date: view.today, sets: sets };
    });
    view.todaySets = {};
    view.today = t;
    view.todaySummary = { total: { sets: 0, reps: 0, secs: 0, vol: 0 }, parts: [] };
    return true;
  }

  function findSet(view, id) {
    var ids = Object.keys(view.todaySets || {});
    for (var i = 0; i < ids.length; i++) {
      var arr = view.todaySets[ids[i]] || [];
      for (var j = 0; j < arr.length; j++) if (arr[j].id === id) return { exId: ids[i], arr: arr, idx: j };
    }
    return null;
  }

  // 送信待ちの操作を表示用データに反映
  function applyOp(view, op) {
    var em = exMap(view);
    if (op.type === 'record') {
      var ex = em[op.exerciseId]; if (!ex) return;
      var c = calcLocal(ex, op.load, op.reps, op.secs);
      var set = { id: op.clientId, at: op.at, setNo: 1, load: op.load, intensity: ex.loadType === '強度固定' ? ex.intensity : '', reps: op.reps, secs: op.secs,
        aReps: c.aReps, aSecs: c.aSecs, vol: c.vol, memo: op.memo || '', pending: true };
      if (op.date === view.today) {
        var arr = view.todaySets[ex.id] = view.todaySets[ex.id] || [];
        if (arr.some(function (s) { return s.id === set.id; })) return;
        set.setNo = arr.reduce(function (m, s) { return Math.max(m, s.setNo || 0); }, 0) + 1;
        arr.push(set);
      } else if (op.date < view.today) {
        var pv = view.prev[ex.id];
        if (!pv || op.date > pv.date) view.prev[ex.id] = { date: op.date, sets: [set] };
        else if (op.date === pv.date && !pv.sets.some(function (s) { return s.id === set.id; })) pv.sets.push(set);
      }
    } else if (op.type === 'cancel') {
      var f = findSet(view, op.id); if (f) f.arr.splice(f.idx, 1);
    } else if (op.type === 'memo') {
      var g = findSet(view, op.id); if (g) g.arr[g.idx].memo = op.memo;
    } else if (op.type === 'interval') {
      view.settings['インターバル秒'] = op.secs;
    }
  }

  function localView(init) {
    var view = clone(init);
    view.prev = view.prev || {}; view.todaySets = view.todaySets || {};
    rollDay(view);
    var q = queue();
    q.forEach(function (op) { applyOp(view, op); });
    if (q.length || init.today !== view.today) view.todaySummary = summarizeLocal(view);
    return view;
  }

  function resultFor(view, exId, recordedId) {
    return { recordedId: recordedId || null, today: view.today, exerciseId: exId, sets: view.todaySets[exId] || [], todaySummary: view.todaySummary };
  }

  function cur() { return (window.APP && APP.data) || localView(LS.get('kt_init', null)); }

  /* ---------- 同期 ---------- */
  var syncing = null, syncTimer = null;
  function sync() {
    if (syncing) return syncing;
    var q = queue();
    status.syncing = true; emitStatus();
    var p = api(q.length ? 'syncOps' : 'getInitData', q.length ? [q] : [], 90000).then(function (res) {
      var init = q.length ? res.init : res;
      if (q.length) {
        var done = {};
        (res.results || []).forEach(function (r) { done[r.qid] = r; });
        var fl = failed();
        q.forEach(function (op) { var r = done[op.qid]; if (r && !r.ok) { op.error = r.error; fl.push(op); } });
        LS.set('kt_failed', fl);
        LS.set('kt_queue', queue().filter(function (op) { return !done[op.qid]; }));
      }
      LS.set('kt_init', init);
      LS.set('kt_synced', Date.now());
      status.online = true; status.error = null;
      var view = localView(init);
      updateCbs.forEach(function (f) { try { f(view); } catch (e) {} });
      setTimeout(prefetchAnalytics, 1500);
      return view;
    }).then(function (v) {
      syncing = null; status.syncing = false; emitStatus();
      if (queue().length) schedule(1500); // 送信中に増えた分
      return v;
    }, function (e) {
      syncing = null; status.syncing = false;
      if (e.offline) status.online = false;
      status.error = e.offline ? null : e;
      emitStatus();
      throw e;
    });
    syncing = p;
    return p;
  }
  function schedule(ms) {
    clearTimeout(syncTimer);
    syncTimer = setTimeout(function () { sync().catch(function () {}); }, ms || 300);
  }

  window.addEventListener('online', function () { status.online = true; emitStatus(); schedule(500); });
  window.addEventListener('offline', function () { status.online = false; emitStatus(); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && cfg()) schedule(300); });
  setInterval(function () { if (queue().length && cfg()) sync().catch(function () {}); }, 45000);

  /* ---------- 分析のキャッシュ ---------- */
  function anKey(type, anchor) { return 'kt_an:' + type + '|' + (anchor || 'today'); }
  function saveAnalytics(type, anchor, d) {
    var now = Date.now(), v = { t: now, d: d };
    LS.set(anKey(type, anchor), v);
    LS.set(anKey(d.type, d.anchor), v);
    // 古いものから削除（最大60件）
    try {
      var keys = [];
      for (var i = 0; i < localStorage.length; i++) { var k = localStorage.key(i); if (k && k.indexOf('kt_an:') === 0) keys.push(k); }
      if (keys.length > 60) {
        keys.map(function (k) { return { k: k, t: (LS.get(k, {}) || {}).t || 0 }; })
          .sort(function (a, b) { return a.t - b.t; })
          .slice(0, keys.length - 60).forEach(function (x) { LS.del(x.k); });
      }
    } catch (e) {}
  }
  function prefetchAnalytics() {
    if (!cfg() || Date.now() - LS.get('kt_anpref', 0) < 20 * 60000) return;
    LS.set('kt_anpref', Date.now());
    ['day', 'week', 'month'].reduce(function (pr, t) {
      return pr.then(function () { return api('getAnalytics', [t, null], 60000).then(function (d) { saveAnalytics(t, null, d); }); });
    }, Promise.resolve()).catch(function () {});
  }

  /* ---------- 画面から呼ぶ関数（GAS版の google.script.run と同じ名前） ---------- */
  var handlers = {
    getInitData: function () {
      var cached = LS.get('kt_init', null);
      if (cached) {
        schedule(200);
        return Promise.resolve(localView(cached));
      }
      return sync();
    },

    recordSet: function (p) {
      var view = cur(), em = exMap(view), ex = em[p.exerciseId];
      if (!ex) return Promise.reject(new Error('種目が見つかりません'));
      rollDay(view);
      var hasLoad = ex.loadType === 'kg' || ex.loadType === '加重';
      var load = hasLoad ? (Number(p.load) || 0) : 0;
      var reps = ex.measure === '回数' ? Math.round(Number(p.reps) || 0) : 0;
      var secs = ex.measure === '秒' ? Math.round(Number(p.secs) || 0) : 0;
      if (load < 0) return Promise.reject(new Error('負荷がマイナスです'));
      if (ex.measure === '回数' && reps <= 0) return Promise.reject(new Error('回数を1以上にしてください'));
      if (ex.measure === '秒' && secs <= 0) return Promise.reject(new Error('秒数を1以上にしてください'));
      if (reps > 1000 || secs > 36000 || load > 1000) return Promise.reject(new Error('値が大きすぎます。入力を確認してください'));
      var op = { qid: uuid(), type: 'record', clientId: p.clientId || uuid(), exerciseId: ex.id, load: load, reps: reps, secs: secs,
        memo: String(p.memo || '').slice(0, 500), date: view.today, at: nowStr() };
      var q = queue(); q.push(op); setQueue(q);
      applyOp(view, op);
      view.todaySummary = summarizeLocal(view);
      schedule(300);
      return Promise.resolve(resultFor(view, ex.id, op.clientId));
    },

    cancelRecord: function (id) {
      var view = cur(), f = findSet(view, id);
      if (!f) return Promise.reject(new Error('記録が見つかりません'));
      var q = queue(), pend = q.filter(function (op) { return op.type === 'record' && op.clientId === id; })[0];
      if (pend) q = q.filter(function (op) { return !(op.clientId === id || ((op.type === 'memo' || op.type === 'cancel') && op.id === id)); });
      else q.push({ qid: uuid(), type: 'cancel', id: id });
      setQueue(q);
      f.arr.splice(f.idx, 1);
      view.todaySummary = summarizeLocal(view);
      schedule(300);
      return Promise.resolve(resultFor(view, f.exId));
    },

    updateMemo: function (id, memo) {
      var view = cur(), f = findSet(view, id);
      if (!f) return Promise.reject(new Error('記録が見つかりません'));
      memo = String(memo || '').replace(/\r\n?/g, '\n').trim().slice(0, 500);
      var q = queue(), pend = q.filter(function (op) { return op.type === 'record' && op.clientId === id; })[0];
      if (pend) pend.memo = memo;
      else { q = q.filter(function (op) { return !(op.type === 'memo' && op.id === id); }); q.push({ qid: uuid(), type: 'memo', id: id, memo: memo }); }
      setQueue(q);
      f.arr[f.idx].memo = memo;
      schedule(300);
      return Promise.resolve(resultFor(view, f.exId));
    },

    saveInterval: function (secs) {
      var v = Math.max(5, Math.min(900, Math.round(Number(secs) || 0)));
      var q = queue().filter(function (op) { return op.type !== 'interval'; });
      q.push({ qid: uuid(), type: 'interval', secs: v });
      setQueue(q);
      var view = cur(); if (view && view.settings) view.settings['インターバル秒'] = v;
      var c = LS.get('kt_init', null); if (c) { c.settings['インターバル秒'] = v; LS.set('kt_init', c); }
      schedule(300);
      return Promise.resolve(v);
    },

    addExercise: function (p) {
      return api('addExercise', [p]).then(function (r) { schedule(500); return r; }, onlineOnly);
    },

    updateExerciseSecondary: function (id, list) {
      return api('updateExerciseSecondary', [id, list]).then(function (r) {
        var view = cur(); view.exercises = r.exercises; r.todaySummary = summarizeLocal(view);
        schedule(500);
        return r;
      }, onlineOnly);
    },

    getAnalytics: function (type, anchor) {
      return api('getAnalytics', [type, anchor], 60000).then(function (d) {
        saveAnalytics(type, anchor, d);
        return d;
      }, function (e) {
        if (!e.offline) throw e;
        var c = LS.get(anKey(type, anchor), null);
        if (!c) { var e2 = new Error('オフラインです。この期間はまだ一度も表示していないため、オンラインの時に開いてください'); e2.offline = true; throw e2; }
        var d = c.d; d._cachedAt = c.t; return d;
      });
    }
  };

  function onlineOnly(e) {
    if (e.offline) throw new Error('この操作はオンラインの時だけできます（記録はオフラインでもできます）');
    throw e;
  }

  function call(fn) {
    var args = Array.prototype.slice.call(arguments, 1);
    var h = handlers[fn];
    if (!h) return Promise.reject(new Error('不明な操作：' + fn));
    return h.apply(null, args);
  }

  return {
    call: call,
    sync: sync,
    schedule: schedule,
    configured: function () { return !!cfg(); },
    setConfig: function (c) { LS.set('kt_cfg', c); },
    clearConfig: function () { LS.del('kt_cfg'); },
    status: statusInfo,
    onStatus: function (f) { statusCbs.push(f); f(statusInfo()); },
    onUpdate: function (f) { updateCbs.push(f); },
    failed: failed,
    clearFailed: function () { LS.set('kt_failed', []); emitStatus(); },
    retryFailed: function () {
      var fl = failed(); LS.set('kt_failed', []);
      var q = queue(); fl.forEach(function (op) { delete op.error; q.push(op); }); setQueue(q); schedule(100);
    },
    today: today
  };
})();

// オフラインでも開けるように Service Worker を登録
if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
