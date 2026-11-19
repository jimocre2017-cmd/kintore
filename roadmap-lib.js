/* マスタープラン（2段階リコンプ＆リーンバルク・ロードマップ）
 * 画面・Apps Script・テストで共通。このファイルを gas/RoadmapLib.gs にそのままコピーして使う（node tools/sync-planlib.js で同期）。
 * ここにある数値は本人が決めた確定ロードマップ（2026-11-18）。AIは再計算・変更しない。直すときはこのファイルの ROADMAP だけを書き換える。
 */
var RoadmapLib = (function () {
  var ROADMAP = {
    id: 'recomp-leanbulk-2stage',
    title: '2段階リコンプ＆リーンバルク・ロードマップ',
    decidedAt: '2026/11/18',
    phases: [
      {
        key: 'recomp', label: '第1期：リコンプ期',
        from: '2026/11/18', to: '2027/04/30', approx: false,
        kcal: { min: 1660, max: 1800 },
        protein: { min: 120, max: 130 },
        fat: { min: 40, max: 50 },
        carbs: null,
        training: [
          '大胸筋（週8〜10セット）と脚（週6〜8セット）を最優先',
          'プレス前の肩インナー（E009／E014）を必須で固定',
          '有酸素は時速5.0〜5.4kmを厳守'
        ],
        cardio: { speedMin: 5.0, speedMax: 5.4, perWeek: null },
        sets: { chest: { min: 8, max: 10 }, legs: { min: 6, max: 8 } },
        targets: { fatPct: 15, leanKg: 50.0, weightKg: null, ffmiAdj: null }
      },
      {
        key: 'leanbulk', label: '第2期：リーンバルク仕上げ',
        from: '2027/05/01', to: '2027/06/30', approx: true, // 「2027年5月〜6月頃」
        kcal: { min: 1950, max: 2100 },
        protein: null, fat: null,
        carbs: { min: 230, max: 260 },
        training: [
          '筋トレの出力と重量をさらに引き上げる',
          '有酸素は週1〜2回へ減らし、回復と筋肥大を最優先'
        ],
        cardio: { speedMin: null, speedMax: null, perWeek: { min: 1, max: 2 } },
        sets: null,
        targets: { fatPct: null, leanKg: 51.0, weightKg: 60.0, ffmiAdj: 20.0 }
      }
    ],
    // 第1期のあとの「もう一つの道」＝現状維持。本人が選んだときだけ使う（日付では入らない）。カロリーは固定せず、減量計画の維持期（体重から計算した維持カロリー）に任せる
    maintainPhase: {
      key: 'maintain', label: '第2期（もう一つの道）：維持期（現状維持）',
      from: null, to: null, approx: true,
      kcal: null,
      protein: { min: 120, max: 130 },
      fat: { min: 40, max: 50 },
      carbs: null,
      training: [
        '第1期で作った筋肉と体脂肪率を保つ（重さ・セット数は落とさず、無理に増やさない）',
        '有酸素は週1〜2回に減らし、回復を優先',
        '体脂肪率は「最低ライン〜許容帯の上限」で見守る（減量計画の維持期の設定）'
      ],
      cardio: { speedMin: null, speedMax: null, perWeek: { min: 1, max: 2 } },
      sets: null,
      targets: { fatPct: null, leanKg: null, weightKg: null, ffmiAdj: null }
    },
    rules: [
      '大筋群（胸・脚）の週間セット数を貯金する。気まぐれな日でも、まず胸（ダンベルプレス・インクライン・プッシュアッププラス）と脚（スクワット・ブルガリアン）から消化する。背中・腕は維持に留める',
      '関節の安全リミッターを外さない。右肩：胸・肩の種目前にフェイスプル（E009）かチューブ外旋（E014）を挟む。右足首・すね：有酸素は時速5.0〜5.4km、母趾球・小趾球・踵の3点接地、スピード競争をしない',
      '毎朝同条件（起床後・排尿後・朝食前）で測定して週平均を追う。クレアチン5gを毎日続け、41℃入浴ケアで超回復を支える'
    ]
  };

  function toDays(s) { var p = String(s).split('/'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function r1(n) { return Math.round(n * 10) / 10; }
  function mid(r, step) { return r ? Math.round((r.min + r.max) / 2 / step) * step : 0; }

  /* 日付 → いまのフェーズ。{phase, index, daysLeft, next}。第1期より前でも第1期、最後の期を過ぎたら null */
  function current(date, rm) {
    rm = rm || ROADMAP;
    var d = toDays(date), ph = rm.phases, i;
    for (i = 0; i < ph.length; i++) {
      var next = ph[i + 1];
      var endDay = next ? toDays(next.from) - 1 : toDays(ph[i].to);
      if (d <= endDay) return { phase: ph[i], index: i, daysLeft: toDays(ph[i].to) - d, next: next || null, started: d >= toDays(ph[i].from) };
    }
    return null;
  }

  /* 食事画面の目標（mealSetGoals）に渡す形。決まっていない項目（第2期のたんぱく質・脂質）は含めず、今の値を残す */
  function mealGoals(phase) {
    var g = {};
    if (phase.kcal) { g.kcal = mid(phase.kcal, 10); g.kcalMin = phase.kcal.min; g.kcalMax = phase.kcal.max; }
    if (phase.protein) { g.protein = mid(phase.protein, 1); g.proteinMin = phase.protein.min; g.proteinMax = phase.protein.max; }
    if (phase.fat) { g.fat = mid(phase.fat, 1); g.fatMin = phase.fat.min; g.fatMax = phase.fat.max; }
    return g;
  }

  /* 体組成とマスタープランから、1日の目標（目安・下限・上限）を自動で出す。画面とApps Scriptで共通。
     o＝{date, decision, planPhase:'cut'|'maintain', fat7, weightKg, bmr, adoptedKcal}
     ・期とモード：未選択／据え置き＝第1期、バルク＝第2期、維持（選択、または減量計画が維持期）＝維持期
     ・マスタープランに数値がある項目はそれを使う（第1期＝カロリー・たんぱく質・脂質、第2期＝カロリー）
     ・マスタープランに無い項目は体組成から出す：たんぱく質＝体重×1.8g（範囲は×1.6〜×2.2）、維持カロリー＝基礎代謝×1.4（範囲は±100kcal）、脂質＝カロリーの25%（範囲は20〜30%）
     ・目安のカロリー：減量計画で今週採用された値を、期の範囲に収めて使う（維持期は体重から出した維持カロリー）
     出せない項目は含めない（呼び出し側が今の値を残す）。炭水化物は含まない */
  function autoMealGoals(o, rm) {
    rm = rm || ROADMAP; o = o || {};
    var r = resolve(o.date || '2026/11/18', { decision: o.decision, fat7: o.fat7 }, rm);
    var maint = o.decision === 'maintain' || o.planPhase === 'maintain';
    var phase = maint && rm.maintainPhase ? rm.maintainPhase : r.phase;
    var w = Number(o.weightKg) > 0 ? Number(o.weightKg) : 0, bmr = Number(o.bmr) > 0 ? Number(o.bmr) : 0, adopted = Number(o.adoptedKcal) > 0 ? Number(o.adoptedKcal) : 0;
    var g = {}, src = {};
    function setRange(key, lo, t, hi, from) { g[key] = Math.round(t); g[key + 'Min'] = Math.round(lo); g[key + 'Max'] = Math.round(hi); src[key] = from; }
    if (phase.kcal) {
      var k = adopted > 0 ? Math.min(phase.kcal.max, Math.max(phase.kcal.min, adopted)) : mid(phase.kcal, 10);
      setRange('kcal', phase.kcal.min, k, phase.kcal.max, 'plan');
    } else if (bmr) {
      var mk = Math.round(bmr * 1.4 / 10) * 10;
      setRange('kcal', mk - 100, mk, mk + 100, 'body');
    }
    if (phase.protein) setRange('protein', phase.protein.min, mid(phase.protein, 1), phase.protein.max, 'plan');
    else if (w) setRange('protein', w * 1.6, w * 1.8, w * 2.2, 'body');
    if (phase.fat) setRange('fat', phase.fat.min, mid(phase.fat, 1), phase.fat.max, 'plan');
    else if (g.kcal) setRange('fat', g.kcal * 0.20 / 9, g.kcal * 0.25 / 9, g.kcal * 0.30 / 9, 'body');
    var label = phase.label, parts = [];
    if (src.kcal) parts.push('カロリー＝' + (src.kcal === 'plan' ? 'マスタープランの範囲' + g.kcalMin + '〜' + g.kcalMax + 'kcal' + (adopted > 0 ? '（目安は減量計画の今週の採用値）' : '') : '基礎代謝×1.4の維持カロリー±100kcal'));
    if (src.protein) parts.push('たんぱく質＝' + (src.protein === 'plan' ? 'マスタープランの範囲' : '体重×1.6〜2.2g（目安は×1.8）'));
    if (src.fat) parts.push('脂質＝' + (src.fat === 'plan' ? 'マスタープランの範囲' : 'カロリーの20〜30%（目安は25%）'));
    return { phaseKey: phase.key, phaseLabel: label, goals: g, source: src, summary: label + ' に合わせて自動計算：' + parts.join('、') + '。' };
  }

  /* 今の測定値との差。state＝{fatPct, leanKg, weightKg}（体組成の最新の日平均）。目標のない項目は出さない */
  function progress(phase, state) {
    var t = phase.targets, s = state || {}, out = [];
    function add(key, label, unit, now, goal, lowerIsBetter) {
      if (goal == null) return;
      if (now == null) { out.push({ key: key, label: label, unit: unit, now: null, goal: goal, gap: null }); return; }
      out.push({ key: key, label: label, unit: unit, now: r1(now), goal: goal, gap: r1(goal - now), reached: lowerIsBetter ? now <= goal : now >= goal });
    }
    add('fatPct', '体脂肪率', '%', s.fatPct, t.fatPct, true);
    add('leanKg', '除脂肪量（LBM）', 'kg', s.leanKg, t.leanKg, false);
    add('weightKg', '体重', 'kg', s.weightKg, t.weightKg, false);
    return out;
  }

  /* 直近の食事の平均が、フェーズの範囲に入っているか。avg＝{kcal, protein, fat}（記録が揃った日の平均） */
  function mealCheck(phase, avg) {
    var out = [];
    [['kcal', 'カロリー', 'kcal'], ['protein', 'たんぱく質', 'g'], ['fat', '脂質', 'g'], ['carbs', '炭水化物', 'g']].forEach(function (k) {
      var r = phase[k[0]], v = avg ? avg[k[0]] : null;
      if (!r || v == null) return;
      out.push({ key: k[0], label: k[1], unit: k[2], avg: r1(v), min: r.min, max: r.max, state: v < r.min ? 'under' : v > r.max ? 'over' : 'in' });
    });
    return out;
  }

  /* 有酸素の確認（直近7日）。第1期＝時速の範囲を守れているか、第2期＝週の回数が範囲内か。logs＝[{date, type, km, mins}] */
  function cardioCheck(phase, logs, today) {
    var c = phase.cardio || {}, from = toDays(today) - 6, to = toDays(today), list = [], days = {};
    (logs || []).forEach(function (l) {
      if (!l.date) return;
      var d = toDays(l.date);
      if (d < from || d > to) return;
      days[l.date] = 1;
      var km = Number(l.km) || 0, mins = Number(l.mins) || 0, sp = km > 0 && mins > 0 ? r1(km / (mins / 60)) : null;
      var st = sp == null || c.speedMin == null ? null : sp > c.speedMax ? 'fast' : sp < c.speedMin ? 'slow' : 'in';
      list.push({ date: l.date, type: l.type || '', km: km, speed: sp, state: st });
    });
    list.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    if (c.speedMin != null) return { mode: 'speed', min: c.speedMin, max: c.speedMax, sessions: list, outside: list.filter(function (x) { return x.state === 'fast' || x.state === 'slow'; }).length };
    if (c.perWeek) {
      var n = Object.keys(days).length;
      return { mode: 'frequency', min: c.perWeek.min, max: c.perWeek.max, days: n, state: n < c.perWeek.min ? 'under' : n > c.perWeek.max ? 'over' : 'in' };
    }
    return null;
  }

  /* ---- 今週のバランス：やり過ぎ・やらな過ぎを、期（第1期＝減量／第2期＝増量）ごとの助言つきで判定する。AIは使わない（ルールのみ） ---- */
  var OVER_SETS = 1.2; // 筋トレのセット数は、上限のこの倍率までは「ちょうど」。超えたら「やり過ぎ」
  var ADVICE = {
    recomp: {
      kcal:    { under: '食事が少なすぎます。赤字を広げすぎると筋量が落ちます。下限まで戻してください。', over: '食事が多めで、減量が進みにくい状態です。間食と脂質から調整してください。' },
      protein: { under: 'たんぱく質が足りません。絞っている時期は最優先で補ってください（筋量を守るため）。', over: 'たんぱく質が多めです。カロリーの枠を圧迫していないか確認してください。' },
      fat:     { under: '脂質が少なすぎます。下限は守ってください（満足感とホルモンのため）。', over: '脂質でカロリーの枠を使いすぎています。たんぱく質を優先し、脂質を減らしてください。' },
      carbs:   { under: '', over: '' },
      chest:   { under: '胸のセット数が足りません。気まぐれな日でも、まず胸から消化してください。', over: '胸のやり過ぎです。右肩の保護と回復を優先し、数日は減らしてください。' },
      legs:    { under: '脚のセット数が足りません。スクワット・ブルガリアンを優先して貯金してください。', over: '脚のやり過ぎです。回復を優先し、数日は減らしてください。' },
      cardio:  { under: '有酸素の記録がありません。時速5.0〜5.4kmで入れてください。', over: '時速が範囲より速い回があります。右足首・すねを守るため、5.0〜5.4kmに落としてください。' }
    },
    maintain: {
      kcal:    { under: '', over: '' },
      protein: { under: 'たんぱく質が足りません。維持期でも筋量を守るため、範囲の下限は守ってください。', over: '' },
      fat:     { under: '脂質が少なすぎます。下限は守ってください。', over: '' },
      carbs:   { under: '', over: '' },
      chest:   { under: '', over: '' },
      legs:    { under: '', over: '' },
      cardio:  { under: '有酸素の記録がありません。週1回は入れて、心肺と回復を保ってください。', over: '有酸素が多めです。維持期は回復を優先し、週1〜2回に収めてください。' }
    },
    leanbulk: {
      kcal:    { under: '食事が少なく、増量が進みません。下限まで増やしてください（炭水化物から）。', over: '食事が多すぎます。脂肪が付きやすくなるので、上限に収めてください。' },
      protein:  { under: '', over: '' },
      fat:      { under: '', over: '' },
      carbs:   { under: '炭水化物が足りません。出力と回復のため、範囲の下限まで増やしてください。', over: '炭水化物が多めです。上限に収めてください。' },
      chest:   { under: '', over: '' },
      legs:    { under: '', over: '' },
      cardio:  { under: '有酸素が少なすぎます。週1回は入れて、心肺と回復を保ってください。', over: '有酸素が多すぎます。回復と筋肥大を優先して、週1〜2回に減らしてください。' }
    }
  };
  var BAL_LABEL = { kcal: ['カロリー', 'kcal'], protein: ['たんぱく質', 'g'], fat: ['脂質', 'g'], carbs: ['炭水化物', 'g'], chest: ['胸のセット数', 'セット'], legs: ['脚のセット数', 'セット'], cardio: ['有酸素', ''] };

  /* d＝{meal:{kcal,protein,fat,carbs}|null（直近7日の平均）, sets:{chest,legs}|null（直近7日のセット数）, cardio:cardioCheck の結果|null}
     戻り値 {items:[{key,label,unit,value,min,max,state:'under'|'in'|'over'|'nodata',advice}], under, in, over, nodata} */
  function balance(phase, d) {
    d = d || {};
    var adv = ADVICE[phase.key] || {}, items = [];
    function push(key, value, min, max, state) {
      var lab = BAL_LABEL[key], a = adv[key] || {};
      items.push({ key: key, label: lab[0], unit: lab[1], value: value == null ? null : r1(value), min: min, max: max, state: state, advice: state === 'under' || state === 'over' ? (a[state] || '') : '' });
    }
    ['kcal', 'protein', 'fat', 'carbs'].forEach(function (k) {
      var r = phase[k]; if (!r) return;
      var v = d.meal ? d.meal[k] : null;
      push(k, v, r.min, r.max, v == null ? 'nodata' : v < r.min ? 'under' : v > r.max ? 'over' : 'in');
    });
    if (phase.sets) ['chest', 'legs'].forEach(function (k) {
      var r = phase.sets[k]; if (!r) return;
      var v = d.sets ? d.sets[k] : null;
      push(k, v, r.min, r.max, v == null ? 'nodata' : v < r.min ? 'under' : v > r.max * OVER_SETS ? 'over' : 'in');
    });
    var c = d.cardio;
    if (c && c.mode === 'speed') {
      var fast = c.sessions.some(function (x) { return x.state === 'fast'; });
      push('cardio', c.sessions.length, null, null, fast ? 'over' : c.sessions.length === 0 ? 'under' : 'in');
    } else if (c && c.mode === 'frequency') {
      push('cardio', c.days, c.min, c.max, c.state);
    }
    var out = { items: items, under: 0, 'in': 0, over: 0, nodata: 0 };
    items.forEach(function (x) { out[x.state]++; });
    return out;
  }

  /* 体脂肪率の直近7日平均（その日の体組成の日平均から）。測定が3日未満なら判断しない（体重計の体脂肪率は日々±1%ぶれるため）
     daily＝[{date, fat}]、today＝'yyyy/MM/dd'。戻り値 {avg, days} または null */
  function fat7(daily, today) {
    var from = toDays(today) - 6, to = toDays(today), v = [];
    (daily || []).forEach(function (l) {
      if (l.fat == null) return;
      var d = toDays(l.date);
      if (d >= from && d <= to) v.push(l.fat);
    });
    if (v.length < 3) return null;
    return { avg: r1(v.reduce(function (a, b) { return a + b; }, 0) / v.length), days: v.length };
  }

  /* いまどの期のプランで動くか。第1期の体脂肪率目標に、直近7日平均で届いたら「選ぶ」状態になる。自動では切り替えない。
     ctx＝{fat7, decision}。decision：''＝未選択（第1期のまま）／'advance'＝第2期へ進む／'maintain'＝維持期（現状維持）にする／'hold'＝いまのプラン（第1期）を据え置く
     戻り値 {phase, index, ready, decision, needChoice, overdue} */
  function resolve(date, ctx, rm) {
    rm = rm || ROADMAP; ctx = ctx || {};
    var first = rm.phases[0], dec = ctx.decision === 'advance' || ctx.decision === 'hold' || ctx.decision === 'maintain' ? ctx.decision : '';
    var goal = first.targets.fatPct, f = ctx.fat7;
    var ready = !!(f && goal != null && f.avg <= goal);
    var idx = dec === 'advance' || dec === 'maintain' ? 1 : 0;
    return {
      phase: dec === 'maintain' && rm.maintainPhase ? rm.maintainPhase : rm.phases[idx], index: idx, ready: ready, decision: dec,
      needChoice: idx === 0 && ready && dec === '',
      overdue: idx === 0 && !ready && toDays(date) > toDays(first.to)
    };
  }

  /* ---- 数値に応じた助言（アプリを開いたとき・体組成を記録したときのポップアップ用。AIは使わない） ----
     ctx＝{fat7:{avg,days}|null, decision, planPhase:'cut'|'maintain', floorFat, date}
     戻り値 [{key, level:'warn'|'info', title, body, action:'plan'}]。しきい値：維持期の許容帯＝最低＋1.5%（減量計画の MAINT_BAND と同じ）、バルク時の上限＝第1期の目標＋3%（アプリの既定値） */
  var MAINT_BAND_PCT = 1.5, BULK_OVER_PCT = 3;
  function advice(ctx, rm) {
    rm = rm || ROADMAP; ctx = ctx || {};
    var out = [], first = rm.phases[0], goal = first.targets.fatPct, f = ctx.fat7, r = resolve(ctx.date || '2026/11/18', ctx, rm);
    var maintMode = ctx.decision === 'maintain' || ctx.planPhase === 'maintain';
    var avg = f ? f.avg : null;
    if (r.needChoice && !maintMode) {
      out.push({ key: 'choose', level: 'info', title: '第1期の目標に届きました', body: '体脂肪率が直近7日平均で ' + avg + '%（目標 ' + goal + '%）になりました。次の道を選んでください：第2期のバルク（増量）／維持（現状維持）／据え置き。減量計画の「いまの道」で切り替えられます。' });
    }
    if (maintMode && avg != null) {
      var floor = Number(ctx.floorFat) > 0 ? Number(ctx.floorFat) : goal, upper = r1(floor + MAINT_BAND_PCT);
      if (avg > upper) out.push({ key: 'maint-over', level: 'warn', title: '許容帯の上を超えました', body: '体脂肪率が直近7日平均で ' + avg + '%。維持期の許容帯（' + floor + '〜' + upper + '%）の上限を超えています。第1期（減量）に戻す目安です。減らしたいときは減量計画の「いまの道」で第1期を選んでください。' });
      else if (avg < floor) out.push({ key: 'maint-below', level: 'warn', title: '最低ラインを下回りました', body: '体脂肪率が直近7日平均で ' + avg + '%。最低ライン ' + floor + '% を下回っています。維持カロリーより少し多めに食べて、筋量を守ってください。' });
    }
    if (ctx.decision === 'advance' && avg != null && goal != null && avg > goal + BULK_OVER_PCT) {
      out.push({ key: 'bulk-over', level: 'warn', title: '脂肪が乗りすぎています', body: '体脂肪率が直近7日平均で ' + avg + '%。第1期の目標（' + goal + '%）より ' + r1(avg - goal) + '% 高くなりました。バルクの食事を少し控えるか、維持（現状維持）に切り替える、または第1期に戻す目安です。' });
    }
    if (r.overdue) out.push({ key: 'overdue', level: 'info', title: '第1期の期限を過ぎました', body: '期限（' + first.to + '）を過ぎましたが、体脂肪率 ' + goal + '% にはまだ届いていません。期限の見直しは総合コーチに相談できます。' });
    return out;
  }

  /* 次週のカロリー調整（PlanLib.adjust）に渡す設定。モードはマスタープランの選択で決まる：
     ''/'hold'＝第1期（減量）、'advance'＝第2期バルク、'maintain'（または減量計画が維持期）＝維持。
     kcalMin/kcalMax＝そのモードの目標カロリーの範囲（維持は範囲なし＝0）。floorFat＝維持期の最低ラインの既定（第1期の体脂肪率目標） */
  function adjustCfg(decision, planPhase, rm) {
    rm = rm || ROADMAP;
    var mode = decision === 'maintain' || planPhase === 'maintain' ? 'maintain' : decision === 'advance' ? 'bulk' : 'cut';
    var k = mode === 'maintain' ? null : (mode === 'bulk' ? rm.phases[1] : rm.phases[0]).kcal;
    return { mode: mode, kcalMin: k ? k.min : 0, kcalMax: k ? k.max : 0, floorFat: rm.phases[0].targets.fatPct || 0 };
  }

  /* AI（総合コーチ・AIトレーナー）に渡す要約。AIはこの数値を引用するだけで、再計算しない */
  function brief(date, state, avg, ctx, rm) {
    rm = rm || ROADMAP;
    var r = resolve(date, ctx, rm), p = r.phase, next = rm.phases[r.index + 1] || null;
    return {
      title: rm.title, decidedAt: rm.decidedAt, today: date,
      nowPhase: p.label, nowPhaseKey: p.key, phaseEnd: p.to, phaseEndApprox: !!p.approx, daysLeftInPhase: toDays(p.to) - toDays(date),
      switchRule: '第1期の体脂肪率目標に直近7日平均で届いたら、本人が「第2期（リーンバルク）へ進む」「維持期（現状維持）にする」「いまのプランを据え置く」のどれかを選ぶ（日付では自動で切り替わらない）',
      fat7: ctx && ctx.fat7 ? ctx.fat7 : null,
      reachedFirstPhaseGoal: r.ready, userChoice: r.decision || '未選択', waitingForUserChoice: r.needChoice, pastPhaseEndWithoutReaching: r.overdue,
      nextPhase: next ? { label: next.label, kcal: next.kcal, carbs: next.carbs, targets: next.targets } : null,
      daily: { kcal: p.kcal, protein: p.protein, fat: p.fat, carbs: p.carbs },
      training: p.training, setsPerWeek: p.sets, cardio: p.cardio, cardioLast7Days: ctx && ctx.cardioLogs ? cardioCheck(p, ctx.cardioLogs, date) : null,
      targets: p.targets, progress: progress(p, state), mealCheck: mealCheck(p, avg),
      weeklyBalance: balance(p, { meal: avg, sets: ctx && ctx.sets7 ? ctx.sets7 : null, cardio: ctx && ctx.cardioLogs ? cardioCheck(p, ctx.cardioLogs, date) : null }),
      setsLast7Days: ctx && ctx.sets7 ? ctx.sets7 : null,
      rules: rm.rules
    };
  }

  return { ROADMAP: ROADMAP, OVER_SETS: OVER_SETS, ADVICE: ADVICE, balance: balance, current: current, cardioCheck: cardioCheck, fat7: fat7, resolve: resolve, advice: advice, adjustCfg: adjustCfg, MAINT_BAND_PCT: MAINT_BAND_PCT, BULK_OVER_PCT: BULK_OVER_PCT, mealGoals: mealGoals, autoMealGoals: autoMealGoals, progress: progress, mealCheck: mealCheck, brief: brief };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RoadmapLib;
