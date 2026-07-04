// 2026-05-09 重啟版 v2 — PWA + 21 欄 schema
const CACHE = 'arrival-v8k';
const ASSETS = [
  './',
  './index.html',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  // cache:'reload' = 略過瀏覽器 HTTP 快取，更新時一定抓到最新檔（修「SW 升級了畫面還是舊的」陷阱）
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
  // GAS / Gemini API 不快取（一律走網路）
  if (e.request.url.includes('script.google.com') || e.request.url.includes('googleapis.com')) return;
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request)));
});
