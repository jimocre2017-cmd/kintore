/* 使い方ガイド：全画面共通。
 * ・初回ガイド（はじめて開いたときに1回だけ出る、めくり式の説明）
 * ・「？ 使い方」ボタン（この画面の使い方・はじめの流れ・用語集・AIに使い方を聞く）
 * 説明文はこのファイルだけに置く。AIへの「使い方の質問」にも同じ説明書（KTGuide.manual()）を渡すので、
 * 画面を変えたらここを直せば、ガイドとAIの答えの両方がそろう。
 * 使い方：各画面で api.js・coach.js の後に <script src="guide.js"></script> を読み込むだけ。 */
(function (root) {
  'use strict';

  var SEEN_KEY = 'kt_guide_seen_v1';

  /* ---------- 説明の中身 ---------- */

  // 初回ガイド（めくり式）。1枚＝[アイコン, 見出し, 本文の行]
  var TOUR = [
    ['💪', 'ようこそ！', [
      'このアプリは、筋トレ・有酸素・体重計の数値・食事・体つきの写真を記録して、目標の体に近づくための道具です。',
      '筋トレもアプリも初めてで大丈夫。まずは「記録するだけ」で十分です。分析は記録がたまると自動で出てきます。AIのアドバイスは、ボタンを押したときに出ます。'
    ]],
    ['🗺️', '画面の地図', [
      '筋トレ記録（最初の画面）… 1セットごとに記録',
      '有酸素 … ウォーキング・ランニング',
      '体組成 … 体重計の数値（写真・減量計画もここから）',
      '食事 … 食べた物を書くとAIがカロリーを見積もり',
      '分析 … 日・週・月・年の合計やグラフ',
      '上の「→」のリンクで画面を行き来します。'
    ]],
    ['🏋️', '筋トレの記録は3ステップ', [
      '① 一覧から、今からやる種目をタップ',
      '② 回数（レップ）と重さ（kg）を合わせる',
      '③ 1セット終わったら「＋ セット記録」を押す',
      '押すと休憩タイマーが自動で始まります。終わったら次のセットへ。間違えたら「今日のセット」から取り消せます。'
    ]],
    ['📊', '記録は自動でまとまる', [
      '部位ごとのセット数・回数・総負荷量（重さ×回数の合計）が、分析画面で日・週・月・四半期・年ごとに見られます。',
      '最初は「日」の表示。今日なにをどれだけやったかが一目で分かります。'
    ]],
    ['⚖️', '体重計と食事もつけると、もっと分かる', [
      '体組成：体重計に乗ったら数値を入れるだけ。毎朝、起床後（トイレの後・飲食前）にそろえると正確です。',
      '食事：「鶏むね定食、ごはん少なめ」のように書くと、AIがカロリー・たんぱく質・脂質を見積もります。',
      '目標の体脂肪率を決めると、減量計画の画面で1日の食事の目安が出ます。進み方は「第1期＝減量」→「第2期＝バルクか維持」→また減らしたくなったら第1期、と選んで行き来できます。'
    ]],
    ['🧭', '迷ったらAIに聞く', [
      '画面の「🧭 総合コーチ」を開き、「診断する」を押すと、記録をまとめて今の状態を診断します（AIを使うのはボタンを押したときだけ。同じ日の結果は保存され、使い回されます）。',
      '「相談」タブでは自由に質問できます。「アプリの使い方」を選べば、操作方法も教えてくれます。',
      '各画面の「？ 使い方」からも、いつでもこの説明とAIへの質問を開けます。'
    ]],
    ['📶', '電波がなくても大丈夫', [
      '記録は端末にいったん保存され、電波が戻ったら自動で送られます（上の「同期」ボタンに「未送信 3」のように数が出て、送り終わると「同期済」になります）。',
      'AIの診断・相談は、ネットにつながっている時だけ使えます。',
      'それでは始めましょう！'
    ]]
  ];

  // 画面ごとの使い方。キー＝ファイル名
  var PAGES = {
    'index.html': {
      title: '筋トレ記録',
      lead: '1セットやるたびに、その場で記録する画面です。タブレットやスマホを横に置いて使うのがおすすめ。',
      steps: [
        '一覧から今日やる種目をタップします。上の部位ボタン（胸・背中・脚など）やタグで絞り込めます。',
        '回数（レップ）と重さ（kg）を合わせます。前回の値が入っているので、同じなら触らなくてOK。',
        '1セット終わったら「＋ セット記録」。秒で測る種目（プランクなど）は「▶ スタート」→「■ ストップして記録」。',
        '記録すると下に休憩タイマー（インターバル）が出ます。−15／＋15で調整、「停止」で止めます。',
        '間違えたら「今日のセット」の「取消」。セットごとに備考（フォームの感覚・痛みなど）も残せます。',
        '使わない種目は「種目の表示設定」でオフ、新しい種目は「＋ 種目を追加」から。',
        '上の数字は今日の合計（セット・レップ・総負荷量・秒・推定の消費kcal）です。'
      ],
      tips: [
        'はじめは、1種目3セット×10回くらいを目安に、正しいフォームでできる重さから。',
        '「カウンセリングシート」（一覧の下）に答えると、AIがあなたの目的・体の状態・器具に合わせて答えるようになります。'
      ]
    },
    'cardio.html': {
      title: '有酸素記録',
      lead: 'ウォーキング・ランニングを記録する画面です。',
      steps: [
        'スマホを持って出るときは「🚶 歩く（GPS記録）」か「🏃 走る（GPS記録）」→ 終わったら「■ 終了して保存」。距離・ルート・平均時速が自動で入ります。',
        '持ち歩けなかった日は「＋ 手動で追加」。距離・時間、出発地・到着地（またはコース）を選んで保存します。',
        'よく通る道は、記録の詳細から「このルートをコースに登録」。次から手動入力で選べます。',
        'カレンダーで記録した日・空いた日が分かります。日付をタップすると、その日の記録を開く（無ければ追加）。',
        '消費カロリーは、平均時速と体重から自動で計算し、筋トレの分と合わせて分析画面に出ます。'
      ],
      tips: ['GPSは屋外で、記録中も画面を閉じすぎないほうが正確です。']
    },
    'body.html': {
      title: '体組成記録',
      lead: '体重計（体組成計）の数値を記録して、推移と過去との比較を見る画面です。',
      steps: [
        '「体重計の数値を記録」から、体重・体脂肪率・骨格筋率・BMI・基礎代謝・内臓脂肪レベルを入れます。分からない項目は空欄でOK。',
        '測った条件（起床後・食事後・排便後など）を選びます。基準は「起床後」（トイレの後・飲食の前）。毎日そろえると変化が正確に分かります。',
        '1日に何回測ってもOK。日の平均と、時間による変化が出ます。',
        '数値が大きくぶれた測定は、行をタップして「集計から除外」にできます（記録は残ります）。',
        '「目標と試算」で目標の体脂肪率を入れると、目標体重と減らす脂肪の量が出ます。',
        '保存した直後に「今の評価」が出ます。いまの測定を、直近の平均・4週の傾向・目標とくらべてAIが一言で評価します。',
        '「FFMIの位置」では、筋肉の厚み（FFMI）が同性・同年代の中でどのあたりかを、日本・アジア・世界の分布で見られます。性別と年齢が必要です（カウンセリングシートか、その場で入力）。スライダーで「筋肉を増やしたら」も試せます。',
        '上の「減量計画」「写真」から、それぞれの画面へ行けます。'
      ],
      tips: ['体重・体脂肪率は1日で±1kg・±1%ほど普通にぶれます。1回の値ではなく、週の傾向で見ましょう。']
    },
    'meal.html': {
      title: '食事記録',
      lead: '食べた物を書くと、AIがカロリー・たんぱく質・脂質・炭水化物を見積もって記録する画面です。',
      steps: [
        '食事の区分（朝食・昼食など）を選び、食べた物をふだんの言葉で書きます（例：「コンビニのおにぎり2個とサラダチキン」）。書く代わりに、📷で料理を撮るか、🖼でスマホにある写真（添付・ギャラリー）を選ぶだけでもOK。すぐ見積もります（写真は保存しません）。',
        'AIが「量が分かりにくい」と感じたときだけ、タップで答える質問が出ます。答えると見積もりが正確になります。',
        'AIの見積もりを確認し、分かっている数値（成分表など）があれば直して保存します。電波が無くても数値を直接入れれば保存できます。',
        'よく食べる物は「この内容を品目として覚える」。次から名前で入力できます。',
        '1日の目標は、体組成の記録とマスタープラン（今の期）から自動で計算されます。自分で決めたいときは「1日の目標を設定」で「自動」のチェックを外し、目安・下限・上限を入れてください。入れると、今日の達成率と直近7日の結果が色で出ます（緑＝目標内、多い・少ないは色が変わります）。',
        '炭水化物は、カロリー・たんぱく質・脂質の目標から自動で「範囲」が出ます。残りは「あと白ご飯◯g（茶碗◯杯）／パスタ（バリラの乾麺）◯g／ジモカフェのフォカッチャ◯個」でも見られます。',
        '多すぎ・少なすぎのときは「減らす・増やす方法」が出ます。外食の前などはAIに食事相談もできます。'
      ],
      tips: ['見積もりは概算です。毎回完璧にするより、抜けなく続けるほうが大事です。']
    },
    'photo.html': {
      title: '体つき写真',
      lead: '体つきの写真（前・横・後ろ）を撮って、過去と見比べる画面です。',
      steps: [
        '「＋ 体つきを撮る（前・横・後ろ）」で撮るか、写真を選びます（1〜3枚）。',
        '「前の写真と並べる」や「この2枚を比べる」で、スワイプ・スライダー・並べて比較できます。',
        '「AIに所見を聞く」で、見た目の変化をAIが評価します（体組成の数値と照らし合わせます）。'
      ],
      tips: ['同じ場所・同じ距離・同じ明るさ・同じ服装で、足先から頭まで入れて撮ると比べやすくなります。']
    },
    'plan.html': {
      title: '減量計画',
      lead: '目標の体脂肪率と期限から、1日に食べてよい量と、途中の目標ラインを出す画面です。',
      steps: [
        '一番上の「目標に対する現在地」で、開始・現在・目標（体脂肪率・体重・脂肪の量）を並べて確認できます。バーは開始から目標までの進み具合です（維持期は「守る範囲」と比べます）。',
        '「マスタープラン」の「いまのモード」で、記録だけ／第1期（減量）／第2期バルク（増量）／第2期維持（現状維持）を切り替えます。「記録だけ」は助言のポップアップ・案内・今週の判定を止めて記録に集中するモードで、直前の道は覚えています。第1期の体脂肪率目標に届くと選ぶ案内が出ます。第2期の中はバルクと維持を行き来でき、また減らしたいときは第1期に戻します。次週のカロリーはモードに連動します（第1期＝消費−赤字を1,660〜1,800kcalの範囲で／バルク＝消費の+7.5%を体重の増え方（週0.25〜0.5%）で微調整し1,950〜2,100kcalの範囲で／維持＝消費そのまま）。毎週、先週（月〜日）の記録で自動採用され、動く幅は週200kcalまで。「記録だけ」のときは自動では変えません。外食前の数日の節制は、同じ週の平均で見るので心配いりません（深く削らず、たんぱく質は守る）。言葉の意味は各所の「ⓘ」から見られます。',
        '「計画の設定」で、いまの局面（減量期／維持期）・目標の体脂肪率・期限（または1週間に減らす量）・開始日を入れます。',
        '無理のない減量の目安は1週間に0.4〜0.6kg（体重の1%以内）。「終盤を緩やかに」がおすすめです。',
        '計画ラインと実績のずれが、日・週・月で見られます。毎週、次週のカロリー調整案をAIが出します。',
        '旅行や年末年始などで休む期間は、総合コーチの「相談」で頼むと、休止期間として計画に反映できます。',
        '維持期は、最低体脂肪率を割らないように、維持カロリーで過ごす設定です。'
      ],
      tips: ['体組成が10日分たまると、実際の記録から消費カロリーを計算するようになり、精度が上がります。']
    },
    'analytics.html': {
      title: '筋トレ分析',
      lead: '記録をまとめて振り返る画面です。',
      steps: [
        '上で期間（日・週・月・四半期・年）を切り替えます。最初は「日」（今日）です。',
        '部位別：胸・背中・脚などの合計セット・レップ・総負荷量。部位マップの部位をタップすると詳しく出ます。',
        '種目別：種目ごとの合計、最大負荷、ベストセット。',
        '消費カロリー：筋トレ＋有酸素の合計と内訳。',
        '日計の日付をタップすると、その日のセット明細が見られます。'
      ],
      tips: ['付随部位（例：ベンチプレスの肩・腕）は0.5セットとして部位別に数えます。全体の合計は二重に数えません。']
    }
  };

  // 用語集：[言葉, 意味]
  var GLOSSARY = [
    ['レップ（回数）', '1回の動作。10回上げ下げしたら10レップ。'],
    ['セット', '続けて行う回数のまとまり。「10回×3セット」＝10回やって休憩、を3回。'],
    ['インターバル', 'セットとセットの間の休憩。筋肉を大きくしたいなら1〜2分くらいが目安。'],
    ['総負荷量', '重さ×回数の合計（kg）。両手のダンベルは×2。自重・チューブ・ハンドグリップは含めません。'],
    ['メイン部位・付随部位', '主に鍛える部位と、一緒に使われる部位。付随部位は0.5セットとして数えます。'],
    ['秒の種目', 'プランクなど、回数ではなく時間で測る種目。タイマーで計測して記録します。'],
    ['体脂肪率', '体重のうち脂肪が占める割合（%）。日々±1%ほどぶれるので、週の平均で見ます。'],
    ['FFMI', '除脂肪体重÷身長(m)²。筋肉の厚みの指標で、脂肪が減っても筋肉が減らなければ下がりません。男性の平均は約18〜19、女性は約15〜16。'],
    ['除脂肪体重', '体重から脂肪を引いた重さ（筋肉・骨・水分など）。減量中はこれを減らさないのが大事。'],
    ['基礎代謝', '何もしなくても1日に使うエネルギー（kcal）。'],
    ['維持カロリー', '体重が増えも減りもしない1日の食事量の目安。これより少なく食べると減量になります。'],
    ['減量期・維持期・増量期', '脂肪を落とす時期／体脂肪率を保つ時期／筋肉を増やすために少し多めに食べる時期。', 'phases'],
    ['リコンプ（リコンプ期）', '体重はあまり動かさずに、体脂肪を減らしながら筋肉を保つ・増やす同時進行の期間。食事は維持カロリーの前後〜やや控えめ、たんぱく質は高め、筋トレは重さとセット数を落とさずに進めます。成果は体重ではなく、体脂肪率・除脂肪量・ウエスト・体つき写真で見ます。筋トレを始めたばかり・ブランク明け・体脂肪が多めの人ほど効果が出やすい方法です。マスタープランの「第1期」がこれにあたります。', 'recomp'],
    ['リーンバルク（リーンバルク仕上げ）', '脂肪をなるべく増やさずに、筋肉を増やすことを優先する増量期。食事は維持カロリーより少しだけ多め（目安＋5〜10%、約＋200〜300kcal）、有酸素は減らして回復と筋肥大を優先します。体重はゆっくり増え（目安は週に体重の0.25〜0.5%）、増え方が速すぎるときは脂肪が乗っているので食事を少し戻します。「仕上げ」は、リコンプで体脂肪を下げたあとに、増やしすぎず筋量を乗せ切る段階のこと。マスタープランの「第2期」がこれにあたります。', 'leanbulk'],
    ['維持期（現状維持）', '第1期のあと、体脂肪率と筋肉を「いまのまま保つ」道。食事は維持カロリー（体重と活動量から計算）で、減らしも増やしもしません。体脂肪率が最低ラインを割りそうなら少し多めに、許容帯（最低＋1.5%）の上を超えたら少し控えます。リーンバルクのように体重を増やさず、リコンプのように減らしもしないので、いったん体を安定させたい・仕事や生活が忙しい時期に向きます。第2期（リーンバルク）と選べます。', 'maintain'],
    ['リコンプとリーンバルクの違い', 'カロリー：リコンプは維持前後〜やや控えめ／リーンバルクは維持より少し多め。\n体重：リコンプはほとんど変わらない／リーンバルクはゆっくり増える。\n脂肪：リコンプは減る／リーンバルクはわずかに増える（想定内）。\n筋肉の増え方：リコンプは遅め／リーンバルクは速め。\n向く人：リコンプは初心者・ブランク明け・体脂肪が多め／リーンバルクは体脂肪が下がって経験がある人。\n見る数字：リコンプは体脂肪率・除脂肪量・写真／リーンバルクは体重の増え方と、その中身（筋肉か脂肪か）。\n順番：このアプリのマスタープランは、先にリコンプで体脂肪率を下げ、目標に届いたらリーンバルクへ進む2段階です。', 'diff'],
    ['同期・未送信', '記録はまず端末に保存され、ネットにつながると自動で送られます。送る前の記録は「未送信」と表示されます。']
  ];

  // 「気になる言葉」のチップ：[GLOSSARY の飛び先キー, ボタンの文字]
  var TERMS = [['recomp', 'リコンプ期とは？'], ['leanbulk', 'リーンバルクとは？'], ['maintain', '維持期とは？'], ['diff', '2つの違い'], ['phases', '減量期・維持期・増量期']];

  // AIに聞く「よくある質問」：[ボタンの文字, 送る質問]
  var FAQ = [
    ['最初に何をすればいい？', 'このアプリを使い始めたばかりです。最初の1週間は、どの画面で何をすればいいですか？'],
    ['1セットの記録のしかた', '筋トレで1セットを記録する手順を、ボタンの名前つきで教えてください'],
    ['この画面の見方', 'いま開いている画面の見方と使い方を、初心者向けに教えてください'],
    ['間違えた記録を直したい', '間違えて記録したセットや食事・体組成を、直したり取り消したりする方法は？'],
    ['電波がない時は？', '電波がない場所でも記録できますか？あとでどうなりますか？'],
    ['どのAIを使えばいい？', '総合コーチ・AIトレーナー・減量計画・写真のAIは、それぞれいつ使えばいいですか？']
  ];

  // 参考文献・出典：[グループ名, [[書誌, このアプリでの使い道, URL（無ければ空）], ...]]。docs/references.md と同じ内容（test/guide.test.js で突き合わせる）
  var REFERENCES = [
    ['食事の目標（たんぱく質・脂質・カロリー）— 2026-11-19に内容を確認', [
      ['Morton RW, et al. (2018). A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. Br J Sports Med 52(6):376-384.', 'たんぱく質は約1.6g/kg/日を超えても、筋トレによる除脂肪量の増加は増えにくい（体重基準の「下限×1.6」「目安×1.8」の根拠）。', 'https://doi.org/10.1136/bjsports-2017-097608'],
      ['Jäger R, et al. (2017). International Society of Sports Nutrition Position Stand: protein and exercise. J Int Soc Sports Nutr 14:20.', '筋量をつくる・保つには1.4〜2.0g/kg/日。筋トレをしている人が摂取カロリーを抑えている期間（減量期）は2.3〜3.1g/kg/日が必要になる場合がある。', 'https://doi.org/10.1186/s12970-017-0177-8'],
      ['Whittaker J, Wu K. (2021). Low-fat diets and testosterone in men: Systematic review and meta-analysis of intervention studies. J Steroid Biochem Mol Biol 210:105878.', '脂質をエネルギーの40%から20%に下げると、男性の総テストステロンが10〜15%低下した（6試験・206人、値は正常範囲内）。脂質の下限を20%付近に置く参考。「20%未満は危険」という閾値を示した研究ではなく、著者もさらなる試験が必要としている。', 'https://doi.org/10.1016/j.jsbmb.2021.105878'],
      ['Thomas DT, Erdman KA, Burke LM. (2016). Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and the American College of Sports Medicine: Nutrition and Athletic Performance. J Acad Nutr Diet 116(3):501-528.', '脂質の範囲（エネルギーの20〜35%）の参考にした立場表明。※この数値が本文にあることは、今回は本文では確認していない。', 'https://doi.org/10.1016/j.jand.2015.12.006']
    ]],
    ['アプリ独自の設定値（研究で決まった値ではない・見直し可）', [
      ['たんぱく質の上限＝体重×2.2g、体脂肪率20%以上は除脂肪量×2.0〜2.5g（目安×2.2）', '2.2と、20%で基準を切り替える点、除脂肪量の係数は、レビュー（Gemini）をもとにアプリ側で決めた値。', ''],
      ['脂質の上限＝カロリーの30%、下限＝カロリーの20%か40gの大きいほう', '上限30%は、残りのカロリーから逆算した値が大きくなりすぎないようにする設計上の値。', ''],
      ['維持カロリー＝基礎代謝×1.35、範囲±150kcal', '直近の減量ログ（摂取量と体重変化）から逆算した消費量に近い値。数週間の記録が根拠なので、体重の推移を見て見直す。', '']
    ]],
    ['すでにアプリが使っている式・分布（コードに書かれた出典。今回は再確認していない）', [
      ['Kouri EM, et al. (1995). 補正FFMI（身長の補正と、ナチュラルの上限目安＝補正FFMI約25）', 'FFMI機能。男性のみ・絶対的な壁ではない。', ''],
      ['Kim et al. Nutrients 2026;18(8):1170（韓国 KNHANES 2022–23）／Jin et al. Clin Nutr 2019（中国）／Schutz・Kyle 2002（スイス）', 'FFMIを同性・同年代と比べる分布（日本の若年成人の全国分布が見つからず、65歳未満は韓国の値で代用）。', ''],
      ['Compendium of Physical Activities（運動強度METsの代表値）', '有酸素・筋トレの消費カロリー推定（MET × 体重 × 時間）。時速の間は線形補間。', ''],
      ['脂肪1kg ≒ 7200kcal', '減量の必要カロリー・ペースの計算に使う一般的な概算の換算値。', '']
    ]]
  ];

  // AI（総合コーチの「アプリの使い方」相談）に渡す説明書。全画面の説明と用語集をまとめた文章
  function manual() {
    var out = ['# 筋トレトラッカー（アプリ）の説明書',
      '画面：筋トレ記録（index.html・最初の画面）／有酸素（cardio.html）／体組成（body.html）／食事（meal.html）／体つき写真（photo.html）／減量計画（plan.html）／分析（analytics.html）。画面上部の「→」リンクで移動する。',
      '全画面共通：「🧭 総合コーチ」（診断＝「診断する」ボタンを押したときだけ記録全体から今の状態を判定／相談＝自由に質問。テーマ「アプリの使い方」で操作の質問にも答える）、「？ 使い方」（その画面の説明・用語集・初回ガイドの見直し）、上部の「同期」ボタン（未送信の数・オフライン・同期済を表示。押すとすぐ送る。「送信失敗」は押すと内容を確認できる）。',
      'オフライン：記録は端末に保存され、ネットに戻ると自動で送られる。AI（診断・相談・見積もり・所見）はオンラインの時だけ。',
      '助言のポップアップ：体脂肪率の直近7日平均などの数値に応じて、アプリを開いたときや体組成の記録後に助言が出る（例：維持期で許容帯の上を超えたら第1期に戻す目安）。「？ 使い方」の「記録だけのモード」にすると出ない。',
      '次週のカロリーはマスタープランのモードに連動し、毎週自動で採用（週200kcalまで、記録不足の週は据え置き）。コンセプト：モードは「記録だけ／第1期（減量）／第2期バルク／第2期維持」の4つ。第1期で減量（リコンプ）→第2期はバルク（増量）か維持（現状維持）を選ぶ→また減らしたいときは第1期へ、と行き来する。炭水化物は残りを白ご飯・パスタ・フォカッチャで換算して見る。AIはボタンを押したときだけ使い、同じ入力の結果は保存して使い回す（利用上限の対策）。',
      'AIの使い分け：いまどうか＝総合コーチ／毎週のカロリー調整＝減量計画の画面／見た目の変化＝体つき写真の「AIに所見を聞く」／トレーニングメニューの作成＝筋トレ記録画面の「AIトレーナー」（目立たない位置のボタン）。',
      '最初に：筋トレ記録画面でカウンセリングシート（5分・はい／いいえ中心。3か月ごとに見直し）に答えると、AIが本人の目的・痛み・器具を踏まえて答える。総合コーチの相談タブの「カルテ」には痛み・避けたい動作を書ける。'];
    Object.keys(PAGES).forEach(function (k) {
      var p = PAGES[k];
      out.push('', '## ' + p.title + '（' + k + '）', p.lead);
      p.steps.forEach(function (s, i) { out.push((i + 1) + '. ' + s); });
      (p.tips || []).forEach(function (t) { out.push('・コツ：' + t); });
    });
    out.push('', '## 用語');
    GLOSSARY.forEach(function (g) { out.push('・' + g[0] + '：' + g[1]); });
    return out.join('\n');
  }

  function pageKey(path) {
    var f = String(path || '').split('?')[0].split('#')[0].split('/').pop();
    return PAGES[f] ? f : 'index.html';
  }

  var api = { TOUR: TOUR, PAGES: PAGES, GLOSSARY: GLOSSARY, REFERENCES: REFERENCES, TERMS: TERMS, FAQ: FAQ, manual: manual, pageKey: pageKey };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; } // テスト（node）用
  if (root.KTGuide) return;
  root.KTGuide = api;

  /* ---------- 画面（ブラウザ） ---------- */

  var doc = root.document, ov = null, tourIdx = 0, mode = '', afterTour = [];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function seen() { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return true; } }
  function setSeen() { try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {} }
  function here() { return pageKey(root.location && root.location.pathname); }

  function css() {
    var st = doc.createElement('style');
    st.textContent =
      '.ktgbtn{border:1px solid var(--line,#e2e1dc);background:var(--surface,#fff);color:var(--ink-2,#55544f);border-radius:999px;padding:6px 12px;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap;font-family:inherit}' +
      '.ktgbtn:active{transform:scale(.97)}' +
      '.ktgov{position:fixed;inset:0;z-index:80;background:rgba(0,0,0,.5);display:none;align-items:flex-end;justify-content:center}' +
      '.ktgov.on{display:flex}' +
      '.ktgbox{background:var(--surface,#fff);color:var(--ink,#141413);width:min(620px,100%);max-height:90vh;overflow:auto;border-radius:16px 16px 0 0;padding:16px 16px 22px;line-height:1.7;-webkit-overflow-scrolling:touch;font-family:inherit}' +
      '@media(min-width:700px){.ktgov{align-items:center}.ktgbox{border-radius:16px}}' +
      '.ktgbox .gh{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px}.ktgbox h3{margin:0;font-size:16px}' +
      '.ktgbox .gx{border:1px solid var(--line,#e2e1dc);background:var(--surface,#fff);color:var(--ink-2,#55544f);border-radius:10px;padding:6px 12px;font-size:13px;cursor:pointer;font-family:inherit}' +
      '.ktgbox .lead{font-size:14px;color:var(--ink,#141413);margin:0 0 8px}' +
      '.ktgbox ol{margin:6px 0 0;padding-left:22px}.ktgbox ol li{margin:4px 0;font-size:14px}' +
      '.ktgbox .tip{background:var(--surface-2,#f0efec);border-radius:10px;padding:8px 10px;margin-top:8px;font-size:13px}' +
      '.ktgbox .sec{margin-top:16px}.ktgbox .sec>b{display:block;font-size:13px;color:var(--ink-2,#55544f);margin-bottom:4px}' +
      '.ktgbox details{border:1px solid var(--line,#e2e1dc);border-radius:10px;padding:8px 10px;margin-top:8px;font-size:14px}.ktgbox summary{cursor:pointer;font-weight:700}' +
      '.tlink{border:1px solid var(--line,#e2e1dc);background:transparent;color:var(--accent,#2a78d6);border-radius:999px;font:inherit;font-size:12px;font-weight:700;padding:1px 8px;margin-left:6px;cursor:pointer}' +
      '.ktgbox dt.hl{background:#ffe27a;color:#141413;border-radius:6px;padding:2px 6px}.ktgbox dd.hl{background:#fff3c4;color:#141413;border-radius:6px;padding:4px 6px}' +
      '.ktgbox .refs{margin:6px 0 0;padding-left:18px;font-size:12px}.ktgbox .refs li{margin-top:8px}.ktgbox .ruse{color:var(--ink-2,#55544f);margin-top:2px}.ktgbox .refs a{color:var(--accent,#2a78d6);font-weight:700}' +
      '.ktgbox dl{margin:6px 0 0}.ktgbox dt{font-weight:700;font-size:13px;margin-top:6px}.ktgbox dd{margin:0 0 0 2px;font-size:13px;color:var(--ink,#141413)}' +
      '.ktgbox .chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.ktgbox .chip{border:1px solid var(--line,#e2e1dc);background:var(--surface-2,#f0efec);color:var(--ink,#141413);border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer;font-family:inherit}' +
      '.ktgbox .go{width:100%;margin-top:10px;border:0;border-radius:12px;padding:12px;font-size:14px;font-weight:700;background:var(--accent,#2a78d6);color:var(--accent-ink,#fff);cursor:pointer;font-family:inherit}' +
      '.ktgbox .go.sub{background:var(--surface-2,#f0efec);color:var(--ink,#141413)}' +
      '.ktgbox .note{font-size:11px;color:var(--ink-2,#55544f);margin-top:6px}' +
      '.ktgbox .tico{font-size:44px;text-align:center;line-height:1.2;margin:8px 0 2px}.ktgbox .ttl{font-size:19px;font-weight:800;text-align:center;margin:0 0 8px}' +
      '.ktgbox .tbody p{margin:6px 0;font-size:15px}' +
      '.ktgbox .dots{display:flex;justify-content:center;gap:6px;margin:14px 0 4px}.ktgbox .dots i{width:8px;height:8px;border-radius:50%;background:var(--line,#e2e1dc)}.ktgbox .dots i.on{background:var(--accent,#2a78d6)}' +
      '.ktgbox .tnav{display:flex;gap:8px;margin-top:10px}.ktgbox .tnav button{flex:1;border-radius:12px;padding:12px;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;border:1px solid var(--line,#e2e1dc);background:var(--surface,#fff);color:var(--ink-2,#55544f)}' +
      '.ktgbox .tnav button.pri{border:0;background:var(--accent,#2a78d6);color:var(--accent-ink,#fff)}.ktgbox .tnav button[disabled]{opacity:.4}' +
      '.ktgbox .skip{display:block;margin:8px auto 0;border:0;background:none;color:var(--ink-3,#8a8983);font-size:12px;cursor:pointer;text-decoration:underline;font-family:inherit}';
    doc.head.appendChild(st);
  }

  function box(html) { ov.querySelector('.ktgbox').innerHTML = html; ov.classList.add('on'); }
  function close() {
    ov.classList.remove('on');
    if (mode === 'tour') { setSeen(); var fns = afterTour; afterTour = []; fns.forEach(function (f) { try { f(); } catch (e) {} }); }
    mode = '';
  }

  /* 初回ガイド */
  function tour(i) {
    mode = 'tour'; tourIdx = Math.max(0, Math.min(TOUR.length - 1, i || 0));
    var t = TOUR[tourIdx], last = tourIdx === TOUR.length - 1;
    var h = '<div class="tico">' + t[0] + '</div><div class="ttl">' + esc(t[1]) + '</div><div class="tbody">' +
      t[2].map(function (x) { return '<p>' + esc(x) + '</p>'; }).join('') + '</div>' +
      '<div class="dots">' + TOUR.map(function (_, k) { return '<i' + (k === tourIdx ? ' class="on"' : '') + '></i>'; }).join('') + '</div>' +
      '<div class="tnav"><button type="button" data-g="prev"' + (tourIdx ? '' : ' disabled') + '>戻る</button>' +
      '<button type="button" class="pri" data-g="' + (last ? 'done' : 'next') + '">' + (last ? 'はじめる' : '次へ') + '</button></div>' +
      (last ? '' : '<button type="button" class="skip" data-g="done">スキップ（あとで「？ 使い方」から見られます）</button>');
    box(h);
  }

  /* 使い方シート */
  function help(termKey) {
    mode = 'help';
    var p = PAGES[here()];
    var h = '<div class="gh"><h3>？ 使い方：' + esc(p.title) + '</h3><button class="gx" type="button" data-g="close">閉じる</button></div>' +
      '<p class="lead">' + esc(p.lead) + '</p><ol>' + p.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      (p.tips || []).map(function (t) { return '<div class="tip">💡 ' + esc(t) + '</div>'; }).join('');
    h += '<div class="sec"><b>💡 気になる言葉</b><div class="chips">' +
      TERMS.map(function (x) { return '<button type="button" class="chip" data-term="' + x[0] + '">' + esc(x[1]) + '</button>'; }).join('') + '</div></div>';
    h += '<div class="sec"><b>🧭 AIに使い方を聞く</b><div class="chips">' +
      FAQ.map(function (f, i) { return '<button type="button" class="chip" data-faq="' + i + '">' + esc(f[0]) + '</button>'; }).join('') + '</div>' +
      '<button type="button" class="go" data-g="ask">自分の言葉で質問する</button>' +
      '<div class="note">総合コーチの「相談」が開きます（テーマ：アプリの使い方）。ネットにつながっている時だけ使えます。</div></div>';
    h += '<div class="sec"><b>ほかの画面</b>' + Object.keys(PAGES).filter(function (k) { return k !== here(); }).map(function (k) {
      var q = PAGES[k];
      return '<details><summary>' + esc(q.title) + '</summary><p class="lead" style="margin-top:6px">' + esc(q.lead) + '</p><ol>' +
        q.steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol></details>';
    }).join('') + '</div>';
    var advOff = window.KTAdvice && KTAdvice.isOff();
    h += '<div class="sec"><b>💬 助言のポップアップ</b><div style="font-size:13px">アプリを開いたときや体組成を記録したときに、数値に合わせた助言（例：体脂肪率が許容帯の上を超えたら第1期に戻す目安）を出します。いまは <b>' + (advOff ? '記録だけのモード（出さない）' : '出す（同じ助言は1日1回）') + '</b> です。</div>' +
      '<button class="go sub" type="button" data-g="adv">' + (advOff ? '助言のポップアップをまた出す' : '記録だけのモードにする（出さない）') + '</button></div>';
    h += '<div class="sec"><b>用語集（はじめての方へ）</b><details open><summary>よく出てくる言葉</summary><dl>' +
      GLOSSARY.map(function (g) { return '<dt' + (g[2] ? ' id="ktg-term-' + g[2] + '"' : '') + '>' + esc(g[0]) + '</dt><dd>' + esc(g[1]).replace(/\n/g, '<br>') + '</dd>'; }).join('') + '</dl></details></div>';
    h += '<div class="sec"><b>参考文献・出典</b>' + REFERENCES.map(function (grp) {
      return '<details><summary>' + esc(grp[0]) + '</summary><ul class="refs">' + grp[1].map(function (r) {
        return '<li>' + esc(r[0]) + '<div class="ruse">' + esc(r[1]) + '</div>' + (r[2] ? '<a href="' + esc(r[2]) + '" target="_blank" rel="noopener noreferrer">論文を開く（DOI）</a>' : '') + '</li>';
      }).join('') + '</ul></details>';
    }).join('') + '<div class="note">数値の根拠は研究の一部で、一人ひとりに当てはまるとは限りません。体調や持病がある場合は医師・管理栄養士に相談してください。</div></div>';
    h += '<button type="button" class="go sub" data-g="tour">初回ガイドをもう一度見る</button>';
    box(h);
    var bx = ov.querySelector('.ktgbox'); if (bx) bx.scrollTop = 0;
    if (termKey) {
      var dt = ov.querySelector('#ktg-term-' + termKey);
      if (dt) {
        dt.classList.add('hl'); var dd = dt.nextElementSibling; if (dd) dd.classList.add('hl');
        if (dt.scrollIntoView) dt.scrollIntoView({ block: 'start' });
      }
    }
  }

  function askAI(text) {
    var C = root.KTCoach;
    close();
    if (!C) { root.alert && root.alert('総合コーチを読み込めませんでした。画面を開き直してください。'); return; }
    if (text) C.ask('howto', text); else C.prefill('howto', '');
  }

  function onClick(e) {
    if (e.target === ov) { close(); return; }
    var b = e.target.closest ? e.target.closest('[data-g],[data-faq]') : null; if (!b) return;
    var g = b.getAttribute('data-g'), f = b.getAttribute('data-faq');
    if (f != null) { askAI(FAQ[+f][1]); return; }
    if (g === 'next') tour(tourIdx + 1);
    else if (g === 'prev') tour(tourIdx - 1);
    else if (g === 'done' || g === 'close') close();
    else if (g === 'tour') tour(0);
    else if (g === 'ask') askAI('');
    else if (g === 'adv') { if (window.KTAdvice) { KTAdvice.setOff(!KTAdvice.isOff()); help(); } }
  }

  function init() {
    css();
    ov = doc.createElement('div'); ov.className = 'ktgov';
    ov.innerHTML = '<div class="ktgbox" role="dialog" aria-label="使い方"></div>';
    ov.addEventListener('click', onClick);
    doc.body.appendChild(ov);
    var btn = doc.createElement('button');
    btn.type = 'button'; btn.className = 'ktgbtn'; btn.id = 'guideOpen'; btn.textContent = '？ 使い方'; btn.setAttribute('aria-label', 'この画面の使い方');
    btn.addEventListener('click', function () { help(); });
    doc.addEventListener('click', function (e) {
      var tl = e.target && e.target.closest ? e.target.closest('[data-term]') : null;
      if (!tl || (ov && ov.contains(tl))) return;
      e.preventDefault(); help(tl.getAttribute('data-term'));
    });
    var hd = doc.querySelector('header'), sync = doc.getElementById('syncChip');
    if (sync && sync.parentNode) sync.parentNode.insertBefore(btn, sync);
    else if (hd) hd.appendChild(btn);
    else { btn.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:60'; doc.body.appendChild(btn); }
    doc.addEventListener('keydown', function (e) {
      if (!ov.classList.contains('on')) return;
      if (e.key === 'Escape') close();
      else if (mode === 'tour' && e.key === 'ArrowRight') tour(tourIdx + 1);
      else if (mode === 'tour' && e.key === 'ArrowLeft') tour(tourIdx - 1);
    });
    if (!seen()) tour(0);
  }

  api.openHelp = function () { help(); };
  api.openTerm = function (key) { help(key); }; // 用語集の該当項目へ飛ぶ（画面の ⓘ・data-term から）
  api.openTour = function () { tour(0); };
  api.isTourOpen = function () { return !!ov && mode === 'tour' && ov.classList.contains('on'); };
  /** 初回ガイドが開いていれば、閉じた後に fn を呼ぶ（開いていなければすぐ呼ぶ）。カウンセリングシートと重ならないようにする */
  api.afterTour = function (fn) { if (api.isTourOpen()) afterTour.push(fn); else fn(); };

  if (doc.body) init(); else doc.addEventListener('DOMContentLoaded', init);
})(typeof window !== 'undefined' ? window : this);
