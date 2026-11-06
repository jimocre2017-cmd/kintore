/**
 * 食事（カロリー・たんぱく質・脂質・炭水化物）の記録 - バックエンド
 * スプレッドシート：食事ログ（初回の呼び出し時に自動で作られる）
 * 食事の内容をざっくり文章で書くと、Gemini が栄養を見積もる（mealEstimate）。見積もりは画面で直してから保存する。
 * 保存は ID で上書きされるので、オフライン中の操作を何度送り直しても安全。
 */

var MSH = '食事ログ';
var MHEAD = ['ID', '日付', '時刻', '区分', '内容', 'kcal', 'たんぱく質g', '脂質g', '炭水化物g', '内訳', '見積もりメモ', '登録日時'];
var MEAL_TYPES = ['朝食', '昼食', '夕食', '間食', '飲酒', 'その他'];
var MFSH = '食事品目';
var MFHEAD = ['ID', '名前', '内容', 'kcal', 'たんぱく質g', '脂質g', '炭水化物g', '内訳', '登録日時'];
var MEAL_READY = false;

function ensureMeal_() {
  if (MEAL_READY) return;
  var ss = ss_();
  var sh = ss.getSheetByName(MSH), created = false;
  if (!sh) { sh = ss.insertSheet(MSH); created = true; }
  sh.getRange(1, 1, 1, MHEAD.length).setValues([MHEAD]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  sh.setFrozenRows(1);
  if (created) [1, 2, 3, 12].forEach(function (c) { sh.getRange(1, c, sh.getMaxRows(), 1).setNumberFormat('@'); });
  var fs = ss.getSheetByName(MFSH);
  if (!fs) fs = ss.insertSheet(MFSH);
  fs.getRange(1, 1, 1, MFHEAD.length).setValues([MFHEAD]).setFontWeight('bold').setBackground('#1f2937').setFontColor('#ffffff');
  fs.setFrozenRows(1);
  MEAL_READY = true;
}

/* ============================================================
 * 品目（よく食べるもの・オリジナルの組み合わせ）：名前で内容と栄養を覚えておく
 * 例：「オリジナルプロテインシェイク」＝プロテイン30g＋牛乳150g＋ヨーグルト100g＋ポカリ粉末12g
 * ============================================================ */

function foodObj_(r) {
  return { id: String(r[0]), name: String(r[1] || ''), text: String(r[2] || ''), kcal: mNum_(r[3]), protein: mNum_(r[4]), fat: mNum_(r[5]), carbs: mNum_(r[6]), items: String(r[7] || '') };
}

function mealFoods_() {
  ensureMeal_();
  return rows_(MFSH).filter(function (r) { return String(r[0]).trim() !== ''; }).map(foodObj_)
    .sort(function (a, b) { return a.name < b.name ? -1 : (a.name > b.name ? 1 : 0); });
}

function mealFoodSave(p) {
  ensureMeal_();
  p = p || {};
  var id = String(p.id || '').trim();
  if (!id) throw new Error('IDがありません');
  var name = String(p.name || '').replace(/\s+/g, ' ').trim().slice(0, 30);
  if (!name) throw new Error('品目の名前を入力してください');
  function n(v, label, max) {
    var x = v === '' || v === null || v === undefined ? 0 : Number(v);
    if (isNaN(x) || x < 0 || x > max) throw new Error(label + 'は0〜' + max + 'で入力してください');
    return Math.round(x * 10) / 10;
  }
  var kcal = Math.round(n(p.kcal, 'カロリー', 6000));
  if (!kcal) throw new Error('カロリーを入力してください（先にAIで見積もるか、数値を入れてください）');
  var row = [id, name, String(p.text || '').replace(/\r\n?/g, '\n').trim().slice(0, 600), kcal,
    n(p.protein, 'たんぱく質', 500), n(p.fat, '脂質', 500), n(p.carbs, '炭水化物', 1000), String(p.items || '').slice(0, 1500), ''];
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(MFSH), last = sh.getLastRow(), rowIdx = 0, sameName = 0;
    if (last >= 2) {
      var vs = sh.getRange(2, 1, last - 1, 2).getValues();
      for (var i = 0; i < vs.length; i++) {
        if (String(vs[i][0]) === id) rowIdx = i + 2;
        else if (String(vs[i][1]) === name && !sameName) sameName = i + 2;
      }
    }
    // 同じ名前の品目があれば、そこを上書きする（名前が品目の識別になる）
    if (!rowIdx && sameName) { rowIdx = sameName; row[0] = String(sh.getRange(sameName, 1).getValue()); }
    row[8] = rowIdx ? sh.getRange(rowIdx, 9).getValue() || Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss') : Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss');
    if (rowIdx) sh.getRange(rowIdx, 1, 1, row.length).setValues([row]);
    else sh.getRange(Math.max(last, 1) + 1, 1, 1, row.length).setValues([row]);
    invalidate_(MFSH);
    id = row[0];
  } finally {
    lock.releaseLock();
  }
  return id;
}

function mealFoodDelete(id) {
  ensureMeal_();
  id = String(id || '');
  if (!id) return true;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(MFSH), last = sh.getLastRow();
    if (last >= 2) {
      var ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) sh.deleteRow(i + 2);
    }
    invalidate_(MFSH);
  } finally {
    lock.releaseLock();
  }
  return true;
}

function mNum_(v) { var n = Number(v); return isNaN(n) ? 0 : n; }

function mealObj_(r) {
  return {
    id: String(r[0]), date: ymd_(r[1]), time: String(r[2] || ''), type: String(r[3] || ''), text: String(r[4] || ''),
    kcal: mNum_(r[5]), protein: mNum_(r[6]), fat: mNum_(r[7]), carbs: mNum_(r[8]), items: String(r[9] || ''), note: String(r[10] || '')
  };
}

function mealGoals_() {
  var p = PropertiesService.getScriptProperties();
  function g(k) { var v = Number(p.getProperty(k)); return v > 0 ? v : 0; }
  return { kcal: g('MEAL_GOAL_KCAL'), protein: g('MEAL_GOAL_P'), fat: g('MEAL_GOAL_F') };
}

/** 体組成の最新値から、目標の目安を出す（たんぱく質＝体重×1.8g、維持カロリー＝基礎代謝×1.4）。体組成が無ければ null */
function mealSuggest_() {
  try {
    var logs = bodyGet().logs, w = null, bmr = null;
    logs.forEach(function (l) { if (w === null && l.weight !== null) w = l.weight; if (bmr === null && l.bmr !== null) bmr = l.bmr; });
    if (w === null) return null;
    var out = { protein: Math.round(w * 1.8) };
    if (bmr !== null) { out.maintenanceKcal = Math.round(bmr * 1.4 / 10) * 10; out.cutKcal = out.maintenanceKcal - 500; }
    return out;
  } catch (e) { return null; }
}

function mealGet() {
  ensureMeal_();
  var from = addDays_(today_(), -120);
  var logs = rows_(MSH).filter(function (r) { return String(r[0]).trim() !== '' && ymd_(r[1]) >= from; }).map(mealObj_);
  logs.sort(function (a, b) { return a.date === b.date ? (a.time < b.time ? 1 : -1) : (a.date < b.date ? 1 : -1); });
  return { today: today_(), logs: logs, goals: mealGoals_(), suggest: mealSuggest_(), foods: mealFoods_() };
}

function mealSave(p) {
  ensureMeal_();
  p = p || {};
  var id = String(p.id || '').trim();
  if (!id) throw new Error('IDがありません');
  var date = ymd_(p.date);
  if (!date) throw new Error('日付が正しくありません');
  if (toDays_(date) > toDays_(today_())) throw new Error('未来の日付は記録できません');
  var time = String(p.time || '').trim();
  if (time && !/^([01]?\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('時刻が正しくありません');
  if (time && time.length === 4) time = '0' + time;
  var type = MEAL_TYPES.indexOf(p.type) >= 0 ? p.type : 'その他';
  function n(v, label, max) {
    var x = v === '' || v === null || v === undefined ? 0 : Number(v);
    if (isNaN(x) || x < 0 || x > max) throw new Error(label + 'は0〜' + max + 'で入力してください');
    return Math.round(x * 10) / 10;
  }
  var kcal = Math.round(n(p.kcal, 'カロリー', 6000));
  var protein = n(p.protein, 'たんぱく質', 500), fat = n(p.fat, '脂質', 500), carbs = n(p.carbs, '炭水化物', 1000);
  var text = String(p.text || '').replace(/\r\n?/g, '\n').trim().slice(0, 600);
  if (!text && !kcal) throw new Error('食事の内容かカロリーを入力してください');
  var items = String(p.items || '').slice(0, 1500), note = String(p.note || '').slice(0, 300);

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(MSH), last = sh.getLastRow(), rowIdx = 0, created = '';
    if (last >= 2) {
      var ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) { rowIdx = i + 2; break; }
      if (rowIdx) created = sh.getRange(rowIdx, 12).getValue();
    }
    if (!created) created = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm:ss');
    var row = [id, date, time, type, text, kcal, protein, fat, carbs, items, note, created];
    if (rowIdx) sh.getRange(rowIdx, 1, 1, row.length).setValues([row]);
    else sh.getRange(Math.max(last, 1) + 1, 1, 1, row.length).setValues([row]);
    invalidate_(MSH);
  } finally {
    lock.releaseLock();
  }
  return id;
}

function mealDelete(id) {
  ensureMeal_();
  id = String(id || '');
  if (!id) return true;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var sh = sheet_(MSH), last = sh.getLastRow();
    if (last >= 2) {
      var ids = sh.getRange(2, 1, last - 1, 1).getValues();
      for (var i = ids.length - 1; i >= 0; i--) if (String(ids[i][0]) === id) sh.deleteRow(i + 2);
    }
    invalidate_(MSH);
  } finally {
    lock.releaseLock();
  }
  return true;
}

function mealSetGoals(g) {
  g = g || {};
  var pr = PropertiesService.getScriptProperties();
  [['kcal', 'MEAL_GOAL_KCAL', 6000], ['protein', 'MEAL_GOAL_P', 500], ['fat', 'MEAL_GOAL_F', 500]].forEach(function (d) {
    var v = g[d[0]] === '' || g[d[0]] === null || g[d[0]] === undefined ? 0 : Number(g[d[0]]);
    if (isNaN(v) || v < 0 || v > d[2]) throw new Error('目標は0〜' + d[2] + 'で入力してください（0＝設定なし）');
    pr.setProperty(d[1], String(Math.round(v)));
  });
  return mealGoals_();
}

/* ============================================================
 * 食事内容 → 栄養の見積もり（Gemini）
 * ============================================================ */

function mealEstimateSystem_() {
  return [
    'あなたは管理栄養士です。ユーザーが書いた「ざっくりした食事の内容」から、日本の一般的な食事を想定して、カロリーとたんぱく質・脂質・炭水化物を見積もります。',
    '',
    '## ルール',
    '- 食品ごとに分けて見積もる（items）。主食・主菜・副菜・汁物・飲み物・調味料や調理油も別の行にする。',
    '- 量が書かれていない場合は、日本の標準的な1人前（ご飯茶碗1杯＝150g、食パン6枚切り1枚＝60g、卵1個＝50g など）で見積もり、amount に想定した量を書く。量が書かれていればそれに従う。',
    '- 外食・コンビニ・市販品は、一般的な値を目安にする。ブランド名が分かる場合はそのおおよその値を使う。',
    '- 調理油・マヨネーズ・ドレッシング・バターなど、見えにくい脂質を見落とさない。揚げ物は衣と吸油を含める。',
    '- お酒は alcohol にアルコール量(g)を入れる（ビール350ml≒14g、ワイン1杯120ml≒11g、日本酒1合≒22g、焼酎・ウイスキー水割り1杯≒10〜12g）。糖質を含む酒は carbs にも入れる。',
    '- 各行の kcal は、たんぱく質×4＋脂質×9＋炭水化物×4＋アルコール×7 に近い値にする（食物繊維などの誤差は許容）。',
    '- 数値は小数1桁まで。たんぱく質・脂質・炭水化物はグラム。',
    '- 推定の確からしさ confidence は「高」「中」「低」のいずれか。量が曖昧、外食、品名が不明なら「中」または「低」にし、note に、何がぶれやすいか（例：油の量、ご飯の量）を1〜2文で書く。',
    '- 食事と無関係な内容や、読み取れない内容のときは items を空にし、note に理由を書く。',
    '- 「登録済みの品目」が渡された場合、食事の内容にその名前（またはほぼ同じ呼び名）が出てきたら、その品目に登録された栄養をそのまま使う（推測し直さない）。「半分」「2杯」「1.5倍」など量の指定があれば、その倍率で栄養を掛ける。登録済みの品目の行は name に品目名を使い、amount に量（例：1回分、×2）を書く。登録済みの品目と、それ以外の食品が混ざっていれば、それ以外だけを見積もる。',
    '- 日本語で、簡潔に。'
  ].join('\n');
}

function mealEstimateSchema_() {
  return {
    type: 'OBJECT',
    properties: {
      items: {
        type: 'ARRAY',
        items: {
          type: 'OBJECT',
          properties: {
            name: { type: 'STRING' },
            amount: { type: 'STRING', description: '想定した量。例：1杯(150g)、2個' },
            kcal: { type: 'NUMBER' }, protein: { type: 'NUMBER' }, fat: { type: 'NUMBER' }, carbs: { type: 'NUMBER' },
            alcohol: { type: 'NUMBER', description: 'アルコール量(g)。無ければ0' }
          },
          required: ['name', 'amount', 'kcal', 'protein', 'fat', 'carbs', 'alcohol']
        }
      },
      confidence: { type: 'STRING' },
      note: { type: 'STRING' }
    },
    required: ['items', 'confidence', 'note']
  };
}

/** AIの出力を整える：数値を丸め、kcal が三大栄養素の計算と大きく食い違う場合は計算値にそろえ、合計を出す */
function mealNormalize_(r) {
  r = r || {};
  function f(v, max) { var x = Number(v); if (isNaN(x) || x < 0) x = 0; return Math.round(Math.min(x, max) * 10) / 10; }
  var items = (r.items || []).slice(0, 30).map(function (it) {
    var p = f(it.protein, 300), fa = f(it.fat, 300), c = f(it.carbs, 600), al = f(it.alcohol, 300), k = f(it.kcal, 4000);
    var calc = p * 4 + fa * 9 + c * 4 + al * 7;
    if (!k || (calc > 0 && Math.abs(k - calc) > Math.max(30, calc * 0.2))) k = calc;
    return { name: String(it.name || '').slice(0, 40), amount: String(it.amount || '').slice(0, 40), kcal: Math.round(k), protein: p, fat: fa, carbs: c, alcohol: al };
  }).filter(function (it) { return it.name; });
  var t = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
  items.forEach(function (it) { t.kcal += it.kcal; t.protein += it.protein; t.fat += it.fat; t.carbs += it.carbs; });
  t.protein = Math.round(t.protein * 10) / 10; t.fat = Math.round(t.fat * 10) / 10; t.carbs = Math.round(t.carbs * 10) / 10;
  var conf = ['高', '中', '低'].indexOf(r.confidence) >= 0 ? r.confidence : '中';
  return { items: items, total: t, confidence: conf, note: String(r.note || '').slice(0, 300) };
}

function mealEstimate(req) {
  req = req || {};
  var text = String(req.text || '').replace(/\r\n?/g, '\n').trim();
  if (text.length < 2) throw new Error('食事の内容を入力してください');
  if (text.length > 600) throw new Error('食事の内容は600文字以内で入力してください');
  var type = MEAL_TYPES.indexOf(req.type) >= 0 ? req.type : 'その他';
  var foods = mealFoods_().slice(0, 60);
  var foodTxt = foods.length ? '\n\n登録済みの品目（1回分の栄養）：\n' + foods.map(function (f) {
    return '- ' + f.name + '：' + f.kcal + 'kcal、たんぱく質' + f.protein + 'g、脂質' + f.fat + 'g、炭水化物' + f.carbs + 'g' + (f.text ? '（内容：' + f.text.replace(/\n/g, ' ').slice(0, 120) + '）' : '');
  }).join('\n') : '';
  var res = gemini_(mealEstimateSystem_(), '区分：' + type + '\n食事の内容：\n' + text + foodTxt, mealEstimateSchema_());
  var out = mealNormalize_(res);
  if (!out.items.length) throw new Error(out.note || '食事の内容から栄養を見積もれませんでした。食べたものをもう少し具体的に書いてください');
  out.items.forEach(function (it) { it.line = it.name + (it.amount ? '（' + it.amount + '）' : '') + ' ' + it.kcal + 'kcal P' + it.protein + ' F' + it.fat + ' C' + it.carbs; });
  return out;
}

/** 動作確認用：エディタから実行して、シートが作られ読み書きできるか確かめる（テスト記録は削除される） */
function mealTest() {
  var id = 'meal-test-' + uuid_();
  mealSave({ id: id, date: today_(), time: '12:00', type: '昼食', text: 'テスト', kcal: 500, protein: 30, fat: 15, carbs: 60 });
  var g = mealGet().logs.filter(function (x) { return x.id === id; })[0];
  Logger.log('テスト記録: ' + JSON.stringify(g));
  mealDelete(id);
  Logger.log('テスト記録を削除しました');
}

/** 動作確認用：Gemini による見積もりを試す（実行ログに結果が出る。記録は作られない） */
function mealEstimateTest() {
  var r = mealEstimate({ type: '昼食', text: 'コンビニの鮭おにぎり2個とサラダチキン1個、野菜ジュース' });
  Logger.log(JSON.stringify(r));
}

/**
 * AIトレーナーに渡す食事の要約。記録が無い・読めない場合は null
 * 直近7日の1日ごとの合計、記録した日の平均、今日の合計、目標との差
 */
function aiMeal_(today) {
  try {
    var d = mealGet(), from = addDays_(today, -6), days = {};
    d.logs.forEach(function (l) {
      if (l.date < from || l.date > today) return;
      var x = days[l.date] = days[l.date] || { kcal: 0, protein: 0, fat: 0, carbs: 0, meals: 0 };
      x.kcal += l.kcal; x.protein += l.protein; x.fat += l.fat; x.carbs += l.carbs; x.meals++;
    });
    var keys = Object.keys(days).sort();
    if (!keys.length) return null;
    var avg = { kcal: 0, protein: 0, fat: 0, carbs: 0 };
    keys.forEach(function (k) { ['kcal', 'protein', 'fat', 'carbs'].forEach(function (f) { avg[f] += days[k][f]; }); });
    ['kcal', 'protein', 'fat', 'carbs'].forEach(function (f) { avg[f] = r1_(avg[f] / keys.length); });
    keys.forEach(function (k) { ['kcal', 'protein', 'fat', 'carbs'].forEach(function (f) { days[k][f] = r1_(days[k][f]); }); });
    var fatPct = avg.kcal ? Math.round(avg.fat * 9 / avg.kcal * 100) : null;
    return {
      daysLogged: keys.length, perDay: days, averagePerLoggedDay: avg, fatEnergyPercent: fatPct,
      today: days[today] || null, goals: d.goals,
      note: '記録した日だけの平均。食事の記録が抜けた日は、実際より少なく見える'
    };
  } catch (e) {
    return null;
  }
}
