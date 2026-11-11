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
      '.coachbox .tabs{display:flex;gap:6px;margin:0 0 10px}.coachbox .tabs button{flex:1;border:1px solid var(--line,#e2e1dc);background:var(--surface,#fff);color:var(--ink-2,#55544f);border-radius:10px;padding:8px;font-size:14px;font-weight:700;cursor:pointer}' +
      '.coachbox .tabs button.on{background:var(--accent,#2a78d6);border-color:var(--accent,#2a78d6);color:var(--accent-ink,#fff)}' +
      '.coachbox .chips{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.coachbox .chip{border:1px solid var(--line,#e2e1dc);background:var(--surface-2,#f0efec);color:var(--ink,#141413);border-radius:999px;padding:6px 12px;font-size:13px;cursor:pointer}' +
      '.coachbox .chip:active{opacity:.7}' +
      '.coachbox .q{background:var(--accent-soft,#e3eefb);border-radius:12px 12px 2px 12px;padding:8px 12px;margin:10px 0 6px 18%;font-size:14px}' +
      '.coachbox .a{background:var(--surface-2,#f0efec);border-radius:12px 12px 12px 2px;padding:10px 12px;margin:6px 8% 6px 0;font-size:14px}' +
      '.coachbox .a .tp{font-size:11px;color:var(--ink-3,#8a8983);margin-bottom:2px}.coachbox .a ul{margin:6px 0 0;padding-left:18px}.coachbox .a .nx{margin-top:6px;font-size:13px}' +
      '.coachbox .ask{display:flex;gap:6px;margin-top:10px;align-items:flex-end}.coachbox .ask textarea{flex:1;min-height:44px;max-height:120px;resize:vertical;border:1px solid var(--line,#e2e1dc);border-radius:10px;padding:8px 10px;font:inherit;font-size:14px;background:var(--surface,#fff);color:var(--ink,#141413)}' +
      '.coachbox .ask button{border:0;border-radius:10px;padding:11px 16px;font-size:14px;font-weight:700;background:var(--accent,#2a78d6);color:var(--accent-ink,#fff);cursor:pointer}.coachbox .ask button[disabled]{opacity:.6}' +
      '.coachbox details.chart{margin-top:12px;border:1px solid var(--line,#e2e1dc);border-radius:10px;padding:8px 10px;font-size:13px}.coachbox details.chart summary{cursor:pointer;font-weight:700;color:var(--ink-2,#55544f)}.coachbox details.chart textarea{width:100%;box-sizing:border-box;margin-top:6px;border:1px solid var(--line,#e2e1dc);border-radius:10px;padding:8px 10px;font:inherit;font-size:14px;background:var(--surface,#fff);color:var(--ink,#141413)}' +
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
    h += '<div class="warn">記録をもとにした目安で、医療的な診断ではありません。痛みや強い疲労があるときは無理をせず、続く場合は専門家に相談してください。</div>' +
      '<div class="warn">使い分け：いまどうか＝総合コーチ／毎週のカロリー調整＝減量計画の画面／見た目の変化＝体つき写真。</div>';
    return h;
  }

  function show(body, err) {
    $('coachBody').innerHTML = body + (err ? '<div class="err">' + esc(err) + '</div>' : '');
  }
  function goBtn(label) { return '<button class="go" id="coachGo">' + label + '</button>'; }
  function bindGo() { var b = $('coachGo'); if (b) b.addEventListener('click', run); }

  function run() {
    if (busy) { show('<div class="busy">別の処理が終わるまでお待ちください…</div>'); return; }
    busy = true;
    show('<div class="busy">記録を読んで診断しています…（10〜30秒）</div>');
    KT.call('coachJudge').then(function (r) {
      busy = false; if (tab !== 'judge') return; show(resultHtml(r, false) + goBtn('もう一度診断する')); bindGo();
      var bx = root.querySelector('.coachbox'); if (bx) bx.scrollTop = 0;
    }).catch(function (e) {
      busy = false; if (tab !== 'judge') return;
      KT.call('coachLast').then(function (c) {
        var msg = (e && e.message) || '診断に失敗しました';
        if (c && c.res) show(resultHtml(c.res, true) + goBtn('もう一度診断する'), msg); else show(goBtn('診断する'), msg);
        bindGo();
      });
    });
  }

  /* ---------- 相談（チャット） ---------- */
  var TOPICS = [
    ['meal', '食事の見直し', 'データを見て、食事を見直すポイントを教えて'],
    ['plan', '減量・バルクのプラン', '今の状態から、目標に向けたプランを相談したい'],
    ['stall', '停滞の原因', '最近、体重や体脂肪率が思うように動かない。原因の候補を教えて'],
    ['eatout', '外食・飲み会', '外食や飲み会が続く週の、減量を崩さない考え方を教えて'],
    ['training', 'トレーニングと回復', '筋トレと有酸素のバランスは今のままでいい？回復は足りてる？'],
    ['condition', '痛み・コンディション', '今の痛みやコンディションを踏まえて、今日の運動と過ごし方を相談したい'],
    ['body', '体組成の読み方', '体重・体脂肪率・筋肉量の最近の動きを、どう読めばいい？'],
    ['protein', 'たんぱく質', 'たんぱく質は足りてる？どう摂ればいい？']
  ];
  var chat = [], tab = 'judge', topic = 'free', draft = '', chartText = '', chartOpen = false, chartLoaded = false;
  try { chat = JSON.parse(localStorage.getItem('kt_coach_chat') || '[]'); } catch (e) { chat = []; }
  function saveChat() { try { localStorage.setItem('kt_coach_chat', JSON.stringify(chat.slice(-12))); } catch (e) {} }

  function chatHtml(pending) {
    var h = '<div class="meta" style="margin-bottom:4px">記録データ（食事・運動・体組成・目標と期限）を根拠に答えます。テーマを選ぶか、自由に聞いてください。</div><div class="chips">' +
      TOPICS.map(function (t) { return '<button class="chip" data-t="' + t[0] + '" data-q="' + esc(t[2]) + '">' + esc(t[1]) + '</button>'; }).join('') + '</div>';
    chat.forEach(function (m) {
      h += '<div class="q">' + esc(m.question) + '</div><div class="a"><div class="tp">' + esc(m.topicLabel) + '・' + esc(m.createdAt || '') + '</div>' + esc(m.answer).replace(/\n/g, '<br>');
      if ((m.points || []).length) h += '<ul>' + m.points.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul>';
      if ((m.nextSteps || []).length) h += '<div class="nx"><b>やること</b><ul>' + m.nextSteps.map(function (x) { return '<li>' + esc(x) + '</li>'; }).join('') + '</ul></div>';
      if (m.dataNote) h += '<div class="meta" style="margin-top:6px">' + esc(m.dataNote) + '</div>';
      h += '</div>';
    });
    var last = chat[chat.length - 1];
    if (!pending && last && (last.followups || []).length) h += '<div class="chips">' + last.followups.map(function (f) { return '<button class="chip" data-t="' + esc(last.topic || 'free') + '" data-q="' + esc(f) + '" data-send="1">' + esc(f) + '</button>'; }).join('') + '</div>';
    if (pending) h += '<div class="q">' + esc(pending) + '</div><div class="a"><div class="busy" style="padding:10px 0">考えています…（10〜30秒）</div></div>';
    h += '<details class="chart"' + (chartOpen ? ' open' : '') + '><summary>カルテ（痛み・既往・避けたい動作）' + (chartText ? '：入力済み' : '：未入力') + '</summary>' +
      '<div class="meta">ここに書いた内容は、診断・相談・AIトレーナーが最優先で守ります（例：右肩にインピンジメント。オーバーヘッドと深いシュラッグは避ける）。</div>' +
      '<textarea id="coachChart" rows="5" maxlength="2000" placeholder="痛む部位、いつから、悪化する動作、避けたい種目、リハビリの経過など">' + esc(chartText) + '</textarea>' +
      '<div style="text-align:right;margin-top:6px"><button class="cx" id="coachChartSave" type="button">カルテを保存</button></div></details>';
    h += '<div class="ask"><textarea id="coachQ" placeholder="例：来月から増量に切り替えるべき？" ' + (busy ? 'disabled' : '') + '>' + esc(draft) + '</textarea><button id="coachSend" ' + (busy ? 'disabled' : '') + '>送信</button></div>';
    if (chat.length) h += '<div style="text-align:right;margin-top:8px"><button class="cx" id="coachClear" type="button">会話を消す</button></div>';
    h += '<div class="warn">記録をもとにした目安で、医療的な診断ではありません。体調不良や痛みが続くときは専門家に相談してください。</div>';
    return h;
  }

  function renderChat(pending, err) {
    show(chatHtml(pending), err);
    var q = $('coachQ'); if (q) q.addEventListener('input', function () { draft = q.value; });
    Array.prototype.forEach.call(root.querySelectorAll('.chip'), function (b) {
      b.addEventListener('click', function () {
        topic = b.getAttribute('data-t'); var text = b.getAttribute('data-q');
        if (b.getAttribute('data-send')) ask(text); else { draft = text; renderChat(); var q2 = $('coachQ'); if (q2) q2.focus(); }
      });
    });
    var sd = $('coachSend'); if (sd) sd.addEventListener('click', function () { ask(draft); });
    var dt = root.querySelector('details.chart'); if (dt) dt.addEventListener('toggle', function () { chartOpen = dt.open; });
    var ct = $('coachChart'); if (ct) ct.addEventListener('input', function () { chartText = ct.value; });
    var cs = $('coachChartSave'); if (cs) cs.addEventListener('click', function () {
      cs.disabled = true; KT.call('coachChartSet', chartText).then(function (r) { chartText = r.text; chartOpen = false; renderChat(null, null); }, function (e) { cs.disabled = false; renderChat(null, (e && e.message) || 'カルテを保存できませんでした'); });
    });
    var cl = $('coachClear'); if (cl) cl.addEventListener('click', function () { chat = []; saveChat(); renderChat(); });
    var bx = root.querySelector('.coachbox'); if (bx && chat.length) bx.scrollTop = bx.scrollHeight;
  }

  function ask(text) {
    text = String(text || '').trim();
    if (busy) return;
    if (text.length < 2) { renderChat(null, '相談したいことを入力するか、テーマを選んでください'); return; }
    busy = true; var sent = text; draft = '';
    renderChat(sent);
    var history = chat.slice(-3).map(function (m) { return { q: m.question, a: m.answer }; });
    KT.call('coachAsk', { topic: topic, question: sent, history: history }).then(function (r) {
      busy = false; chat.push(r); saveChat(); topic = 'free'; if (tab === 'ask') renderChat();
    }).catch(function (e) {
      busy = false; draft = sent; if (tab === 'ask') renderChat(null, (e && e.message) || '相談に失敗しました');
    });
  }

  function setTab(t) {
    tab = t;
    if (t === 'ask' && !chartLoaded) { chartLoaded = true; KT.call('coachChart').then(function (r) { chartText = (r && r.text) || ''; if (tab === 'ask' && !busy) renderChat(); }, function () {}); }
    Array.prototype.forEach.call(root.querySelectorAll('.tabs button'), function (b) { b.className = b.getAttribute('data-tab') === t ? 'on' : ''; });
    if (t === 'ask') renderChat(); else openJudge();
  }

  function open() {
    root.classList.add('on');
    setTab(tab);
  }
  function openJudge() {
    KT.call('coachLast').then(function (c) {
      if (c && c.res && Date.now() - c.t < FRESH_MS) { show(resultHtml(c.res, false) + goBtn('もう一度診断する')); bindGo(); }
      else run();
    });
  }
  function close() { root.classList.remove('on'); }

  function init() {
    css();
    var fab = document.createElement('button'), host = $('aiOpen') ? $('syncChip') : null; // 記録画面：下にタイマー帯があるので、ヘッダー（同期ボタンの前）に置く
    fab.type = 'button'; fab.setAttribute('aria-label', '総合コーチ');
    if (host && host.parentNode) { fab.className = 'aibtn'; fab.innerHTML = '<span class="spark">🧭</span>総合コーチ'; host.parentNode.insertBefore(fab, host); }
    else { fab.className = 'coachfab'; fab.innerHTML = '<span>🧭</span>総合コーチ'; document.body.appendChild(fab); }
    fab.addEventListener('click', open);
    root = document.createElement('div');
    root.className = 'coachov';
    root.innerHTML = '<div class="coachbox" role="dialog" aria-label="総合コーチ"><div class="ch"><h3>総合コーチ</h3><button class="cx" id="coachClose" type="button">閉じる</button></div><div class="tabs"><button type="button" data-tab="judge" class="on">診断</button><button type="button" data-tab="ask" data-tab-ask="1">相談</button></div><div id="coachBody"></div></div>';
    root.addEventListener('click', function (e) { if (e.target === root) close(); });
    document.body.appendChild(root);
    $('coachClose').addEventListener('click', close);
    Array.prototype.forEach.call(root.querySelectorAll('.tabs button'), function (b) { b.addEventListener('click', function () { setTab(b.getAttribute('data-tab')); }); });
  }
  if (document.body) init(); else document.addEventListener('DOMContentLoaded', init);
})();
