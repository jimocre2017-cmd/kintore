/* plan-lib.js を gas/PlanLib.gs にコピーする（Apps Script 用）。plan-lib.js を直したら node tools/sync-planlib.js */
var fs = require('fs'), path = require('path');
var root = path.join(__dirname, '..');
var src = fs.readFileSync(path.join(root, 'plan-lib.js'), 'utf8');
fs.writeFileSync(path.join(root, 'gas', 'PlanLib.gs'), '// 自動生成：plan-lib.js のコピー。直接編集せず、plan-lib.js を直して node tools/sync-planlib.js を実行する\n' + src);
console.log('gas/PlanLib.gs を更新しました');
