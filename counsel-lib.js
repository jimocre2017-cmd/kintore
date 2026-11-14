/* カウンセリングシート：質問の定義と、回答→「前提メモ」への変換（画面・テストで共通。端末側だけで動く）
 * ねらい：アプリを初めて使う人（家族・友人など）に、最初に状態を聞いて安全に始めてもらう。3か月ごとに「変わったところだけ」更新する。
 * 変換は決まりごとで行う（AIは使わない）。回答に無いことは書かない。
 *
 * 回答 answers … { 質問ID: 値 }
 *   single … '文字列'　multi … ['文字列',…]　text … '文字列'
 *   yno    … { v:'yes'|'no'|'other', t:'その他のときのメモ' }
 */
var CounselLib = (function () {
  var INTERVAL_DAYS = 90;
  var REGIONS = ['首', '肩（右）', '肩（左）', '肘', '手首・手', '腰', '股関節・太もも', '膝', '足首・すね'];
  var PAIN = ['なし', '過去にあった', '今ある'];
  var PURPOSES = ['脂肪を落とす', '筋肉をつける', '体力・健康を保つ', 'リハビリ中心'];

  function toDays(s) { var m = String(s || '').match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/); return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null; }

  /** 質問の一覧。equipment は種目マスタにある器具名の一覧（持っている器具の選択肢に使う） */
  function sections(equipment) {
    var eq = (equipment || []).filter(function (x) { return x; });
    var pain = [];
    REGIONS.forEach(function (r) {
      pain.push({ id: 'pain:' + r, type: 'single', label: r, options: PAIN, tight: true });
      pain.push({ id: 'move:' + r, type: 'text', label: r + '：どんな動きで、どのくらい痛む？（例：腕を上げると引っかかる・5段階の2）', when: { id: 'pain:' + r, is: ['今ある'] } });
      pain.push({ id: 'hist:' + r, type: 'text', label: r + '：過去のけが・手術（いつ頃・何）', when: { id: 'pain:' + r, is: ['過去にあった', '今ある'] } });
    });
    return [
      { id: 'goal', title: '目的と運動の習慣', items: [
        { id: 'purpose', type: 'single', label: 'いちばんの目的は？', options: PURPOSES },
        { id: 'exp', type: 'single', label: '筋トレの経験は？', options: ['初めて', '1年未満', '1年以上'] },
        { id: 'freq', type: 'single', label: '週に何回くらい運動できそう？', options: ['1〜2回', '3〜4回', '5回以上'] },
        { id: 'mins', type: 'single', label: '1回に使える時間は？', options: ['20分まで', '30〜45分', '60分以上'] }
      ] },
      { id: 'gear', title: '持っている器具', items: [
        { id: 'equipment', type: 'multi', label: '使える器具にチェック（チェックしなかった器具の種目は、表示をオフにできます）', options: eq, none: '（自重のみ）' },
        { id: 'gearNote', type: 'text', label: '器具について、その他あれば' }
      ] },
      { id: 'body', title: '痛み・けが・体調', items: [
        { id: 'doctor', type: 'yno', label: '医師から、運動を控えるよう言われていることはある？' },
        { id: 'numb', type: 'yno', label: '運動中でなくても、しびれや夜間の痛み（寝ていて目が覚める）がある？' }
      ].concat(pain).concat([
        { id: 'bodyNote', type: 'text', label: '体調・持病・薬など、伝えておきたいことがあれば' }
      ]) },
      { id: 'life', title: '生活と食事', items: [
        { id: 'work', type: 'single', label: '普段の活動量に近いのは？', options: ['座っている時間が長い', '立ち・歩きが多い', '力仕事・体をよく動かす'] },
        { id: 'sleep', type: 'single', label: '睡眠時間は？', options: ['5時間未満', '5〜6時間', '7時間以上'] },
        { id: 'diet', type: 'yno', label: '食事で、避けているもの・制限はある？（アレルギー、宗教、好き嫌いなど）' },
        { id: 'dietNote', type: 'text', label: '食事について、その他あれば' }
      ] },
      { id: 'memo', title: '最後に', items: [
        { id: 'memo', type: 'text', label: 'アプリ（AI）に伝えておきたいこと、不安なことがあれば自由に' }
      ] }
    ];
  }

  function isShown(item, ans) { return !item.when || (item.when.is || []).indexOf(ans[item.when.id]) >= 0; }
  function ynText(a) { if (!a || !a.v) return ''; return a.v === 'yes' ? 'はい' : a.v === 'no' ? 'いいえ' : 'その他' + (a.t ? '（' + a.t + '）' : ''); }

  /** 受診・見合わせをすすめる回答があれば、その文のリストを返す */
  function redFlags(ans) {
    var out = [];
    ans = ans || {};
    if (ans.doctor && ans.doctor.v === 'yes') out.push('医師から運動を控えるよう言われているため、運動を始める前に医師に相談してください。');
    if (ans.numb && ans.numb.v === 'yes') out.push('しびれや夜間の痛みがあるため、運動より先に医療機関で相談してください。');
    return out;
  }

  /** 回答 → AIが読む前提メモ（プレーンテキスト）。回答のあったことだけ書く */
  function compile(ans, equipment, updatedAt) {
    ans = ans || {};
    var L = [];
    var one = function (id) { return ans[id] || ''; };
    var g = [];
    if (one('purpose')) g.push('目的：' + one('purpose'));
    if (one('exp')) g.push('経験：' + one('exp'));
    if (one('freq')) g.push('頻度：週' + one('freq'));
    if (one('mins')) g.push('1回の時間：' + one('mins'));
    if (g.length) L.push('【目的と習慣】' + g.join('。'));
    var eqAll = (equipment || []).filter(Boolean);
    var have = Array.isArray(ans.equipment) ? ans.equipment : null;
    if (have) {
      var lack = eqAll.filter(function (x) { return have.indexOf(x) < 0; });
      L.push('【器具】使える：' + (have.length ? have.join('、') : '自重のみ') + (lack.length ? '。無い：' + lack.join('、') + '（これらを使う種目は勧めない）' : '') + (one('gearNote') ? '。' + one('gearNote') : ''));
    }
    var flags = redFlags(ans), b = [];
    flags.forEach(function (f) { b.push('注意：' + f); });
    if (ans.doctor && ans.doctor.v === 'other') b.push('医師の指示：' + ynText(ans.doctor));
    if (ans.numb && ans.numb.v === 'other') b.push('しびれ・夜間痛：' + ynText(ans.numb));
    var now = [], past = [];
    REGIONS.forEach(function (r) {
      var st = ans['pain:' + r];
      if (st === '今ある') now.push(r + (ans['move:' + r] ? '（' + ans['move:' + r] + '）' : '') + (ans['hist:' + r] ? '［既往：' + ans['hist:' + r] + '］' : ''));
      else if (st === '過去にあった') past.push(r + (ans['hist:' + r] ? '（' + ans['hist:' + r] + '）' : ''));
    });
    if (now.length) b.push('今ある痛み・違和感：' + now.join('、') + '。これらに負担のかかる動作は避け、代わりの動作を示す');
    if (past.length) b.push('過去のけが・既往（再発に注意）：' + past.join('、'));
    if (!now.length && ans['pain:' + REGIONS[0]] !== undefined) b.push('現在、痛みや違和感の申告はなし');
    if (one('bodyNote')) b.push(one('bodyNote'));
    if (b.length) L.push('【痛み・けが・体調】' + b.join('。'));
    var l = [];
    if (one('work')) l.push('活動量：' + one('work'));
    if (one('sleep')) l.push('睡眠：' + one('sleep'));
    if (ans.diet && ans.diet.v) l.push('食事の制限：' + ynText(ans.diet) + (one('dietNote') ? '。' + one('dietNote') : ''));
    else if (one('dietNote')) l.push(one('dietNote'));
    if (l.length) L.push('【生活と食事】' + l.join('。'));
    if (one('memo')) L.push('【本人からの伝言】' + one('memo'));
    if (!L.length) return '';
    L.push('（本人の回答にもとづく。' + (updatedAt ? updatedAt + ' 時点。' : '') + 'この内容を最優先で守り、書かれていないことは推測しない）');
    var t = L.join('\n');
    return t.length > 1800 ? t.slice(0, 1790) + '…' : t;
  }

  /** 見直しの時期か。updatedAt が無ければ初回 */
  function status(updatedAt, today, skipped) {
    if (skipped) return { state: 'skipped' };
    if (!updatedAt) return { state: 'first' };
    var d = toDays(today) - toDays(updatedAt);
    if (d >= INTERVAL_DAYS) return { state: 'due', daysSince: d };
    return { state: 'ok', daysSince: d, daysLeft: INTERVAL_DAYS - d };
  }

  /** 見直し用：各セクションの、前回の回答の要約（1行） */
  function sectionSummary(sec, ans) {
    var parts = [];
    sec.items.forEach(function (it) {
      if (!isShown(it, ans || {})) return;
      var v = (ans || {})[it.id];
      if (it.tight && (v === undefined || v === 'なし')) return;
      var s = it.type === 'yno' ? ynText(v) : Array.isArray(v) ? (v.length ? v.join('・') : (it.none || 'なし')) : (v || '');
      if (!s) return;
      parts.push((it.tight ? it.label + '：' : (it.type === 'text' ? '' : '')) + s);
    });
    return parts.join(' ／ ');
  }

  return { INTERVAL_DAYS: INTERVAL_DAYS, REGIONS: REGIONS, sections: sections, isShown: isShown, ynText: ynText, redFlags: redFlags, compile: compile, status: status, sectionSummary: sectionSummary, toDays: toDays };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CounselLib;
