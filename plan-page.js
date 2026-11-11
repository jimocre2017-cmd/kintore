/* 減量計画の画面（plan.html）。計算は plan-lib.js、通信は api.js */
var PL = PlanLib;
var $ = function (id) { return document.getElementById(id); };
function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
var tTimer = null;
function toast(msg, err){
  var t = $('toast'); t.textContent = msg; t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(tTimer); tTimer = setTimeout(function(){ t.className = 'toast' + (err ? ' err' : ''); }, 2800);
}
function p2(n){ return ('0'+n).slice(-2); }
function dowLbl(s){ return '日月火水木金土'.charAt((PL.toDays(s)+4)%7); }
function md(s){ var p = s.split('/'); return (+p[1])+'/'+(+p[2]); }
function mdw(s){ return md(s)+'（'+dowLbl(s)+'）'; }
function toInputDate(s){ return s ? s.replace(/\//g,'-') : ''; }
function fromInputDate(s){ return s ? s.replace(/-/g,'/') : ''; }
function f1(x){ return x == null || isNaN(x) ? '－' : Number(x).toFixed(1); }
function f2(x){ return x == null || isNaN(x) ? '－' : Number(x).toFixed(2); }
function sg(x, d){ if (x == null || isNaN(x)) return '－'; var s = Number(x).toFixed(d == null ? 1 : d); return (x > 0 && Number(s) !== 0 ? '+' : '') + s; }
function comma(n){ return n == null || isNaN(n) ? '－' : Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
// 計画より脂肪が多い(+)＝遅れ(赤)、少ない(−)＝先行(緑)
function gapCls(x, band){ if (x == null || Math.abs(x) < (band || 0.001)) return 'mut'; return x > 0 ? 'pos' : 'neg'; }
var STATUS = {
  on_track: ['順調', 'good'], behind: ['遅れ', 'bad'], ahead: ['先行（速め）', 'warn'], learning: ['計測中', ''], insufficient: ['記録不足', 'warn']
};

var S = { body: null, meal: null, plan: null, V: null, ai: null, range: 'all', busy: false, loadErr: null };

function view(){
  if (!S.plan) return null;
  var p = S.plan.plan || {};
  var cfg = { goalFat: p.goalFat || (S.body && S.body.goalFat) || 0, startDate: p.startDate, weeklyLossKg: p.weeklyLossKg, deadline: p.deadline, activity: p.activity };
  return PL.view({
    today: (S.body && S.body.today) || KT.today(), daily: S.body ? S.body.logs : [], meals: S.meal ? S.meal.logs : [],
    plan: cfg, targets: S.plan.targets || [], mealGoalKcal: S.meal && S.meal.goals ? S.meal.goals.kcal : 0
  });
}

function render(){
  if (!S.plan && !S.body) return;
  S.V = view();
  var today = (S.body && S.body.today) || KT.today();
  $('dateLbl').textContent = today.replace(/^(\d+)\/0?(\d+)\/0?(\d+)$/, '$1年$2月$3日')+'（'+dowLbl(today)+'）';
  renderMsg(); renderHero(); renderAdjust(); renderChart(); renderMilestones(); renderDays(); renderWeeks(); renderMonths(); renderSettings();
}

function renderMsg(){
  var h = '', V = S.V;
  if (S.loadErr) h += '<div class="banner">'+esc(S.loadErr)+'</div>';
  if (S.plan && S.plan.offline) h += '<div class="banner info">オフラインです。端末に控えた記録で表示しています（AIの提案と設定の変更はオンラインの時に）。</div>';
  if (V && V.base && V.base.provisional) h += '<div class="banner warn">基準線は暫定です（測定 '+V.base.days+' 日分）。開始日からの7日間のうち3日以上測ると確定に近づき、7日間が過ぎると固定されます。</div>';
  var fl = KT.failed().filter(function(o){ return /^(body|meal)/.test(o.type); });
  if (fl.length) h += '<div class="banner">送信できなかった記録があります（'+fl.length+'件）。右上の同期ボタンから確認できます。</div>';
  $('msg').innerHTML = h;
}

function renderHero(){
  var V = S.V, el = $('heroCard');
  if (!V || !V.configured) {
    var g = (S.plan && S.plan.plan && S.plan.plan.goalFat) || (S.body && S.body.goalFat) || 0;
    el.innerHTML = '<h3>目標に対する現在地</h3><div class="empty" style="padding:8px 0 12px">まだ計画がありません。目標の体脂肪率'+(g?'（'+g+'%）':'')+'と開始日を決めると、日・週・月で計画とのずれが見られます。</div><button class="btn primary" style="width:100%" id="heroSet">計画を設定する</button>';
    $('heroSet').onclick = openSettings; return;
  }
  if (V.noBody || !V.built) { el.innerHTML = '<h3>目標に対する現在地</h3><div class="empty">体組成の記録がまだありません。体組成の画面で測定を記録してください。</div>'; return; }
  var b = V.built, n = V.now, ad = V.adjust, st = STATUS[ad.status] || ['', ''];
  var h = '<h3>目標に対する現在地（直近7日の平均）</h3>';
  if (!n) { el.innerHTML = h + '<div class="empty">直近7日に体組成の測定がありません。測れる時に測ると、ここに現在地が出ます。</div>'; return; }
  var gap = n.gapKg, band = 0.3, pre = PL.toDays(V.today) < PL.toDays(b.startDate);
  var verdict = pre ? '開始前' : (Math.abs(gap) < band ? 'ほぼ計画どおり' : (gap > 0 ? '計画より遅れ' : '計画より先行'));
  h += '<div class="top"><div class="big num">'+f1(n.fat)+'<small>%</small></div><span class="chip '+(pre ? '' : (Math.abs(gap) < band ? 'good' : (gap > 0 ? 'bad' : 'good')))+'">'+verdict+'</span><span class="chip '+st[1]+'">'+st[0]+'</span></div>';
  if (pre) h += '<div style="font-size:14px;margin-top:6px;color:var(--ink-2)">計画は '+mdw(b.startDate)+' から始まります。それまでの数値は基準線の暫定値で、開始後7日間に測った日の平均で確定します。</div>';
  else h += '<div style="font-size:14px;margin-top:6px;color:var(--ink-2)">今日の計画 '+f1(PL.plannedFatPct(b, V.today))+'% ／ ずれ <b class="num '+gapCls(gap, band)+'">'+sg(n.gapPct)+'%（脂肪 '+sg(gap)+'kg）</b></div>';
  var dl = b.deadline.split('/');
  h += '<div class="kv"><div><b class="num">'+f1(n.remainingKg)+'kg</b><span>目標 '+b.goalFat+'% まで落とす脂肪</span></div><div><b class="num">'+dl[0]+'/'+(+dl[1])+'/'+(+dl[2])+'</b><span>予定の到達日</span></div><div><b class="num">'+f2(b.weeklyLossKg)+'kg</b><span>週あたりの計画</span></div></div>';
  h += '<div class="note">体脂肪率は水分や食事で1日に±1%ほど動くため、判断は日ではなく週の平均で行います。測定数は直近7日で '+n.days+' 日分。</div>';
  el.innerHTML = h;
}

function renderAdjust(){
  var V = S.V, el = $('adjustCard');
  if (!V || !V.configured || !V.adjust) { el.style.display = 'none'; return; }
  el.style.display = '';
  var ai = S.ai, ad = ai ? ai.adjust : V.adjust, st = STATUS[ad.status] || ['', ''];
  var from = ai ? ai.effectiveFrom : PL.nextMonday(V.today);
  var h = '<h3>次週のカロリー調整（'+mdw(from)+'から）</h3>';
  if (ad.target) {
    h += '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><div class="big num">'+comma(ad.target)+'<small> kcal／日</small></div><span class="chip '+st[1]+'">'+st[0]+'</span></div>';
    var dl = ad.deltaFromPrevious;
    h += '<div style="font-size:14px;margin-top:6px;color:var(--ink-2)">'+(ad.previousTarget ? '今の目標 '+comma(ad.previousTarget)+'kcal から <b class="num">'+(dl ? sg(dl, 0)+'kcal' : '変更なし')+'</b> ／ ' : '')+'1週間の予算 <b class="num">'+comma(ad.weeklyBudget || ad.target*7)+'kcal</b></div>';
    h += '<div class="kv"><div><b class="num">'+comma(ad.tdee ? ad.tdee.kcal : null)+'</b><span>消費の見込み（'+(ad.tdee && ad.tdee.basis === 'observed' ? '実測' : '基礎代謝×係数の推定')+'）</span></div><div><b class="num">'+(ad.protein ? ad.protein.minG+'〜'+ad.protein.targetG+'g' : '－')+'</b><span>たんぱく質／日</span></div><div><b class="num">'+(ad.expectedLossKgPerWeek != null ? f2(ad.expectedLossKgPerWeek)+'kg' : '－')+'</b><span>この目標での脂肪の減り／週</span></div></div>';
  } else {
    h += '<div><span class="chip '+st[1]+'">'+st[0]+'</span></div>';
  }
  if (ad.reasons && ad.reasons.length) h += '<ul class="reasons">'+ad.reasons.map(function(r){ return '<li>'+esc(r)+'</li>'; }).join('')+'</ul>';
  if (ad.leanWarning) h += '<div class="banner warn" style="margin-top:10px">'+esc(ad.leanWarning)+'</div>';
  if (ad.actual) h += '<div class="note">実績（直近'+ad.actual.spanDays+'日の傾向）：脂肪が週 '+f2(ad.actual.weeklyLossKg)+'kg のペースで減少、平均摂取 '+comma(ad.actual.avgIntake)+'kcal。期間が短いほど誤差は大きくなります。</div>';

  var adv = ai ? ai.advice : (S.plan && S.plan.latest && S.plan.latest.effectiveFrom === from ? S.plan.latest.advice : null);
  if (adv) {
    h += '<div class="adv"><div class="head" style="margin-top:12px">'+esc(adv.headline)+'</div><p style="margin-top:6px">'+esc(adv.summary)+'</p>';
    if (adv.whyTarget) h += '<h4>この目標にした理由</h4><p>'+esc(adv.whyTarget)+'</p>';
    if (adv.actions && adv.actions.length) h += '<h4>来週やること</h4><ul>'+adv.actions.map(function(a){ return '<li><b>'+esc(a.title)+'</b>　'+esc(a.detail)+'</li>'; }).join('')+'</ul>';
    if (adv.foodSwaps && adv.foodSwaps.length) h += '<h4>置き換えの例</h4><ul>'+adv.foodSwaps.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>';
    if (adv.watch && adv.watch.length) h += '<h4>気をつける点</h4><ul>'+adv.watch.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>';
    if (adv.nextCheck) h += '<h4>次の見直しまでに</h4><p>'+esc(adv.nextCheck)+'</p>';
    h += '</div>';
  }
  var adopted = S.plan && (S.plan.targets || []).some(function(t){ return t.from === from; });
  if (ad.target) {
    h += '<div class="apply"><input type="number" id="aKcal" inputmode="numeric" step="10" min="1000" max="4500" value="'+ad.target+'" aria-label="採用する目標kcal"><button class="btn primary" id="aApply"'+(S.busy?' disabled':'')+'>'+(adopted ? '採用済み（上書き）' : 'この目標を採用')+'</button></div>';
    h += '<div class="note">採用すると、'+mdw(from)+'からの目標として履歴に残り、食事画面の目標カロリーにも反映されます。数値は手で直しても構いません。</div>';
  }
  h += '<div class="rowbtns"><button class="btn small" id="aAdvise"'+(S.busy?' disabled':'')+'>'+(S.busy ? '処理中…' : (adv ? 'AIに出し直してもらう' : 'AIに来週の方針を出してもらう'))+'</button></div>';
  if (ai && ai.createdAt) h += '<div class="note">'+esc(ai.createdAt)+' に作成'+(ai.model ? '（'+esc(ai.model)+'）' : '')+'。数値はアプリが計算し、AIは文章にしています。いまの総合診断（期限に間に合うか）は「総合コーチ」、見た目の変化は「体つき写真」で。</div>';
  el.innerHTML = h;
  $('aAdvise').onclick = advise;
  if ($('aApply')) $('aApply').onclick = function(){ apply(from, ad); };
}

function advise(){
  if (S.busy) return;
  S.busy = true; renderAdjust();
  KT.sync().catch(function(){}).then(function(){ return KT.call('planAdvise'); }).then(function(r){
    S.ai = r; S.busy = false; render(); toast('来週の方針を作りました');
  }, function(e){
    S.busy = false; renderAdjust(); toast(e.message, true);
  });
}
function apply(from, ad){
  var kcal = Math.round(Number($('aKcal').value));
  if (!kcal || kcal < 1000 || kcal > 4500) { toast('目標カロリーは1000〜4500で入力してください', true); return; }
  if (S.busy) return;
  S.busy = true; renderAdjust();
  KT.call('planApply', { kcal: kcal, from: from, protein: ad.protein ? ad.protein.targetG : 0 }).then(function(d){
    S.plan = d; S.busy = false;
    if (S.ai && S.ai.effectiveFrom === from) S.ai.adopted = true;
    return KT.call('mealInit').catch(function(){ return S.meal; });
  }).then(function(m){ if (m) S.meal = m; render(); toast('次週の目標を採用しました'); }, function(e){ S.busy = false; renderAdjust(); toast(e.message, true); });
}

/* ---- 推移グラフ：体脂肪率（日平均・7日移動平均）と計画ライン ---- */
function movingAvg(map, ds){
  var d = PL.toDays(ds), v = [];
  for (var i = 0; i < 7; i++) { var x = map[PL.fromDays(d - i)]; if (x && x.fat != null) v.push(x.fat); }
  return v.length >= 2 ? v.reduce(function(a, b){ return a + b; }, 0) / v.length : null;
}

/* ---- 経過目標：開始日から期限までを月末で区切り、各時点の計画値を出す ---- */
function monthEndsOf(b){
  var out = [], st = PL.toDays(b.startDate), dl = PL.toDays(b.deadline);
  var p = b.startDate.split('/'), y = +p[0], m = +p[1];
  for (var i = 0; i < 60; i++) {
    var ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    var last = PL.toDays(ny+'/'+('0'+nm).slice(-2)+'/01') - 1;
    if (last >= dl) break;
    if (last > st) out.push(PL.fromDays(last));
    y = ny; m = nm;
  }
  out.push(b.deadline);
  return out;
}
function planAt(b, date){
  var fm = PL.plannedFatMass(b, date);
  return { date: date, fat: PL.plannedFatPct(b, date), fatMass: fm, weight: b.leanKg + fm, lost: Math.max(0, b.baseFatMass - fm) };
}

function renderChart(){
  var V = S.V, el = $('chartCard');
  if (!V || !V.built) { el.style.display = 'none'; return; }
  el.style.display = '';
  var b = V.built, today = V.today, map = PL.bodyDays(S.body ? S.body.logs : []);
  var h = '<h3>計画ラインと実績（体脂肪率）</h3><div class="tabs" id="rTabs">'+[['30','30日'],['90','90日'],['all','開始〜期限']].map(function(r){ return '<button data-r="'+r[0]+'"'+(r[0]===S.range?' class="on"':'')+'>'+r[1]+'</button>'; }).join('')+'</div>';
  var st = PL.toDays(b.startDate), dl = PL.toDays(b.deadline), t = PL.toDays(today), d0, d1;
  if (S.range === 'all') { d0 = st; d1 = Math.max(dl, t); } else { var n = +S.range; d0 = Math.max(st, t - n + 1); d1 = Math.max(d0 + 6, Math.min(dl, t + 7)); }
  var pts = [], mas = [], lo = 1e9, hi = -1e9, d;
  for (d = d0; d <= Math.min(d1, t); d++) {
    var ds = PL.fromDays(d), x = map[ds];
    if (x && x.fat != null) { pts.push({ d: d, v: x.fat, n: x.count }); lo = Math.min(lo, x.fat); hi = Math.max(hi, x.fat); }
    var m = movingAvg(map, ds); if (m != null) mas.push({ d: d, v: m });
  }
  var planPts = [], step = Math.max(1, Math.round((d1 - d0) / 40));
  for (d = d0; d <= d1; d += step) { planPts.push({ d: d, v: PL.plannedFatPct(b, PL.fromDays(d)) }); }
  planPts.push({ d: d1, v: PL.plannedFatPct(b, PL.fromDays(d1)) });
  planPts.forEach(function(p){ lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); });
  lo = Math.min(lo, b.goalFat); hi = Math.max(hi, b.baseFat);
  var padv = Math.max(0.5, (hi - lo) * 0.1); lo -= padv; hi += padv;
  var W = 640, H = 230, pl = 40, pr = 10, pt = 12, pb = 26, span = Math.max(1, d1 - d0);
  function X(dd){ return pl + (W - pl - pr) * (dd - d0) / span; }
  function Y(v){ return pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo)); }
  var s = '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="体脂肪率の計画と実績">';
  for (var i = 0; i <= 3; i++) { var gv = lo + (hi - lo) * i / 3, gy = Y(gv); s += '<line class="gl" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+gy+'" y2="'+gy+'"/><text x="'+(pl-4)+'" y="'+(gy+3)+'" text-anchor="end">'+gv.toFixed(1)+'</text>'; }
  // 目標の体脂肪率の横線
  if (b.goalFat >= lo && b.goalFat <= hi) { var gy2 = Y(b.goalFat); s += '<line class="goal" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+gy2+'" y2="'+gy2+'"/><text x="'+(pl+4)+'" y="'+(gy2-4)+'" class="goaltx">目標 '+f1(b.goalFat)+'%</text>'; }
  // 月末の経過目標（計画ライン上の印と数値）
  var msAll = monthEndsOf(b).filter(function(ds){ var dd = PL.toDays(ds); return dd >= d0 && dd <= d1; });
  msAll.forEach(function(ds, i){
    var dd = PL.toDays(ds), v = PL.plannedFatPct(b, ds), mx = X(dd), my = Y(v), last = ds === b.deadline;
    s += '<line class="mk" x1="'+mx.toFixed(1)+'" x2="'+mx.toFixed(1)+'" y1="'+pt+'" y2="'+(H-pb)+'"/>'
      + '<circle class="mkdot" cx="'+mx.toFixed(1)+'" cy="'+my.toFixed(1)+'" r="3.5"><title>'+mdw(ds)+' 計画 '+f1(v)+'%</title></circle>'
      + '<text class="mktx" x="'+Math.min(W-pr, mx).toFixed(1)+'" y="'+(my-7).toFixed(1)+'" text-anchor="'+(last || mx > W - 40 ? 'end' : 'middle')+'">'+f1(v)+'</text>'
      + '<text x="'+mx.toFixed(1)+'" y="'+(H-12)+'" text-anchor="'+(last ? 'end' : 'middle')+'" class="mkdate">'+md(ds)+'</text>';
  });
  s += '<path class="plan" d="'+planPts.map(function(p, i){ return (i?'L':'M')+X(p.d).toFixed(1)+' '+Y(p.v).toFixed(1); }).join(' ')+'"/>';
  pts.forEach(function(p){ s += '<circle class="pt" cx="'+X(p.d).toFixed(1)+'" cy="'+Y(p.v).toFixed(1)+'" r="3"><title>'+mdw(PL.fromDays(p.d))+' '+f1(p.v)+'%（'+p.n+'回測定の平均）</title></circle>'; });
  if (mas.length > 1) s += '<path class="ma" d="'+mas.map(function(p, i){ return (i?'L':'M')+X(p.d).toFixed(1)+' '+Y(p.v).toFixed(1); }).join(' ')+'"/>';
  if (t >= d0 && t <= d1) s += '<line class="now" x1="'+X(t)+'" x2="'+X(t)+'" y1="'+pt+'" y2="'+(H-pb)+'"/><text x="'+X(t)+'" y="'+(H-12)+'" text-anchor="'+(t - d0 > span * 0.85 ? 'end' : 'middle')+'">今日</text>';
  s += '<text x="'+pl+'" y="'+(H-2)+'">'+md(PL.fromDays(d0))+'</text><text x="'+(W-pr)+'" y="'+(H-2)+'" text-anchor="end">'+md(PL.fromDays(d1))+'</text></svg>';
  h += s + '<div class="legend"><span><i style="border-color:var(--good);border-top-style:dashed"></i>計画</span><span><i style="border-color:var(--accent)"></i>実績の7日平均</span><span>● 測った日の平均</span><span>◯ 月末の計画値（%）</span></div>';
  if (!pts.length) h += '<div class="note">この期間の測定がまだありません。</div>';
  el.innerHTML = h;
  Array.prototype.forEach.call($('rTabs').querySelectorAll('button'), function(btn){ btn.onclick = function(){ S.range = btn.getAttribute('data-r'); renderChart(); }; });
}


function renderMilestones(){
  var V = S.V, el = $('msCard');
  if (!V || !V.built) { el.style.display = 'none'; return; }
  el.style.display = '';
  var b = V.built, today = V.today, t = PL.toDays(today), n = V.now;
  var months = {}; (V.months || []).forEach(function(r){ months[r.month] = r; });
  var rows = [{ label: '開始（'+md(b.startDate)+'）', date: b.startDate, kind: 'start' }];
  monthEndsOf(b).forEach(function(ds){ rows.push({ label: ds === b.deadline ? 'ゴール（'+md(ds)+'）' : mdw(ds)+'（月末）', date: ds, kind: ds === b.deadline ? 'goal' : 'month' }); });
  var todayRow = { label: '今日（'+mdw(today)+'）', date: today, kind: 'today' };
  var ins = 0; rows.forEach(function(r, i){ if (PL.toDays(r.date) <= t) ins = i + 1; });
  if (t > PL.toDays(b.startDate) && t < PL.toDays(b.deadline)) rows.splice(ins, 0, todayRow);
  var h = '<h3>ゴールまでの経過目標</h3><div class="tblwrap"><table class="tbl" style="min-width:430px"><tr><th>時点</th><th>体脂肪率</th><th>体重</th><th>脂肪量</th><th>ここまでに落とす脂肪</th><th>実績</th></tr>';
  rows.forEach(function(r){
    var a = planAt(b, r.date), act = '<span class="mut">－</span>', dd = PL.toDays(r.date);
    if (r.kind === 'today' && n) act = f1(n.fat)+'%<small>直近7日平均</small>';
    else if (r.kind === 'start') act = f1(b.baseFat)+'%<small>基準</small>';
    else if (dd <= t) { var m = months[PL.monthOf(r.date)]; if (m && m.fat != null) act = f1(m.fat)+'%<small>その月の平均</small>'; }
    h += '<tr'+(r.kind === 'today' ? ' class="cur"' : '')+(r.kind === 'goal' ? ' style="font-weight:700"' : '')+'><td>'+r.label+'</td>'
      + '<td class="num">'+f1(a.fat)+'%</td><td class="num">'+f1(a.weight)+'kg</td><td class="num">'+f1(a.fatMass)+'kg</td>'
      + '<td class="num">'+(a.lost > 0 ? '−'+f1(a.lost)+'kg' : '－')+'</td><td class="num">'+act+'</td></tr>';
  });
  h += '</table></div><div class="note">除脂肪量（'+f1(b.leanKg)+'kg）を維持して、脂肪だけを一定のペース（週'+f2(b.weeklyLossKg)+'kg）で落とす計画です。実績は体組成の記録から。月末の行は、その月の平均と比べてください（ずれは週の平均で判断）。</div>';
  el.innerHTML = h;
}

/* ---- 日・週・月 ---- */
function renderDays(){
  var V = S.V, el = $('dayCard');
  if (!V || !V.days) { el.style.display = 'none'; return; }
  el.style.display = '';
  var h = '<h3>日（直近14日）</h3><div class="tblwrap"><table class="tbl"><tr><th>日付</th><th>体脂肪率</th><th>計画</th><th>ずれ</th><th>摂取kcal</th><th>目標差</th></tr>';
  V.days.forEach(function(r){
    var kc = r.kcal == null ? '－' : comma(r.kcal)+(r.complete ? '' : '<small>記録中</small>');
    var okd = r.kcal != null && r.complete && r.target;
    h += '<tr'+(r.date === V.today ? ' class="today"' : '')+'><td>'+mdw(r.date)+'</td>'
      + '<td class="num">'+(r.body ? f1(r.fat)+'<small>'+r.count+'回</small>' : '<span class="mut">－</span>')+'</td>'
      + '<td class="num">'+(r.active ? f1(r.plannedFat) : '<span class="mut">開始前</span>')+'</td>'
      + '<td class="num '+(r.body && r.active ? gapCls(r.gapPct, 0.05) : 'mut')+'">'+(r.body && r.active ? sg(r.gapPct) : '－')+'</td>'
      + '<td class="num">'+kc+'</td><td class="num '+(okd ? (r.kcal - r.target > 0 ? 'pos' : 'neg') : 'mut')+'">'+(okd ? sg(r.kcal - r.target, 0) : '－')+'</td></tr>';
  });
  h += '</table></div><div class="note">日々の体脂肪率は水分などで±1%ほど動きます。ずれは週の平均で判断してください。食事の「目標差」は、3食以上（または1200kcal以上）記録した日だけ出します。記録の抜けは摂取を少なく見せます。</div>';
  el.innerHTML = h;
}

function renderWeeks(){
  var V = S.V, el = $('weekCard');
  if (!V || !V.weeks) { el.style.display = 'none'; return; }
  el.style.display = '';
  var h = '<h3>週（月曜はじまり）</h3>';
  var cur = V.weeks[V.weeks.length - 1];
  if (cur && cur.target) {
    h += '<div class="budget"><span>今週の予算 <b class="num">'+comma(cur.weekBudget)+'</b>kcal</span><span>使用 <b class="num">'+comma(cur.usedKcal)+'</b></span><span>残り <b class="num '+(cur.remainingKcal < 0 ? 'pos' : '')+'">'+comma(cur.remainingKcal)+'</b>'+(cur.perDayRemaining != null ? '（残り'+cur.remainingDays+'日、1日 <b class="num">'+comma(cur.perDayRemaining)+'</b>）' : '')+'</span></div>';
  }
  h += '<div class="tblwrap" style="margin-top:10px"><table class="tbl"><tr><th>週</th><th>体脂肪率</th><th>計画</th><th>ずれ(kg)</th><th>前週比(kg)</th><th>平均kcal</th><th>目標差</th><th>測/食</th></tr>';
  V.weeks.slice().reverse().forEach(function(r){
    h += '<tr'+(r.current ? ' class="cur"' : '')+'><td>'+md(r.start)+'〜'+(r.current ? '<small>今週</small>' : '')+'</td>'
      + '<td class="num">'+f1(r.fat)+'</td><td class="num">'+f1(r.plannedFat)+'</td>'
      + '<td class="num '+gapCls(r.gapKg, 0.3)+'">'+sg(r.gapKg)+'</td>'
      + '<td class="num '+(r.changeFromPrev != null ? (r.changeFromPrev > 0 ? 'pos' : 'neg') : 'mut')+'">'+sg(r.changeFromPrev)+'</td>'
      + '<td class="num">'+comma(r.avgKcal)+'</td>'
      + '<td class="num '+(r.kcalGap != null ? (r.kcalGap > 0 ? 'pos' : 'neg') : 'mut')+'">'+sg(r.kcalGap, 0)+'</td>'
      + '<td class="num">'+r.bodyDays+'/'+r.mealDays+'</td></tr>';
  });
  h += '</table></div><div class="note">ずれ(kg)は、その週に測った日の脂肪量の平均と、同じ日の計画値の平均との差（＋は計画より脂肪が多い）。前週比は両方の週で2日以上測った時だけ出します。「測/食」は体組成を測った日数／食事の記録が揃った日数。</div>';
  el.innerHTML = h;
}

function renderMonths(){
  var V = S.V, el = $('monthCard');
  if (!V || !V.months) { el.style.display = 'none'; return; }
  el.style.display = '';
  var h = '<h3>月</h3><div class="tblwrap"><table class="tbl" style="min-width:380px"><tr><th>月</th><th>体脂肪率</th><th>計画</th><th>ずれ(kg)</th><th>平均kcal</th><th>測/食</th></tr>';
  V.months.slice().reverse().forEach(function(r){
    h += '<tr><td>'+r.month.replace('/','年')+'月</td><td class="num">'+f1(r.fat)+'</td><td class="num">'+f1(r.plannedFat)+'</td>'
      + '<td class="num '+gapCls(r.gapKg, 0.3)+'">'+sg(r.gapKg)+'</td><td class="num">'+comma(r.avgKcal)+'</td><td class="num">'+r.bodyDays+'/'+r.mealDays+'</td></tr>';
  });
  h += '</table></div><div class="note">月は、開始日以降に測った日・記録が揃った日の平均です。</div>';
  el.innerHTML = h;
}

function renderSettings(){
  var V = S.V, el = $('setCard'), p = S.plan && S.plan.plan ? S.plan.plan : {};
  var h = '<h3>計画の設定</h3>';
  if (V && V.built) {
    var b = V.built;
    h += '<div class="plan-row"><span>目標の体脂肪率</span><b>'+b.goalFat+'%</b></div>'
      + '<div class="plan-row"><span>開始日／期限</span><b>'+b.startDate+' ／ '+b.deadline+'</b></div>'
      + '<div class="plan-row"><span>基準（開始後7日の平均）</span><b>'+f1(b.baseFat)+'%・'+f1(b.baseWeight)+'kg・脂肪'+f1(b.baseFatMass)+'kg</b></div>'
      + '<div class="plan-row"><span>目標体重（除脂肪量を維持）</span><b>'+f1(b.targetWeight)+'kg</b></div>'
      + '<div class="plan-row"><span>落とす脂肪</span><b>'+f1(b.toLoseKg)+'kg（約'+comma(b.toLoseKg * PL.KCAL_PER_KG)+'kcal）</b></div>'
      + '<div class="plan-row"><span>週あたり／1日の赤字</span><b>'+f2(b.weeklyLossKg)+'kg（体重の'+f2(b.weeklyLossPct)+'%）／'+comma(b.deficitKcalPerDay)+'kcal</b></div>';
    if (b.aggressive) h += '<div class="banner warn" style="margin-top:10px">このペースは体重の1%/週を超えています。筋肉が落ちやすいので、期限を延ばすことをおすすめします。</div>';
  }
  h += '<div class="rowbtns"><button class="btn small" id="setBtn">'+(p.startDate ? '設定を変更' : '計画を設定する')+'</button></div>';
  h += '<div class="note">基準線は「開始日からの7日間に測った日」の平均で決まり、7日が過ぎると固定されます。体組成は1日に何回測っても日平均で扱い、測る時間は生活のリズムで構いません（同じ条件で測る日が多いほど、傾向が安定します）。</div>';
  el.innerHTML = h;
  $('setBtn').onclick = openSettings;
}

/* ---- 設定ダイアログ ---- */
function openSettings(){
  var p = (S.plan && S.plan.plan) || {}, g = p.goalFat || (S.body && S.body.goalFat) || 12;
  $('sGoal').value = g;
  $('sStart').value = toInputDate(p.startDate || (S.plan && S.plan.defaultStart) || PL.nextMonday(KT.today()));
  $('sWeekly').value = p.weeklyLossKg || PL.DEFAULTS.weeklyLossKg;
  $('sDeadline').value = toInputDate(p.deadline || '');
  $('sAct').value = p.activity || PL.DEFAULTS.activity;
  $('setModal').classList.add('open');
}
$('sClose').onclick = $('sCancel').onclick = function(){ $('setModal').classList.remove('open'); };
$('sSave').onclick = function(){
  var req = { goalFat: $('sGoal').value, startDate: fromInputDate($('sStart').value), weeklyLossKg: $('sWeekly').value, deadline: fromInputDate($('sDeadline').value), activity: $('sAct').value };
  $('sSave').disabled = true;
  KT.call('planSet', req).then(function(d){
    S.plan = d; S.ai = null; $('sSave').disabled = false; $('setModal').classList.remove('open');
    return KT.call('bodyInit').catch(function(){ return S.body; });
  }).then(function(b){ if (b) S.body = b; render(); toast('計画を保存しました'); }, function(e){ $('sSave').disabled = false; toast(e.message, true); });
};

/* ---- 同期表示・起動 ---- */
KT.onStatus(function(st){
  var c = $('syncChip'); if (!c) return;
  var cls = 'syncchip', txt;
  if (st.failed) { cls += ' err'; txt = '送信失敗 '+st.failed; }
  else if (st.syncing) { cls += ' pend'; txt = '送信中…'; }
  else if (st.pending) { cls += st.online ? ' pend' : ' off'; txt = (st.online ? '未送信 ' : 'オフライン・未送信 ')+st.pending; }
  else if (!st.online) { cls += ' off'; txt = 'オフライン'; }
  else if (st.error) { cls += ' err'; txt = '同期エラー'; }
  else { var t = st.syncedAt ? new Date(st.syncedAt) : null; txt = t ? '同期済 '+t.getHours()+':'+p2(t.getMinutes()) : '同期'; }
  c.className = cls; c.querySelector('span').textContent = txt;
  c.title = st.error ? st.error.message : '';
});
function reloadAll(){
  return Promise.all([KT.call('bodyInit'), KT.call('mealInit'), KT.call('planInit')]).then(function(r){ S.body = r[0]; S.meal = r[1]; S.plan = r[2]; S.loadErr = null; render(); });
}
$('syncChip').addEventListener('click', function(){
  var fl = KT.failed();
  if (fl.length) {
    if (confirm('送信できなかった操作が '+fl.length+' 件あります。\n\n最初のエラー：'+(fl[0].error||'')+'\n\nOK＝もう一度送る ／ キャンセル＝そのまま')) KT.retryFailed();
    return;
  }
  KT.sync().then(reloadAll).then(function(){ toast('同期しました'); }, function(e){
    toast(e.offline ? 'オフラインです。つながったら自動で送信します' : '同期できませんでした：'+e.message, !e.offline);
  });
});
KT.onUpdate(function(){
  Promise.all([KT.call('bodyCached'), KT.call('mealCached')]).then(function(r){ if (r[0]) S.body = r[0]; if (r[1]) S.meal = r[1]; render(); });
});

function showSetup(msg){
  $('app').innerHTML = '<div class="setup card"><h3 style="margin-top:0">アプリ版の設定が必要です</h3>'+(msg?'<p style="color:var(--danger)">'+esc(msg)+'</p>':'')
    + '<p>先に筋トレ記録の画面で設定を済ませてください。</p><p><a class="navlink" href="index.html">筋トレ記録を開く</a></p></div>';
}
// 古い api.js が端末に残っていると「不明な操作：planInit」になる。保存済みの画面ファイルを消して1回だけ読み込み直す
function healStaleCache(e){
  if (!e || !/^不明な操作：plan(Init|Cached|Set|Advise|Apply)$/.test(e.message)) return false;
  try { if (sessionStorage.getItem('kt_heal_plan')) return false; sessionStorage.setItem('kt_heal_plan', '1'); } catch (x) { return false; }
  var done = function(){ location.reload(); };
  if (window.caches && caches.keys) caches.keys().then(function(ks){ return Promise.all(ks.map(function(k){ return caches.delete(k); })); }).then(done, done);
  else done();
  return true;
}
function init(){
  if (!KT.configured()) { showSetup(); return; }
  Promise.all([KT.call('bodyCached'), KT.call('mealCached'), KT.call('planCached')]).then(function(r){
    if (r[0]) S.body = r[0]; if (r[1]) S.meal = r[1]; if (r[2]) S.plan = r[2];
    if (S.body && S.plan) render();
  }, function(e){ healStaleCache(e); });
  reloadAll().catch(function(e){
    if (healStaleCache(e)) return;
    if (e.auth) { KT.clearConfig(); showSetup('合言葉が一致しません。設定をやり直してください。'); return; }
    var hint = /^不明な操作：plan(Get|Init)$/.test(e.message) ? '（サーバー側の更新が必要です：gas/README.md の「減量計画の導入手順」を実行してください）' : '';
    S.loadErr = '読み込みに失敗しました：' + e.message + hint;
    if (!S.body) S.body = { today: KT.today(), entries: [], logs: [], goalFat: 0 };
    if (!S.plan) S.plan = { today: KT.today(), plan: {}, targets: [], latest: null, defaultStart: PL.nextMonday(KT.today()) };
    render();
  });
}
init();
