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
      var set = { id: op.clientId, at: op.at, setNo: 1, load: op.load, intensity: ex.loadType === '強度固定' ? (op.intensity || ex.intensity) : '', reps: op.reps, secs: op.secs,
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
        // 送信できた有酸素の操作は、端末に持っているデータにも反映しておく（送信待ちから消えても表示が消えないように）
        var cbase = LS.get('kt_cardio', null);
        if (cbase) {
          q.forEach(function (op) { var r = done[op.qid]; if (r && r.ok && CARDIO_OPS[op.type]) cardioApplyOp(cbase, op, false); });
          LS.set('kt_cardio', cbase);
        }
        var mbase = LS.get('kt_meal', null);
        if (mbase) {
          q.forEach(function (op) { var r = done[op.qid]; if (r && r.ok && MEAL_OPS[op.type]) mealApplyOp(mbase, op); });
          LS.set('kt_meal', mbase);
        }
        var bbase = LS.get('kt_body', null);
        if (bbase) {
          q.forEach(function (op) { var r = done[op.qid]; if (r && r.ok && BODY_OPS[op.type]) bodyApplyOp(bbase, op); });
          LS.set('kt_body', bbase);
        }
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

  /* ---------- 有酸素：端末のデータ＋送信待ちの操作を重ねた表示用データ ---------- */
  var CARDIO_OPS = { cardioSave: 1, cardioDelete: 1, cardioPlace: 1, cardioPlaceDel: 1, cardioCourse: 1, cardioCourseDel: 1 };
  function upsertById(arr, item) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === item.id) { arr[i] = item; return; }
    arr.push(item);
  }
  function removeById(arr, id) {
    for (var i = arr.length - 1; i >= 0; i--) if (arr[i].id === id) arr.splice(i, 1);
  }
  // 操作を表示用データに反映（pending=true なら「送信待ち」の印を付ける）
  function cardioApplyOp(v, op, pending) {
    if (op.type === 'cardioSave') {
      var e = clone(op.entry); e.hasRoute = !!e.route; delete e.route;
      if (pending) e.pending = true;
      upsertById(v.logs, e);
    } else if (op.type === 'cardioDelete') removeById(v.logs, op.id);
    else if (op.type === 'cardioPlace') upsertById(v.places, clone(op.place));
    else if (op.type === 'cardioPlaceDel') removeById(v.places, op.id);
    else if (op.type === 'cardioCourse') upsertById(v.courses, clone(op.course));
    else if (op.type === 'cardioCourseDel') removeById(v.courses, op.id);
  }
  function cardioLocal() {
    var v = clone(LS.get('kt_cardio', null) || { today: today(), logs: [], courses: [], places: [] });
    v.today = today();
    queue().forEach(function (op) { if (CARDIO_OPS[op.type]) cardioApplyOp(v, op, true); });
    v.logs.sort(function (a, b) { return a.date === b.date ? ((a.start || '') < (b.start || '') ? 1 : -1) : (a.date < b.date ? 1 : -1); });
    return v;
  }
  // ルートは長いので一覧とは別に、記録IDごとに端末へ保存（最大40件）
  function routeCache() { return LS.get('kt_croutes', {}); }
  function routePut(id, route) {
    var c = routeCache(); c[id] = route;
    var keys = Object.keys(c);
    if (keys.length > 40) keys.slice(0, keys.length - 40).forEach(function (k) { delete c[k]; });
    LS.set('kt_croutes', c);
  }
  function cardioEnqueue(op) {
    var q = queue(); q.push(op); setQueue(q); schedule(300);
    return Promise.resolve(cardioLocal());
  }

  /* ---------- 体組成：端末のデータ＋送信待ちの操作を重ねた表示用データ（1測定＝1件、IDで上書き） ---------- */
  var BODY_OPS = { bodySave: 1, bodyDelete: 1, bodyGoal: 1 };
  // 端末に残っている古い形式（日ごとの logs だけ）も、測定1件ずつの entries に直して使う
  function bodyEntries(v) {
    if (!v.entries) v.entries = (v.logs || []).map(function (l) { var e = clone(l); e.id = 'L' + l.date; e.time = ''; e.tags = []; delete e.count; delete e.range; return e; });
    return v.entries;
  }
  function bodyApplyOp(v, op, pending) {
    var E = bodyEntries(v);
    if (op.type === 'bodySave') {
      var e = clone(op.entry);
      if (!e.id) e.id = 'L' + e.date;
      if (!e.tags) e.tags = [];
      if (pending) e.pending = true;
      for (var i = E.length - 1; i >= 0; i--) if (E[i].id === e.id) E.splice(i, 1);
      E.push(e);
    } else if (op.type === 'bodyDelete') {
      var key = op.id || op.date, byDate = /^\d{4}\/\d{1,2}\/\d{1,2}$/.test(key);
      for (var j = E.length - 1; j >= 0; j--) if (byDate ? E[j].date === key : E[j].id === key) E.splice(j, 1);
    } else if (op.type === 'bodyGoal') v.goalFat = Number(op.goal) || 0;
  }
  function bodyLocal() {
    var v = clone(LS.get('kt_body', null) || { today: today(), entries: [], goalFat: 0 });
    v.today = today();
    bodyEntries(v);
    queue().forEach(function (op) { if (BODY_OPS[op.type]) bodyApplyOp(v, op, true); });
    v.entries = BodyLib.sortEntries(v.entries);
    v.logs = BodyLib.daily(v.entries); // 日ごとの平均
    return v;
  }
  function bodyEnqueue(op) {
    var q = queue(); q.push(op); setQueue(q); schedule(300);
    return Promise.resolve(bodyLocal());
  }


  /* ---------- 体つき写真：画像はこの端末のIndexedDBに保存（一覧のメタ情報だけlocalStorage） ---------- */
  var PH = { mem: {}, db: null };
  function phDb() {
    if (PH.db) return PH.db;
    PH.db = new Promise(function (res) {
      try {
        var rq = indexedDB.open('kt-photo', 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore('img'); };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { res(null); };
      } catch (e) { res(null); }
    });
    return PH.db;
  }
  function phGet(key) {
    if (PH.mem[key]) return Promise.resolve(PH.mem[key]);
    return phDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (res) {
        var rq = db.transaction('img').objectStore('img').get(key);
        rq.onsuccess = function () { if (rq.result) PH.mem[key] = rq.result; res(rq.result || null); };
        rq.onerror = function () { res(null); };
      });
    });
  }
  function phPut(key, val) {
    PH.mem[key] = val;
    return phDb().then(function (db) { if (db) try { db.transaction('img', 'readwrite').objectStore('img').put(val, key); } catch (e) {} });
  }
  function phDel(id) {
    ['thumb', 'full'].forEach(function (k) { delete PH.mem[k + ':' + id]; });
    return phDb().then(function (db) { if (db) try { var st = db.transaction('img', 'readwrite').objectStore('img'); st.delete('thumb:' + id); st.delete('full:' + id); } catch (e) {} });
  }

  /* ---------- 食事：端末のデータ＋送信待ちの操作を重ねた表示用データ（ID単位で上書き） ---------- */
  var MEAL_OPS = { mealSave: 1, mealDelete: 1, mealGoal: 1, mealFood: 1, mealFoodDel: 1 };
  function mealApplyOp(v, op, pending) {
    if (op.type === 'mealSave') {
      var e = clone(op.entry);
      if (pending) e.pending = true;
      upsertById(v.logs, e);
    } else if (op.type === 'mealDelete') removeById(v.logs, op.id);
    else if (op.type === 'mealGoal') v.goals = clone(op.goals);
    else if (op.type === 'mealFood') {
      v.foods = v.foods || [];
      var f = clone(op.food);
      for (var i = v.foods.length - 1; i >= 0; i--) if (v.foods[i].name === f.name && v.foods[i].id !== f.id) v.foods.splice(i, 1); // 同じ名前は上書き
      upsertById(v.foods, f);
      v.foods.sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
    } else if (op.type === 'mealFoodDel') { v.foods = v.foods || []; removeById(v.foods, op.id); }
  }
  function mealLocal() {
    var v = clone(LS.get('kt_meal', null) || { today: today(), logs: [], goals: { kcal: 0, protein: 0, fat: 0 }, suggest: null, foods: [] });
    v.today = today(); v.foods = v.foods || [];
    queue().forEach(function (op) { if (MEAL_OPS[op.type]) mealApplyOp(v, op, true); });
    v.logs.sort(function (a, b) { return a.date === b.date ? ((a.time || '') < (b.time || '') ? 1 : -1) : (a.date < b.date ? 1 : -1); });
    return v;
  }
  function mealEnqueue(op) {
    var q = queue(); q.push(op); setQueue(q); schedule(300);
    return Promise.resolve(mealLocal());
  }

  /* ---------- 画面から呼ぶ関数（GAS版の google.script.run と同じ名前） ---------- */
  var handlers = {
    /* 有酸素：端末にあるデータをすぐ返す（無ければ null） */
    cardioCached: function () {
      return Promise.resolve(LS.get('kt_cardio', null) || queue().some(function (o) { return CARDIO_OPS[o.type]; }) ? cardioLocal() : null);
    },
    /* 有酸素：サーバーの最新を取り直す（先に送信待ちを送る）。オフラインなら端末のデータ */
    cardioInit: function () {
      if (!cfg()) { var e0 = new Error('NOCFG'); e0.nocfg = true; return Promise.reject(e0); }
      if (navigator.onLine === false) return Promise.resolve(cardioLocal());
      var pre = queue().length ? sync().catch(function () {}) : Promise.resolve();
      return pre.then(function () { return api('cardioGet', [], 60000); }).then(function (d) {
        LS.set('kt_cardio', d); LS.set('kt_cardio_at', Date.now());
        return cardioLocal();
      }, function (e) {
        if (e.offline) return cardioLocal();
        throw e;
      });
    },
    cardioSave: function (entry) {
      entry = clone(entry); entry.id = entry.id || uuid();
      if (entry.route) routePut(entry.id, entry.route);
      return cardioEnqueue({ qid: uuid(), type: 'cardioSave', entry: entry }).then(function (v) { v.savedId = entry.id; return v; });
    },
    cardioDelete: function (id) {
      var q = queue().filter(function (op) { return !(op.type === 'cardioSave' && op.entry.id === id); });
      // まだ送っていない新規記録なら、取り消すだけでよい（サーバーには何も無い）
      var wasPendingOnly = q.length !== queue().length && !(LS.get('kt_cardio', null) || { logs: [] }).logs.some(function (l) { return l.id === id; });
      if (wasPendingOnly) { setQueue(q); return Promise.resolve(cardioLocal()); }
      setQueue(q);
      return cardioEnqueue({ qid: uuid(), type: 'cardioDelete', id: id });
    },
    cardioRoute: function (id) {
      var q = queue(), i;
      for (i = q.length - 1; i >= 0; i--) if (q[i].type === 'cardioSave' && q[i].entry.id === id) return Promise.resolve(q[i].entry.route || '');
      var c = routeCache();
      if (c[id] !== undefined) return Promise.resolve(c[id]);
      return api('cardioRoute', [id], 60000).then(function (r) { routePut(id, r || ''); return r || ''; });
    },
    cardioSavePlace: function (place) {
      place = clone(place); place.id = place.id || uuid();
      return cardioEnqueue({ qid: uuid(), type: 'cardioPlace', place: place });
    },
    cardioDeletePlace: function (id) { return cardioEnqueue({ qid: uuid(), type: 'cardioPlaceDel', id: id }); },
    cardioSaveCourse: function (course) {
      course = clone(course); course.id = course.id || uuid();
      return cardioEnqueue({ qid: uuid(), type: 'cardioCourse', course: course });
    },
    cardioDeleteCourse: function (id) { return cardioEnqueue({ qid: uuid(), type: 'cardioCourseDel', id: id }); },

    /* 体組成 */
    bodyCached: function () {
      return Promise.resolve(LS.get('kt_body', null) || queue().some(function (o) { return BODY_OPS[o.type]; }) ? bodyLocal() : null);
    },
    bodyInit: function () {
      if (!cfg()) { var e0 = new Error('NOCFG'); e0.nocfg = true; return Promise.reject(e0); }
      if (navigator.onLine === false) return Promise.resolve(bodyLocal());
      var pre = queue().length ? sync().catch(function () {}) : Promise.resolve();
      return pre.then(function () { return api('bodyGet', [], 60000); }).then(function (d) {
        LS.set('kt_body', d);
        return bodyLocal();
      }, function (e) {
        if (e.offline) return bodyLocal();
        throw e;
      });
    },
    bodySave: function (entry) {
      entry = clone(entry);
      if (!entry.date) return Promise.reject(new Error('日付が正しくありません'));
      if (!entry.id) entry.id = uuid();
      return bodyEnqueue({ qid: uuid(), type: 'bodySave', entry: entry });
    },
    bodyDelete: function (id) {
      // まだ送っていない新規記録なら取り消すだけでよい
      var q = queue().filter(function (op) { return !(op.type === 'bodySave' && op.entry.id === id); });
      var onServer = bodyEntries(LS.get('kt_body', null) || { entries: [] }).some(function (e) { return e.id === id; });
      if (q.length !== queue().length && !onServer) { setQueue(q); return Promise.resolve(bodyLocal()); }
      setQueue(q);
      return bodyEnqueue({ qid: uuid(), type: 'bodyDelete', id: id });
    },
    bodySetGoal: function (goal) { return bodyEnqueue({ qid: uuid(), type: 'bodyGoal', goal: Number(goal) || 0 }); },


    /* 体つき写真（前・横・後ろ）：保存・削除・比較はオンラインのみ。一覧は端末にも控える */
    photoCached: function () { return Promise.resolve(LS.get('kt_photo', null)); },
    photoInit: function () {
      if (!cfg()) { var e0 = new Error('NOCFG'); e0.nocfg = true; return Promise.reject(e0); }
      return api('photoGet', [], 60000).then(function (d) { LS.set('kt_photo', d); return d; }, function (e) {
        if (e.offline) { var c = LS.get('kt_photo', null) || { today: today(), photos: [], angles: ['前', '横', '後ろ'] }; c = clone(c); c.offline = true; return c; }
        throw e;
      });
    },
    // p = { id, setId, date, time, angle, memo, image(dataURL), thumb(dataURL) }
    photoSave: function (p) {
      p = clone(p); p.id = p.id || uuid();
      return api('photoSave', [p], 120000).then(function () {
        var c = LS.get('kt_photo', null) || { today: today(), photos: [], angles: ['前', '横', '後ろ'] };
        c.photos = c.photos.filter(function (x) { return x.id !== p.id; });
        c.photos.push({ id: p.id, date: p.date, time: p.time || '', angle: p.angle, memo: p.memo || '', setId: p.setId || '' });
        LS.set('kt_photo', c);
        var jobs = [];
        if (p.thumb) jobs.push(phPut('thumb:' + p.id, p.thumb));
        if (p.image) jobs.push(phPut('full:' + p.id, p.image));
        return Promise.all(jobs).then(function () { return p.id; });
      }, onlineOnly);
    },
    photoDelete: function (id) {
      return api('photoDelete', [id], 60000).then(function () {
        var c = LS.get('kt_photo', null);
        if (c) { c.photos = c.photos.filter(function (x) { return x.id !== id; }); LS.set('kt_photo', c); }
        return phDel(id).then(function () { return c; });
      }, onlineOnly);
    },
    // 画像（dataURL）を { id: dataURL|null } で返す。端末に無いものだけサーバーから取る（10件ずつ）
    photoImages: function (ids, kind) {
      kind = kind === 'full' ? 'full' : 'thumb';
      var out = {};
      return Promise.all(ids.map(function (id) { return phGet(kind + ':' + id).then(function (v) { if (v) out[id] = v; }); })).then(function () {
        var miss = ids.filter(function (id) { return !out[id]; });
        if (!miss.length) return out;
        var chunks = [], i;
        for (i = 0; i < miss.length; i += 10) chunks.push(miss.slice(i, i + 10));
        return chunks.reduce(function (pr, ch) {
          return pr.then(function () {
            return api('photoImages', [ch, kind], 120000).then(function (m) {
              return Promise.all(ch.map(function (id) { if (m[id]) { out[id] = m[id]; return phPut(kind + ':' + id, m[id]); } }));
            }, function (e) { if (!e.offline) throw e; });
          });
        }, Promise.resolve()).then(function () { return out; });
      });
    },
    photoCompare: function (a, b) { return api('photoCompare', [{ a: a, b: b }], 150000).then(function (r) { return r; }, onlineOnly); },

    /* 食事 */
    mealCached: function () {
      return Promise.resolve(LS.get('kt_meal', null) || queue().some(function (o) { return MEAL_OPS[o.type]; }) ? mealLocal() : null);
    },
    mealInit: function () {
      if (!cfg()) { var e0 = new Error('NOCFG'); e0.nocfg = true; return Promise.reject(e0); }
      if (navigator.onLine === false) return Promise.resolve(mealLocal());
      var pre = queue().length ? sync().catch(function () {}) : Promise.resolve();
      return pre.then(function () { return api('mealGet', [], 60000); }).then(function (d) {
        LS.set('kt_meal', d);
        return mealLocal();
      }, function (e) {
        if (e.offline) return mealLocal();
        throw e;
      });
    },
    // 食事内容 → 栄養の見積もり（AIを使うのでオンラインのみ）
    mealEstimate: function (req) { return api('mealEstimate', [req], 120000).then(function (r) { return r; }, onlineOnly); },
    mealSave: function (entry) {
      entry = clone(entry); entry.id = entry.id || uuid();
      if (!entry.date) return Promise.reject(new Error('日付が正しくありません'));
      return mealEnqueue({ qid: uuid(), type: 'mealSave', entry: entry });
    },
    mealDelete: function (id) {
      var q = queue().filter(function (op) { return !(op.type === 'mealSave' && op.entry.id === id); });
      var onServer = (LS.get('kt_meal', null) || { logs: [] }).logs.some(function (l) { return l.id === id; });
      if (q.length !== queue().length && !onServer) { setQueue(q); return Promise.resolve(mealLocal()); }
      setQueue(q);
      return mealEnqueue({ qid: uuid(), type: 'mealDelete', id: id });
    },
    mealSaveFood: function (food) {
      food = clone(food); food.id = food.id || uuid();
      return mealEnqueue({ qid: uuid(), type: 'mealFood', food: food });
    },
    mealDeleteFood: function (id) {
      var q = queue().filter(function (op) { return !(op.type === 'mealFood' && op.food.id === id); });
      var onServer = ((LS.get('kt_meal', null) || {}).foods || []).some(function (f) { return f.id === id; });
      if (q.length !== queue().length && !onServer) { setQueue(q); return Promise.resolve(mealLocal()); }
      setQueue(q);
      return mealEnqueue({ qid: uuid(), type: 'mealFoodDel', id: id });
    },
    mealSetGoals: function (goals) { return mealEnqueue({ qid: uuid(), type: 'mealGoal', goals: clone(goals) }); },

    /* 減量計画：設定・AIの提案・採用はオンラインのみ。表示用の設定と履歴は端末にも控える（表示は体組成・食事の控えと合わせて計算） */
    planCached: function () { return Promise.resolve(LS.get('kt_plan', null)); },
    planInit: function () {
      if (!cfg()) { var e0 = new Error('NOCFG'); e0.nocfg = true; return Promise.reject(e0); }
      return api('planGet', [], 60000).then(function (d) { LS.set('kt_plan', d); return d; }, function (e) {
        if (e.offline) {
          var c = LS.get('kt_plan', null);
          if (c) { c = clone(c); c.offline = true; return c; }
        }
        throw e;
      });
    },
    planSet: function (p) { return api('planSet', [p], 60000).then(function (d) { LS.set('kt_plan', d); return d; }, onlineOnly); },
    planAdvise: function () { return api('planAdvise', [], 120000).then(function (r) { return r; }, onlineOnly); },
    planApply: function (p) { return api('planApply', [p], 60000).then(function (d) { LS.set('kt_plan', d); return d; }, onlineOnly); },

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
        memo: String(p.memo || '').slice(0, 500), date: view.today, at: nowStr(),
        intensity: ex.loadType === '強度固定' ? String(p.intensity || ex.intensity || '').slice(0, 40) : '' };
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

    updateExerciseTags: function (id, tags) {
      return api('updateExerciseTags', [id, tags]).then(function (r) {
        var view = cur(); view.exercises = r.exercises;
        schedule(500);
        return r;
      }, onlineOnly);
    },

    // AIトレーナー（Gemini はGAS側から呼ぶ。APIキーはアプリに置かない）
    aiConsult: function (req) {
      return api('aiConsult', [req], 180000).then(function (r) { LS.set('kt_ai_last', r); return r; }, onlineOnly);
    },
    aiLast: function () { return Promise.resolve(LS.get('kt_ai_last', null)); },
    aiApplyProgram: function (prog) {
      return api('aiApplyProgram', [prog], 60000).then(function (r) { return sync().then(function () { return r; }, function () { return r; }); }, onlineOnly);
    },
    aiDeleteProgram: function (tag) {
      return api('aiDeleteProgram', [tag], 60000).then(function (r) { return sync().then(function () { return r; }, function () { return r; }); }, onlineOnly);
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
    uuid: uuid,
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
