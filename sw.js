/* 筋トレトラッカー アプリ版 Service Worker
 * 画面ファイルを端末に保存し、オフラインでも開けるようにする。
 * 通信（Google Apps Script への送信）は扱わない（api.js 側で送信待ちとして保存）。
 */
var VERSION = 'kt-v22';
var FILES = ['./', './index.html', './analytics.html', './cardio.html', './cardio-lib.js', './body.html', './body-lib.js', './meal.html', './meal-lib.js', './api.js', './manifest.webmanifest', './icon-192.png', './icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// 同じサイトのファイル：オンラインなら最新版を取りにいく（3秒待っても来なければ保存版）。オフラインは保存版。
// ※以前は「保存版を先に返す」方式で、更新後も古い画面が出ることがあったため変更
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
      if (!hit) return net;
      var timeout = new Promise(function (resolve) { setTimeout(function () { resolve(hit); }, 3000); });
      return Promise.race([net.catch(function () { return hit; }), timeout]);
    });
  }));
});
