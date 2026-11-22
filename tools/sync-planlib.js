/* plan-lib.js / roadmap-lib.js / yk-lib.js / meal-lib.js を gas/ にコピーする（Apps Script 用）。元のファイルを直したら node tools/sync-planlib.js */
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
[['plan-lib.js', 'PlanLib.gs'], ['roadmap-lib.js', 'RoadmapLib.gs'], ['yk-lib.js', 'YkLib.gs'], ['meal-lib.js', 'MealLib.gs']].forEach(function (p) {
  var src = fs.readFileSync(path.join(root, p[0]), 'utf8');
  fs.writeFileSync(path.join(root, 'gas', p[1]), '// 自動生成：' + p[0] + ' のコピー。直接編集せず、' + p[0] + ' を直して node tools/sync-planlib.js を実行する\n' + src);
  console.log('gas/' + p[1] + ' を更新しました');
});
