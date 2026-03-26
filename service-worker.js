// =====================================================
// Ankit Study Point – Service Worker
// Version: 1.0.0
// =====================================================

const CACHE_NAME = 'ankit-study-point-v1';
const OFFLINE_URL = './offline.html';

// Files to cache immediately on install
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './offline.html',
  './icons/icon-192.png',
  './icons/icon-512.png',
  'https://fonts.googleapis.com/css2?family=Nunito:wght@400;600;700;800&family=Poppins:wght@400;500;600;700&display=swap'
];

// ===================== INSTALL =====================
self.addEventListener('install', (event) => {
  console.log('[SW] Installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('[SW] Pre-caching assets');
        return cache.addAll(PRECACHE_ASSETS.map(url => {
          // Use no-cors for cross-origin requests
          if (url.startsWith('https://fonts.')) {
            return new Request(url, { mode: 'no-cors' });
          }
          return url;
        })).catch(err => console.log('[SW] Pre-cache error (non-fatal):', err));
      })
      .then(() => self.skipWaiting()) // Activate immediately
  );
});

// ===================== ACTIVATE =====================
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating...');
  event.waitUntil(
    // Delete old caches
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim()) // Take control immediately
  );
});

// ===================== FETCH =====================
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // Skip Chrome extension requests
  if (url.protocol === 'chrome-extension:') return;

  // Strategy: Network First for blog content (always fresh)
  if (url.hostname.includes('blogspot.com') || url.hostname.includes('blogger.com')) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }

  // Strategy: Cache First for static assets (fonts, icons, app shell)
  if (
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    request.destination === 'image' ||
    request.destination === 'style' ||
    request.destination === 'script'
  ) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }

  // Default: Network First with offline fallback
  event.respondWith(networkFirstWithOfflineFallback(request));
});

// ===================== STRATEGIES =====================

// Network First – try network, fall back to cache
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request, {
      // Add mobile param for Blogger
      signal: AbortSignal.timeout(8000)
    });
    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    // Try cache
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;
    // Show offline page for navigation
    if (request.mode === 'navigate') {
      return caches.match(OFFLINE_URL);
    }
    throw error;
  }
}

// Cache First – try cache, fall back to network
async function cacheFirstStrategy(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) return cachedResponse;

  try {
    const networkResponse = await fetch(request);
    if (networkResponse.ok || networkResponse.type === 'opaque') {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    console.log('[SW] Cache-first network fail:', error);
    throw error;
  }
}

// Network First with offline fallback
async function networkFirstWithOfflineFallback(request) {
  try {
    const networkResponse = await fetch(request, {
      signal: AbortSignal.timeout(10000)
    });
    if (networkResponse.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) return cachedResponse;
    if (request.mode === 'navigate') {
      return caches.match(OFFLINE_URL);
    }
    throw error;
  }
}

// ===================== PUSH NOTIFICATIONS =====================
self.addEventListener('push', (event) => {
  console.log('[SW] Push received');

  let data = {
    title: 'Ankit Study Point',
    body: 'Naya content available hai! 📚',
    icon: './icons/icon-192.png',
    badge: './icons/icon-72.png',
    url: 'https://ankitstudypoint.blogspot.com/?m=1'
  };

  // Parse push data if available
  if (event.data) {
    try {
      const pushData = event.data.json();
      data = { ...data, ...pushData };
    } catch(e) {
      data.body = event.data.text();
    }
  }

  const options = {
    body: data.body,
    icon: data.icon,
    badge: data.badge,
    vibrate: [200, 100, 200],
    data: { url: data.url },
    actions: [
      { action: 'open', title: '📖 Open' },
      { action: 'close', title: '✕ Dismiss' }
    ],
    requireInteraction: false,
    tag: 'ankit-study-point-notification'
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// Handle notification click
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  if (event.action === 'close') return;

  const url = event.notification.data?.url || 'https://ankitstudypoint.blogspot.com/?m=1';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(windowClients => {
        // Focus existing window if open
        for (const client of windowClients) {
          if (client.url.includes('ankitstudypoint') && 'focus' in client) {
            return client.focus();
          }
        }
        // Open new window
        if (clients.openWindow) {
          return clients.openWindow(url);
        }
      })
  );
});

// ===================== BACKGROUND SYNC =====================
self.addEventListener('sync', (event) => {
  if (event.tag === 'check-new-posts') {
    event.waitUntil(checkForNewPosts());
  }
});

async function checkForNewPosts() {
  // Background check for new blog posts
  try {
    const response = await fetch(
      'https://ankitstudypoint.blogspot.com/feeds/posts/default?alt=json&max-results=1'
    );
    if (response.ok) {
      console.log('[SW] Post check completed');
    }
  } catch (e) {
    console.log('[SW] Post check failed:', e);
  }
}

console.log('[SW] Service Worker loaded ✓');
