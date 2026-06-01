// 食光 PWA Service Worker
var CACHE = 'shiguang-v1';
var FILES = [
  '/food-app/',
  '/food-app/index.html',
  '/food-app/manifest.json',
  '/food-app/icon-512.png'
];

// 安装：预缓存核心文件
self.addEventListener('install', function(e) {
  e.waitUntil(
    caches.open(CACHE).then(function(cache) {
      return cache.addAll(FILES);
    })
  );
});

// 激活：清理旧缓存
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE; })
            .map(function(k) { return caches.delete(k); })
      );
    })
  );
});

// 请求拦截：缓存优先，网络回退
self.addEventListener('fetch', function(e) {
  // 跳过 API 请求（不缓存 DeepSeek 调用）
  if (e.request.url.indexOf('api.deepseek.com') > -1) return;
  if (e.request.url.indexOf('workers.dev') > -1) return;

  e.respondWith(
    caches.match(e.request).then(function(cached) {
      if (cached) return cached;
      return fetch(e.request).then(function(resp) {
        // 只缓存成功的 GET
        if (resp.status === 200 && e.request.method === 'GET') {
          var clone = resp.clone();
          caches.open(CACHE).then(function(cache) {
            cache.put(e.request, clone);
          });
        }
        return resp;
      }).catch(function() {
        // 离线时返回缓存
        return cached || new Response('离线模式', { status: 503 });
      });
    })
  );
});
