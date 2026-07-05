// 2026-05-09 重啟版 v2 — PWA + 21 欄 schema
// 2026-07-05 v10 — 網頁改「網路優先」，一部署就看到新版（不再卡舊快取）
const CACHE = 'arrival-v10';
const ASSETS = [
  './',
  './index.html',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // cache:'reload' = 略過瀏覽器 HTTP 快取，更新時一定抓到最新檔
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(
    ASSETS.map(u => new Request(u, { cache: 'reload' }))
  )));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  const req = e.request;

  // GAS / Gemini API 不快取（一律走網路）
  if (req.url.includes('script.google.com') || req.url.includes('googleapis.com')) return;

  // 網頁（HTML 導覽）→ 網路優先：一上線就看到新版；抓不到（離線）才用快取墊底
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          // 把最新網頁存回快取，供離線時使用
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', clone)).catch(() => {});
          return res;
        })
        .catch(() =>
          caches.match(req).then(r => r || caches.match('./index.html')).then(r => r || caches.match('./'))
        )
    );
    return;
  }

  // 其他靜態資源（圖示等）→ 快取優先，離線也快
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
