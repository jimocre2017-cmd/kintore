/* FFMI（除脂肪量指数）の計算と、同性・同年代の分布との比較（画面とテストで共通）
 * FFMI = 除脂肪体重(kg) ÷ 身長(m)²。除脂肪体重 = 体重 × (1 − 体脂肪率/100)。
 * 補正FFMI = FFMI + 6.1 × (1.80 − 身長m)（Kouri 1995 の原式。身長の違いをならす）。
 * ※ 家庭用の体組成計（BIA）の推定値で、体脂肪率の誤差・水分の影響を受ける。分布も「概算の目安」。
 *
 * 出典（すべてBIA測定）
 *  韓国  Kim et al., Nutrients 2026;18(8):1170（KNHANES 2022–23, n=10,140）… 年代別の平均・SD
 *  中国  Jin et al., Clin Nutr 2019（n=8,959）… 男18.6±1.6、女15.7±1.1（全年齢）
 *  欧州系 Schutz/Kyle 2002（スイス白人）… 18–34歳の中央値 男18.9、女15.4（SDは出典なし→仮定）
 *  日本  若年成人の全国分布が見つからず、65歳以上のみ（男17.4±1.5、女15.3±1.2）→ 65歳未満は韓国の値で代用
 *  ナチュラルの上限目安  Kouri 1995（補正FFMI 約25。薬物未使用者の上端。男性のみ・絶対的な壁ではない）
 */
var FfmiLib = (function () {
  var KOREA = {
    M: [[10, 19, 16.6, 2.4], [20, 29, 18.8, 2.1], [30, 39, 19.1, 1.9], [40, 49, 19.1, 1.8], [50, 59, 18.8, 1.7], [60, 69, 18.1, 1.6], [70, 200, 17.3, 1.5]],
    F: [[10, 19, 14.4, 1.5], [20, 29, 15.0, 1.7], [30, 39, 15.4, 1.6], [40, 49, 15.6, 1.6], [50, 59, 15.7, 1.5], [60, 69, 15.8, 1.4], [70, 200, 15.6, 1.3]]
  };
  var CHINA = { M: [18.6, 1.6], F: [15.7, 1.1] };
  var WORLD_OFFSET = { M: 0.1, F: 0.4 };   // 欧州系18–34歳の中央値 − 韓国20代の平均
  var WORLD_SD_MIN = { M: 2.0, F: 1.7 };   // 仮定
  var NATURAL_LIMIT = 25;
  var NORM_K = 6.1;   // Kouri 1995 の身長補正係数（6.3 は出典なしの流用値なので使わない）

  function r1(n) { return Math.round(n * 10) / 10; }
  function r2(n) { return Math.round(n * 100) / 100; }
  function ffm(weight, fatPct) { return weight * (1 - fatPct / 100); }
  function ffmi(weight, fatPct, heightCm) {
    if (!(weight > 0) || !(fatPct >= 0) || fatPct >= 100 || !(heightCm > 0)) return null;
    var m = heightCm / 100; return ffm(weight, fatPct) / (m * m);
  }
  function normalized(v, heightCm) { return v == null ? null : v + NORM_K * (1.8 - heightCm / 100); }

  function korea(sex, age) {
    var L = KOREA[sex === 'F' ? 'F' : 'M'], a = Math.max(10, Math.min(80, Math.round(age) || 25));
    for (var i = 0; i < L.length; i++) if (a >= L[i][0] && a <= L[i][1]) return { mean: L[i][2], sd: L[i][3] };
    return { mean: L[1][2], sd: L[1][3] };
  }

  /** 比較の基準3つ（日本・アジア・世界）。sex: 'M'|'F'、age: 数字 */
  function refs(sex, age) {
    sex = sex === 'F' ? 'F' : 'M';
    var k = korea(sex, age), c = CHINA[sex];
    return [
      { key: 'jp', label: '日本', mean: k.mean, sd: k.sd, note: '日本の若い世代の全国データが見つからないため、韓国の同年代の値で代用した推定' },
      { key: 'asia', label: 'アジア', mean: r2((k.mean + c[0]) / 2), sd: r2((k.sd + c[1]) / 2), note: '韓国（同年代）と中国（全年齢）の研究の平均' },
      { key: 'world', label: '世界', mean: r2(k.mean + WORLD_OFFSET[sex]), sd: Math.max(k.sd, WORLD_SD_MIN[sex]), note: '世界全体の統計は無く、欧州系の研究をもとにした推定（SDは仮定）' }
    ];
  }

  function cdf(z) { // 標準正規分布の累積（Abramowitz-Stegun 26.2.17）
    var t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2);
    var p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return z > 0 ? 1 - p : p;
  }
  /** 値が分布の下から何％の位置か（0〜100） */
  function percentile(v, mean, sd) { return Math.round(cdf((v - mean) / sd) * 1000) / 10; }
  function pdf(x, mean, sd) { return Math.exp(-Math.pow((x - mean) / sd, 2) / 2) / (sd * Math.sqrt(2 * Math.PI)); }

  /** 「上位◯％」の言い方 */
  function rankText(pct) {
    if (pct >= 50) { var top = Math.max(0.1, r1(100 - pct)); return '上位 ' + (top < 1 ? top : Math.round(top)) + '%'; }
    return '下から ' + (pct < 1 ? pct : Math.round(pct)) + '%';
  }
  function levelText(pct) {
    if (pct >= 99) return 'かなり高い（同年代の上位1%前後）';
    if (pct >= 90) return '高い（同年代の上位1割）';
    if (pct >= 65) return 'やや高い';
    if (pct >= 35) return '平均的';
    if (pct >= 10) return 'やや低い';
    return '低め';
  }
  function naturalLimit(sex) { return sex === 'F' ? null : NATURAL_LIMIT; }

  /** 現在値と、筋量を gainKg 増やしたときの目標値。o: {weight, fat, height, sex, age, goalFat, gainKg} */
  function snapshot(o) {
    var f = ffmi(o.weight, o.fat, o.height);
    if (f == null) return null;
    var lean = ffm(o.weight, o.fat), gain = Math.max(0, Number(o.gainKg) || 0);
    var m = o.height / 100, tf = (lean + gain) / (m * m);
    var goalW = o.goalFat > 0 ? (lean + gain) / (1 - o.goalFat / 100) : null;
    var rs = refs(o.sex, o.age);
    function view(v) {
      return { ffmi: r1(v), norm: r1(normalized(v, o.height)), raw: v, vs: rs.map(function (r) { var p = percentile(v, r.mean, r.sd); return { key: r.key, label: r.label, mean: r.mean, sd: r.sd, note: r.note, pct: p, rank: rankText(p), level: levelText(p) }; }) };
    }
    var lim = naturalLimit(o.sex), now = view(f), tgt = view(tf);
    return {
      lean: r1(lean), goalWeight: goalW == null ? null : r1(goalW), refs: rs, now: now, target: tgt, limit: lim,
      limitGap: lim == null ? null : r1(lim - now.norm),
      toLimitKg: lim == null ? null : r1(Math.max(0, (lim - NORM_K * (1.8 - m) - f) * m * m))
    };
  }

  return { NORM_K: NORM_K, ffm: ffm, ffmi: ffmi, normalized: normalized, refs: refs, percentile: percentile, pdf: pdf, rankText: rankText, levelText: levelText, naturalLimit: naturalLimit, snapshot: snapshot, r1: r1 };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = FfmiLib;
