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
        // 1日の範囲は計算式で出す（2026-11-21 本人が選択。固定の範囲は幅が狭く、日々の調整が難しかったため）。RoadmapLib.effective で計算
        //  カロリー＝消費の見込み×0.75〜0.90（1日の不足10〜25%。消費2,218kcalなら1,660〜2,000kcal）。下限は基礎代謝（最低1,200kcal）を割らない
        //  たんぱく質＝除脂肪量×2.3〜3.1g（目安×2.6）。脂質＝カロリーの20〜30%（下限40g）。根拠は docs/references.md（Helms 2014 ほか）
        // 下の kcal・protein・fat は、消費の見込みや体組成がまだ無いときだけ使う控え（以前の固定値）
        kcalFromEnergy: { min: 0.75, max: 0.90 },
        proteinPerLean: { min: 2.3, target: 2.6, max: 3.1 },
        fatFromKcal: true,
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
        // カロリーは消費の見込み（実測）に連動：消費×1.05〜1.10（+5〜10%の余剰）。2026-11-19に本人が承認（固定の1950〜2100kcalは実測の消費2,218kcalを下回り、増量にならないため）。
        // kcal は消費が分からないときだけ使う控え。炭水化物は 230g 以上・上限はカロリーの55%（effective で計算）
        kcalFromEnergy: { min: 1.05, max: 1.10 },
        kcal: { min: 1950, max: 2100 },
        protein: null, fat: null,
        carbs: { min: 230, max: 260 }, carbsMaxPct: 0.55,
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
      key: 'maintain', label: '第3期：維持・回復期',
      from: null, to: null, approx: true,
      kcal: null,
      protein: { min: 120, max: 130 },
      fat: { min: 40, max: 50 },
      carbs: null,
      training: [
        '最初の数週は「回復」：減量中の食事から維持カロリーまで、毎週+100kcalずつ戻す（一気に戻さない）',
        '第1期・第2期で作った筋肉と体脂肪率を保つ（重さ・セット数は落とさず、無理に増やさない）',
        '有酸素は週1〜2回に減らし、回復を優先',
        '体脂肪率は「最低ライン〜許容帯の上限」で見守る（減量計画の維持期の設定）'
      ],
      cardio: { speedMin: null, speedMax: null, perWeek: { min: 1, max: 2 } },
      sets: null,
      targets: { fatPct: null, leanKg: null, weightKg: null, ffmiAdj: null }
    },
    // 絞り込み期（2026-11-22 追加）：第1期（減量）のあとの「もう一つの道」。体脂肪率を12%→8%まで落としつつ、筋肉をわずかに増やす。本人が選んだときだけ使う（日付では入らない）。
    //  減量期（第1期）との違い：赤字を小さく（消費の90〜97%＝不足3〜10%。第1期は不足10〜25%）／たんぱく質を高く（除脂肪量×2.5〜3.3g）／炭水化物の下限を設けて筋トレの出力を守る／
    //  筋トレは落とさず胸・脚のセットを増やし、重さ・レップを少しずつ伸ばす／有酸素は週2〜3回に絞る／ペースが遅いので期限は置かない（体脂肪率の到達で判断）
    //  カロリー・たんぱく質・脂質・炭水化物は RoadmapLib.effective で計算。下の kcal は消費が分からないときは持たない（維持期と同じ扱い）。根拠と注意点は docs/references.md
    shredPhase: {
      key: 'shred', label: '第2期（選ぶ道）：絞り込み期（体脂肪率12%・微増筋）',
      from: null, to: null, approx: true,
      kcalFromEnergy: { min: 0.90, max: 0.97 },
      proteinPerLean: { min: 2.5, target: 2.8, max: 3.3 },
      fatFromKcal: true,
      kcal: null,
      protein: { min: 130, max: 150 },
      fat: { min: 40, max: 60 },
      carbs: { min: 160, max: 260 }, carbsMaxPct: 0.5,
      training: [
        '筋トレは落とさず、重さとレップを少しずつ伸ばす（レップの上限に届いたら次の重さへ）。狙いは月+0.1〜0.2kg程度の「微増筋」',
        '大胸筋（週10〜12セット）と脚（週8〜10セット）を最優先。プレス前の肩インナー（E009／E014）は必須で固定',
        '有酸素は週2〜3回、時速5.0〜5.4km（右足首・すねを守る）。赤字は小さく保ち、筋トレ後の回復を削らない',
        '体脂肪率の直近7日平均が12%に届いたら、第3期（維持・回復）か「絞り込み（8%）」を選ぶ。急がず、期限は置かない'
      ],
      cardio: { speedMin: null, speedMax: null, perWeek: { min: 2, max: 3 } },
      sets: { chest: { min: 10, max: 12 }, legs: { min: 8, max: 10 } },
      targets: { fatPct: 12, leanKg: null, weightKg: null, ffmiAdj: null }
    },
    // 絞り込み期の8%ステージ。男性でも8%は体への負担が大きい水準なので、赤字をさらに小さく（消費の92〜98%）、たんぱく質を最も高くし、休息日・ダイエットブレイク・睡眠を条件にする。到達したら必ず維持へ
    shred8Phase: {
      key: 'shred8', label: '第2期（選ぶ道）：絞り込み期・仕上げ（体脂肪率8%・微増筋）',
      from: null, to: null, approx: true,
      kcalFromEnergy: { min: 0.92, max: 0.98 },
      proteinPerLean: { min: 2.6, target: 3.0, max: 3.3 },
      fatFromKcal: true,
      kcal: null,
      protein: { min: 135, max: 155 },
      fat: { min: 40, max: 60 },
      carbs: { min: 160, max: 260 }, carbsMaxPct: 0.5,
      training: [
        '筋トレは落とさず、重さとレップを少しずつ伸ばす。ここでの微増筋は「減らさずに少し乗る」くらいで十分（月+0.1kg前後）',
        '大胸筋（週10〜12セット）と脚（週8〜10セット）を最優先。肩インナー（E009／E014）は必須',
        '有酸素は週2〜3回、時速5.0〜5.4km。睡眠は7時間以上を条件にし、足りない週は赤字を作らない',
        '週1回は維持カロリー（消費と同じ量）の日を入れ、4〜6週ごとに1週間は維持期に戻す（ダイエットブレイク）',
        '8%に届いたら、それ以上は減らさず必ず維持へ。8%は長く保つ水準ではなく、短期間の仕上げとして使う'
      ],
      cardio: { speedMin: null, speedMax: null, perWeek: { min: 2, max: 3 } },
      sets: { chest: { min: 10, max: 12 }, legs: { min: 8, max: 10 } },
      targets: { fatPct: 8, leanKg: null, weightKg: null, ffmiAdj: null }
    },
    rules: [
      '大筋群（胸・脚）の週間セット数を貯金する。気まぐれな日でも、まず胸（ダンベルプレス・インクライン・プッシュアッププラス）と脚（スクワット・ブルガリアン）から消化する。背中・腕は維持に留める',
      '関節の安全リミッターを外さない。右肩：胸・肩の種目前にフェイスプル（E009）かチューブ外旋（E014）を挟む。右足首・すね：有酸素は時速5.0〜5.4km、母趾球・小趾球・踵の3点接地、スピード競争をしない',
      '毎朝同条件（起床後・排尿後・朝食前）で測定して週平均を追う。クレアチン5gを毎日続け、41℃入浴ケアで超回復を支える'
    ]
  };

  function toDays(s) { var p = String(s).split('/'); return Math.round(Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000); }
  function fromDays(n) { var d = new Date(n * 86400000); return d.getUTCFullYear() + '/' + ('0' + (d.getUTCMonth() + 1)).slice(-2) + '/' + ('0' + d.getUTCDate()).slice(-2); }
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
    if (phase.protein) { g.protein = phase.protein.target || mid(phase.protein, 1); g.proteinMin = phase.protein.min; g.proteinMax = phase.protein.max; }
    if (phase.fat) { g.fat = mid(phase.fat, 1); g.fatMin = phase.fat.min; g.fatMax = phase.fat.max; }
    return g;
  }

  /* ---- 共通の計算（全画面・Apps Script がここだけを使う。数値の出どころを1か所にする） ----
     ACTIVITY：消費カロリーの見積もり（基礎代謝×係数）の既定値。2026-11の記録（摂取 約1,676kcal・体脂肪量の減り 週約0.38kg・基礎代謝 約1,530）から逆算すると約1.35。
     実測（摂取−脂肪量の変化×7200）が出せるようになったら、そちらを優先する（PlanLib.adjust の observed）。 */
  var ACTIVITY = 1.35;

  /* 消費カロリー（1日）。o＝{tdeeKcal, tdeeBasis, bmr, activity}。実測・計画画面の値（tdeeKcal）があればそれ、なければ 基礎代謝×係数 */
  function energy(o) {
    o = o || {};
    var bmr = Number(o.bmr) > 0 ? Number(o.bmr) : 0, act = Number(o.activity) > 0 ? Number(o.activity) : ACTIVITY;
    // bmr は範囲の下限（基礎代謝を割らない）に使うため、分かれば一緒に返す
    if (Number(o.tdeeKcal) > 0) { var t = { kcal: Math.round(Number(o.tdeeKcal)), basis: o.tdeeBasis || 'plan' }; if (bmr) t.bmr = Math.round(bmr); return t; }
    return bmr ? { kcal: Math.round(bmr * act / 10) * 10, basis: 'estimated', activity: act, bmr: Math.round(bmr) } : null;
  }

  /* その期の実際の範囲（計算式の期）。元の phase は書き換えない（コピーを返す）。
     ・kcalFromEnergy：カロリー＝消費の見込み en×係数（第1期＝0.75〜0.90、第2期バルク＝1.05〜1.10）。炭水化物がある期は 下限〜カロリー上限の55%
       安全策：下限は基礎代謝（en.bmr。最低 KCAL_FLOOR）を割らない／そのとき幅は最低 MIN_KCAL_WIDTH を残す
     ・proteinPerLean：たんぱく質＝除脂肪量×係数。除脂肪量は body（{leanKg} か {weightKg, fatPct}。体脂肪率は直近7日平均を渡すと日々のぶれに強い）
     ・fatFromKcal：脂質＝カロリー（範囲の中央）の20〜30%、下限 FAT_FLOOR_G
     消費の見込みや体組成が分からない項目は、ROADMAP に書いた控えの値のまま */
  var KCAL_FLOOR = 1200, MIN_KCAL_WIDTH = 150, FAT_FLOOR_G = 40;
  function leanOf(body) {
    body = body || {};
    if (Number(body.leanKg) > 0) return Number(body.leanKg);
    var w = Number(body.weightKg), bf = Number(body.fatPct);
    return w > 0 && bf > 0 && bf < 100 ? w * (1 - bf / 100) : 0;
  }
  function effective(phase, en, body) {
    if (!phase) return phase;
    var dynK = !!(phase.kcalFromEnergy && en && en.kcal > 0), lean = phase.proteinPerLean ? leanOf(body) : 0;
    if (!dynK && !lean) return phase;
    var q = {}, k;
    for (k in phase) q[k] = phase[k];
    if (dynK) {
      var floor = Math.max(KCAL_FLOOR, Number(en.bmr) > 0 ? Math.round(Number(en.bmr) / 10) * 10 : 0);
      var raw = Math.round(en.kcal * phase.kcalFromEnergy.min / 10) * 10, lo = Math.max(floor, raw);
      var hi = Math.round(en.kcal * phase.kcalFromEnergy.max / 10) * 10;
      if (raw < floor) hi = Math.max(hi, lo + MIN_KCAL_WIDTH); // 基礎代謝で下限を上げたときも、調整できる幅を残す
      q.kcal = { min: lo, max: hi };
      if (phase.carbs) q.carbs = { min: phase.carbs.min, max: Math.max(phase.carbs.min, Math.round(hi * (phase.carbsMaxPct || 0.55) / 4)) };
      q.dynamic = { energyKcal: en.kcal, basis: en.basis || '', ratio: phase.kcalFromEnergy, floorKcal: floor, floored: raw < floor };
      if (phase.fatFromKcal) { var km = mid(q.kcal, 10); q.fat = { min: Math.max(FAT_FLOOR_G, Math.round(km * 0.20 / 9)), max: Math.max(FAT_FLOOR_G + 5, Math.round(km * 0.30 / 9)) }; }
    }
    if (lean) {
      var pp = phase.proteinPerLean;
      q.protein = { min: Math.round(lean * pp.min), target: Math.round(lean * pp.target), max: Math.round(lean * pp.max) };
      q.dynamicProtein = { leanKg: r1(lean), perKg: pp };
    }
    return q;
  }
  /* 計算式の言い方（画面・要約で共通）。例：「消費の75〜90%（不足10〜25%）」「消費の+5〜10%」 */
  function kcalRuleText(phase) {
    var r = phase && (phase.kcalFromEnergy || (phase.dynamic && phase.dynamic.ratio));
    if (!r) return '';
    var a = Math.round(r.min * 100), b = Math.round(r.max * 100);
    return r.min >= 1 ? '消費の+' + (a - 100) + '〜' + (b - 100) + '%' : '消費の' + a + '〜' + b + '%（不足' + (100 - b) + '〜' + (100 - a) + '%）';
  }
  function basisText(en) { return en && en.basis === 'observed' ? '記録からの実測' : en && en.basis === 'estimated' ? '基礎代謝×' + (en.activity || ACTIVITY) + 'の推定' : '減量計画の値'; }

  /* たんぱく質の範囲（g）。期に数値があればそれ（第1期・維持期＝120〜130g）。無ければ体組成から：
     体脂肪率20%未満＝体重×1.6〜2.2（目安×1.8）、20%以上＝除脂肪量×2.0〜2.5（目安×2.2）。根拠：Morton 2018／ISSN 2017（docs/references.md） */
  function proteinFor(phase, weightKg, fatPct) {
    if (phase && phase.proteinPerLean && !phase.dynamicProtein) phase = effective(phase, null, { weightKg: weightKg, fatPct: fatPct });
    if (phase && phase.protein) return { min: phase.protein.min, target: phase.protein.target || mid(phase.protein, 1), max: phase.protein.max, source: phase.dynamicProtein ? 'planLean' : 'plan', leanKg: phase.dynamicProtein ? phase.dynamicProtein.leanKg : undefined };
    var w = Number(weightKg) > 0 ? Number(weightKg) : 0, bf = Number(fatPct) > 0 ? Number(fatPct) : 0;
    if (!w) return null;
    if (bf >= 20) { var lean = w * (1 - bf / 100); return { min: Math.round(lean * 2.0), target: Math.round(lean * 2.2), max: Math.round(lean * 2.5), source: 'lean' }; }
    return { min: Math.round(w * 1.6), target: Math.round(w * 1.8), max: Math.round(w * 2.2), source: 'body' };
  }

  function phaseFor(o, rm) {
    var r = resolve(o.date || '2026/11/18', { decision: o.decision, fat7: o.fat7 }, rm);
    var shred = o.decision === 'shred' || o.decision === 'shred8';
    var maint = o.decision === 'maintain' || (o.planPhase === 'maintain' && !shred);
    return { phase: maint && rm.maintainPhase ? rm.maintainPhase : r.phase, maintain: maint, resolved: r };
  }

  /* 体組成とマスタープランから、1日の目標（目安・下限・上限）を自動で出す。画面とApps Scriptで共通。
     o＝{date, decision, planPhase:'cut'|'maintain', fat7, fatPct, weightKg, bmr, activity, tdeeKcal, tdeeBasis, adoptedKcal, adoptedMode}
     ・期とモード：未選択／据え置き＝第1期、バルク＝第2期、維持（選択、または減量計画が維持期）＝維持期
     ・カロリー：期に範囲があればその範囲。目安は減量計画で採用された今週の値を範囲に収めたもの（無ければ中央）。
       維持期は範囲が無いので、消費カロリー（energy）を中心に±150kcal。減量計画が維持期として採用した値があれば、それを中心にする
     ・たんぱく質：proteinFor
     ・脂質：期に範囲があればそれ。無ければ 下限＝max(40g, カロリーの20%)、上限＝30%。炭水化物が決まっている期は残りカロリーから逆算した値を目安にする
     出せない項目は含めない（呼び出し側が今の値を残す） */
  function autoMealGoals(o, rm) {
    rm = rm || ROADMAP; o = o || {};
    var w = Number(o.weightKg) > 0 ? Number(o.weightKg) : 0, adopted = Number(o.adoptedKcal) > 0 ? Number(o.adoptedKcal) : 0;
    var bf = o.fat7 && Number(o.fat7.avg) > 0 ? Number(o.fat7.avg) : (Number(o.fatPct) > 0 ? Number(o.fatPct) : 0);
    var en = energy(o), pf = phaseFor(o, rm), phase = effective(pf.phase, en, { weightKg: w, fatPct: bf });
    var g = {}, src = {};
    function setRange(key, lo, t, hi, from) { g[key] = Math.round(t); g[key + 'Min'] = Math.round(lo); g[key + 'Max'] = Math.round(hi); src[key] = from; }
    if (phase.kcal) {
      var k = adopted > 0 ? Math.min(phase.kcal.max, Math.max(phase.kcal.min, adopted)) : mid(phase.kcal, 10);
      setRange('kcal', phase.kcal.min, k, phase.kcal.max, 'plan');
    } else {
      var c = adopted > 0 && o.adoptedMode === 'maintain' ? adopted : (en ? en.kcal : 0);
      if (c) { c = Math.round(c / 10) * 10; setRange('kcal', c - 150, c, c + 150, adopted > 0 && o.adoptedMode === 'maintain' ? 'adopted' : 'energy'); }
    }
    var pr = proteinFor(phase, w, bf);
    if (pr) setRange('protein', pr.min, pr.target, pr.max, pr.source);
    // 脂質：期の範囲（計算式の期は effective が出した「カロリー範囲の中央の20〜30%」）をそのまま使う。計画画面と同じ値になる
    if (phase.fat) setRange('fat', phase.fat.min, Math.min(phase.fat.max, Math.max(phase.fat.min, phase.fatFromKcal && g.kcal ? Math.round(g.kcal * 0.25 / 9) : mid(phase.fat, 1))), phase.fat.max, 'plan');
    else if (g.kcal) {
      var floor = Math.max(40, Math.round(g.kcal * 0.20 / 9)), ceil = Math.round(g.kcal * 0.30 / 9), t, back = false;
      if (phase.carbs && g.protein) { t = Math.round((g.kcal - g.protein * 4 - mid(phase.carbs, 1) * 4) / 9); back = true; }
      else t = Math.round(g.kcal * 0.25 / 9);
      setRange('fat', floor, Math.min(Math.max(t, floor), ceil), ceil, back ? 'back' : 'body');
    }
    var parts = [];
    if (src.kcal) parts.push('カロリー＝' + (src.kcal === 'plan' ? (phase.dynamic ? '消費の見込み' + phase.dynamic.energyKcal + 'kcal（' + basisText(en) + '）の' + kcalRuleText(phase).replace('消費の', '') + '＝' + g.kcalMin + '〜' + g.kcalMax + 'kcal' + (phase.dynamic.floored ? '（下限は基礎代謝' + phase.dynamic.floorKcal + 'kcalで止めています）' : '') : (phase.kcalFromEnergy ? '消費の見込みがまだ無いため控えの範囲' : 'マスタープランの範囲') + g.kcalMin + '〜' + g.kcalMax + 'kcal') + (adopted > 0 ? '（目安は減量計画の今週の採用値）' : '')
      : src.kcal === 'adopted' ? '減量計画が維持期として採用した' + g.kcal + 'kcal±150'
      : '消費カロリーの見込み' + g.kcal + 'kcal（' + (en && en.basis === 'estimated' ? '基礎代謝×' + en.activity : '記録からの実測') + '）±150'));
    if (src.protein) parts.push('たんぱく質＝' + (src.protein === 'planLean' ? '除脂肪量' + phase.dynamicProtein.leanKg + 'kg×' + phase.proteinPerLean.min + '〜' + phase.proteinPerLean.max + 'g（目安×' + phase.proteinPerLean.target + '）' : src.protein === 'plan' ? (phase.proteinPerLean ? '体組成がまだ無いため控えの範囲' : 'マスタープランの範囲') : src.protein === 'lean' ? '体脂肪率が高めなので除脂肪量×2.0〜2.5g（目安×2.2）' : '体重×1.6〜2.2g（目安×1.8）'));
    if (src.fat) parts.push('脂質＝' + (src.fat === 'plan' ? 'マスタープランの範囲' : src.fat === 'back' ? 'カロリーから、たんぱく質とマスタープランの炭水化物を引いた残り（下限＝20%か40g、上限＝30%）' : 'カロリーの20〜30%（目安25%）'));
    return { phaseKey: phase.key, phaseLabel: phase.label, goals: g, source: src, energy: en, summary: phase.label + ' に合わせて自動計算：' + parts.join('、') + '。' };
  }

  /* ---- 計画の点検：記録（消費カロリー・体組成）とマスタープランの数値が噛み合っているかを確かめる（AIは使わない）。
     o＝{date, decision, planPhase, energy:{kcal,basis}, state:{weightKg, fatPct, leanKg}}
     戻り値 [{key, level:'ok'|'info'|'warn', title, body}]。数値の変更はしない（決めるのは本人）。 */
  var BULK_MIN_SURPLUS = 150, CUT_MIN_DEFICIT = 150;
  function planCheck(o, rm) {
    rm = rm || ROADMAP; o = o || {};
    var out = [], E = o.energy && o.energy.kcal > 0 ? o.energy.kcal : 0, s = o.state || {}, first = rm.phases[0], second = rm.phases[1];
    var pf = phaseFor(o, rm), inFirst = pf.phase.key === first.key, ebasis = o.energy && o.energy.basis === 'estimated' ? '（基礎代謝からの見積もり）' : '（記録からの実測）';
    if (!E) { out.push({ key: 'energy', level: 'info', title: '消費カロリーがまだ分かりません', body: '体組成（基礎代謝）を記録すると、計画の点検ができます。' }); return out; }
    var fe = effective(first, o.energy, s);
    if (inFirst && fe.kcal) {
      var cm = mid(fe.kcal, 10), def = E - cm, loss = def * 7 / 7200;
      if (fe.dynamic) out.push({ key: 'cut-range', level: 'ok', title: '第1期のカロリーは' + kcalRuleText(fe) + 'に自動で合わせます',
        body: 'いまの消費の見込み ' + E + 'kcal' + ebasis + 'なら、1日の範囲は ' + fe.kcal.min + '〜' + fe.kcal.max + 'kcal' + (fe.dynamicProtein ? '、たんぱく質は除脂肪量 ' + fe.dynamicProtein.leanKg + 'kg から ' + fe.protein.min + '〜' + fe.protein.max + 'g' : '') + '。体重や消費が変わると、範囲も一緒に動きます。' + (fe.dynamic.floored ? '下限は基礎代謝（' + fe.dynamic.floorKcal + 'kcal）を割らないように止めています。' : '') });
      if (def < CUT_MIN_DEFICIT) out.push({ key: 'cut-deficit', level: 'warn', title: '第1期のカロリーでは、ほとんど減りません', body: '消費の見込み ' + E + 'kcal' + ebasis + 'に対して、第1期の範囲の中央 ' + cm + 'kcal では1日 ' + def + 'kcal の赤字しかありません。' + (fe.dynamic && fe.dynamic.floored ? '基礎代謝に近く、食事だけで赤字を作る余地が小さい状態です。有酸素で消費を増やすか、期限の見直しを検討してください。' : '') });
      if (s.weightKg > 0 && s.fatPct > 0 && first.targets.fatPct) {
        var lean = s.weightKg * (1 - s.fatPct / 100), goalW = lean / (1 - first.targets.fatPct / 100), toLose = s.weightKg - goalW;
        var weeks = (toDays(first.to) - toDays(o.date || '2026/11/18')) / 7, need = weeks > 0 ? toLose / weeks : null;
        if (toLose > 0 && loss > 0) {
          var etaDays = Math.round(toLose / loss * 7), eta = fromDays(toDays(o.date || '2026/11/18') + etaDays);
          var late = toDays(eta) > toDays(first.to);
          out.push({ key: 'pace', level: late ? 'warn' : 'ok', title: late ? '今のカロリーでは期限に間に合わない見込み' : '期限に間に合うペースです',
            body: '体脂肪率 ' + first.targets.fatPct + '% まで、筋肉を保つ前提で体重 約' + r1(goalW) + 'kg（あと ' + r1(toLose) + 'kg）。第1期の範囲の中央 ' + cm + 'kcal なら週 約' + Math.round(loss * 100) / 100 + 'kg 減で、到達見込みは ' + eta + '（期限 ' + first.to + '）。' + (need != null ? '期限までに必要なのは週 約' + Math.round(need * 100) / 100 + 'kg。' : '') + (late ? '範囲の下限寄りで食べるか、期限を見直してください。' : '') });
        }
        if (first.targets.leanKg && lean < first.targets.leanKg - 0.5) {
          out.push({ key: 'lean', level: 'info', title: '除脂肪量の目標は「保つ」を合格ラインに', body: '除脂肪量の目標 ' + first.targets.leanKg + 'kg まで あと ' + r1(first.targets.leanKg - lean) + 'kg（いま ' + r1(lean) + 'kg、体組成計の推定）。減量中に筋肉を増やすのは難しいので、第1期は「減らさない」を合格ラインにし、増やすのは第2期で狙うのが現実的です。' });
        }
      }
    }
    var sk = pf.phase.key;
    if (sk === 'shred' || sk === 'shred8') {
      var sh = pf.phase, se = effective(sh, o.energy, s), sgoal = sh.targets.fatPct, scm = mid(se.kcal, 10), sdef = E - scm, sloss = sdef * 7 / 7200;
      if (se.dynamic) out.push({ key: 'shred-range', level: 'ok', title: '絞り込み期のカロリーは' + kcalRuleText(se) + 'に自動で合わせます',
        body: 'いまの消費の見込み ' + E + 'kcal' + ebasis + 'なら、1日の範囲は ' + se.kcal.min + '〜' + se.kcal.max + 'kcal（炭水化物 ' + se.carbs.min + '〜' + se.carbs.max + 'g' + (se.dynamicProtein ? '、たんぱく質 ' + se.protein.min + '〜' + se.protein.max + 'g' : '') + '）。第1期（減量）より赤字が小さく、筋トレの出力と回復を守りながらゆっくり落とします。' + (se.dynamic.floored ? '下限は基礎代謝（' + se.dynamic.floorKcal + 'kcal）を割らないように止めています。' : '') });
      if (sdef < 50) out.push({ key: 'shred-deficit', level: 'warn', title: '絞り込み期のカロリーでは、ほとんど減りません', body: '消費の見込み ' + E + 'kcal' + ebasis + 'に対して、範囲の中央 ' + scm + 'kcal では1日 ' + sdef + 'kcal の赤字しかありません。基礎代謝に近く食事で赤字を作る余地が小さい状態です。有酸素を週2〜3回きちんと入れるか、記録（消費の見込み）を見直してください。' });
      if (s.weightKg > 0 && s.fatPct > 0 && sgoal) {
        var slean = s.weightKg * (1 - s.fatPct / 100), sgw = slean / (1 - sgoal / 100), stl = s.weightKg - sgw;
        if (stl > 0 && sloss > 0) {
          var seta = fromDays(toDays(o.date || '2026/11/18') + Math.round(stl / sloss * 7));
          out.push({ key: 'shred-pace', level: 'info', title: '体脂肪率 ' + sgoal + '% までの見込み',
            body: '筋肉を保つ前提で、体重 約' + r1(sgw) + 'kg（あと ' + r1(stl) + 'kg）。範囲の中央 ' + scm + 'kcal なら週 約' + Math.round(sloss * 100) / 100 + 'kg 減で、到達は ' + seta + ' ごろの見込み。ペースが遅いのは設計どおりです（赤字が大きいと筋肉が落ち、微増筋になりません）。期限は置きません。' });
        }
      }
      out.push({ key: 'shred-lean', level: 'info', title: '「微増筋」の現実的な目安', body: '赤字の中で筋肉が増えるのは、筋トレ歴が浅い・ブランク明け・体脂肪が多めの人ほど出やすく、鍛え込んだ人は「減らさない」が上限になりがちです。目安は月+0.1〜0.2kg。体組成計の除脂肪量は日々ぶれるので、7日平均が1か月続けて下がるときは、食事を範囲の上寄りに戻してください。' });
      if (sk === 'shred8') out.push({ key: 'shred-8warn', level: 'warn', title: '体脂肪率8%は、期間を区切って使う水準です', body: '男性でも8%付近まで落とすと、睡眠の質・疲労・免疫・ホルモン・気分に影響が出やすくなります。睡眠7時間以上、週1回の維持カロリー日、4〜6週ごとの1週間の維持期（ダイエットブレイク）を入れ、8%に届いたら減らさず維持へ。体調が崩れたらすぐ維持期に戻してください（持病・服薬がある場合は医師に相談を）。' });
    }
    if (second && second.kcal && (inFirst || o.decision === 'advance')) { // バルクの点検は、第1期（次の候補）かバルク中だけ
      var sp = effective(second, { kcal: E, basis: o.energy.basis }), sur = sp.kcal.max - E, decided = o.decision === 'advance';
      if (sp.dynamic) out.push({ key: 'bulk-surplus', level: 'ok', title: '第2期バルクは消費の+5〜10%に自動で合わせます',
        body: 'いまの消費の見込み ' + E + 'kcal' + ebasis + 'なら、第2期のカロリーは ' + sp.kcal.min + '〜' + sp.kcal.max + 'kcal（炭水化物 ' + sp.carbs.min + '〜' + sp.carbs.max + 'g）。第2期に入った時点の消費に合わせて動きます。' });
      else if (sur < BULK_MIN_SURPLUS) out.push({ key: 'bulk-surplus', level: decided ? 'warn' : 'info', title: '第2期バルクのカロリーでは、増量になりにくい',
        body: '第2期の上限 ' + sp.kcal.max + 'kcal は、消費の見込み ' + E + 'kcal' + ebasis + 'より ' + (sur >= 0 ? '+' + sur : sur) + 'kcal。筋肉を増やすには消費の+5〜10%（約+' + Math.round(E * 0.05) + '〜' + Math.round(E * 0.1) + 'kcal）の余剰が目安です。第2期に入る前にカロリー範囲を見直してください。' });
    }
    return out;
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
    shred: {
      kcal:    { under: '食事が少なすぎます。絞り込み期の赤字は小さく保つ設計です。下限まで戻さないと筋トレの出力と回復が落ちます。', over: '食事が多めで、体脂肪が減りにくい状態です。間食と脂質から調整してください。' },
      protein: { under: 'たんぱく質が足りません。赤字の中で筋肉を増やすには最優先です。1日の中で足す場所（朝・間食）を決めて補ってください。', over: 'たんぱく質が多めです。カロリーの枠（特に炭水化物）を圧迫していないか確認してください。' },
      fat:     { under: '脂質が少なすぎます。下限は守ってください（ホルモンと満足感のため）。', over: '脂質でカロリーの枠を使いすぎています。炭水化物とたんぱく質を優先してください。' },
      carbs:   { under: '炭水化物が足りません。筋トレの出力と回復を守るため、下限までは確保してください（特に筋トレの前後）。', over: '炭水化物が多めです。上限に収めてください。' },
      chest:   { under: '胸のセット数が足りません。微増筋にはボリュームが要ります。まず胸から消化してください。', over: '胸のやり過ぎです。右肩の保護と回復を優先し、数日は減らしてください。' },
      legs:    { under: '脚のセット数が足りません。スクワット・ブルガリアンを優先して貯金してください。', over: '脚のやり過ぎです。回復を優先し、数日は減らしてください。' },
      cardio:  { under: '有酸素が少なめです。週2回は入れて、赤字を食事だけに頼らないようにしてください。', over: '有酸素が多すぎます。回復が追いつかず筋肉が落ちやすいので、週2〜3回に収めてください。' }
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
  ADVICE.shred8 = ADVICE.shred;
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
  /* 計算に使う「今の体」（全画面・全AIで共通）。体重＝最新、体脂肪率＝直近7日平均（3日分以上あれば）→ 無ければ最新。除脂肪量はこの2つから。
     daily＝日ごとの体組成（新しい順でも古い順でもよい）。日々の体脂肪率のぶれで、たんぱく質の範囲などが動かないようにする */
  function bodyState(daily, today) {
    var w = null, f = null, wd = '', fd = '';
    (daily || []).forEach(function (l) {
      if (l.weight != null && (!wd || l.date > wd)) { w = Number(l.weight); wd = l.date; }
      if (l.fat != null && (!fd || l.date > fd)) { f = Number(l.fat); fd = l.date; }
    });
    if (w == null) return {};
    var f7 = today ? fat7(daily, today) : null, bf = f7 ? f7.avg : f;
    return { weightKg: w, fatPct: bf, leanKg: bf != null ? r1(w * (1 - bf / 100)) : null, fatBasis: f7 ? '7日平均' : (bf != null ? '最新' : '') };
  }
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
     ctx＝{fat7, decision}。decision：''＝未選択（第1期のまま）／'advance'＝第2期へ進む／'maintain'＝第3期（維持・回復）にする／'hold'＝いまのプラン（第1期）を据え置く
     戻り値 {phase, index, ready, decision, needChoice, overdue} */
  function resolve(date, ctx, rm) {
    rm = rm || ROADMAP; ctx = ctx || {};
    var first = rm.phases[0], dec = ctx.decision === 'advance' || ctx.decision === 'hold' || ctx.decision === 'maintain' || ctx.decision === 'shred' || ctx.decision === 'shred8' ? ctx.decision : '';
    var goal = first.targets.fatPct, f = ctx.fat7;
    var ready = !!(f && goal != null && f.avg <= goal);
    var idx = dec === 'advance' || dec === 'maintain' || dec === 'shred' || dec === 'shred8' ? 1 : 0;
    var shred = dec === 'shred' && rm.shredPhase ? rm.shredPhase : dec === 'shred8' && rm.shred8Phase ? rm.shred8Phase : null;
    return {
      phase: shred || (dec === 'maintain' && rm.maintainPhase ? rm.maintainPhase : rm.phases[idx]), index: idx, ready: ready, decision: dec,
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
    var shredMode = ctx.decision === 'shred' || ctx.decision === 'shred8';
    var maintMode = ctx.decision === 'maintain' || (ctx.planPhase === 'maintain' && !shredMode); // 絞り込みを選んでいれば、計画が維持期の設定でも絞り込み（phaseFor・adjustCfg と同じ優先順）
    var avg = f ? f.avg : null;
    if (r.needChoice && !maintMode) {
      out.push({ key: 'choose', level: 'info', title: '第1期の目標に届きました', body: '体脂肪率が直近7日平均で ' + avg + '%（目標 ' + goal + '%）になりました。次の道を選んでください：第2期のバルク（増量）／第2期の絞り込み（体脂肪率12%・微増筋）／第3期（維持・回復）／据え置き。減量計画の「いまの道」で切り替えられます。' });
    }
    if (maintMode && avg != null) {
      var floor = Number(ctx.floorFat) > 0 ? Number(ctx.floorFat) : goal, upper = r1(floor + MAINT_BAND_PCT);
      if (avg > upper) out.push({ key: 'maint-over', level: 'warn', title: '許容帯の上を超えました', body: '体脂肪率が直近7日平均で ' + avg + '%。維持期の許容帯（' + floor + '〜' + upper + '%）の上限を超えています。第1期（減量）に戻す目安です。減らしたいときは減量計画の「いまの道」で第1期を選んでください。' });
      else if (avg < floor) out.push({ key: 'maint-below', level: 'warn', title: '最低ラインを下回りました', body: '体脂肪率が直近7日平均で ' + avg + '%。最低ライン ' + floor + '% を下回っています。維持カロリーより少し多めに食べて、筋量を守ってください。' });
    }
    if (ctx.decision === 'advance' && avg != null && goal != null && avg > goal + BULK_OVER_PCT) {
      out.push({ key: 'bulk-over', level: 'warn', title: '脂肪が乗りすぎています', body: '体脂肪率が直近7日平均で ' + avg + '%。第1期の目標（' + goal + '%）より ' + r1(avg - goal) + '% 高くなりました。バルクの食事を少し控えるか、第3期（維持・回復）に切り替える、または第1期に戻す目安です。' });
    }
    var ap = approach(ctx, rm);
    if (ap && ap.near && !ap.reached && !(maintMode)) out.push({ key: 'approach-' + ap.kind, level: 'info', title: 'もうすぐ、次のステップを選ぶ段階です', body: ap.text });
    if (ctx.decision === 'shred' && avg != null && avg <= rm.shredPhase.targets.fatPct) {
      out.push({ key: 'shred-reached', level: 'info', title: '絞り込み（12%）に届きました', body: '体脂肪率が直近7日平均で ' + avg + '%（目標 ' + rm.shredPhase.targets.fatPct + '%）になりました。次を選んでください：さらに8%を目指す（「絞り込み 8%」）／第3期（維持・回復）。維持にするときは、減量計画の最低体脂肪率を ' + rm.shredPhase.targets.fatPct + '% にしてください。8%を目指す場合は、睡眠・疲労・コンディションが良好なことが条件です。' });
    }
    if (ctx.decision === 'shred8' && avg != null && avg <= rm.shred8Phase.targets.fatPct) {
      out.push({ key: 'shred8-reached', level: 'warn', title: '絞り込み（8%）に届きました', body: '体脂肪率が直近7日平均で ' + avg + '%（目標 ' + rm.shred8Phase.targets.fatPct + '%）。ここから減らさず、第3期（維持・回復）に切り替えてください。減量計画の最低体脂肪率は ' + rm.shred8Phase.targets.fatPct + '〜' + (rm.shred8Phase.targets.fatPct + 2) + '% を目安に。8%は長く保つ水準ではないので、慣れたら少し戻して構いません。' });
    }
    if ((ctx.decision === 'shred' || ctx.decision === 'shred8') && avg != null) {
      var sg = (ctx.decision === 'shred8' ? rm.shred8Phase : rm.shredPhase).targets.fatPct;
      if (avg < sg - 1) out.push({ key: 'shred-below', level: 'warn', title: '目標より下がりすぎています', body: '体脂肪率が直近7日平均で ' + avg + '%。目標 ' + sg + '% を1%以上下回っています。食事を維持カロリー付近まで戻し、第3期（維持・回復）に切り替える目安です。' });
    }
    if (r.overdue) out.push({ key: 'overdue', level: 'info', title: '第1期の期限を過ぎました', body: '期限（' + first.to + '）を過ぎましたが、体脂肪率 ' + goal + '% にはまだ届いていません。期限の見直しは総合コーチに相談できます。' });
    return out;
  }

  /* ---- 「次のステップを選ぶ段階」まであとどれくらいか（第1期→第2期、絞り込み12%→8%／維持）。
     ctx＝{decision, fat7:{avg,days}|null, weightKg, lossKgPerWeek}（体重と週の減少量は、あれば見込みの週数に使う）
     戻り値 null（判断できない／今の道に選ぶ段階が無い）または {kind:'cut'|'shred'|'shred8', goal, avg, gap, weeks, near, reached, next, text}
     near＝あと体脂肪率2%以内、または見込み4週以内。reached＝もう届いている（選ぶ段階）。 */
  var APPROACH_PCT = 2, APPROACH_WEEKS = 4;
  function approach(ctx, rm) {
    rm = rm || ROADMAP; ctx = ctx || {};
    var dec = ctx.decision, f = ctx.fat7, kind, goal, next;
    if (!f || f.avg == null) return null;
    if (dec === 'shred') { kind = 'shred'; goal = rm.shredPhase.targets.fatPct; next = '維持にするか、8%を目指すか'; }
    else if (dec === 'shred8') { kind = 'shred8'; goal = rm.shred8Phase.targets.fatPct; next = '維持（これ以上は減らさない）'; }
    else if (dec === '' || dec === 'hold' || dec == null) { kind = 'cut'; goal = rm.phases[0].targets.fatPct; next = '第2期（バルク・維持・絞り込み）のどれにするか'; }
    else return null;
    if (goal == null) return null;
    var gap = r1(f.avg - goal), weeks = null;
    if (gap <= 0) return { kind: kind, goal: goal, avg: f.avg, gap: gap, weeks: 0, near: false, reached: true, next: next, text: '体脂肪率 ' + goal + '% に届きました。次のステップを選ぶ段階です：' + next + '。' };
    var w = Number(ctx.weightKg), loss = Number(ctx.lossKgPerWeek);
    if (w > 0 && loss > 0 && f.avg > 0 && f.avg < 100) {
      var lean = w * (1 - f.avg / 100), toLose = w - lean / (1 - goal / 100);
      if (toLose > 0) weeks = Math.max(1, Math.ceil(toLose / loss));
    }
    var near = gap <= APPROACH_PCT || (weeks != null && weeks <= APPROACH_WEEKS);
    var pace = weeks != null ? '（今のペースで約' + weeks + '週間後）' : '';
    var text = near
      ? 'もうすぐ、次のステップを選ぶ段階です。目標の ' + goal + '% まで あと ' + gap + '%' + pace + '。ここまで積み上げてきた成果です。届いたら「' + next + '」を選びます。'
      : '次のステップ（' + next + '）を選ぶ段階まで、あと体脂肪率 ' + gap + '%' + pace + '。';
    return { kind: kind, goal: goal, avg: f.avg, gap: gap, weeks: weeks, near: near, reached: false, next: next, text: text };
  }

  /* 次週のカロリー調整（PlanLib.adjust）に渡す設定。モードはマスタープランの選択で決まる：
     ''/'hold'＝第1期（減量）、'advance'＝第2期バルク、'shred'／'shred8'＝絞り込み期（12%／8%）、'maintain'（または減量計画が維持期）＝維持。
     kcalMin/kcalMax＝そのモードの目標カロリーの範囲（維持は範囲なし＝0）。floorFat＝維持期の最低ラインの既定（第1期の体脂肪率目標） */
  function adjustCfg(decision, planPhase, rm, body, en) {
    rm = rm || ROADMAP; body = body || {};
    var shred = decision === 'shred' || decision === 'shred8';
    var mode = decision === 'maintain' || (planPhase === 'maintain' && !shred) ? 'maintain' : decision === 'advance' ? 'bulk' : shred ? 'shred' : 'cut';
    var sp = decision === 'shred8' ? rm.shred8Phase : rm.shredPhase;
    var ph = effective(mode === 'maintain' ? (rm.maintainPhase || rm.phases[0]) : mode === 'bulk' ? rm.phases[1] : mode === 'shred' && sp ? sp : rm.phases[0], en, body);
    var k = mode === 'maintain' ? null : ph.kcal, pr = proteinFor(ph, body.weightKg, body.fatPct);
    // protein：その期のたんぱく質の範囲（食事の目標・総合コーチと同じ）。体組成が無く期にも数値が無いときは null
    // floorFat：絞り込み期は、その段階の目標（12%か8%）。減量計画の「最低ライン」として、届いたらそれ以上は減らさない
    return { mode: mode, recover: mode === 'maintain', kcalMin: k ? k.min : 0, kcalMax: k ? k.max : 0, floorFat: mode === 'shred' && sp ? sp.targets.fatPct : rm.phases[0].targets.fatPct || 0, protein: pr ? { min: pr.min, target: pr.target, max: pr.max } : null };
  }

  /* AI（総合コーチ・AIトレーナー）に渡す要約。AIはこの数値を引用するだけで、再計算しない */
  function brief(date, state, avg, ctx, rm) {
    rm = rm || ROADMAP;
    var en = ctx && ctx.energy ? ctx.energy : null;
    var r = resolve(date, ctx, rm), p = effective(r.phase, en, state), next = rm.phases[r.index + 1] ? effective(rm.phases[r.index + 1], en, state) : null;
    return {
      title: rm.title, decidedAt: rm.decidedAt, today: date,
      nowPhase: p.label, nowPhaseKey: p.key, phaseEnd: p.to, phaseEndApprox: !!p.approx, daysLeftInPhase: p.to ? toDays(p.to) - toDays(date) : null, // 第3期・絞り込みは期限なし
      switchRule: '第1期の体脂肪率目標に直近7日平均で届いたら、本人が「第2期（リーンバルク）へ進む」「第3期（維持・回復）にする」「いまのプランを据え置く」のどれかを選ぶ。さらに体脂肪率を下げたいときは「絞り込み期（12%→8%・微増筋）」も選べる（日付では自動で切り替わらない）',
      fat7: ctx && ctx.fat7 ? ctx.fat7 : null,
      reachedFirstPhaseGoal: r.ready, userChoice: r.decision || '未選択', waitingForUserChoice: r.needChoice, pastPhaseEndWithoutReaching: r.overdue,
      nextPhase: next ? { label: next.label, kcal: next.kcal, carbs: next.carbs, targets: next.targets } : null,
      daily: { kcal: p.kcal, protein: p.protein, fat: p.fat, carbs: p.carbs },
      training: p.training, setsPerWeek: p.sets, cardio: p.cardio, cardioLast7Days: ctx && ctx.cardioLogs ? cardioCheck(p, ctx.cardioLogs, date) : null,
      targets: p.targets, progress: progress(p, state), mealCheck: mealCheck(p, avg),
      weeklyBalance: balance(p, { meal: avg, sets: ctx && ctx.sets7 ? ctx.sets7 : null, cardio: ctx && ctx.cardioLogs ? cardioCheck(p, ctx.cardioLogs, date) : null }),
      setsLast7Days: ctx && ctx.sets7 ? ctx.sets7 : null,
      planCheck: ctx && ctx.energy ? planCheck({ date: date, decision: ctx.decision, planPhase: ctx.planPhase, energy: ctx.energy, state: state }, rm) : null,
      rules: rm.rules
    };
  }

  return { bodyState: bodyState, ROADMAP: ROADMAP, OVER_SETS: OVER_SETS, ADVICE: ADVICE, balance: balance, current: current, cardioCheck: cardioCheck, fat7: fat7, resolve: resolve, advice: advice, approach: approach, APPROACH_PCT: APPROACH_PCT, adjustCfg: adjustCfg, MAINT_BAND_PCT: MAINT_BAND_PCT, BULK_OVER_PCT: BULK_OVER_PCT, mealGoals: mealGoals, autoMealGoals: autoMealGoals, ACTIVITY: ACTIVITY, energy: energy, proteinFor: proteinFor, planCheck: planCheck, effective: effective, kcalRuleText: kcalRuleText, basisText: basisText, progress: progress, mealCheck: mealCheck, brief: brief };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = RoadmapLib;
