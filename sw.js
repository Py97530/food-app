// 食光 PWA Service Worker
// 每次部署记得改版本号（改这里就行）
var CACHE = 'shiguang-v3';

// 安装时立即接管页面（不等旧 SW 释放）
self.addEventListener('install', function(e) {
  self.skipWaiting();
});

// 激活时清空所有旧缓存，并立即控制所有页面
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// 请求拦截：网络优先，缓存兜底（保证每次打开都是最新内容）
self.addEventListener('fetch', function(e) {
  if (e.request.url.indexOf('api.deepseek.com') > -1) return;
  if (e.request.url.indexOf('workers.dev') > -1) return;

  e.respondWith(
    fetch(e.request).then(function(resp) {
      // 成功的 GET 写入缓存（供离线时使用）
      if (resp.status === 200 && e.request.method === 'GET') {
        var clone = resp.clone();
        caches.open(CACHE).then(function(cache) {
          cache.put(e.request, clone);
        });
      }
      return resp;
    }).catch(function() {
      // 网络不通时从缓存读取
      return caches.match(e.request);
    })
  );
});
