/**
 * 「今の評価」と「食事の写真から見積もり」（Gemini）
 *  - bodyNowEval：体組成を保存した直後の一言評価（総合コーチの「全体の評価」とは別に、いまの測定だけを見る）
 *  - mealPhotoEstimate：食事の写真から栄養を見積もる。確信度が低いときだけ、タップで答えられる質問を返す。写真は保存しない
 */

/* ---------------- 今の評価 ---------------- */

function nowEvalSystem_() {
  return [
    'あなたは、減量・筋トレ中の本人に本音で伝える専属コーチです。体重計に乗った「直後」の、いまの測定についてだけ、一言で評価します。',
    '',
    '## ルール',
    '- 数値は渡されたJSONからそのまま引用する。再計算や、無い数値の追加をしない。',
    '- 体重・体脂肪率は日々±（体重0.5〜1kg、体脂肪率1%）程度ぶれる。1回の増減で一喜一憂させず、直近の平均や週平均との位置づけで語る。',
    '- 見る順：①今回の値が直近の平均より上か下か ②4週間の傾向 ③筋肉量（muscle）が落ちていないか ④計画との差（plan）があれば一言。',
    '- 測定時刻・タグ（朝・運動後・食後など）が分かれば、条件の違いによるぶれを考慮する。',
    '- 耳が痛いことも言うが、人格や努力を責めない。事実と、今日の一手を1つだけ添える。',
    '- comment：2文以内、110字以内。tone：good（良い方向）/ neutral（ぶれの範囲）/ watch（注意）のいずれか。',
    '- 診断・医療的な断定をしない。日本語。'
  ].join('\n');
}

/** 体組成の「今の評価」。画面のボタンを押したときだけ呼ばれる（保存のたびには呼ばない）。req.force で作り直し */
function bodyNowEval(req) {
  var today = today_(), body = aiBody_(today);
  if (!body) throw new Error('体組成の記録がまだありません');
  var pl = {};
  try { pl = planSettings_(); } catch (e) { pl = {}; }
  var data = {
    today: today, nowTime: Utilities.formatDate(new Date(), TZ, 'HH:mm'),
    goal: { goalFatPct: pl.goalFat || null, deadline: pl.deadline || null },
    body: body
  };
  // コメント生成は軽量モデル。同じ日・同じ測定なら、保存済みの評価を使う（ボタンを何度押しても Gemini は呼ばない）
  var keyData = { today: data.today, goal: data.goal, body: body };
  var res = aiCached_('now', keyData, !!(req && req.force), function () {
    var r = gemini_(nowEvalSystem_(), '# 記録データ（JSON）\n' + JSON.stringify(data), {
      type: 'OBJECT', properties: { comment: { type: 'STRING' }, tone: { type: 'STRING', enum: ['good', 'neutral', 'watch'] } }, required: ['comment', 'tone']
    }, null, { lite: true, fast: true });
    r.at = data.nowTime; // 評価した時刻も保存して、再表示のときに使う
    return r;
  });
  return { comment: planStr_(res.comment, 200), tone: ['good', 'neutral', 'watch'].indexOf(res.tone) >= 0 ? res.tone : 'neutral', at: res.at || Utilities.formatDate(new Date(), TZ, 'HH:mm'), cached: !!res.cached };
}

/* ---------------- 食事の写真 ---------------- */

function mealPhotoSystem_() {
  return mealEstimateSystem_() + '\n' + [
    '',
    '## 写真から見積もるときの追加ルール',
    '- 写真に写っているものだけを見積もる。写っていないものを足さない。皿・箸・手などを大きさの基準にして量を推定する。',
    '- 隠れて見えない中身（ご飯の下、スープの具、揚げ物の中身、かかっているソースの量）は、確信度を下げる理由にする。',
    '- 確信度 confidence が「低」のとき（または「中」でも、答えが分かれば大きく変わるとき）だけ、questions に最大2つ質問を入れる。確信度が「高」のときは questions は空にする。',
    '- 質問は、カロリーが大きく動く不確かさ（量・油の使い方・ソースやドレッシング・飲み物の種類・食べた割合）に絞る。「はい/いいえ」や短い選択肢で、写真を見ただけでは分からないことを聞く。',
    '- 質問ごとに options を2〜4個。タップで答えられる短い言葉にする（例：「普通盛り」「大盛り」「半分だけ食べた」）。',
    '- 「これまでの質問と回答」が渡されたら、その答えを反映して見積もり直し、同じ質問を繰り返さない。答えが出揃ったら questions は空にしてよい。',
    '- 食事の写真ではない・ぼやけて判別できないときは items を空にし、note に理由を書く。'
  ].join('\n');
}

function mealPhotoSchema_() {
  var s = mealEstimateSchema_();
  s.properties.questions = {
    type: 'ARRAY',
    items: { type: 'OBJECT', properties: { question: { type: 'STRING' }, options: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['question', 'options'] }
  };
  s.required = s.required.concat(['questions']);
  return s;
}

/**
 * req: { image:{mime,data(base64)}, type:'朝食'…, text:'補足（任意）', qa:[{q,a}]（これまでの質問と回答） }
 * 戻り値：mealEstimate と同じ形（items,total,confidence,note）＋ questions:[{question,options[]}]
 */
function mealPhotoEstimate(req) {
  req = req || {};
  var im = req.image || {};
  if (!/^image\/(jpeg|png|webp)$/.test(String(im.mime || ''))) throw new Error('写真の形式が読み取れません（JPEG・PNG・WebPに対応）');
  var data = String(im.data || '');
  if (data.length < 200) throw new Error('写真が読み取れませんでした。もう一度撮影してください');
  if (data.length > 3500000) throw new Error('写真が大きすぎます。もう一度撮影してください');
  var type = MEAL_TYPES.indexOf(req.type) >= 0 ? req.type : 'その他';
  var note = String(req.text || '').replace(/\r\n?/g, '\n').trim().slice(0, 300);
  var qa = (req.qa || []).slice(0, 6).map(function (x) { return '- ' + String(x.q || '').slice(0, 80) + ' → ' + String(x.a || '').slice(0, 60); });
  var foods = [];
  try { foods = mealFoods_().slice(0, 40); } catch (e) { foods = []; }
  var foodTxt = foods.length ? '\n\n登録済みの品目（写真のものと同じなら、この栄養を使う）：\n' + foods.map(function (f) {
    return '- ' + f.name + '：' + f.kcal + 'kcal、たんぱく質' + f.protein + 'g、脂質' + f.fat + 'g、炭水化物' + f.carbs + 'g';
  }).join('\n') : '';
  var user = '区分：' + type + '\n写真の食事を見積もってください。' + (note ? '\n本人の補足：' + note : '')
    + (qa.length ? '\n\nこれまでの質問と回答：\n' + qa.join('\n') : '') + foodTxt;
  var res = gemini_(mealPhotoSystem_(), user, mealPhotoSchema_(), [{ mime: im.mime, data: data }]);
  var out = mealNormalize_(res);
  if (!out.items.length) throw new Error(out.note || '写真から食事を読み取れませんでした。明るい場所で、料理全体が写るように撮り直してください');
  out.items.forEach(function (it) { it.line = it.name + (it.amount ? '（' + it.amount + '）' : '') + ' ' + it.kcal + 'kcal P' + it.protein + ' F' + it.fat + ' C' + it.carbs; });
  // 質問は、確信度が高くないときだけ。最大2つ、選択肢は2〜4個
  out.questions = [];
  if (out.confidence !== '高') {
    (res.questions || []).slice(0, 2).forEach(function (q) {
      var opts = (q.options || []).map(function (o) { return String(o || '').slice(0, 24); }).filter(Boolean).slice(0, 4);
      if (q.question && opts.length >= 2) out.questions.push({ question: String(q.question).slice(0, 80), options: opts });
    });
  }
  return out;
}
