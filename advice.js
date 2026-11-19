/* 数値に応じた助言のポップアップ（アプリを開いたとき・体組成を記録したとき）。AIは使わない。
 * 判定は roadmap-lib.js の RoadmapLib.advice。同じ助言は1日1回まで。「記録だけのモード」にすると一切出さない。 */
(function () {
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  var OFF = 'kt_adv_off', SEEN = 'kt_adv_seen';
  function pad(n) { return ('0' + n).slice(-2); }
  function todayStr() { var d = new Date(); return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function isOff() { return !!LS.get(OFF, false); }
  function setOff(v) { LS.set(OFF, !!v); }

  // 端末に保存してある体組成（未送信分を含む）から、日ごとの平均の体脂肪率
  function dailyFat() {
    var b = LS.get('kt_body', null) || {}, list = (b.entries || b.logs || []).slice(), q = LS.get('kt_queue', []) || [], by = {}, out = [];
    q.forEach(function (op) { if (op && op.type === 'bodySave' && op.entry) list.push(op.entry); });
    list.forEach(function (e) { if (e && e.date && e.fat != null && e.fat !== '' && !isNaN(Number(e.fat))) (by[e.date] = by[e.date] || []).push(Number(e.fat)); });
    Object.keys(by).forEach(function (d) { out.push({ date: d, fat: by[d].reduce(function (a, c) { return a + c; }, 0) / by[d].length }); });
    return out;
  }
  function compute() {
    if (typeof RoadmapLib === 'undefined') return [];
    var pl = ((LS.get('kt_plan', null) || {}).plan) || {}, today = todayStr();
    return RoadmapLib.advice({ date: today, fat7: RoadmapLib.fat7(dailyFat(), today), decision: pl.roadmapDecision || '', planPhase: pl.phase, floorFat: pl.floorFat });
  }

  var box = null;
  function close() { if (box && box.parentNode) box.parentNode.removeChild(box); box = null; }
  function show(list, force) {
    if (box || !list.length) return;
    var seen = LS.get(SEEN, {}), t = todayStr();
    var fresh = force ? list : list.filter(function (a) { return seen[a.key] !== t; });
    if (!fresh.length) return;
    var onPlan = /plan\.html/.test(location.pathname);
    var st = document.createElement('style');
    st.textContent = '.ktadv{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.45);display:flex;align-items:flex-end;justify-content:center;padding:0}'
      + '.ktadv .bx{background:var(--surface,#fff);color:var(--ink,#141413);width:min(560px,100%);max-height:80vh;overflow:auto;border-radius:16px 16px 0 0;padding:16px 16px 20px;line-height:1.7;font-family:inherit}'
      + '@media(min-width:700px){.ktadv{align-items:center}.ktadv .bx{border-radius:16px}}'
      + '.ktadv h3{margin:0 0 6px;font-size:16px}.ktadv .it{border-top:1px solid var(--line,#e2e1dc);padding:10px 0}.ktadv .it:first-of-type{border-top:0}'
      + '.ktadv .it b{display:block;font-size:15px}.ktadv .it.warn b{color:var(--warn,#b26b00)}.ktadv .it p{margin:4px 0 0;font-size:14px;color:var(--ink,#141413)}'
      + '.ktadv .bt{display:flex;flex-wrap:wrap;gap:8px;margin-top:12px}.ktadv button{font:inherit;font-size:14px;font-weight:700;border-radius:12px;padding:10px 14px;cursor:pointer;border:1px solid var(--line,#e2e1dc);background:var(--surface-2,#f0efec);color:var(--ink,#141413)}'
      + '.ktadv button.pri{background:var(--accent,#2a78d6);border-color:var(--accent,#2a78d6);color:var(--accent-ink,#fff)}.ktadv .sm{font-size:12px;color:var(--ink-2,#55544f);margin-top:8px}';
    box = document.createElement('div'); box.className = 'ktadv';
    box.innerHTML = '<div class="bx" role="dialog" aria-label="助言"><h3>💬 いまの数値からの助言</h3>'
      + fresh.map(function (a) { return '<div class="it ' + esc(a.level) + '"><b>' + esc(a.title) + '</b><p>' + esc(a.body) + '</p></div>'; }).join('')
      + '<div class="bt"><button type="button" class="pri" data-a="go">' + (onPlan ? 'マスタープランで切り替える' : '減量計画を開く') + '</button><button type="button" data-a="ok">今日はもう出さない</button><button type="button" data-a="later">あとで</button></div>'
      + '<div class="sm">うるさいときは <button type="button" data-a="off" style="padding:4px 8px;font-size:12px">記録だけのモードにする</button>（ポップアップを出しません。「？ 使い方」でいつでも戻せます）</div></div>';
    box.appendChild(st); document.body.appendChild(box);
    function mark() { var s = LS.get(SEEN, {}); fresh.forEach(function (a) { s[a.key] = t; }); LS.set(SEEN, s); }
    box.addEventListener('click', function (e) {
      var a = e.target && e.target.getAttribute && e.target.getAttribute('data-a');
      if (e.target === box) { close(); return; }
      if (!a) return;
      if (a === 'go') { mark(); close(); if (onPlan) { var c = document.getElementById('roadmapCard'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'start' }); } else location.href = 'plan.html'; }
      else if (a === 'ok') { mark(); close(); }
      else if (a === 'later') close();
      else if (a === 'off') { setOff(true); close(); }
    });
  }
  // force＝体組成を記録した直後など。1日1回の制限を外す（「記録だけのモード」のときは出さない）
  function check(force) { if (isOff()) return; try { show(compute(), !!force); } catch (e) {} }
  window.KTAdvice = { check: check, isOff: isOff, setOff: setOff, compute: compute };
  window.addEventListener('load', function () { setTimeout(function () { check(false); }, 1200); });
})();
