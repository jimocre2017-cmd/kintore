/* 食事の集計（画面とテストで共通） */
var MealLib = (function () {
  function r1(n) { return Math.round(n * 10) / 10; }
  function toDays(s) { var p = s.split('/'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fromDays(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + ('0' + d.getUTCDate()).slice(-2); }
  function zero() { return { kcal: 0, protein: 0, fat: 0, carbs: 0, meals: 0, confirmed: false, logged: false }; }

  /* 「この日はこれで全部」の印（記録の確認）。食事ログに 0kcal の行として保存する（オフラインの送信待ち・サーバーの集計にそのまま乗る）。
     食事の数には数えないが、その日は「記録した日」になる（食べていない日＝0kcal として平均に入る） */
  var DAY_MARK_NOTE = 'day-confirmed', DAY_MARK_TEXT = '【この日はこれで全部（記録確認）】';
  function isMark(l) { return !!l && l.note === DAY_MARK_NOTE; }
  function markEntry(id, date) { return { id: id, date: date, time: '', type: 'その他', text: DAY_MARK_TEXT, kcal: 0, protein: 0, fat: 0, carbs: 0, items: '', note: DAY_MARK_NOTE }; }

  // 1日の合計。logged＝平均などに数える日（食事が1件以上、または「これで全部」の確認あり）
  function dayTotal(logs, date) {
    var t = zero();
    logs.forEach(function (l) {
      if (l.date !== date) return;
      if (isMark(l)) { t.confirmed = true; return; }
      t.kcal += l.kcal || 0; t.protein += l.protein || 0; t.fat += l.fat || 0; t.carbs += l.carbs || 0; t.meals++;
    });
    t.kcal = Math.round(t.kcal); t.protein = r1(t.protein); t.fat = r1(t.fat); t.carbs = r1(t.carbs);
    t.logged = t.meals > 0 || t.confirmed;
    return t;
  }

  /* 記録忘れの可能性がある日（今日より前の n 日。最初に記録した日より前は見ない。「これで全部」を確認した日は出さない）
     none＝何も記録が無い／low＝カロリーが少ない（下限の65%未満。下限が無いときは1,000kcal未満） */
  function suspects(logs, today, kcalMin, n) {
    n = n || 7;
    var first = null;
    (logs || []).forEach(function (l) { if (l.date && (!first || l.date < first)) first = l.date; });
    if (!first) return [];
    var lim = kcalMin > 0 ? Math.round(kcalMin * 0.65) : 1000, out = [], t0 = toDays(today);
    for (var i = 1; i <= n; i++) {
      var ds = fromDays(t0 - i); if (ds < first) break;
      var t = dayTotal(logs, ds);
      if (t.confirmed) continue;
      if (!t.meals) out.push({ date: ds, reason: 'none', meals: 0, kcal: 0 });
      else if (t.kcal < lim) out.push({ date: ds, reason: 'low', meals: t.meals, kcal: t.kcal, limit: lim });
    }
    return out;
  }

  // 終了日までの直近 n 日（古い順）。記録の無い日は meals=0
  function lastDays(logs, endDate, n) {
    var out = [], e = toDays(endDate);
    for (var i = n - 1; i >= 0; i--) { var d = fromDays(e - i), t = dayTotal(logs, d); t.date = d; out.push(t); }
    return out;
  }

  // 記録した日だけの平均（全画面・AI共通の数え方）。excludeDate（今日＝途中の日）は入れない
  function average(days, excludeDate) {
    var a = days.filter(function (d) { return d.logged && d.date !== excludeDate; }), t = { kcal: 0, protein: 0, fat: 0, carbs: 0, days: a.length };
    if (!a.length) return t;
    a.forEach(function (d) { t.kcal += d.kcal; t.protein += d.protein; t.fat += d.fat; t.carbs += d.carbs; });
    t.kcal = Math.round(t.kcal / a.length); t.protein = r1(t.protein / a.length); t.fat = r1(t.fat / a.length); t.carbs = r1(t.carbs / a.length);
    return t;
  }

  // 三大栄養素のエネルギー比（%）
  function energySplit(t) {
    var p = t.protein * 4, f = t.fat * 9, c = t.carbs * 4, sum = p + f + c;
    if (!sum) return null;
    return { protein: Math.round(p / sum * 100), fat: Math.round(f / sum * 100), carbs: Math.round(c / sum * 100) };
  }

  // 目標に対する達成率（目標0＝null）
  function pct(v, goal) { return goal > 0 ? Math.round(v / goal * 100) : null; }

  // 下限（アンダー）・上限（トップ）に対する状態。どちらも未設定なら null。'under'＝下限未満、'over'＝上限超え、'in'＝範囲内
  function status(v, lo, hi) {
    lo = lo > 0 ? lo : 0; hi = hi > 0 ? hi : 0;
    if (!lo && !hi) return null;
    if (lo && v < lo) return 'under';
    if (hi && v > hi) return 'over';
    return 'in';
  }

  // その週（月曜始まり）の月曜の日数
  function weekStart(date) { var n = toDays(date); return n - ((n + 3) % 7); }

  /* 「今日の目標」＝週の合計が目安×7に着くように、残りの日で割り戻した値。
     月曜から前日までの実績（記録の無い日は目安どおり食べた扱いにして、ずれを作らない）を差し引いて、今日以降の日数で割る。
     下限・上限があれば、その範囲に収める。key＝kcal / protein / fat、step＝丸める刻み（kcal=10、g=1）。目安が未設定なら null */
  function weekPlan(logs, date, goal, lo, hi, key, step) {
    if (!(goal > 0)) return null;
    step = step || 1; lo = lo > 0 ? lo : 0; hi = hi > 0 ? hi : 0;
    var start = weekStart(date), today = toDays(date), used = 0, sum = 0, rec = 0;
    for (var d = start; d < today; d++) {
      var t = dayTotal(logs, fromDays(d));
      if (t.logged) { used += t[key]; sum += t[key]; rec++; } else used += goal;
    }
    var left = 7 - (today - start), raw = (goal * 7 - used) / left, target = raw, clamp = null;
    if (hi && target > hi) { target = hi; clamp = 'hi'; }
    if (lo && target < lo) { target = lo; clamp = 'lo'; }
    if (target < 0) target = 0;
    target = Math.round(target / step) * step;
    return { target: target, raw: Math.round(raw * 10) / 10, goal: goal, clamp: clamp, days: rec, avg: rec ? Math.round(sum / rec * 10) / 10 : null, left: left, diff: target - goal };
  }

  /* 1日の合計に対するコメント（多い／少ない → 減らす・増やす方法）。AIは使わず、ルールで出す。
     t＝その日の合計、tg＝{kcal,protein,fat: {ref:今日の目標, lo:下限, hi:上限}}、partial＝まだ1日の途中（少ないとは言わず、残りを案内する）
     返り値 { state:{kcal,protein,fat: 'over'|'under'|'ok'|null}, head:'…', lines:[…] } */
  var NAME = { kcal: 'カロリー', protein: 'たんぱく質', fat: '脂質' }, UNIT = { kcal: 'kcal', protein: 'g', fat: 'g' };
  var HOW = {
    kcal_over: 'カロリーが多め。間食・甘い飲み物・お酒を減らし、揚げ物や炒め物の油を控える。主食（米・パン・麺）を一口ずつ減らすのも効く。',
    kcal_under: 'カロリーが少なめ。主食（米・パン・芋）やバナナ・おにぎりなど、低脂質のものから足す。削りすぎると筋肉が落ちるので注意。',
    protein_over: 'たんぱく質は多め。極端でなければ問題ないが、増やした分は炭水化物や野菜に回してバランスを取る。',
    protein_under: 'たんぱく質が少なめ。各食に手のひら1枚ぶん（鶏むね・ささみ・魚・卵・納豆・豆腐）を入れる。間にヨーグルトやプロテインを足すのが手軽。',
    fat_over: '脂質が多め。揚げ物・バター・マヨネーズ・ドレッシング・脂身・洋菓子・ナッツを控える。調理は焼く・蒸す・ゆでるに、肉は皮なし・赤身に。',
    fat_under: '脂質が少なめ。少なすぎるとホルモンやビタミンの吸収に響くので、魚・卵・オリーブ油・ナッツを少量足す。'
  };
  function advise(t, tg, partial) {
    var keys = ['kcal', 'protein', 'fat'], st = {}, lines = [], used = {};
    keys.forEach(function (k) {
      var x = tg && tg[k];
      if (!x || !(x.ref > 0 || x.lo > 0 || x.hi > 0)) { st[k] = null; return; }
      var v = t[k] || 0, over = x.hi > 0 ? v > x.hi : (x.ref > 0 && v > x.ref * 1.1);
      var under = !over && (x.lo > 0 ? v < x.lo : (x.ref > 0 && v < x.ref * 0.9));
      st[k] = over ? 'over' : (under && !partial) ? 'under' : 'ok';
    });
    var on = keys.filter(function (k) { return st[k]; });
    if (!on.length) return { state: st, head: '', lines: [] };
    var head = on.map(function (k) { return NAME[k] + (st[k] === 'over' ? 'が多い' : st[k] === 'under' ? 'が少ない' : 'は範囲内'); }).join('・');
    function use() { Array.prototype.slice.call(arguments).forEach(function (k) { used[k] = 1; }); }
    // 組み合わせ
    if (st.fat === 'over' && st.protein === 'under') {
      lines.push('脂質を減らしつつ、たんぱく質を足すのが最優先です。揚げ物・バター・マヨネーズ・ドレッシング・脂身・菓子を控え、鶏むね・ささみ・白身魚・卵白・納豆・無脂肪ヨーグルト・プロテインに置き換えましょう。');
      if (st.kcal === 'under') lines.push('カロリーも足りないので、減らした脂質の分は米・パン・芋などの炭水化物で補います（脂質では補わない）。');
      use('fat_over', 'protein_under'); if (st.kcal === 'under') use('kcal_under');
    } else if (st.fat === 'over' && st.kcal === 'over') {
      lines.push('カロリー超過の主な原因は脂質の可能性が高いです。油もの・間食・お酒を減らすと、いちばん効率よく戻せます。');
      use('fat_over', 'kcal_over');
    } else if (st.kcal === 'under' && st.protein === 'under' && st.fat !== 'under') {
      lines.push('全体に少なめです。各食にたんぱく源を足し、主食（米・パン・芋）もしっかり摂りましょう。脂質は足さなくて大丈夫です。');
      use('kcal_under', 'protein_under');
    }
    keys.forEach(function (k) { if ((st[k] === 'over' || st[k] === 'under') && !used[k + '_' + st[k]]) lines.push(HOW[k + '_' + st[k]]); });
    // 1日の途中：残りの案内
    if (partial) {
      var rem = [];
      keys.forEach(function (k) {
        var x = tg && tg[k], lim = x && (x.hi > 0 ? x.hi : x.ref > 0 ? x.ref : 0); if (!lim) return;
        var left = Math.round((lim - (t[k] || 0)) * 10) / 10;
        rem.push(NAME[k] + (left > 0 ? (k === 'fat' ? ' あと' + left + UNIT[k] + 'まで' : ' あと' + left + UNIT[k]) : ' 上限に到達'));
      });
      if (rem.length) lines.push('今日の残り：' + rem.join('／') + '。');
    }
    if (!lines.length) lines.push('今のところ範囲内です。この調子で。');
    return { state: st, head: head, lines: lines };
  }

  /* 1日の結果の判定：'over'（多い）／'under'（少ない）／'ok'（目標内）／null（目標なし）
     上限があれば上限、無ければ目安の+10%を超えたら多い。下限があれば下限、無ければ目安の-10%を下回ったら少ない */
  function judge(v, lo, hi, ref) {
    lo = lo > 0 ? lo : 0; hi = hi > 0 ? hi : 0; ref = ref > 0 ? ref : 0;
    if (!lo && !hi && !ref) return null;
    if (hi ? v > hi : (ref && v > ref * 1.1)) return 'over';
    if (lo ? v < lo : (ref && v < ref * 0.9)) return 'under';
    return 'ok';
  }

  /* 今週（月曜〜昨日）の収支：実績の合計と、目標ペース（目安×経過日数）との差。記録の無い日は目安どおりの扱い。月曜は null */
  function weekBalance(logs, today, goal, key) {
    if (!(goal > 0)) return null;
    var start = weekStart(today), t = toDays(today), el = t - start;
    if (el <= 0) return null;
    var used = 0, miss = 0;
    for (var d = start; d < t; d++) {
      var x = dayTotal(logs, fromDays(d));
      if (x.logged) used += x[key]; else { used += goal; miss++; }
    }
    return { used: r1(used), week: r1(goal * 7), pace: r1(goal * el), diff: r1(used - goal * el), elapsed: el, miss: miss };
  }

  // 食事の区分の並び順
  var TYPES = ['朝食', '昼食', '夕食', '間食', '飲酒', 'その他'];
  function typeOrder(t) { var i = TYPES.indexOf(t); return i < 0 ? 99 : i; }

  // 肉＋マリネ液の全体が目標の塩分%になる液の量。塩分は重量%、液の比重は約1.15で ml に換算
  function marinade(meatG, targetPct, brinePct, density) {
    meatG = Number(meatG); targetPct = Number(targetPct); brinePct = Number(brinePct); density = Number(density) || 1.15;
    if (!(meatG > 0) || !(targetPct > 0) || !(brinePct > targetPct)) return null;
    var liquid = meatG * targetPct / (brinePct - targetPct);
    return { liquidG: Math.round(liquid), liquidMl: Math.round(liquid / density), saltG: r1(liquid * brinePct / 100), totalG: Math.round(meatG + liquid) };
  }
  /* 炭水化物の目標：カロリー＝たんぱく質×4＋脂質×9＋炭水化物×4 なので、独立には決めず、カロリー・たんぱく質・脂質の目標から割り出す。
     目安＝(カロリー目安 − たんぱく質目安×4 − 脂質目安×9) ÷ 4。下限・上限は、カロリーの下限・上限から同じ式で出す（無ければ入れない）。
     カロリー・たんぱく質・脂質のどれかが未設定なら null（炭水化物の目標は出さない） */
  function carbGoals(g) {
    g = g || {};
    var K = +g.kcal || 0, P = +g.protein || 0, F = +g.fat || 0;
    if (!(K > 0 && P > 0 && F > 0)) return null;
    var base = P * 4 + F * 9, ref = Math.round((K - base) / 4);
    if (ref <= 0) return null;
    var lo = +g.kcalMin > 0 ? Math.round((+g.kcalMin - base) / 4) : 0, hi = +g.kcalMax > 0 ? Math.round((+g.kcalMax - base) / 4) : 0;
    if (lo < 0) lo = 0;
    if (lo > ref) lo = 0;
    if (hi && hi < ref) hi = 0;
    return { carbs: ref, carbsMin: lo, carbsMax: hi };
  }
  function withCarbs(g) {
    var c = carbGoals(g), o = {};
    Object.keys(g || {}).forEach(function (k) { o[k] = g[k]; });
    if (c) { o.carbs = c.carbs; o.carbsMin = c.carbsMin; o.carbsMax = c.carbsMax; }
    return o;
  }

  // 白ご飯（炊飯後・精白米）100g あたりの炭水化物 35.6g（日本食品標準成分表2020年版（八訂））。茶碗1杯＝150g
  var RICE_C_PER_G = 0.356, RICE_BOWL_G = 150;
  // 主食ごとの炭水化物（100gあたり）：パスタ＝バリラ スパゲッティ（日本販売品の栄養表示：乾麺100gあたり炭水化物75.0g）、フォカッチャ＝市販・店の標準的な目安（約47g、商品で幅あり）
  var PASTA_C_PER_G = 0.75;
  // ジモカフェのフォカッチャ：強力粉333g＋砂糖16g＋イースト7.5g。成分表（八訂）の差引き法による利用可能炭水化物で計算 ≒ 251g を8等分 → 1個 約31g（質量計だと約30g）
  var FOCACCIA_C_PER_PIECE = 31;
  function foodG(carbsG, perG) { return Math.max(0, Math.round(carbsG / perG / 5) * 5); }
  function pastaG(carbsG) { return foodG(carbsG, PASTA_C_PER_G); }
  function focacciaPieces(carbsG) { return Math.max(0, Math.round(carbsG / FOCACCIA_C_PER_PIECE * 2) / 2); }
  function riceG(carbsG) { return Math.max(0, Math.round(carbsG / RICE_C_PER_G / 5) * 5); }

  return { isMark: isMark, markEntry: markEntry, suspects: suspects, DAY_MARK_NOTE: DAY_MARK_NOTE, carbGoals: carbGoals, withCarbs: withCarbs, riceG: riceG, pastaG: pastaG, focacciaPieces: focacciaPieces, FOCACCIA_C_PER_PIECE: FOCACCIA_C_PER_PIECE, RICE_BOWL_G: RICE_BOWL_G, r1: r1, marinade: marinade, toDays: toDays, fromDays: fromDays, dayTotal: dayTotal, lastDays: lastDays, average: average, energySplit: energySplit, pct: pct, status: status, weekStart: weekStart, weekPlan: weekPlan, advise: advise, judge: judge, weekBalance: weekBalance, TYPES: TYPES, typeOrder: typeOrder };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = MealLib;
