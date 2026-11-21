/* 種目の検索（筋トレ記録の画面で、種目名・部位・器具・タグを言葉で絞り込む）
 * ひらがな／カタカナ、全角／半角、大文字／小文字、空白・「・」「ー」の違いを無視して照合する。
 * 例：「ふぇいすぷる」「フェイス」「face」「ﾌｪｲｽﾌﾟﾙ」→ フェイスプル
 * スペース区切りで複数の言葉を入れると、すべてを含む種目だけを出す（例：「肩 チューブ」）。
 */
var ExSearch = (function () {
  function norm(s) {
    s = String(s == null ? '' : s);
    if (s.normalize) s = s.normalize('NFKC');
    s = s.toLowerCase().replace(/[ァ-ヶ]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) - 0x60); });
    return s.replace(/[\s・\-ー－_/／()（）]/g, '');
  }
  function haystack(e) {
    return norm([e.name, e.part, (e.secondary || []).join(' '), e.equipment, (e.tags || []).join(' ')].join(' '));
  }
  function terms(q) {
    var s = String(q == null ? '' : q);
    if (s.normalize) s = s.normalize('NFKC');
    return s.split(/[\s,、]+/).map(norm).filter(function (t) { return t; });
  }
  /** 一致した種目を、名前の先頭一致 → 名前に含む → 部位・器具・タグのみ一致 の順で返す */
  function filter(list, q) {
    var ts = terms(q); if (!ts.length) return [];
    var out = [];
    (list || []).forEach(function (e, i) {
      var h = haystack(e);
      if (!ts.every(function (t) { return h.indexOf(t) >= 0; })) return;
      var n = norm(e.name), score = n.indexOf(ts[0]) === 0 ? 0 : ts.every(function (t) { return n.indexOf(t) >= 0; }) ? 1 : 2;
      out.push({ e: e, s: score, i: i });
    });
    out.sort(function (a, b) { return a.s - b.s || a.i - b.i; });
    return out.map(function (x) { return x.e; });
  }
  return { norm: norm, terms: terms, filter: filter };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = ExSearch;
