# 筋トレトラッカー 参考文献・出典

アプリの「？ 使い方」の最下部にも同じ内容を載せています（`guide.js` の `REFERENCES`）。
数値の根拠は研究の一部で、一人ひとりに当てはまるとは限りません。

## 食事の目標（たんぱく質・脂質・カロリー）— 2026-11-19に内容を確認

- Morton RW, et al. (2018). A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults. Br J Sports Med 52(6):376-384. [DOI](https://doi.org/10.1136/bjsports-2017-097608)
  - 使い道：たんぱく質は約1.6g/kg/日を超えても、筋トレによる除脂肪量の増加は増えにくい（体重基準の「下限×1.6」「目安×1.8」の根拠）。
- Jäger R, et al. (2017). International Society of Sports Nutrition Position Stand: protein and exercise. J Int Soc Sports Nutr 14:20. [DOI](https://doi.org/10.1186/s12970-017-0177-8)
  - 使い道：筋量をつくる・保つには1.4〜2.0g/kg/日。筋トレをしている人が摂取カロリーを抑えている期間（減量期）は2.3〜3.1g/kg/日が必要になる場合がある。
- Whittaker J, Wu K. (2021). Low-fat diets and testosterone in men: Systematic review and meta-analysis of intervention studies. J Steroid Biochem Mol Biol 210:105878. [DOI](https://doi.org/10.1016/j.jsbmb.2021.105878)
  - 使い道：脂質をエネルギーの40%から20%に下げると、男性の総テストステロンが10〜15%低下した（6試験・206人、値は正常範囲内）。脂質の下限を20%付近に置く参考。「20%未満は危険」という閾値を示した研究ではなく、著者もさらなる試験が必要としている。
- Thomas DT, Erdman KA, Burke LM. (2016). Position of the Academy of Nutrition and Dietetics, Dietitians of Canada, and the American College of Sports Medicine: Nutrition and Athletic Performance. J Acad Nutr Diet 116(3):501-528. [DOI](https://doi.org/10.1016/j.jand.2015.12.006)
  - 使い道：脂質の範囲（エネルギーの20〜35%）の参考にした立場表明。※この数値が本文にあることは、今回は本文では確認していない。

## アプリ独自の設定値（研究で決まった値ではない・見直し可）

- たんぱく質の上限＝体重×2.2g、体脂肪率20%以上は除脂肪量×2.0〜2.5g（目安×2.2）
  - 使い道：2.2と、20%で基準を切り替える点、除脂肪量の係数は、レビュー（Gemini）をもとにアプリ側で決めた値。
- 脂質の上限＝カロリーの30%、下限＝カロリーの20%か40gの大きいほう
  - 使い道：上限30%は、残りのカロリーから逆算した値が大きくなりすぎないようにする設計上の値。
- 維持カロリー＝基礎代謝×1.35、範囲±150kcal
  - 使い道：直近の減量ログ（摂取量と体重変化）から逆算した消費量に近い値。数週間の記録が根拠なので、体重の推移を見て見直す。

## すでにアプリが使っている式・分布（コードに書かれた出典。今回は再確認していない）

- Kouri EM, et al. (1995). 補正FFMI（身長の補正と、ナチュラルの上限目安＝補正FFMI約25）
  - 使い道：FFMI機能。男性のみ・絶対的な壁ではない。
- Kim et al. Nutrients 2026;18(8):1170（韓国 KNHANES 2022–23）／Jin et al. Clin Nutr 2019（中国）／Schutz・Kyle 2002（スイス）
  - 使い道：FFMIを同性・同年代と比べる分布（日本の若年成人の全国分布が見つからず、65歳未満は韓国の値で代用）。
- Compendium of Physical Activities（運動強度METsの代表値）
  - 使い道：有酸素・筋トレの消費カロリー推定（MET × 体重 × 時間）。時速の間は線形補間。
- 脂肪1kg ≒ 7200kcal
  - 使い道：減量の必要カロリー・ペースの計算に使う一般的な概算の換算値。
