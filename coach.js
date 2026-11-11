/* 総合コーチ：全画面共通の「ワンクリックAI」ボタンと結果シート。
 * 食事・筋トレ・有酸素・体組成と、目標の体脂肪率・期限をまとめて診断する（計算は GAS の Coach.gs、通信は api.js）。
 * 使い方：各画面で api.js の後に <script src="coach.js"></script> を読み込むだけ。 */
(function () {
  'use strict';
  if (window.__coachLoaded || !window.KT) return;
  window.__coachLoaded = true;

  var FRESH_MS = 60 * 60 * 1000; // この時間内の結果は、ボタンを押したときそのまま表示（再診断は別ボタン）
  var VERDICT = {
    on_track: ['順調', '#1a9a62'], slightly_behind: ['少し遅れ', '#c98a00'], behind: ['このままでは間に合わない', '#d03a3a'],
    ahead: ['速すぎ（筋肉が心配）', '#c98a00'], unknown: ['判定できない（記録不足）', '#8a8983']
  };
  var busy = false, root = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function $(id) { return document.getElementById(id); }

  function css() {
    var st = document.createElement('style');
    st.textContent =
      '.coachfab{position:fixed;right:14px;bottom:14px;z-index:60;border:0;border-radius:999px;padding:12px 16px;font-size:14px;font-weight:700;' +
      'background:var(--accent,#2a78d6);color:var(--accent-ink,#fff);box-shadow:0 4px 14px rgba(0,0,0,.28);cursor:pointer;display:flex;align-items:center;gap:6px}' +
      '.coachfab:active{transform:scale(.97)}' +
      '.coachov{position:fixed;inset:0;z-index:70;background:rgba(0,0,0,.45);display:none;align-items:flex-end;justify-content:center}' +
      '.coachov.on{display:flex}' +
      '.coachbox{background:var(--surface,#fff);color:var(--ink,#141413);width:min(640px,100%);max-height:88vh;overflow:auto;border-radius:16px 16px 0 0;padding:16px 16px 22px;' +
      'font-family:inherit;line-height:1.7;-webkit-overflow-scrolling:touch}' +
      '@media(min-width:700px){.coachov{align-items:center}.coachbox{border-radius:16px}}' +
      '.coachbox h3{margin:0;font-size:16px}' +
      '.coachbox .ch{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}' +
      '.coachbox .cx{border:1px solid var(--line,#e2e1dc);background:var(--surface,#fff);color:var(--ink-2,#55544f);border-radius:10px;padding:6px 12px;font-size:13px;cursor:pointer}' +
      '.coachbox .vd{display:inline-block;color:#fff;border-radius:999px;padding:3px 12px;font-size:12px;font-weight:700}' +
      '.coachbox .hl{font-size:18px;font-weight:800;line-height:1.5;margin:8px 0 6px}' +
      '.coachbox .meta{font-size:11px;color:var(--ink-3,#8a8983)}' +
      '.coachbox .facts{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0}' +
      '.coachbox .facts span{background:var(--surface-2,#f0efec);border-radius:8px;padding:4px 9px;font-size:12px;color:var(--ink-2,#55544f)}' +
      '.coachbox .sec{margin-top:12px}.coachbox .sec b{display:block;font-size:12px;color:var(--ink-3,#8a8983);margin-bottom:2px}' +
      '.coachbox .sec p{margin:0;font-size:14px}' +
      '.coachbox .act{background:var(--surface-2,#f0efec);border-radius:10px;padding:8px 10px;margin-top:6px;font-size:14px}.coachbox .act i{font-style:normal;font-weight:700}' +
      '.coachbox .blunt{margin-top:12px;border-left:4px solid #d03a3a;background:var(--surface-2,#f0efec);padding:8px 10px;border-radius:0 10px 10px 0;font-size:14px;font-weight:700}' +
      '.coachbox .gaps{margin-top:12px;font-size:13px;color:var(--ink-2,#55544f)}.coachbox .gaps ul{margin:4px 0 0;padding-left:18px}' +
      '.coachbox .warn{margin-top:12px;font-size:11px;color:var(--ink-3,#8a8983)}' +
      '.coachbox .go{width:100%;margin-top:14px;border:0;border-radius:12px;padding:12px;font-size:14px;font-weight:700;background:var(--accent,#2a78d6);color:var(--accent-ink,#fff);cursor:pointer}' +
      '.coachbox .go[disabled]{opacity:.6}' +
      '.coachbox .busy{padding:28px 0;text-align:center;color:var(--ink-2,#55544f);font-size:14px}' +
      '.coachbox .err{margin-top:10px;background:#fbe9e9;color:#9a2a2a;border-radius:10px;padding:8px 10px;font-size:13px}';
    document.head.appendChild(st);
  }

  function fmtFacts(f) {
    if (!f) return '';
    var a = [];
    if (f.goalFat) a.push('目標 体脂肪率 ' + f.goalFat + '%');
    if (f.deadline) a.push('期限 ' + f.deadline + (f.daysLeft != null ? '（あと' + f.daysLeft + '日）' : ''));
    else if (f.projectedDate) a.push('今のペースの到達予定 ' + f.projectedDate + '（期限は未設定）');
    if (f.remainingFatKg != null) a.push('残り脂肪 ' + f.remainingFatKg + 'kg');
    if (f.requiredKgPerWeek != null) a.push('必要 ' + f.requiredKgPerWeek + 'kg/週（安全上限 ' + f.safeMaxKgPerWeek + '）');
    if (f.avgIntakeKcal != null) a.push('摂取 平均' + Math.round(f.avgIntakeKcal) + 'kcal（' + f.mealDays + '日記録）');
    if (f.burn7) a.push('直近7日の運動消費 筋' + f.burn7.strength + '・有' + f.burn7.cardio + 'kcal');
    return a.length ? '<div class="facts">' + a.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' : '';
  }

  function resultHtml(r, stale) {
    var v = VERDICT[r.verdict] || VERDICT.unknown, h = '';
    h += '<span class="vd" style="background:' + v[1] + '">' + esc(v[0]) + '</span>';
    h += '<div class="hl">' + esc(r.headline) + '</div>';
    h += '<div class="meta">' + esc(r.createdAt || '') + (stale ? '（前回の診断）' : '') + '</div>';
    h += fmtFacts(r.facts);
    h += '<div class="sec"><b>目標と期限</b><p>' + esc(r.goalCheck) + '</p></div>';
    h += '<div class="sec"><b>食事</b><p>' + esc(r.meal) + '</p></div>';
    h += '<div class="sec"><b>運動</b><p>' + esc(r.exercise) + '</p></div>';
    h += '<div class="sec"><b>体組成</b><p>' + esc(r.body) + '</p></div>';
    if ((r.todayActions || []).length) {
      h += '<div class="sec"><b>今日〜明日にやること</b>' + r.todayActions.map(function (a) { return '<div class="act"><i>' + esc(a.title) + '</i><br>' + esc(a.detail) + '</div>'; }).join('') + '</div>';
    }
    if (r.blunt) h += '<div class="blunt">' + esc(r.blunt) + '</div>';
    if ((r.dataGaps || []).length) h += '<div class="gaps">記録を足すと精度が上がります<ul>' + r.dataGaps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
    h += '<div class="warn">記録をもとにした目安で、医療的な診断ではありません。痛みや強い疲労があるときは無理をせず、続く場合は専門家に相談してください。</div>';
    return h;
  }

  function show(body, err) {
    $('coachBody').innerHTML = body + (err ? '<div class="err">' + esc(err) + '</div>' : '');
  }
  function goBtn(label) { return '<button class="go" id="coachGo">' + label + '</button>'; }
  function bindGo() { var b = $('coachGo'); if (b) b.addEventListener('click', run); }

  function run() {
    if (busy) return;
    busy = true;
    show('<div class="busy">記録を読んで診断しています…（10〜30秒）</div>');
    KT.call('coachJudge').then(function (r) {
      busy = false; show(resultHtml(r, false) + goBtn('もう一度診断する')); bindGo();
      var bx = root.querySelector('.coachbox'); if (bx) bx.scrollTop = 0;
    }).catch(function (e) {
      busy = false;
      KT.call('coachLast').then(function (c) {
        var msg = (e && e.message) || '診断に失敗しました';
        if (c && c.res) show(resultHtml(c.res, true) + goBtn('もう一度診断する'), msg); else show(goBtn('診断する'), msg);
        bindGo();
      });
    });
  }

  function open() {
    root.classList.add('on');
    KT.call('coachLast').then(function (c) {
      if (c && c.res && Date.now() - c.t < FRESH_MS) { show(resultHtml(c.res, false) + goBtn('もう一度診断する')); bindGo(); }
      else run();
    });
  }
  function close() { root.classList.remove('on'); }

  function init() {
    css();
    var fab = document.createElement('button'), host = $('aiOpen'); // 記録画面：下にタイマー帯があるので、ヘッダーのAIトレーナーの隣に置く
    fab.type = 'button'; fab.setAttribute('aria-label', '総合コーチ');
    if (host && host.parentNode) { fab.className = 'aibtn'; fab.innerHTML = '<span class="spark">🧭</span>総合コーチ'; host.parentNode.insertBefore(fab, host); }
    else { fab.className = 'coachfab'; fab.innerHTML = '<span>🧭</span>総合コーチ'; document.body.appendChild(fab); }
    fab.addEventListener('click', open);
    root = document.createElement('div');
    root.className = 'coachov';
    root.innerHTML = '<div class="coachbox" role="dialog" aria-label="総合コーチ"><div class="ch"><h3>総合コーチ</h3><button class="cx" id="coachClose" type="button">閉じる</button></div><div id="coachBody"></div></div>';
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    document.body.appendChild(root);
    $('coachClose').addEventListener('click', close);
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
