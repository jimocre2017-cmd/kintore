/* 筋トレトラッカー アプリ版 Service Worker
 * 画面ファイルを端末に保存し、オフラインでも開けるようにする。
 * 通信（Google Apps Script への送信）は扱わない（api.js 側で送信待ちとして保存）。
 */
var VERSION = 'kt-v44';
var FILES = ['./', './index.html', './analytics.html', './cardio.html', './cardio-lib.js', './body.html', './body-lib.js', './photo.html', './photo-lib.js', './meal.html', './meal-lib.js', './plan.html', './plan-lib.js', './plan-page.js', './yk-lib.js', './counsel-lib.js', './api.js', './coach.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// 同じサイトのファイル：保存版を先に返して即表示し、裏で最新版を取りにいく（次回起動から反映）。
// 保存版が無いときだけ通信を待つ。更新を確実に配るため、画面を直したら VERSION を上げること（install時に最新を取り直す）
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(caches.open(VERSION).then(function (cache) {
    return cache.match(req, { ignoreSearch: true }).then(function (hit) {
      var net = fetch(req, { cache: 'no-cache' }).then(function (res) {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      });
      if (hit) { var bg = net.catch(function () {}); e.waitUntil(bg); return hit; }
      return net;
    });
  }));
});
