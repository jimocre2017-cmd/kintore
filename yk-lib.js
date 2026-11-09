/* YKトレーニング（山本KID化計画）の計算（画面・テストで共通。端末側だけで動く＝オフラインOK）
 * ルール：今日のメニューは「不足度」で決定論的に決める。AI（Gemini）は決まったメニューの解説と、
 * 絞り期→増量期の移行タイミングの助言だけを行い、種目や数値は変えない（gas/Yk.gs）。
 *
 * 入力
 *   hist       … [{d:'2026/11/05', e:'E001', n:3}]  日付×種目ごとのセット数（今日より前。サーバーが直近35日分を返す）
 *   todaySets  … {種目ID: [セット…]}（今日の分。送信待ちも含む端末側の値）
 *   exercises  … 種目マスタ（id,name,part,equipment,measure,loadType,def,min,max,step,secondary,active…）
 *   parts      … 部位マスタ [{part, group}]
 *   prev       … {種目ID: {date, sets:[{load,reps,secs,intensity}]}}（前回のセット）
 */
var YkLib = (function () {
  var TAG = 'YKトレーニング';   // 固定テンプレートのタグ（gas/Yk.gs の ykInstallTemplate が作る）
  var TAG_TODAY = 'YK今日';     // 今日の推奨セッション（端末の中だけの一時タグ）
  var WINDOW = 7;               // 不足度を見る期間（日）。直近7日のローリング
  var OVER = 1.25;              // 目標のこの倍率を超えたら、今日は主働筋にしない

  // 部位（5つの充足度）。parts が先に、なければ groups（exclude を除く）で振り分ける
  var AREAS = [
    { key: 'chest',    label: '胸',         groups: ['胸'], target: 9,  weight: 1.5, minGap: 2, reps: [8, 12] },
    { key: 'legs',     label: '脚',         groups: ['脚'], target: 7,  weight: 1.5, minGap: 2, reps: [10, 15] },
    { key: 'back',     label: '背中',       groups: ['背中'], exclude: ['僧帽筋'], target: 10, weight: 1.0, minGap: 1, reps: [6, 12] },
    { key: 'shoulder', label: '肩・僧帽筋', parts: ['三角筋', '腱板（インナーマッスル）', '僧帽筋'], target: 7, weight: 1.0, minGap: 1, reps: [10, 15] },
    { key: 'core',     label: '腹',         groups: ['腹'], target: 5,  weight: 0.9, minGap: 1, reps: [6, 12] }
  ];

  // 部位ごとの候補種目（優先順）。risk＝右肩への負担（none/low/mid/high）
  var ROLES = {
    chest:    [{ id: 'E001', risk: 'mid' }, { id: 'E041', risk: 'high' }, { id: 'E018', risk: 'low' }],
    legs:     [{ id: 'E008', risk: 'none' }, { id: 'E033', risk: 'none' }],
    back:     [{ id: 'E027', risk: 'mid' }, { id: 'E042', risk: 'high' }, { id: 'E003', risk: 'low' }],
    shoulder: [{ id: 'E012', risk: 'low' }, { id: 'E017', risk: 'low' }],
    core:     [{ id: 'E007', risk: 'none' }, { id: 'E021', risk: 'none' }]
  };
  var REHAB = ['E009', 'E014'];          // フェイスプル・チューブ外旋（週のセット数には数えない）
  var PRESS = ['E001', 'E041', 'E004'];  // 肩に負担がかかるプレス系（名前に「プレス」を含む胸・肩の種目も同じ扱い）
  var BLOCK = { ok: [], uneasy: ['high'], pain: ['high', 'mid'] }; // 肩の状態ごとに外すリスク

  var DEFAULT_CFG = { phase: 'cut', blankDays: 3, phaseMul: { cut: 1, bulk: 1.15 }, maxMinutes: 30 };

  function r1(n) { return Math.round(n * 10) / 10; }
  function toDays(s) { var p = String(s).split('/'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function p2(n) { return ('0' + n).slice(-2); }
  function fromDays(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '/' + p2(d.getUTCMonth() + 1) + '/' + p2(d.getUTCDate()); }
  function addDays(s, n) { return fromDays(toDays(s) + n); }
  function inList(a, v) { return a.indexOf(v) >= 0; }

  /* 設定シート（設定タブ）の値から設定を組み立てる。キーが無ければ既定値 */
  function configFrom(settings) {
    var s = settings || {}, cfg = JSON.parse(JSON.stringify(DEFAULT_CFG));
    cfg.areas = AREAS.map(function (a) {
      var o = JSON.parse(JSON.stringify(a)), v = Number(s['YK_目標_' + a.label]);
      if (v > 0) o.target = v;
      return o;
    });
    var b = Number(s['YK_ブランク日数']); if (b >= 1) cfg.blankDays = b;
    var m = Number(s['YK_最大分']); if (m >= 10) cfg.maxMinutes = m;
    var mb = Number(s['YK_増量期倍率']); if (mb >= 1) cfg.phaseMul.bulk = mb;
    cfg.phase = Number(s['YK_フェーズ']) === 1 ? 'bulk' : 'cut'; // 0＝絞り期 / 1＝増量期
    return cfg;
  }

  /* 部位→充足度の区分 */
  function areaOf(areas, part, group) {
    var i, a;
    for (i = 0; i < areas.length; i++) { a = areas[i]; if (a.parts && inList(a.parts, part)) return a; }
    for (i = 0; i < areas.length; i++) {
      a = areas[i];
      if (a.groups && inList(a.groups, group) && !(a.exclude && inList(a.exclude, part))) return a;
    }
    return null;
  }

  /* 1セットが各区分に数える重み：メイン1、付随0.5。同じ区分に重なる時は大きい方（1セットを二重に数えない） */
  function setShares(ctx, ex) {
    var out = {};
    function add(part, w) {
      var a = areaOf(ctx.cfg.areas, part, ctx.groupOf[part]);
      if (a && (out[a.key] || 0) < w) out[a.key] = w;
    }
    add(ex.part, 1);
    (ex.secondary || []).forEach(function (p) { add(p, 0.5); });
    return out;
  }

  function prepare(input) {
    var cfg = input.cfg || configFrom(input.settings);
    var exMap = {}, groupOf = {};
    (input.exercises || []).forEach(function (e) { exMap[e.id] = e; });
    (input.parts || []).forEach(function (p) { groupOf[p.part] = p.group; });
    return { cfg: cfg, exMap: exMap, groupOf: groupOf, today: input.today };
  }

  /* 日付×種目の行にそろえる（履歴＋今日の端末側のセット） */
  function rows(input) {
    var out = (input.hist || []).map(function (h) { return { d: h.d, e: h.e, n: h.n }; });
    Object.keys(input.todaySets || {}).forEach(function (id) {
      var n = (input.todaySets[id] || []).length;
      if (n) out.push({ d: input.today, e: id, n: n });
    });
    return out;
  }

  /* 直近7日の区分ごとの消化セット数と、最後に鍛えた日からの経過日数 */
  function progress(input, ctx) {
    var from = toDays(ctx.today) - (WINDOW - 1), now = toDays(ctx.today);
    var done = {}, last = {}, lastAny = null;
    rows(input).forEach(function (r) {
      var ex = ctx.exMap[r.e]; if (!ex || inList(REHAB, r.e)) return;
      var d = toDays(r.d), sh = setShares(ctx, ex);
      if (lastAny === null || d > lastAny) lastAny = d;
      Object.keys(sh).forEach(function (k) {
        if (d >= from && d <= now) done[k] = (done[k] || 0) + r.n * sh[k];
        if (last[k] === undefined || d > last[k]) last[k] = d;
      });
    });
    return { done: done, last: last, lastAny: lastAny };
  }

  /* 不足度。score＝優先度×(目標−消化)/目標。目標の1.25倍を超えたら今日の対象外、前回から間隔が足りない部位も外す */
  function deficits(input) {
    var ctx = prepare(input), pr = progress(input, ctx), mul = ctx.cfg.phaseMul[ctx.cfg.phase] || 1, now = toDays(ctx.today);
    var list = ctx.cfg.areas.map(function (a) {
      var target = Math.round(a.target * mul * 10) / 10, done = r1(pr.done[a.key] || 0);
      var ratio = Math.max(0, (target - done) / target);
      var since = pr.last[a.key] === undefined ? null : now - pr.last[a.key];
      return {
        key: a.key, label: a.label, target: target, done: done, ratio: ratio, score: r1(a.weight * ratio * 100) / 100,
        daysSince: since, over: done >= target * OVER, tooSoon: since !== null && since < a.minGap
      };
    });
    return { areas: list, lastAny: pr.lastAny, gap: pr.lastAny === null ? null : now - pr.lastAny, ctx: ctx };
  }

  /* 絞り期→増量期の準備度：直近4週（7日ごと）のうち、胸と脚が目標の9割以上だった週の数 */
  function readiness(input) {
    var ctx = prepare(input), met = 0, weeks = [];
    for (var w = 1; w <= 4; w++) {
      var end = toDays(ctx.today) - 7 * (w - 1), start = end - (WINDOW - 1);
      var sum = { chest: 0, legs: 0 };
      rows(input).forEach(function (r) {
        var ex = ctx.exMap[r.e]; if (!ex || inList(REHAB, r.e)) return;
        var d = toDays(r.d); if (d < start || d > end) return;
        var sh = setShares(ctx, ex);
        ['chest', 'legs'].forEach(function (k) { if (sh[k]) sum[k] += r.n * sh[k]; });
      });
      var tc = ctx.cfg.areas[0].target, tl = ctx.cfg.areas[1].target;
      var ok = sum.chest >= tc * 0.9 && sum.legs >= tl * 0.9;
      weeks.push({ chest: r1(sum.chest), legs: r1(sum.legs), ok: ok });
      if (ok) met++;
    }
    return { metWeeks: met, of: 4, ready: met >= 3, weeks: weeks };
  }

  /* 種目が使えるか（マスタにあり、有効） */
  function usable(ctx, id) { var e = ctx.exMap[id]; return e && e.active !== false ? e : null; }

  function isPress(ex) {
    return inList(PRESS, ex.id) || (/プレス/.test(ex.name) && !/プッシュ/.test(ex.name));
  }

  /* 前回の記録 → 今日の目安（重さ・回数・秒・強度）。漸進は 回数→重さ の順。上限kgに届いたら回数を伸ばす */
  function recommend(ex, prev, area, mode) {
    var range = area.reps, sets = (prev && prev.sets) || [];
    var out = { load: ex.def || 0, reps: range[0], secs: 30, intensity: ex.intensity || '', note: '' };
    if (!sets.length) { out.note = '初回の目安'; return out; }
    var best = sets.reduce(function (b, s) { return (!b || (s.load || 0) > (b.load || 0) || ((s.load || 0) === (b.load || 0) && (s.reps || 0) >= (b.reps || 0))) ? s : b; }, null);
    var load0 = best.load || 0, reps0 = best.reps || range[0];
    out.intensity = best.intensity || out.intensity;
    var step = ex.step || 2.5, hasLoad = ex.loadType === 'kg' || ex.loadType === '加重';
    var label = hasLoad && load0 ? load0 + 'kg×' + reps0 : (ex.measure === '秒' ? (best.secs || 0) + '秒' : reps0 + '回');
    if (ex.measure === '秒') {
      out.secs = mode === 'reboot' ? Math.max(10, (best.secs || 30) - 5) : (best.secs || 30) + 5;
      out.note = '前回 ' + label + ' → ' + out.secs + '秒';
      return out;
    }
    if (mode === 'reboot') {
      out.load = hasLoad ? Math.max(ex.min || 0, load0 - step) : load0;
      out.reps = Math.min(reps0, range[1]);
      out.note = '復帰：前回 ' + label + ' → 1段階軽く';
      return out;
    }
    if (hasLoad && reps0 >= range[1] && ex.max && load0 + step <= ex.max) {
      out.load = load0 + step; out.reps = range[0];
      out.note = '前回 ' + label + ' → 重さ+' + step + 'kg';
    } else if (reps0 >= range[0]) {
      out.load = load0; out.reps = reps0 + 1;
      var capped = hasLoad && ex.max && load0 + step > ex.max && reps0 >= range[1];
      out.note = '前回 ' + label + ' → +1回' + (capped ? '（上限kg。3秒かけて下ろす・休憩を短く）' : '');
    } else {
      out.load = load0; out.reps = range[0];
      out.note = '前回 ' + label + ' → まず' + range[0] + '回';
    }
    return out;
  }

  /* 種目の並べ方：その部位で最近やっていない種目を先に */
  function pickExercises(ctx, area, input, shoulder, want) {
    var block = BLOCK[shoulder] || [], lastDone = {};
    rows(input).forEach(function (r) { var d = toDays(r.d); if (lastDone[r.e] === undefined || d > lastDone[r.e]) lastDone[r.e] = d; });
    var cands = (ROLES[area.key] || []).map(function (c, i) {
      return { c: c, i: i, ex: usable(ctx, c.id) };
    }).filter(function (x) { return x.ex && !inList(block, x.c.risk); });
    // E003（チューブ）は、プルアップ系が使えない時だけの代役
    var hasPull = cands.some(function (x) { return x.c.id === 'E027' || x.c.id === 'E042'; });
    if (hasPull) cands = cands.filter(function (x) { return x.c.id !== 'E003'; });
    cands.sort(function (a, b) {
      var la = lastDone[a.c.id] === undefined ? -1e9 : lastDone[a.c.id], lb = lastDone[b.c.id] === undefined ? -1e9 : lastDone[b.c.id];
      return la - lb || a.i - b.i;
    });
    return cands.slice(0, want).map(function (x) { return x.ex; });
  }

  function areaByKey(ctx, k) { return ctx.cfg.areas.filter(function (a) { return a.key === k; })[0]; }

  /* 今日のメニューを組む。戻り値＝JSON（画面・既存のワークアウト開始にそのまま渡す） */
  function build(input) {
    var D = deficits(input), ctx = D.ctx, cfg = ctx.cfg, shoulder = input.shoulder || 'ok';
    var state = input.state || {}, today = ctx.today, warnings = [], reasons = [];
    var plan = { date: today, mode: 'normal', phase: cfg.phase, shoulder: shoulder, tag: TAG, areas: D.areas, items: [], reasons: reasons, warnings: warnings, estMinutes: 0 };

    // 1) ブランク判定（休養明けは全身を軽く。直前の1週間にすでに復帰メニューをやっていれば通常に戻す）
    var rebootRecent = state.lastReboot && toDays(today) - toDays(state.lastReboot) < 7;
    var noHistory = D.lastAny === null;
    if ((noHistory || D.gap >= cfg.blankDays) && !rebootRecent) {
      plan.mode = 'reboot';
      reasons.push(noHistory ? '記録がまだ無いので、全身を軽く動かす復帰メニューにします' : '最後のトレーニングから ' + D.gap + ' 日空いたので、負荷を1段階落とした全身メニュー（YKリブート）にします');
    }

    var chosen = []; // [{area, exs}]
    if (plan.mode === 'reboot') {
      ['legs', 'chest', 'back', 'core'].forEach(function (k) {
        var a = areaByKey(ctx, k), exs = pickExercises(ctx, a, input, shoulder, 1);
        if (exs.length) chosen.push({ area: a, exs: exs });
      });
    } else {
      // 2) 不足度の高い上位2部位（対象外の部位は外す。全部外れたら間隔の条件を緩める）
      var avail = function (strict, allowOver) {
        return D.areas.filter(function (d) { return (allowOver || !d.over) && (!strict || !d.tooSoon); })
          .filter(function (d) { return pickExercises(ctx, areaByKey(ctx, d.key), input, shoulder, 1).length; });
      };
      var pool = avail(true, false);
      if (pool.length < 2) { pool = avail(false, false); if (pool.length) warnings.push('前回から間隔が短い部位も含めています'); }
      if (!pool.length) { pool = avail(false, true); if (pool.length) warnings.push('ほとんどの部位が今週の目標を超えています。今日は休養も検討してください'); }
      pool.sort(function (a, b) { return b.score - a.score; });
      var top = pool.slice(0, 2), maintain = top.length && top[0].score === 0;
      if (maintain) {
        reasons.push('今週の目標は達成済み。維持メニューで軽く動かします');
        top = pool.slice().sort(function (a, b) { return a.done / a.target - b.done / b.target; }).slice(0, 2);
      }
      top.forEach(function (d, i) {
        var a = areaByKey(ctx, d.key);
        var want = (top.length === 1 || i === 0) ? 2 : 1;
        if (top.length === 2 && i === 1 && pickExercises(ctx, areaByKey(ctx, top[0].key), input, shoulder, 2).length < 2) want = 2;
        var exs = pickExercises(ctx, a, input, shoulder, want);
        if (exs.length) chosen.push({ area: a, exs: exs, d: d });
        if (!maintain) reasons.push(d.label + '：直近7日で ' + d.done + ' / ' + d.target + ' セット' + (d.daysSince !== null ? '（' + d.daysSince + '日前が最後）' : '（記録なし）'));
      });
    }

    // 3) 種目とセット数・重さを決める
    var mains = [];
    chosen.forEach(function (c) {
      var d = c.d, remain = d ? Math.max(c.area.target - d.done, 2) : 2;
      c.exs.forEach(function (ex) {
        var rec = recommend(ex, (input.prev || {})[ex.id], c.area, plan.mode);
        var sets = plan.mode === 'reboot' ? 2 : Math.max(2, Math.min(4, Math.round(remain / c.exs.length)));
        mains.push({ exId: ex.id, name: ex.name, part: ex.part, role: 'main', area: c.area.key, areaLabel: c.area.label, sets: sets, load: rec.load, reps: rec.reps, secs: rec.secs, intensity: rec.intensity, measure: ex.measure, note: rec.note });
      });
    });

    // 4) 肩保護インターロック：必ず最初に肩インナーを入れる（プレス系が入る時は2セット）
    var hasPress = mains.some(function (m) { return isPress(ctx.exMap[m.exId]); });
    var lastDone = {};
    rows(input).forEach(function (r) { var d = toDays(r.d); if (lastDone[r.e] === undefined || d > lastDone[r.e]) lastDone[r.e] = d; });
    var rehab = REHAB.filter(function (id) { return usable(ctx, id); })
      .sort(function (a, b) { return (lastDone[a] === undefined ? -1e9 : lastDone[a]) - (lastDone[b] === undefined ? -1e9 : lastDone[b]); })[0];
    var warm = [];
    if (rehab) {
      var rx = ctx.exMap[rehab], rrec = recommend(rx, (input.prev || {})[rehab], { reps: [12, 15] }, plan.mode === 'reboot' ? 'reboot' : 'normal');
      rrec.reps = Math.max(12, Math.min(15, rrec.reps)); // 肩の準備は進歩させない（12〜15回の軽め）
      var rsets = (hasPress || shoulder !== 'ok') && plan.mode !== 'reboot' ? 2 : 1;
      warm.push({ exId: rehab, name: rx.name, part: rx.part, role: 'warmup', area: 'rehab', areaLabel: '肩インナー', sets: rsets, load: rrec.load, reps: rrec.reps, secs: rrec.secs, intensity: rrec.intensity, measure: rx.measure, note: '軽めに。' + (hasPress ? 'プレス前の肩の準備' : 'セッション開始の肩ケア') });
      reasons.push('肩を守るため ' + rx.name + ' を最初に入れます' + (hasPress ? '（プレス系の前）' : ''));
    } else {
      warnings.push('肩インナーの種目（E009・E014）が種目マスタに見つかりません');
    }

    // 5) 肩の状態の反映
    if (shoulder === 'uneasy') reasons.push('右肩に違和感があるため、負担の大きい種目（インクライン・オーバーハンドのプルアップ）を外しました');
    if (shoulder === 'pain') {
      reasons.push('右肩が痛いため、プレス系・プルアップ系を外し、肩インナー・脚・体幹を中心にしました');
      warnings.push('痛みが続く場合はトレーニングを控え、整形外科などに相談してください');
    }

    // 6) 時間（1セット約2.5分、ウォームアップ約1.5分）に収める。超えたら多いセット数の主種目から1セットずつ減らす（最低2）
    plan.items = warm.concat(mains);
    var est = function () { return Math.round(plan.items.reduce(function (s, it) { return s + it.sets * (it.role === 'warmup' ? 1.5 : 2.5); }, 0)); };
    var guard = 20;
    while (est() > cfg.maxMinutes && guard-- > 0) {
      // セット数が多い種目から減らす（同数なら後ろの種目から）＝片方の部位だけが削られて偏らない
      var cut = null;
      plan.items.forEach(function (it) { if (it.role === 'main' && it.sets > 2 && (!cut || it.sets >= cut.sets)) cut = it; });
      if (!cut) break;
      cut.sets--;
    }
    plan.estMinutes = est();
    if (!mains.length) warnings.push('使える種目がありません。種目マスタのIDと「有効」を確認してください');

    // 種目マスタに無いIDの検出（設定ミスに気づけるように）
    var missing = [];
    Object.keys(ROLES).forEach(function (k) { ROLES[k].forEach(function (c) { if (!usable(ctx, c.id) && !inList(missing, c.id)) missing.push(c.id); }); });
    REHAB.forEach(function (id) { if (!usable(ctx, id) && !inList(missing, id)) missing.push(id); });
    plan.missing = missing;
    return plan;
  }

  /* 既存のタグ・プログラム機構に渡す形（index.html の APP.data.programs の1件） */
  function toProgram(plan, name) {
    return {
      name: name || TAG_TODAY,
      note: (plan.mode === 'reboot' ? 'YKリブート（休養明けの全身・1段階軽く）。' : '') + '約' + plan.estMinutes + '分。' + plan.reasons.join(' / '),
      items: plan.items.map(function (it, i) {
        return { exId: it.exId, order: i + 1, note: it.sets + 'セット｜' + (it.measure === '秒' ? it.secs + '秒' : (it.load ? it.load + 'kg×' : '') + it.reps + '回') + '｜' + it.note };
      })
    };
  }

  return {
    TAG: TAG, TAG_TODAY: TAG_TODAY, AREAS: AREAS, ROLES: ROLES, REHAB: REHAB,
    configFrom: configFrom, deficits: deficits, readiness: readiness, build: build, recommend: recommend, toProgram: toProgram,
    addDays: addDays, toDays: toDays
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = YkLib;
