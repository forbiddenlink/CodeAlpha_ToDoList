const CACHE_NAME = 'todo-app-v2.0'; // Major version update for CSS fixes
const STATIC_CACHE = `${CACHE_NAME}-static`;
const DYNAMIC_CACHE = `${CACHE_NAME}-dynamic`;

// Assets that should always be cached
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/script.js',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// Assets that should always be fetched from network first (bypass cache)
const NETWORK_FIRST_ASSETS = [
    '/styles.css'  // Always fetch CSS fresh to avoid styling issues
];

// Install event - cache static resources
self.addEventListener('install', event => {
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then(cache => {
                console.log('Caching static assets');
                return cache.addAll(STATIC_ASSETS);
            })
    );
    // Force activation immediately without waiting
    self.skipWaiting();
});

// Fetch event - intelligent caching strategy
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);
    
    // Network-first strategy for CSS and other critical files that need fresh content
    const isNetworkFirstAsset = NETWORK_FIRST_ASSETS.some(asset => 
        url.pathname.endsWith(asset) || url.pathname === asset
    );
    
    if (isNetworkFirstAsset) {
        // Network-first strategy for CSS files to ensure fresh styling
        event.respondWith(
            fetch(event.request)
                .then(response => {
                    // Clone the response before using it to respond
                    const responseToCache = response.clone();
                    
                    // Update cache with fresh content
                    caches.open(DYNAMIC_CACHE).then(cache => {
                        cache.put(event.request, responseToCache);
                    });
                    
                    return response;
                })
                .catch(() => {
                    // Fallback to cache if network fails
                    return caches.match(event.request);
                })
        );
    } else {
        // Cache-first strategy for other assets
        event.respondWith(
            caches.match(event.request)
                .then(response => {
                    // Return cached response if found
                    if (response) {
                        return response;
                    }
                    
                    // Clone the request before using it to fetch
                    const fetchRequest = event.request.clone();
                    
                    return fetch(fetchRequest)
                        .then(response => {
                            // Don't cache if response is not valid
                            if (!response || response.status !== 200 || response.type !== 'basic') {
                                return response;
                            }
                            
                            // Clone the response before using it to respond
                            const responseToCache = response.clone();
                            
                            // Update cache with fresh content
                            caches.open(DYNAMIC_CACHE).then(cache => {
                                cache.put(event.request, responseToCache);
                            });
                            
                            return response;
                        })
                        .catch(() => {
                            // Provide offline fallback for navigate requests
                            if (event.request.mode === 'navigate') {
                                return new Response('<h1>Offline</h1><p>The page is not available offline.</p>', {
                                    headers: { 'Content-Type': 'text/html' }
                                });
                            }
                            return new Response('Offline content not available');
                        });
                })
        );
    }
});

// Activate event - clean up old caches
self.addEventListener('activate', event => {
    const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE];
    
    event.waitUntil(
        caches.keys()
            .then(cacheNames => {
                return cacheNames.filter(cacheName => !currentCaches.includes(cacheName));
            })
            .then(cachesToDelete => {
                return Promise.all(
                    cachesToDelete.map(cacheToDelete => {
                        console.log('Deleting old cache:', cacheToDelete);
                        return caches.delete(cacheToDelete);
                    })
                );
            })
            .then(() => {
                // Take control of all clients immediately
                return self.clients.claim();
            })
    );
});

// Background sync for offline functionality
self.addEventListener('sync', event => {
    if (event.tag === 'background-sync') {
        event.waitUntil(doBackgroundSync());
    }
});

function doBackgroundSync() {
    // Handle background sync tasks
    console.log('Background sync triggered');
    return Promise.resolve();
}

// Push notification support
self.addEventListener('push', event => {
    const options = {
        body: event.data ? event.data.text() : 'New task reminder!',
        icon: '/icon.png',
        badge: '/badge.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: 1
        },
        actions: [
            {
                action: 'explore',
                title: 'View Tasks',
                icon: '/icon.png'
            },
            {
                action: 'close',
                title: 'Close',
                icon: '/icon.png'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('To-Do List', options)
    );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
    event.notification.close();

    if (event.action === 'explore') {
        event.waitUntil(
            clients.openWindow('/')
        );
    }
});

// Message handler
self.addEventListener('message', event => {
    if (event.data && event.data.action === 'skipWaiting') {
        self.skipWaiting();
    }
    
    if (event.data && event.data.action === 'clearCssCache') {
        event.waitUntil(
            caches.open(DYNAMIC_CACHE)
                .then(cache => {
                    // Get all cache entries
                    return cache.keys()
                        .then(requests => {
                            // Filter for CSS files
                            const cssRequests = requests.filter(request => 
                                request.url.endsWith('.css') || 
                                request.url.includes('styles.css')
                            );
                            
                            // Delete all CSS files from cache
                            return Promise.all(
                                cssRequests.map(request => {
                                    console.log('Deleting CSS from cache:', request.url);
                                    return cache.delete(request);
                                })
                            );
                        });
                })
        );
    }
}); 