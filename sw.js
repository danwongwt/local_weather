const CACHE_NAME = 'weather-app-v2';

// Install event - try to cache but don't fail if it doesn't work
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        // Try to cache these files, but don't fail if we can't
        return cache.addAll([
          './',
          './index.html',
          './app.js',
          './manifest.json'
        ]).catch(err => {
          console.log('Cache addAll failed, but continuing:', err);
          return Promise.resolve();
        });
      })
      .catch(err => {
        console.log('Cache open failed:', err);
        return Promise.resolve();
      })
  );
  self.skipWaiting();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', event => {
  // Skip chrome extensions and non-http requests
  if (!event.request.url.startsWith('http')) {
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Don't cache API responses
        if (event.request.url.includes('weather.gc.ca') || 
            event.request.url.includes('openweathermap.org') ||
            event.request.url.includes('allorigins.win')) {
          return response;
        }

        // Clone the response
        const responseToCache = response.clone();
        
        // Try to cache, but don't fail if we can't
        caches.open(CACHE_NAME)
          .then(cache => {
            cache.put(event.request, responseToCache).catch(err => {
              console.log('Cache put failed:', err);
            });
          })
          .catch(err => {
            console.log('Cache open failed in fetch:', err);
          });

        return response;
      })
      .catch(() => {
        // If network fails, try cache
        return caches.match(event.request)
          .then(response => {
            if (response) {
              return response;
            }
            // If no cache, return a basic response
            return new Response('Offline - No cached data available', {
              status: 503,
              statusText: 'Service Unavailable',
              headers: new Headers({
                'Content-Type': 'text/plain'
              })
            });
          });
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheWhitelist.indexOf(cacheName) === -1) {
              return caches.delete(cacheName);
            }
          })
        );
      })
      .catch(err => {
        console.log('Cache cleanup failed:', err);
        return Promise.resolve();
      })
  );
  self.clients.claim();
});
