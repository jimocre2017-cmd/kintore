
/* 炭水化物の目標（残りカロリーから逆算）と白ご飯換算 */
(function () {
  var ML = require('../meal-lib.js'), assert = require('assert');
  var c = ML.carbGoals({ kcal: 1700, protein: 125, fat: 45, kcalMin: 1660, kcalMax: 1800 });
  assert.strictEqual(c.carbs, Math.round((1700 - 500 - 405) / 4));
  assert.ok(c.carbsMin < c.carbs && c.carbsMax > c.carbs);
  assert.strictEqual(ML.carbGoals({ kcal: 1700, protein: 0, fat: 45 }), null);
  assert.strictEqual(ML.carbGoals({ kcal: 500, protein: 125, fat: 45 }), null);
  assert.strictEqual(ML.riceG(35.6), 100);
  assert.strictEqual(ML.riceG(0), 0);
  assert.strictEqual(ML.pastaG(72), 100);
  assert.strictEqual(ML.focacciaPieces(32), 1);
  assert.strictEqual(ML.focacciaPieces(48), 1.5);
  assert.strictEqual(ML.pastaG(0), 0);
  console.log('ok  carbGoals / riceG');
})();
