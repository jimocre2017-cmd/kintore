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
  on_track: ['順調', 'good'], behind: ['遅れ', 'bad'], ahead: ['先行（速め）', 'warn'], learning: ['計測中', ''], insufficient: ['記録不足', 'warn'],
  paused: ['休止中（維持カロリー）', ''], maintaining: ['維持：許容帯の中', 'good'], below_floor: ['最低ライン割れ', 'bad'], above_band: ['許容帯の上', 'warn'], floor_reached: ['最低ラインに到達', 'good'],
  bulk_ok: ['増量：順調', 'good'], bulk_fast: ['増え方が速い', 'warn'], bulk_slow: ['増え方が遅い', 'warn']
};

var S = { body: null, meal: null, plan: null, V: null, ai: null, range: 'all', busy: false, loadErr: null };

function view(){
  if (!S.plan) return null;
  var p = S.plan.plan || {};
  var cfg = { goalFat: p.goalFat || (S.body && S.body.goalFat) || 0, startDate: p.startDate, weeklyLossKg: p.weeklyLossKg, deadline: p.deadline, activity: p.activity, activityCal: p.activityCal, shape: p.shape, pauses: p.pauses, phase: p.phase, floorFat: p.floorFat, roadmap: RoadmapLib.adjustCfg(p.roadmapDecision, p.phase, null, rmState(), rmEnergyStored()) };
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
  renderMsg(); renderHero(); renderRoadmap(); renderAdjust(); renderChart(); renderMilestones(); renderDays(); renderWeeks(); renderMonths(); renderSettings();
}

/* ---- マスタープラン（2段階リコンプ＆リーンバルク）：いまの期・目標との差・食事の平均・食事目標への反映 ---- */
function rmState(){
  // 全画面共通の「今の体」：体重＝最新、体脂肪率＝直近7日平均（無ければ最新）。Apps Script（planBodyNow_・総合コーチ・食事の目標）と同じ RoadmapLib.bodyState
  return RoadmapLib.bodyState((S.body && S.body.logs) || [], (S.body && S.body.today) || KT.today());
}
function rmMealAvg(today){
  if (!S.meal || !S.meal.logs) return null;
  var from = PL.addDays(today, -6), days = PL.mealDays(S.meal.logs.filter(function(l){ return l.date >= from && l.date <= today; })), ks = Object.keys(days).filter(function(k){ return days[k].complete; });
  if (!ks.length) return null;
  function avg(f){ return ks.reduce(function(a, k){ return a + days[k][f]; }, 0) / ks.length; }
  return { kcal: avg('kcal'), protein: avg('protein'), fat: avg('fat'), carbs: avg('carbs'), days: ks.length };
}
function rmRange(r, u){ return r ? r.min + '〜' + r.max + (u || '') : '－'; }
function rmCtx(today){
  var pl = (S.plan && S.plan.plan) || {};
  return { fat7: RoadmapLib.fat7((S.body && S.body.logs) || [], today), decision: pl.roadmapDecision || '' };
}
function rmFfmiRow(goal, st){
  var logs = (S.body && S.body.logs) || [], ht = 0, i, now = null;
  var hd = ''; for (i = 0; i < logs.length; i++) if (logs[i].height && logs[i].date > hd) { ht = logs[i].height; hd = logs[i].date; }
  if (typeof FfmiLib !== 'undefined' && ht && st && st.weightKg != null && st.fatPct != null) { var v = FfmiLib.ffmi(st.weightKg, st.fatPct, ht); if (v != null) now = FfmiLib.r1(FfmiLib.normalized(v, ht)); }
  return '<div class="note" style="margin:6px 0 0">参考：いまの補正後FFMI <b class="num">'+(now == null ? '－' : f1(now))+'</b> → '+f1(goal)+'（除脂肪量の目標と対になる指標。体組成計の推定値なので目安です）</div>';
}
function renderRoadmap(){
  var el = $('roadmapCard'); if (!el || typeof RoadmapLib === 'undefined') return;
  var RM = RoadmapLib.ROADMAP, today = (S.body && S.body.today) || KT.today(), ctx = rmCtx(today), R = RoadmapLib.resolve(today, ctx);
  var st = rmState(), avg = rmMealAvg(today), h = '<div class="rm"><h3>マスタープラン　'+esc(RM.title)+'<button type="button" class="tlink" data-term="diff">ⓘ 違いと意味</button></h3>';
  var first = RM.phases[0], f7 = ctx.fat7;
  h += '<div class="note" style="margin:0 0 4px">切り替えの条件：体脂肪率の直近7日平均が '+first.targets.fatPct+'% に届いたら、第2期へ進むか据え置くかを選びます（日付では自動で切り替わりません）。'+(f7 ? '　いまの直近7日平均：<b class="num">'+f1(f7.avg)+'%</b>（'+f7.days+'日分）' : '　直近7日の測定が3日未満のため、まだ判定できません。')+'</div>';
  var modeKey = R.decision === 'maintain' ? 'maintain' : R.decision === 'advance' ? 'advance' : 'first', dis = S.rmBusy ? ' disabled' : '', rec = !!(window.KTAdvice && KTAdvice.isOff());
  var modeName = { first: '第1期（減量）', advance: '第2期 バルク', maintain: '第2期 維持' }[modeKey];
  h += '<div class="modesw"><div class="note" style="margin:8px 0 4px"><b>いまのモード</b>（押すとすぐ切り替わります。「記録だけ」は助言・判定を止めて記録に集中するモードで、直前の道は覚えています）</div><div class="seg">'
    + '<button type="button" class="'+(rec ? 'on' : '')+'" id="rmGoRec"'+dis+'>記録だけ<small>助言なし</small></button>'
    + '<button type="button" class="'+(!rec && modeKey === 'first' ? 'on' : '')+'" id="rmGo1"'+dis+'>第1期<small>減量</small></button>'
    + '<button type="button" class="'+(!rec && modeKey === 'advance' ? 'on' : '')+'" id="rmGoBulk"'+dis+'>第2期<small>バルク</small></button>'
    + '<button type="button" class="'+(!rec && modeKey === 'maintain' ? 'on' : '')+'" id="rmGoMaint"'+dis+'>第2期<small>維持</small></button></div></div>';
  if (rec) {
    h += '<div class="banner" style="margin-top:10px">記録だけのモードです（助言のポップアップ・切り替えの案内・今週の判定は止めています）。直前の道は「'+modeName+'」。上のボタンで、いつでも戻せます。</div>';
  } else if (R.needChoice) {
    h += '<div class="banner info" style="margin-top:10px"><b>体脂肪率 '+first.targets.fatPct+'% に到達しました（直近7日平均 '+f1(f7.avg)+'%）。次を選んでください。</b>'
      + '<div class="rowbtns"><button class="btn primary" id="rmAdvance"'+(S.rmBusy ? ' disabled' : '')+'>第2期（リーンバルク）へ進む</button><button class="btn" id="rmMaintain"'+(S.rmBusy ? ' disabled' : '')+'>維持期（現状維持）にする</button><button class="btn" id="rmHold"'+(S.rmBusy ? ' disabled' : '')+'>いまのプランを据え置く</button></div>'
      + '<div class="note">リーンバルク＝筋肉を増やすために少し多めに食べる道／維持期＝いまの体を保つ道（食事は維持カロリー）／据え置き＝第1期の食事（消費の75〜90%）のままなので減量の赤字が続きます。いつでも選び直せます。</div></div>';
  } else if (R.decision === 'hold') {
    h += '<div class="banner warn" style="margin-top:10px">いまのプラン（第1期）を据え置いています。<div class="rowbtns"><button class="btn small primary" id="rmAdvance"'+(S.rmBusy ? ' disabled' : '')+'>第2期へ進む</button></div></div>';
  } else if (R.decision === 'maintain') {
    var pl0 = (S.plan && S.plan.plan) || {};
    h += '<div class="banner info" style="margin-top:10px">維持期（現状維持）を選んでいます。'+(pl0.phase === 'maintain' ? '減量計画も維持期の設定です。' : '減量計画はまだ減量期の設定です。下のボタンで維持期に切り替えると、食事のカロリーが維持カロリーになります。')
      + '<div class="rowbtns">'+(pl0.phase === 'maintain' ? '' : '<button class="btn small primary" id="rmMaintPlan"'+(S.rmBusy ? ' disabled' : '')+'>減量計画を維持期にする（最低 '+first.targets.fatPct+'%）</button>')+'</div></div>';
  } else if (R.decision === 'advance') {
    h += '<div class="banner info" style="margin-top:10px">第2期（リーンバルク）に進んでいます。</div>';
  } else if (R.overdue) {
    h += '<div class="banner warn" style="margin-top:10px">第1期の期限（'+md(first.to)+'）を過ぎましたが、体脂肪率 '+first.targets.fatPct+'% にはまだ届いていません。期限の見直しは総合コーチに相談できます。</div>';
  }
  var enNow = rmEnergy();
  var stNow = rmState();
  RM.phases.concat(RM.maintainPhase ? [RM.maintainPhase] : []).map(function(p){ return RoadmapLib.effective(p, enNow, stNow); }).forEach(function(p, i){
    var now = R.phase.key === p.key;
    h += '<div class="ph'+(now ? ' now' : '')+'"><h4>'+esc(p.label)+'<button type="button" class="tlink" data-term="'+esc(p.key)+'" aria-label="'+esc(p.label)+'とは">ⓘ</button>'+(now ? '<span class="chip good">いま</span>' : '')+'<span class="mut" style="font-size:12px;font-weight:600">'+(p.key === 'maintain' ? '第1期のあと、選んだとき' : i === 0 ? md(p.from)+'〜'+md(p.to) : '15%到達後（目安 '+md(p.from)+'〜'+md(p.to)+'頃）')+'</span></h4>';
    h += '<div class="kvs"><div>カロリー<b class="num">'+(p.kcal ? rmRange(p.kcal) : '維持カロリー')+'</b>'+(p.dynamic ? '<small class="mut" style="display:block;font-size:11px">消費 '+comma(p.dynamic.energyKcal)+'kcal（'+(p.dynamic.basis === 'observed' ? '実測' : '推定')+'）の'+esc(RoadmapLib.kcalRuleText(p).replace('消費の', ''))+(p.dynamic.floored ? '・下限は基礎代謝' : '')+'</small>' : (p.kcalFromEnergy ? '<small class="mut" style="display:block;font-size:11px">消費が分かるまでの控え</small>' : ''))+'</div>'
      + '<div>'+(p.carbs ? '炭水化物<b class="num">'+rmRange(p.carbs, 'g')+'</b>' : 'たんぱく質<b class="num">'+rmRange(p.protein, 'g')+'</b>'+(p.dynamicProtein ? '<small class="mut" style="display:block;font-size:11px">除脂肪量 '+p.dynamicProtein.leanKg+'kg×'+p.proteinPerLean.min+'〜'+p.proteinPerLean.max+'g</small>' : ''))+'</div>'
      + '<div>'+(p.fat ? '脂質<b class="num">'+rmRange(p.fat, 'g')+'</b>' : '有酸素<b class="num">週'+rmRange(p.cardio.perWeek, '回')+'</b>')+'</div></div>';
    h += '<ul>'+p.training.map(function(x){ return '<li>'+esc(x)+'</li>'; }).join('')+'</ul>';
    if (p.targets && p.targets.ffmiAdj) h += rmFfmiRow(p.targets.ffmiAdj, st);
    if (now) {
      var pr = RoadmapLib.progress(p, st), mc = RoadmapLib.mealCheck(p, avg);
      if (pr.length) h += '<div style="margin-top:8px">'+pr.map(function(x){ return '<div class="row"><span>'+esc(x.label)+'</span><span class="num">'+(x.now == null ? '－' : f1(x.now))+' → '+f1(x.goal)+x.unit+(x.gap == null ? '' : '（あと '+sg(x.gap)+(x.reached ? '・到達' : '')+'）')+'</span></div>'; }).join('')+'</div>';
      if (mc.length) h += '<div style="margin-top:8px"><div class="note" style="margin:0 0 2px">直近7日の食事の平均（記録が揃った'+avg.days+'日分）</div>'+mc.map(function(x){ return '<div class="row"><span>'+esc(x.label)+'</span><span class="num '+(x.state === 'in' ? 'neg' : 'pos')+'">'+f1(x.avg)+x.unit+'（'+x.min+'〜'+x.max+'：'+(x.state === 'in' ? '範囲内' : x.state === 'under' ? '少ない' : '多い')+'）</span></div>'; }).join('')+'</div>';
      var bl = RoadmapLib.balance(p, { meal: avg, sets: S.plan ? S.plan.sets7 : null, cardio: S.cardioC ? RoadmapLib.cardioCheck(p, S.cardioC.logs || [], today) : null });
      if (!rec && bl.items.length) {
        h += '<div style="margin-top:12px"><div class="note" style="margin:0 0 4px"><b>今週のバランス</b>（直近7日。やり過ぎ・やらな過ぎの判定）　'+(bl.under ? '足りない '+bl.under+'　' : '')+(bl.over ? 'やり過ぎ '+bl.over+'　' : '')+(!bl.under && !bl.over && !bl.nodata ? 'すべてちょうど' : '')+'</div>'
          + bl.items.map(function(x){
            var lab = x.state === 'in' ? 'ちょうど' : x.state === 'under' ? '足りない' : x.state === 'over' ? 'やり過ぎ' : '記録なし';
            var cls = x.state === 'in' ? 'good' : x.state === 'nodata' ? '' : (x.state === 'over' ? 'bad' : 'warn');
            var rng = x.min != null ? '（'+x.min+'〜'+x.max+x.unit+(x.key === 'chest' || x.key === 'legs' ? '、上限の+20%まで可' : '')+'）' : '';
            return '<div class="row" style="flex-wrap:wrap"><span>'+esc(x.label)+'</span><span class="num">'+(x.value == null ? '－' : f1(x.value)+x.unit)+rng+' <span class="chip '+cls+'">'+lab+'</span></span>'+(x.advice ? '<div class="note" style="width:100%;margin:2px 0 4px">'+esc(x.advice)+'</div>' : '')+'</div>';
          }).join('')+'</div>';
      }
      h += '<div class="rowbtns"><button class="btn small primary" id="rmApply"'+(S.rmBusy ? ' disabled' : '')+'>食事の目標を自動（この期）にする</button></div><div class="note">食事画面の目標を、体組成とマスタープランから毎日自動で計算する設定にします（手入力にしていた場合）。期を切り替えると自動で追従します。</div>';
    }
    h += '</div>';
  });
  h += rmCheckHtml(today);
  h += '<h3 style="margin-top:14px">今日からの実践ルール</h3><ul>'+RM.rules.map(function(x){ return '<li style="font-size:13px;line-height:1.7;color:var(--ink-2)">'+esc(x)+'</li>'; }).join('')+'</ul></div>';
  el.innerHTML = h;
  var b = $('rmApply'); if (b) b.onclick = rmApply;
  var a = $('rmAdvance'); if (a) a.onclick = function(){ rmDecide('advance'); };
  var m = $('rmMaintain'); if (m) m.onclick = function(){ rmDecide('maintain'); };
  var mp = $('rmMaintPlan'); if (mp) mp.onclick = rmMaintPlan;
  var o = $('rmHold'); if (o) o.onclick = function(){ rmDecide('hold'); };
  var k = $('rmBack'); if (k) k.onclick = function(){ rmDecide(''); };
  function pick(key, val){ var was = rec; if (window.KTAdvice) KTAdvice.setOff(false); if (modeKey === key) { if (was) renderRoadmap(); return; } rmDecide(val); }
  var gr = $('rmGoRec'); if (gr) gr.onclick = function(){ if (window.KTAdvice) { KTAdvice.setOff(true); renderRoadmap(); toast('記録だけのモードにしました'); } };
  var g1 = $('rmGo1'); if (g1) g1.onclick = function(){ pick('first', ''); };
  var gb = $('rmGoBulk'); if (gb) gb.onclick = function(){ pick('advance', 'advance'); };
  var gm = $('rmGoMaint'); if (gm) gm.onclick = function(){ pick('maintain', 'maintain'); };
}
// 計画の点検：記録（消費カロリーの見込み・体組成）とマスタープランの数値が噛み合っているか（RoadmapLib.planCheck。AIは使わない）
// 消費の見込み（計算の前に使う版）：減量計画の直近の結果（実測ならそれ）→ 基礎代謝×係数。Apps Script の planEnergy_ と同じ順
function rmEnergyStored(){
  var lt = S.plan && S.plan.latest, t = lt && lt.adjust && lt.adjust.tdee;
  var logs = (S.body && S.body.logs) || [], bmr = null, i, p = (S.plan && S.plan.plan) || {};
  for (i = 0; i < logs.length && bmr == null; i++) if (logs[i].bmr != null) bmr = logs[i].bmr;
  if (t && t.basis === 'observed' && t.kcal > 0) return RoadmapLib.energy({ tdeeKcal: t.kcal, tdeeBasis: 'observed', bmr: bmr });
  return RoadmapLib.energy({ bmr: bmr, activity: p.activityCal || p.activity });
}
function rmEnergy(){
  var V = S.V || view(), t = V && V.adjust && V.adjust.tdee;
  var logs = (S.body && S.body.logs) || [], bmr = null, i;
  for (i = 0; i < logs.length && bmr == null; i++) if (logs[i].bmr != null) bmr = logs[i].bmr;
  if (t && t.kcal > 0) return { kcal: t.kcal, basis: t.basis === 'observed' ? 'observed' : 'estimated', activity: t.activity, bmr: bmr || undefined };
  var p = (S.plan && S.plan.plan) || {};
  return RoadmapLib.energy({ bmr: bmr, activity: p.activityCal || p.activity });
}
function rmCheckHtml(today){
  var p = (S.plan && S.plan.plan) || {}, en = rmEnergy();
  var items = RoadmapLib.planCheck({ date: today, decision: p.roadmapDecision, planPhase: p.phase, energy: en, state: rmState() });
  if (!items.length) return '';
  var lv = { ok: ['good', '問題なし'], info: ['', '参考'], warn: ['warn', '要確認'] };
  return '<h3 style="margin-top:14px">計画の点検</h3><div class="note" style="margin:0 0 4px">記録から出した消費の見込み '+(en ? comma(en.kcal)+'kcal（'+(en.basis === 'observed' ? '実測' : '基礎代謝×'+en.activity)+'）' : '－')+' と、マスタープランの数値を突き合わせた結果です。範囲を変えるかどうかは自分で決めます。</div>'
    + items.map(function(x){ var c = lv[x.level] || lv.info; return '<div class="ph" style="margin-top:6px"><h4 style="font-size:14px">'+esc(x.title)+'<span class="chip '+c[0]+'">'+c[1]+'</span></h4><div class="note" style="margin:0">'+esc(x.body)+'</div></div>'; }).join('');
}
function rmDecide(d){
  if (S.rmBusy) return;
  S.rmBusy = true; renderRoadmap();
  KT.call('roadmapSet', d).then(function(r){ S.plan = r; S.rmBusy = false; render(); toast(d === 'advance' ? '第2期に進みました。食事の目標も自動で第2期に切り替わります（自動計算のとき）' : d === 'maintain' ? '維持期（現状維持）を選びました。「減量計画を維持期にする」で食事も維持カロリーに切り替わります' : d === 'hold' ? 'いまのプランを据え置きにしました' : '第1期に戻しました'); },
    function(e){ S.rmBusy = false; renderRoadmap(); toast(e.message, true); });
}
// 減量計画の「いまの局面」を維持期にする（最低体脂肪率＝第1期の目標）。ほかの設定はそのまま
function rmMaintPlan(){
  if (S.rmBusy) return;
  var p = (S.plan && S.plan.plan) || {}, fl = RoadmapLib.ROADMAP.phases[0].targets.fatPct;
  var req = { goalFat: p.goalFat, startDate: p.startDate, weeklyLossKg: p.weeklyLossKg, deadline: p.deadline, activity: p.activity, shape: p.shape, phase: 'maintain', floorFat: p.floorFat || fl };
  S.rmBusy = true; renderRoadmap();
  KT.call('planSet', req).then(function(d){ S.plan = d; S.ai = null; return KT.call('bodyInit').catch(function(){ return S.body; }); })
    .then(function(b){ if (b) S.body = b; S.rmBusy = false; render(); toast('減量計画を維持期にしました（最低 '+(req.floorFat)+'%）'); },
      function(e){ S.rmBusy = false; renderRoadmap(); toast(e.message, true); });
}
function rmApply(){
  // 食事の目標を「自動」（体組成とマスタープランから毎日計算）に戻す。期を切り替えると自動で追従する
  if (S.rmBusy) return;
  S.rmBusy = true; renderRoadmap();
  KT.call('mealSetGoals', { auto: true }).then(function(){ S.rmBusy = false; return KT.call('mealInit').catch(function(){ return S.meal; }); }).then(function(m){ if (m) S.meal = m; render(); toast('食事の目標を自動（この期の範囲）にしました'); }, function(e){ S.rmBusy = false; renderRoadmap(); toast(e.message, true); });
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

// 「開始 → 現在 → 目標」の3列。開始は計画の基準（開始後7日の平均で確定）、目標は目標体脂肪率に達したときの体重・脂肪量（除脂肪量は変わらない前提）
// 追加の指標（骨格筋率・内臓脂肪レベル・FFMI）。体組成の日ごとの平均から、開始（開始日から7日）／現在（直近7日）／FFMIの開始以降の平均を出す
function bodyExtra(b){
  var logs = (S.body && S.body.logs) || [], today = (S.body && S.body.today) || KT.today(), ht = 0, hd = '', i;
  for (i = 0; i < logs.length; i++) if (logs[i].height && logs[i].date > hd) { ht = logs[i].height; hd = logs[i].date; }
  function inRange(from, to){ return logs.filter(function(l){ return l.date >= from && l.date <= to; }); }
  function mean(list, f){ var v = list.map(function(x){ return x[f]; }).filter(function(x){ return x != null; }); return v.length ? v.reduce(function(a, c){ return a + c; }, 0) / v.length : null; }
  var s0 = b.startDate, base = inRange(s0, PL.addDays(s0, 6)), now = inRange(PL.addDays(today, -6), today);
  if (!base.length) base = logs.filter(function(l){ return l.date >= s0; }).slice(0, 7);
  function nf(w, f){ if (typeof FfmiLib === 'undefined' || !ht || w == null || f == null) return null; var v = FfmiLib.ffmi(w, f, ht); return v == null ? null : FfmiLib.r1(FfmiLib.normalized(v, ht)); }
  var since = logs.filter(function(l){ return l.date >= s0 && l.weight != null && l.fat != null; }).map(function(l){ return nf(l.weight, l.fat); }).filter(function(x){ return x != null; });
  return { height: ht, muscle: [mean(base, 'muscle'), mean(now, 'muscle')], visceral: [mean(base, 'visceral'), mean(now, 'visceral')], ffmiBase: nf(b.baseWeight, b.baseFat), ffmiGoal: nf(b.targetWeight, b.goalFat), ffmiNow: null, ffmiAvg: since.length ? FfmiLib.r1(since.reduce(function(a, c){ return a + c; }, 0) / since.length) : null, ffmiDays: since.length, nf: nf };
}
// 数値の背景に敷く折れ線グラフ：横＝開始〜目標日、縦＝進み具合 0〜100%（脂肪の量で）。太線＝実績の7日平均、細線＝日々の実測、点線＝計画。数値の読みを邪魔しない薄さにしている
function chartBg(b, n){
  if (b.baseFatMass == null || !(b.baseFatMass > b.targetFatMass) || !b.deadline) return '';
  var tot = b.baseFatMass - b.targetFatMass, s0 = PL.toDays(b.startDate), e0 = PL.toDays(b.deadline), today = (S.body && S.body.today) || KT.today(), t0 = PL.toDays(today);
  var span = Math.max(e0, t0) - s0; if (!(span > 0)) return '';
  var X = function(d){ return Math.max(0, Math.min(100, (d - s0) / span * 100)); }, Y = function(p){ return 100 - Math.max(0, Math.min(100, p)); };
  var plan = [], i, steps = 24;
  for (i = 0; i <= steps; i++) { var d = s0 + (e0 - s0) * i / steps, fm = PL.plannedFatMass(b, PL.fromDays(Math.round(d))); if (fm != null && !isNaN(fm)) plan.push(X(d).toFixed(2)+','+Y((b.baseFatMass - fm) / tot * 100).toFixed(2)); }
  var logs = ((S.body && S.body.logs) || []).filter(function(l){ return l.date >= b.startDate && l.weight != null && l.fat != null; }).sort(function(a, c){ return a.date < c.date ? -1 : 1; });
  var act = logs.map(function(l){ return { x: X(PL.toDays(l.date)), y: Y((b.baseFatMass - l.weight * l.fat / 100) / tot * 100) }; });
  // 直近7日の移動平均（体組成計の日々のぶれをならす。「現在」の数値と同じ考え方）
  var days = logs.map(function(l){ return PL.toDays(l.date); });
  var avg = act.map(function(p, i){ var sm = 0, k = 0; for (var j = i; j >= 0 && days[i] - days[j] < 7; j--) { sm += act[j].y; k++; } return { x: p.x, y: sm / k }; });
  var pts = act.map(function(p){ return p.x.toFixed(2)+','+p.y.toFixed(2); }), apts = avg.map(function(p){ return p.x.toFixed(2)+','+p.y.toFixed(2); }), last = avg.length ? avg[avg.length - 1] : null;
  var area = apts.length > 1 ? '<polygon points="'+avg[0].x.toFixed(2)+',100 '+apts.join(' ')+' '+last.x.toFixed(2)+',100" fill="url(#cbg)"/>' : '';
  var svg = '<svg class="cbg" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="cbg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:var(--accent)" stop-opacity=".28"/><stop offset="1" style="stop-color:var(--accent)" stop-opacity="0"/></linearGradient></defs>'
    + '<line x1="0" y1="0" x2="100" y2="0" class="gl"/><line x1="0" y1="50" x2="100" y2="50" class="gl mid"/><line x1="0" y1="100" x2="100" y2="100" class="gl"/>'
    + (plan.length > 1 ? '<polyline points="'+plan.join(' ')+'" class="pl"/>' : '') + area
    + (pts.length > 1 ? '<polyline points="'+pts.join(' ')+'" class="ad"/>' : '')
    + (apts.length > 1 ? '<polyline points="'+apts.join(' ')+'" class="ac"/>' : '') + '</svg>'
    + '<span class="yl" style="top:0">100%</span><span class="yl" style="top:50%">50%</span><span class="yl" style="top:100%">0%</span>'
    + (last ? '<i class="cdot" style="left:'+last.x.toFixed(2)+'%;top:'+last.y.toFixed(2)+'%"></i>' : '');
  return svg;
}
// 開始→目標の道のり。脂肪の量で測り、1/4・折り返し（半分）・3/4の目印と、いまの位置を出す
function trackHtml(b, n){
  if (b.baseFatMass == null || n.fatMass == null || !(b.baseFatMass > b.targetFatMass)) return '';
  var tot = b.baseFatMass - b.targetFatMass, done = b.baseFatMass - n.fatMass, pct = Math.max(0, Math.min(100, done / tot * 100)), left = Math.max(0, n.fatMass - b.targetFatMass);
  var txt = pct >= 100 ? '目標の脂肪の量に届きました'
    : pct >= 75 ? 'ゴールが見えてきました。あと脂肪 <b class="num">'+f1(left)+'kg</b>'
    : pct >= 50 ? '折り返しを過ぎました。残りは脂肪 <b class="num">'+f1(left)+'kg</b>'
    : pct >= 25 ? '折り返しまであと脂肪 <b class="num">'+f1(n.fatMass - (b.baseFatMass - tot / 2))+'kg</b>（全体で残り <b class="num">'+f1(left)+'kg</b>）'
    : 'まだ序盤です。折り返しまであと脂肪 <b class="num">'+f1(n.fatMass - (b.baseFatMass - tot / 2))+'kg</b>';
  var tick = function(p, lbl){ return '<span class="tk" style="left:'+p+'%"><i></i><em>'+lbl+'</em></span>'; };
  return '<div class="track"><div class="tt">開始から目標までの道のり（脂肪の量で <b class="num">'+pct.toFixed(0)+'%</b>）</div>'
    + '<div class="rail"><i class="fill" style="width:'+pct.toFixed(1)+'%"></i><i class="dot" style="left:'+pct.toFixed(1)+'%"></i>'+tick(0, '開始')+tick(25, '1/4')+tick(50, '折り返し')+tick(75, '3/4')+tick(100, '目標')+'</div>'
    + '<div class="tx">'+txt+'</div></div>';
}
// 「開始 → 現在 → 目標」の表。開始は計画の基準（開始後7日の平均で確定）、目標は目標体脂肪率に達したときの体重・脂肪量（除脂肪量は変わらない前提）
function progressHtml(b, n, pre){
  var dl = b.deadline.split('/'), ex = bodyExtra(b);
  var ffNow = ex.nf(n.weight, n.fat);
  // better＝良い方向（'down'＝下がるほど良い／'up'＝上がるほど良い）。現在の下に「開始からの変化」、目標の下に「あと◯◯」を出す
  function row(lbl, a, c, g, u, d, better){
    var sub = '', rem = '';
    if (!pre && a != null && c != null) {
      var df = c - a, pc = a ? df / a * 100 : null, ok = better === 'down' ? df < 0 : df > 0;
      sub = '<i class="'+(Math.abs(df) < Math.pow(10, -d) / 2 ? '' : ok ? 'ok' : 'ng')+'">'+sg(df, d)+(u === '%' ? 'pt' : u)+(pc != null ? '<br>'+sg(pc, 1)+'%' : '')+'</i>';
    }
    if (g != null && c != null) { var r = better === 'down' ? c - g : g - c; rem = '<i>'+(r <= 0 ? '達成' : 'あと '+r.toFixed(d)+u)+'</i>'; }
    return '<div class="r"><span class="l">'+lbl+'</span><span class="c"><b class="num">'+(a == null ? '－' : a.toFixed(d))+'<small>'+u+'</small></b></span><span class="c now"><b class="num">'+(c == null ? '－' : c.toFixed(d))+'<small>'+u+'</small></b>'+sub+'</span><span class="c goal"><b class="num">'+(g == null ? '－' : g.toFixed(d))+'<small>'+u+'</small></b>'+rem+'</span></div>';
  }
  var bg = chartBg(b, n);
  var h = '<div class="sngwrap">'+(bg ? '<div class="sngbg">'+bg+'</div>' : '')+'<div class="sng"><div class="r hd"><span class="l"></span><span>開始<br><small>'+md(b.startDate)+(pre ? '（暫定）' : '')+'</small></span><span class="now">現在<br><small>直近7日</small></span><span class="goal">目標<br><small>'+(+dl[1])+'/'+(+dl[2])+'ごろ</small></span></div>'
    + row('体脂肪率', b.baseFat, n.fat, b.goalFat, '%', 1, 'down')
    + row('体重', b.baseWeight, n.weight, b.targetWeight, 'kg', 1, 'down')
    + row('脂肪の量', b.baseFatMass, n.fatMass, b.targetFatMass, 'kg', 1, 'down')
    + row('骨格筋率', ex.muscle[0], ex.muscle[1], null, '%', 1, 'up')
    + row('内臓脂肪', ex.visceral[0], ex.visceral[1], null, '', 1, 'down')
    + row('FFMI（補正後）', ex.ffmiBase, ffNow, ex.ffmiGoal, '', 1, 'up') + '</div>'
    + (bg ? '<div class="sngx"><span>▲ 開始 '+md(b.startDate)+'</span><span>背景：脂肪の量の進み 0〜100%（太線＝7日平均／細線＝日々の実測／点線＝計画）</span><span>目標日 '+md(b.deadline)+' ▲</span></div>' : '') + '</div>';
  h += '<div class="sngtx">FFMIの開始以降の平均：<b class="num">'+(ex.ffmiAvg == null ? '－' : ex.ffmiAvg.toFixed(1))+'</b>'+(ex.ffmiDays ? '（'+ex.ffmiDays+'日分）' : '')+'　／　骨格筋率・内臓脂肪レベルに目標はありません（推移を見る指標です）</div>';
  h += trackHtml(b, n);
  return h;
}
// 開始から何日目（開始日を1日目とする）。開始前は「開始まであと◯日」。期限があれば残り日数も
function dayCountHtml(b, today){
  var d = PL.toDays(today) - PL.toDays(b.startDate) + 1, tx;
  if (d < 1) tx = '開始まであと <b class="num">'+(1 - d)+'</b> 日（'+md(b.startDate)+' 開始）';
  else {
    tx = '開始から <b class="num">'+d+'</b> 日目';
    if (b.deadline) { var left = PL.toDays(b.deadline) - PL.toDays(today), tot = PL.toDays(b.deadline) - PL.toDays(b.startDate) + 1; tx += left >= 0 ? ' ／ 期限まで残り <b class="num">'+left+'</b> 日（全 '+tot+' 日）' : ' ／ 期限から <b class="num">'+(-left)+'</b> 日経過'; }
  }
  return '<div style="font-size:14px;margin-top:6px;color:var(--ink-2)">'+tx+'</div>';
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
  if (V.plan && V.plan.phase === 'maintain') { el.innerHTML = h + maintainHero(V, n, ad, st); return; }
  h += dayCountHtml(b, V.today);
  var gap = n.gapKg, band = PL.BAND_KG, pre = PL.toDays(V.today) < PL.toDays(b.startDate);
  var verdict = pre ? '開始前' : (Math.abs(gap) < band ? 'ほぼ計画どおり' : (gap > 0 ? '計画より遅れ' : '計画より先行'));
  h += '<div class="top"><div class="big num">'+f1(n.fat)+'<small>%</small></div><span class="chip '+(pre ? '' : (Math.abs(gap) < band ? 'good' : (gap > 0 ? 'bad' : 'good')))+'">'+verdict+'</span><span class="chip '+st[1]+'">'+st[0]+'</span></div>';
  if (pre) h += '<div style="font-size:14px;margin-top:6px;color:var(--ink-2)">計画は '+mdw(b.startDate)+' から始まります。それまでの数値は基準線の暫定値で、開始後7日間に測った日の平均で確定します。</div>';
  else h += '<div style="font-size:14px;margin-top:6px;color:var(--ink-2)">今日の計画 '+f1(PL.plannedFatPct(b, V.today))+'% ／ ずれ <b class="num '+gapCls(gap, band)+'">'+sg(n.gapPct)+'%（脂肪 '+sg(gap)+'kg）</b></div>';
  var dl = b.deadline.split('/');
  h += progressHtml(b, n, pre);
  h += '<div class="kv"><div><b class="num">'+f1(n.remainingKg)+'kg</b><span>目標 '+b.goalFat+'% まで落とす脂肪</span></div><div><b class="num">'+dl[0]+'/'+(+dl[1])+'/'+(+dl[2])+'</b><span>予定の到達日</span></div><div><b class="num">'+f2(b.weeklyLossKg)+'kg</b><span>週あたりの計画</span></div></div>';
  h += '<div class="note">体脂肪率は水分や食事で1日に±1%ほど動くため、判断は日ではなく週の平均で行います。測定数は直近7日で '+n.days+' 日分。</div>';
  el.innerHTML = h;
}

// 維持期：開始（維持期に入る前の基準）→ 現在 → 守る範囲（最低ライン〜許容帯の上限）。体重の範囲は除脂肪量が変わらない前提で換算
function maintainProgressHtml(b, n, p, up){
  if (!b || !p.floorFat) return '';
  var wAt = function(f){ return b.leanKg ? b.leanKg / (1 - f / 100) : null; };
  var rng = function(a, c, d, u){ return a == null || c == null ? '－' : a.toFixed(d)+'<small>'+u+'</small>〜<br>'+c.toFixed(d)+'<small>'+u+'</small>'; };
  var v = function(x, u){ return x == null ? '－' : x.toFixed(1)+'<small>'+u+'</small>'; };
  var inside = n.fat != null && n.fat >= p.floorFat && n.fat <= up;
  return '<div class="sng"><div class="r hd"><span class="l"></span><span>開始<br><small>'+md(b.startDate)+'</small></span><span class="now">現在<br><small>直近7日</small></span><span class="goal">守る範囲<br><small>最低〜上限</small></span></div>'
    + '<div class="r"><span class="l">体脂肪率</span><b class="num">'+v(b.baseFat, '%')+'</b><b class="num now">'+v(n.fat, '%')+'</b><b class="num goal" style="font-size:14px">'+rng(p.floorFat, up, 1, '%')+'</b></div>'
    + '<div class="r"><span class="l">体重</span><b class="num">'+v(b.baseWeight, 'kg')+'</b><b class="num now">'+v(n.weight, 'kg')+'</b><b class="num goal" style="font-size:14px">'+rng(wAt(p.floorFat), wAt(up), 1, 'kg')+'</b></div></div>'
    + '<div class="sngtx">いまの体脂肪率は、守る範囲の<b>'+(inside ? '中です' : (n.fat < p.floorFat ? '下（最低ライン割れ）です' : '上（許容帯の超過）です'))+'</b></div>';
}
function maintainHero(V, n, ad, st){
  var fl = ad && ad.floor, p = V.plan, up = p.floorFat ? p.floorFat + PL.MAINT_BAND : null;
  var h = '<div class="top"><div class="big num">'+f1(n.fat)+'<small>%</small></div><span class="chip '+st[1]+'">'+(st[0] || '維持期')+'</span></div>' + dayCountHtml(V.built, V.today);
  if (p.floorFat) h += '<div style="font-size:14px;margin-top:6px;color:var(--ink-2)">維持期：最低 <b class="num">'+f1(p.floorFat)+'%</b> 〜 許容帯の上限 <b class="num">'+f1(up)+'%</b>'+(fl ? ' ／ 最低ラインまで <b class="num '+(fl.marginPct < 0 ? 'pos' : '')+'">'+sg(fl.marginPct)+'%</b>' : '')+'</div>';
  h += maintainProgressHtml(V.built, n, p, up);
  h += '<div class="note">維持期は減量せず、維持カロリーで過ごします。体脂肪率が最低ラインを割りそうなら少し多めに食べ、許容帯の上を超えたら少し控えます（いずれも週単位で±200kcalまで）。判断は日ではなく直近7日の平均です。</div>';
  return h;
}

function renderAdjust(){
  var V = S.V, el = $('adjustCard');
  if (!V || !V.configured || !V.adjust) { el.style.display = 'none'; return; }
  el.style.display = '';
  var ai = S.ai, ad = ai ? ai.adjust : V.adjust, st = STATUS[ad.status] || ['', ''];
  var from = ai ? ai.effectiveFrom : PL.nextMonday(V.today);
  var bulkM = ad.mode === 'bulk', maintM = ad.mode === 'maintain', off = window.KTAdvice && KTAdvice.isOff();
  var modeTx = bulkM ? '第2期バルク' : maintM ? '第2期 維持' : '第1期（減量）';
  var h = '<h3>次週のカロリー調整（'+mdw(from)+'から）</h3>';
  h += '<div class="note" style="margin:0 0 8px">モード：<b>'+modeTx+'</b>'+(ad.range ? '（目標の範囲 '+comma(ad.range.min)+'〜'+comma(ad.range.max)+'kcal）' : '')+(off ? ' ／ 記録だけのモード：自動では変えません' : ' ／ 毎週、先週の記録で自動採用されます')+'</div>';
  var al = S.plan && S.plan.autoLast;
  if (al && !off) {
    h += '<div class="banner '+(al.changed ? 'warn' : '')+'" style="margin:0 0 10px"><b>'+mdw(al.from)+'からの目標：'+(al.changed ? (al.prev ? comma(al.prev)+' → ' : '')+comma(al.kcal)+'kcal に自動で変更しました' : (al.kcal ? comma(al.kcal)+'kcal のまま（据え置き）' : '据え置き'))+'</b>'
      + (al.reasons && al.reasons.length ? '<ul class="reasons" style="margin:6px 0 0">'+al.reasons.map(function(r){ return '<li>'+esc(r)+'</li>'; }).join('')+'</ul>' : '')
      + '<div style="font-size:12px;margin-top:4px;color:var(--ink-2)">'+mdw(al.evalDate)+'までの1週間の記録で判定。週の途中の節制と外食は、同じ週の平均で見ます。</div></div>';
  }
  if (ad.target) {
    h += '<div style="display:flex;align-items:baseline;gap:10px;flex-wrap:wrap"><div class="big num">'+comma(ad.target)+'<small> kcal／日</small></div><span class="chip '+st[1]+'">'+st[0]+'</span></div>';
    var dl = ad.deltaFromPrevious;
    h += '<div style="font-size:14px;margin-top:6px;color:var(--ink-2)">'+(ad.previousTarget ? '今の目標 '+comma(ad.previousTarget)+'kcal から <b class="num">'+(dl ? sg(dl, 0)+'kcal' : '変更なし')+'</b> ／ ' : '')+'1週間の予算 <b class="num">'+comma(ad.weeklyBudget || ad.target*7)+'kcal</b></div>';
    h += '<div class="kv"><div><b class="num">'+comma(ad.tdee ? ad.tdee.kcal : null)+'</b><span>消費の見込み（'+(ad.tdee && ad.tdee.basis === 'observed' ? '実測' : '基礎代謝×係数の推定')+'）</span></div><div><b class="num">'+(ad.protein ? ad.protein.minG+'〜'+ad.protein.targetG+'g' : '－')+'</b><span>たんぱく質／日</span></div><div><b class="num">'+(ad.expectedLossKgPerWeek != null ? f2(Math.abs(ad.expectedLossKgPerWeek))+'kg' : '－')+'</b><span>'+(ad.mode === 'bulk' ? 'この目標での体重の増え（目安）／週' : 'この目標での脂肪の減り／週')+'</span></div></div>';
  } else {
    h += '<div><span class="chip '+st[1]+'">'+st[0]+'</span></div>';
  }
  if (ad.reasons && ad.reasons.length) h += '<ul class="reasons">'+ad.reasons.map(function(r){ return '<li>'+esc(r)+'</li>'; }).join('')+'</ul>';
  if (ad.leanWarning) h += '<div class="banner warn" style="margin-top:10px">'+esc(ad.leanWarning)+'</div>';
  if (ad.actual && ad.actual.weeklyGainPct != null) h += '<div class="note">実績（直近'+ad.actual.spanDays+'日の傾向）：体重が週 '+f2(ad.actual.weeklyGainKg)+'kg（'+f2(ad.actual.weeklyGainPct)+'%）のペースで増加。目安は週0.25〜0.5%です。</div>';
  else if (ad.actual) h += '<div class="note">実績（直近'+ad.actual.spanDays+'日の傾向）：脂肪が週 '+f2(ad.actual.weeklyLossKg)+'kg のペースで減少、平均摂取 '+comma(ad.actual.avgIntake)+'kcal。期間が短いほど誤差は大きくなります。</div>';

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
    h += '<div class="note">自動で採用されますが、ここから手で決め直すこともできます（採用すると '+mdw(from)+'からの目標として履歴に残り、食事画面にも反映）。</div>';
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

var CH = { zoom: null, cur: null, ptrs: {}, g: null, bound: false, ctx: null, raf: 0 };
function chRedraw(){ if (CH.raf) return; CH.raf = requestAnimationFrame(function(){ CH.raf = 0; renderChart(); }); }
function chFull(){
  var V = S.V, b = V.built, t = PL.toDays(V.today), maint = V.plan && V.plan.phase === 'maintain';
  return { a: PL.toDays(b.startDate), b: Math.max(maint ? t + 14 : PL.toDays(b.deadline), t) };
}
function chSet(a, bb){
  var f = chFull(), span = Math.min(Math.max(bb - a, 5), f.b - f.a);
  a = Math.min(Math.max(a, f.a), f.b - span);
  CH.zoom = (span >= f.b - f.a - 0.01) ? null : { a: a, b: a + span };
  if (!CH.zoom && S.range !== 'all') { S.range = 'all'; }
}
function chZoomBy(factor, center){
  var c = CH.ctx; if (!c) return;
  var span = c.d1 - c.d0, ns = span * factor;
  if (center == null) center = (c.d0 + c.d1) / 2;
  var a = center - (center - c.d0) * (ns / span);
  chSet(a, a + ns);
}
function chDayAt(clientX){
  var c = CH.ctx, svg = $('chartCard').querySelector('svg'); if (!c || !svg) return null;
  var r = svg.getBoundingClientRect(), sx = (clientX - r.left) / r.width * c.W;
  return { day: c.d0 + (sx - c.pl) / (c.W - c.pl - c.pr) * (c.d1 - c.d0), sx: sx };
}
function chBind(){
  if (CH.bound) return; CH.bound = true;
  var el = $('chartCard');
  function inWrap(e){ return e.target.closest && e.target.closest('.chwrap'); }
  el.addEventListener('pointerdown', function(e){
    if (!inWrap(e)) return;
    CH.ptrs[e.pointerId] = { x: e.clientX, y: e.clientY, t: e.pointerType };
    try { el.setPointerCapture(e.pointerId); } catch (x) {}
    var ids = Object.keys(CH.ptrs);
    if (ids.length === 2 && CH.ctx) {
      var p = CH.ptrs[ids[0]], q = CH.ptrs[ids[1]], m = chDayAt((p.x + q.x) / 2);
      CH.g = { dist: Math.max(10, Math.hypot(p.x - q.x, p.y - q.y)), a: CH.ctx.d0, b: CH.ctx.d1, anchor: m ? m.day : (CH.ctx.d0 + CH.ctx.d1) / 2 };
    } else if (ids.length === 1) {
      CH.g = null; var d = chDayAt(e.clientX); if (d) { CH.cur = Math.round(d.day); chRedraw(); }
    }
  });
  el.addEventListener('pointermove', function(e){
    var p = CH.ptrs[e.pointerId], c = CH.ctx;
    if (!p) { if (e.pointerType === 'mouse' && inWrap(e) && c) { var h = chDayAt(e.clientX); if (h) { CH.cur = Math.round(h.day); chRedraw(); } } return; }
    var ids = Object.keys(CH.ptrs), prevX = p.x;
    p.x = e.clientX; p.y = e.clientY;
    if (!c) return;
    if (ids.length >= 2 && CH.g) {
      var a = CH.ptrs[ids[0]], b = CH.ptrs[ids[1]], dist = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), mid = chDayAt((a.x + b.x) / 2); if (!mid) return;
      var span0 = CH.g.b - CH.g.a, ns = span0 * CH.g.dist / dist, frac = (mid.sx - c.pl) / (c.W - c.pl - c.pr);
      chSet(CH.g.anchor - frac * ns, CH.g.anchor - frac * ns + ns); CH.cur = null; chRedraw();
    } else if (e.pointerType === 'mouse' && e.buttons && CH.zoom) {
      var svg = el.querySelector('svg'), w = svg.getBoundingClientRect().width * (c.W - c.pl - c.pr) / c.W, dd = -(e.clientX - prevX) / w * (c.d1 - c.d0);
      chSet(c.d0 + dd, c.d1 + dd); chRedraw();
    } else { var d = chDayAt(e.clientX); if (d) { CH.cur = Math.round(d.day); chRedraw(); } }
  });
  function up(e){ delete CH.ptrs[e.pointerId]; if (Object.keys(CH.ptrs).length < 2) CH.g = null; }
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  el.addEventListener('pointerleave', function(e){ if (e.pointerType === 'mouse' && inWrap(e) && !e.buttons) { CH.cur = null; chRedraw(); } });
  el.addEventListener('wheel', function(e){
    if (!inWrap(e) || !CH.ctx) return; e.preventDefault();
    var d = chDayAt(e.clientX); chZoomBy(e.deltaY > 0 ? 1.25 : 0.8, d ? d.day : null); chRedraw();
  }, { passive: false });
  el.addEventListener('dblclick', function(e){ if (inWrap(e)) { CH.zoom = null; chRedraw(); } });
  el.addEventListener('click', function(e){
    var z = e.target.closest && e.target.closest('[data-z]'); if (!z || !CH.ctx) return;
    var k = z.getAttribute('data-z'), c = CH.ctx, span = c.d1 - c.d0;
    if (k === 'in') chZoomBy(0.6); else if (k === 'out') chZoomBy(1.6); else if (k === 'reset') { CH.zoom = null; CH.cur = null; }
    else if (k === 'l') chSet(c.d0 - span * 0.3, c.d1 - span * 0.3); else if (k === 'r') chSet(c.d0 + span * 0.3, c.d1 + span * 0.3);
    chRedraw();
  });
}

function renderChart(){
  var V = S.V, el = $('chartCard');
  if (!V || !V.built) { el.style.display = 'none'; return; }
  el.style.display = '';
  chBind();
  var b = V.built, today = V.today, map = PL.bodyDays(S.body ? S.body.logs : []);
  var h = '<h3>計画ラインと実績（体脂肪率）</h3><div class="tabs" id="rTabs">'+[['30','30日'],['90','90日'],['all','開始〜期限']].map(function(r){ return '<button data-r="'+r[0]+'"'+(r[0]===S.range&&!CH.zoom?' class="on"':'')+'>'+r[1]+'</button>'; }).join('')+'</div>';
  var maint = V.plan && V.plan.phase === 'maintain', st = PL.toDays(b.startDate), dl = maint ? PL.toDays(today) + 14 : PL.toDays(b.deadline), t = PL.toDays(today), d0, d1;
  if (S.range === 'all') { d0 = st; d1 = Math.max(dl, t); } else { var n = +S.range; d0 = Math.max(st, t - n + 1); d1 = Math.max(d0 + 6, Math.min(dl, t + 7)); }
  if (CH.zoom) { d0 = CH.zoom.a; d1 = CH.zoom.b; }
  var span = Math.max(1, d1 - d0), d, i0 = Math.floor(d0) - 1, i1 = Math.ceil(d1) + 1;
  var pts = [], mas = [], lo = 1e9, hi = -1e9;
  for (d = i0; d <= Math.min(i1, t); d++) {
    if (d < st - 14) continue;
    var ds = PL.fromDays(d), x = map[ds], vis = d >= d0 && d <= d1;
    if (x && x.fat != null) { pts.push({ d: d, v: x.fat, n: x.count }); if (vis) { lo = Math.min(lo, x.fat); hi = Math.max(hi, x.fat); } }
    var m = movingAvg(map, ds); if (m != null) { mas.push({ d: d, v: m }); if (vis) { lo = Math.min(lo, m); hi = Math.max(hi, m); } }
  }
  var planPts = [], step = Math.max(1, Math.round((i1 - i0) / 40));
  for (d = i0; d <= i1; d += step) { planPts.push({ d: d, v: PL.plannedFatPct(b, PL.fromDays(d)) }); }
  planPts.push({ d: i1, v: PL.plannedFatPct(b, PL.fromDays(i1)) });
  if (maint) planPts = [];
  planPts.forEach(function(p){ if (p.d >= d0 - step && p.d <= d1 + step) { lo = Math.min(lo, p.v); hi = Math.max(hi, p.v); } });
  var fl = V.plan && V.plan.floorFat > 0 ? V.plan.floorFat : 0;
  if (maint) { if (fl) { lo = Math.min(lo, fl); hi = Math.max(hi, fl + PL.MAINT_BAND); } if (!isFinite(lo) || lo > hi) { lo = (fl || b.goalFat) - 1; hi = (fl || b.goalFat) + 2; } }
  else if (!CH.zoom) { lo = Math.min(lo, b.goalFat); hi = Math.max(hi, b.baseFat); }
  else if (!isFinite(lo) || lo > hi) { lo = b.goalFat; hi = b.baseFat; }
  if (hi - lo < 0.4) { var mid0 = (hi + lo) / 2; lo = mid0 - 0.2; hi = mid0 + 0.2; }
  var padv = Math.max(0.2, (hi - lo) * 0.1); lo -= padv; hi += padv;
  var W = 640, H = 240, pl = 40, pr = 10, pt = 12, pb = 28;
  function X(dd){ return pl + (W - pl - pr) * (dd - d0) / span; }
  function Y(v){ return pt + (H - pt - pb) * (1 - (v - lo) / (hi - lo)); }
  CH.ctx = { d0: d0, d1: d1, W: W, pl: pl, pr: pr };
  function path(a){ return a.map(function(p, i){ return (i?'L':'M')+X(p.d).toFixed(1)+' '+Y(p.v).toFixed(1); }).join(' '); }
  var dec = (hi - lo) < 3 ? 2 : 1;
  var s = '<svg class="chart" viewBox="0 0 '+W+' '+H+'" role="img" aria-label="体脂肪率の計画と実績"><defs><clipPath id="chclip"><rect x="'+pl+'" y="'+pt+'" width="'+(W-pl-pr)+'" height="'+(H-pt-pb)+'"/></clipPath></defs>';
  for (var i = 0; i <= 4; i++) { var gv = lo + (hi - lo) * i / 4, gy = Y(gv); s += '<line class="gl" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+gy+'" y2="'+gy+'"/><text x="'+(pl-4)+'" y="'+(gy+3)+'" text-anchor="end">'+gv.toFixed(dec)+'</text>'; }
  s += '<g clip-path="url(#chclip)">';
  (b.pauses || []).forEach(function(pz){
    var a = Math.max(d0, PL.toDays(pz.from)), z = Math.min(d1, PL.toDays(pz.to)); if (z < a) return;
    s += '<rect class="pause" x="'+X(a).toFixed(1)+'" y="'+pt+'" width="'+Math.max(2, X(z + 1) - X(a)).toFixed(1)+'" height="'+(H-pt-pb)+'"><title>休止 '+md(pz.from)+'〜'+md(pz.to)+(pz.reason ? '（'+pz.reason+'）' : '')+'</title></rect>';
  });
  if (!maint && planPts.length > 1) {
    var up = planPts.map(function(p){ var fm = PL.plannedFatMass(b, PL.fromDays(p.d)) + PL.BAND_KG; return { d: p.d, v: fm / (b.leanKg + fm) * 100 }; });
    var dn = planPts.map(function(p){ var fm = Math.max(0, PL.plannedFatMass(b, PL.fromDays(p.d)) - PL.BAND_KG); return { d: p.d, v: fm / (b.leanKg + fm) * 100 }; }).reverse();
    s += '<path class="band" d="'+path(up.concat(dn))+' Z"/>';
  }
  if (maint && fl) { var fy = Y(fl), uy = Y(fl + PL.MAINT_BAND); s += '<rect class="band" x="'+pl+'" y="'+uy.toFixed(1)+'" width="'+(W-pl-pr)+'" height="'+(fy-uy).toFixed(1)+'"/><line class="goal" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+fy.toFixed(1)+'" y2="'+fy.toFixed(1)+'"/><text x="'+(pl+4)+'" y="'+(fy+11).toFixed(1)+'" class="goaltx">最低 '+f1(fl)+'%</text>'; }
  if (!maint && b.goalFat >= lo && b.goalFat <= hi) { var gy2 = Y(b.goalFat); s += '<line class="goal" x1="'+pl+'" x2="'+(W-pr)+'" y1="'+gy2+'" y2="'+gy2+'"/><text x="'+(pl+4)+'" y="'+(gy2-4)+'" class="goaltx">目標 '+f1(b.goalFat)+'%</text>'; }
  var msAll = (maint ? [] : monthEndsOf(b)).filter(function(ds){ var dd = PL.toDays(ds); return dd >= d0 && dd <= d1; });
  msAll.forEach(function(ds){
    var dd = PL.toDays(ds), v = PL.plannedFatPct(b, ds), mx = X(dd), my = Y(v), last = ds === b.deadline;
    s += '<line class="mk" x1="'+mx.toFixed(1)+'" x2="'+mx.toFixed(1)+'" y1="'+pt+'" y2="'+(H-pb)+'"/>'
      + '<circle class="mkdot" cx="'+mx.toFixed(1)+'" cy="'+my.toFixed(1)+'" r="3.5"><title>'+mdw(ds)+' 計画 '+f1(v)+'%</title></circle>'
      + '<text class="mktx" x="'+Math.min(W-pr, mx).toFixed(1)+'" y="'+(my-7).toFixed(1)+'" text-anchor="'+(last || mx > W - 40 ? 'end' : 'middle')+'">'+f1(v)+'</text>';
  });
  if (planPts.length) s += '<path class="plan" d="'+path(planPts)+'"/>';
  pts.forEach(function(p){ s += '<circle class="pt" cx="'+X(p.d).toFixed(1)+'" cy="'+Y(p.v).toFixed(1)+'" r="3"/>'; });
  if (mas.length > 1) s += '<path class="ma" d="'+path(mas)+'"/>';
  if (t >= d0 && t <= d1) s += '<line class="now" x1="'+X(t)+'" x2="'+X(t)+'" y1="'+pt+'" y2="'+(H-pb)+'"/>';
  s += '</g>';
  // 下の日付目盛り（表示範囲に応じて5つ）
  for (var k = 0; k <= 4; k++) { var td = Math.round(d0 + span * k / 4); s += '<text x="'+X(td).toFixed(1)+'" y="'+(H-14)+'" text-anchor="'+(k === 0 ? 'start' : k === 4 ? 'end' : 'middle')+'" class="mkdate">'+md(PL.fromDays(td))+'</text>'; }
  msAll.forEach(function(ds){ if (ds === b.deadline) return; s += '<text x="'+X(PL.toDays(ds)).toFixed(1)+'" y="'+(H-2)+'" text-anchor="middle" class="mkdate">'+md(ds)+'</text>'; });
  if (t >= d0 && t <= d1) s += '<text x="'+X(t)+'" y="'+(H-2)+'" text-anchor="'+(t - d0 > span * 0.85 ? 'end' : 'middle')+'">今日</text>';
  // なぞった日の十字線・値の札・情報パネル
  var info = '<div class="chinfo muted">グラフをなぞると、その日の数値が出ます。2本指で拡大・縮小（PCはホイール、ダブルタップで戻す）</div>';
  if (CH.cur != null && CH.cur >= d0 - 0.5 && CH.cur <= d1 + 0.5) {
    var cd = CH.cur, cds = PL.fromDays(cd), cx = X(cd), pv = maint ? null : PL.plannedFatPct(b, cds);
    var pw = maint ? null : b.leanKg + PL.plannedFatMass(b, cds), mv = cd <= t ? movingAvg(map, cds) : null, me = cd <= t ? map[cds] : null, mf = me && me.fat != null ? me.fat : null;
    var prim = mv != null ? mv : mf != null ? mf : pv;
    s += '<line class="cross" x1="'+cx.toFixed(1)+'" x2="'+cx.toFixed(1)+'" y1="'+pt+'" y2="'+(H-pb)+'"/>';
    if (pv != null) s += '<circle class="cdot plan" cx="'+cx.toFixed(1)+'" cy="'+Y(pv).toFixed(1)+'" r="4.5"/>';
    if (mf != null) s += '<circle class="cdot meas" cx="'+cx.toFixed(1)+'" cy="'+Y(mf).toFixed(1)+'" r="4.5"/>';
    if (mv != null) s += '<circle class="cdot ma" cx="'+cx.toFixed(1)+'" cy="'+Y(mv).toFixed(1)+'" r="5"/>';
    if (prim != null) { var py = Y(prim); s += '<line class="cross" x1="'+pl+'" x2="'+cx.toFixed(1)+'" y1="'+py.toFixed(1)+'" y2="'+py.toFixed(1)+'"/><rect class="tag" x="0" y="'+(py-8).toFixed(1)+'" width="'+(pl-2)+'" height="16" rx="4"/><text class="tagtx" x="'+((pl-2)/2)+'" y="'+(py+3.5).toFixed(1)+'" text-anchor="middle">'+prim.toFixed(dec)+'</text>'; }
    var tx = Math.min(Math.max(cx, pl + 26), W - pr - 26);
    s += '<rect class="tag" x="'+(tx-26).toFixed(1)+'" y="'+(H-pb+1)+'" width="52" height="14" rx="4"/><text class="tagtx" x="'+tx.toFixed(1)+'" y="'+(H-pb+11.5)+'" text-anchor="middle">'+md(cds)+'</text>';
    var diff = (mv != null && pv != null) ? mv - pv : null;
    info = '<div class="chinfo"><b>'+mdw(cds)+'</b>'
      + (pv != null ? '<span class="c-plan">計画 <b>'+f1(pv)+'%</b>'+(pw != null ? '（体重 '+f1(pw)+'kg）' : '')+'</span>' : (fl ? '<span class="c-plan">最低 <b>'+f1(fl)+'%</b></span>' : ''))
      + (mv != null ? '<span class="c-ma">7日平均 <b>'+f1(mv)+'%</b></span>' : '')
      + (mf != null ? '<span class="c-meas">その日の測定 <b>'+f1(mf)+'%</b>（'+me.count+'回）</span>' : (cd <= t ? '<span class="muted">測定なし</span>' : '<span class="muted">未来</span>'))
      + (diff != null ? '<span class="'+(diff > 0.05 ? 'c-bad' : 'c-ok')+'">計画との差 <b>'+(diff > 0 ? '+' : '')+f1(diff)+'pt</b>'+(diff > 0.05 ? '（計画より高い）' : diff < -0.05 ? '（計画より低い＝先行）' : '（計画どおり）')+'</span>' : '')
      + '</div>';
  }
  s += '</svg>';
  var ctl = '<div class="chctl"><button type="button" data-z="l" aria-label="左へ">◀</button><button type="button" data-z="out" aria-label="縮小">－</button><button type="button" data-z="in" aria-label="拡大">＋</button><button type="button" data-z="r" aria-label="右へ">▶</button><button type="button" data-z="reset">全体</button><span class="muted">'+(CH.zoom ? '拡大中：'+md(PL.fromDays(Math.round(d0)))+'〜'+md(PL.fromDays(Math.round(d1))) : '')+'</span></div>';
  h += ctl + info + '<div class="chwrap">' + s + '</div>';
  h += '<div class="legend"><span><i style="border-color:var(--good);border-top-style:dashed"></i>計画</span><span><i style="border-color:var(--accent)"></i>実績の7日平均</span><span>● 測った日の平均</span>'+(maint ? '<span><i style="border-color:var(--good);opacity:.5"></i>最低〜許容帯</span>' : '<span><i style="border-color:var(--good);opacity:.35;border-top-width:6px"></i>許容幅（±'+PL.BAND_KG+'kg）</span>')+((b.pauses||[]).length ? '<span>▒ 休止期間</span>' : '')+'<span>◯ 月末の計画値（%）</span></div>';
  if (!pts.length) h += '<div class="note">この期間の測定がまだありません。</div>';
  el.innerHTML = h;
  Array.prototype.forEach.call($('rTabs').querySelectorAll('button'), function(btn){ btn.onclick = function(){ S.range = btn.getAttribute('data-r'); CH.zoom = null; CH.cur = null; renderChart(); }; });
}


function renderMilestones(){
  var V = S.V, el = $('msCard');
  if (!V || !V.built || (V.plan && V.plan.phase === 'maintain')) { el.style.display = 'none'; return; }
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
  h += '</table></div><div class="note">除脂肪量（'+f1(b.leanKg)+'kg）を維持して、脂肪だけを落とす計画です。'+(b.shape === 'ease' ? '前半は週'+f2(b.weeklyLossKg1)+'kg、終盤（最後の約'+b.phase2Days+'日）は週'+f2(b.weeklyLossKg2)+'kgへ緩めます。' : '一定のペース（週'+f2(b.weeklyLossKg)+'kg）です。')+(b.pauses && b.pauses.length ? '休止期間の間は減らさず、その分ほかの週で取り戻します。' : '')+'実績は体組成の記録から。月末の行は、その月の平均と比べてください（ずれは週の平均で判断）。</div>';
  el.innerHTML = h;
}

/* ---- 日・週・月 ---- */
function renderDays(){
  var V = S.V, el = $('dayCard');
  if (!V || !V.days) { el.style.display = 'none'; return; }
  el.style.display = '';
  var h = '<h3>日（直近14日）</h3><div class="tblwrap"><table class="tbl"><tr><th>日付</th><th>体脂肪率</th><th>FFMI</th><th>計画</th><th>ずれ</th><th>摂取kcal</th><th>目標差</th></tr>';
  var blogs = (S.body && S.body.logs) || [], byD = {}, hh = 0, hdt = '';
  blogs.forEach(function(l){ byD[l.date] = l; if (l.height && l.date > hdt) { hh = l.height; hdt = l.date; } });
  function ffmiDay(date){ var l = byD[date]; if (!l || typeof FfmiLib === 'undefined' || l.weight == null || l.fat == null) return null; var ht = l.height || hh; if (!ht) return null; var x = FfmiLib.ffmi(l.weight, l.fat, ht); return x == null ? null : FfmiLib.r1(FfmiLib.normalized(x, ht)); }
  V.days.forEach(function(r){
    var kc = r.kcal == null ? '－' : comma(r.kcal)+(r.complete ? '' : '<small>記録中</small>');
    var okd = r.kcal != null && r.complete && r.target;
    h += '<tr'+(r.date === V.today ? ' class="today"' : '')+'><td>'+mdw(r.date)+'</td>'
      + '<td class="num">'+(r.body ? f1(r.fat)+'<small>'+r.count+'回</small>' : '<span class="mut">－</span>')+'</td>'
      + '<td class="num">'+(ffmiDay(r.date) == null ? '<span class="mut">－</span>' : f1(ffmiDay(r.date)))+'</td>'
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
      + (V.plan && V.plan.phase === 'maintain' ? '' : '<div class="plan-row"><span>週あたり／1日の赤字</span><b>'+f2(b.weeklyLossKg)+'kg（体重の'+f2(b.weeklyLossPct)+'%）／'+comma(b.deficitKcalPerDay)+'kcal</b></div>');
    var pp = V.plan || {};
    h += '<div class="plan-row"><span>いまの局面</span><b>'+(pp.phase === 'maintain' ? '維持期' : '減量期')+(pp.floorFat ? '（最低体脂肪率 '+f1(pp.floorFat)+'%）' : '')+'</b></div>';
    if (pp.phase !== 'maintain') h += '<div class="plan-row"><span>減量ペースの形</span><b>'+(b.shape === 'ease' ? '終盤を緩やかに（前半 週'+f2(b.weeklyLossKg1)+'kg → 終盤 週'+f2(b.weeklyLossKg2)+'kg）' : '一定のペース')+'</b></div>';
    var pz = b.pauses || [];
    if (pp.phase !== 'maintain') h += '<div class="plan-row"><span>休止期間</span><b>'+(pz.length ? pz.map(function(x){ return md(x.from)+'〜'+md(x.to)+(x.reason ? '（'+esc(x.reason)+'）' : ''); }).join('、') : 'なし')+'</b></div><div class="hint" style="margin:2px 0 6px">休止期間の追加・取り消しは、コーチの「相談」で「年末年始は休みたい」のように頼むと、変更案が出ます（確認して反映）。</div>';
    if (b.aggressive && pp.phase !== 'maintain') h += '<div class="banner warn" style="margin-top:10px">このペースは体重の1%/週を超えています。筋肉が落ちやすいので、期限を延ばすことをおすすめします。</div>';
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
  var ac = $('sActCal'); if (ac) ac.textContent = p.activityCal ? '記録から逆算した係数：'+p.activityCal+'（実測が出た週に自動更新。推定にはこちらを優先して使います）' : '記録から逆算した係数：まだありません（体組成と食事の記録が揃うと、週1回の自動採用で出ます）';
  $('sShape').value = p.shape === 'linear' ? 'linear' : 'ease';
  $('sPhase').value = p.phase === 'maintain' ? 'maintain' : 'cut';
  $('sFloor').value = p.floorFat || '';
  $('setModal').classList.add('open');
}
$('sClose').onclick = $('sCancel').onclick = function(){ $('setModal').classList.remove('open'); };
$('sSave').onclick = function(){
  var req = { goalFat: $('sGoal').value, startDate: fromInputDate($('sStart').value), weeklyLossKg: $('sWeekly').value, deadline: fromInputDate($('sDeadline').value), activity: $('sAct').value, shape: $('sShape').value, phase: $('sPhase').value, floorFat: $('sFloor').value };
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
  return Promise.all([KT.call('bodyInit'), KT.call('mealInit'), KT.call('planInit'), KT.call('cardioInit').catch(function(){ return null; })]).then(function(r){ S.body = r[0]; S.meal = r[1]; S.plan = r[2]; if (r[3]) S.cardioC = r[3]; S.loadErr = null; render(); });
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
// 毎週1回、先週の記録から次の目標を自動で採用する（サーバー側で判定）。「記録だけ」のモードでは動かさない
function autoRun(){
  var p = S.plan && S.plan.plan;
  if (!p || !p.goalFat || !p.startDate || (window.KTAdvice && KTAdvice.isOff())) return;
  return KT.call('planAuto').then(function(d){
    var was = S.plan && S.plan.autoLast ? S.plan.autoLast.from + ':' + S.plan.autoLast.kcal : '';
    S.plan = d;
    var a = d.autoLast;
    if (a && a.changed && a.from + ':' + a.kcal !== was) return KT.call('mealInit').catch(function(){ return S.meal; }).then(function(m){ if (m) S.meal = m; render(); toast('今週の目標を自動で '+a.kcal+'kcal にしました'); });
    render();
  }, function(){ /* 古いサーバー・オフラインでは何もしない */ });
}
function init(){
  if (!KT.configured()) { showSetup(); return; }
  Promise.all([KT.call('bodyCached'), KT.call('mealCached'), KT.call('planCached'), KT.call('cardioCached').catch(function(){ return null; })]).then(function(r){
    if (r[0]) S.body = r[0]; if (r[1]) S.meal = r[1]; if (r[2]) S.plan = r[2]; if (r[3]) S.cardioC = r[3];
    if (S.body && S.plan) render();
  }, function(e){ healStaleCache(e); });
  reloadAll().then(autoRun).catch(function(e){
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
