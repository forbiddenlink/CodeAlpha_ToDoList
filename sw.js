const CACHE_VERSION = '2.1.0';
const CACHE_NAME = `todo-app-v${CACHE_VERSION}`;
const STATIC_CACHE = `${CACHE_NAME}-static`;
const DYNAMIC_CACHE = `${CACHE_NAME}-dynamic`;
const RUNTIME_CACHE = `${CACHE_NAME}-runtime`;

// Configuration
const CONFIG = {
    maxAge: 24 * 60 * 60 * 1000, // 24 hours in milliseconds
    maxEntries: 100,
    networkTimeoutSeconds: 5,
    offlinePagePath: '/offline.html'
};

// Assets that should always be cached during install
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/script.js',
    '/manifest.json',
    '/offline.html', // Offline fallback page
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap'
];

// Assets that should always fetch from network first
const NETWORK_FIRST_PATTERNS = [
    /\/styles\.css(\?.*)?$/,
    /\/api\//,
    /\.json$/
];

// Assets that should be cached first
const CACHE_FIRST_PATTERNS = [
    /\.(?:png|jpg|jpeg|svg|gif|webp|ico)$/,
    /\.(?:js|css)$/,
    /googleapis\.com/,
    /cdnjs\.cloudflare\.com/
];

// Utility functions
const isNetworkFirstAsset = (url) => {
    return NETWORK_FIRST_PATTERNS.some(pattern => pattern.test(url));
};

const isCacheFirstAsset = (url) => {
    return CACHE_FIRST_PATTERNS.some(pattern => pattern.test(url));
};

const isNavigationRequest = (request) => {
    return request.mode === 'navigate' || 
           (request.method === 'GET' && request.headers.get('accept').includes('text/html'));
};

const createNetworkTimeoutPromise = (timeoutSeconds) => {
    return new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Network timeout')), timeoutSeconds * 1000);
    });
};

// Cache management utilities
const cleanupOldCaches = async () => {
    const currentCaches = [STATIC_CACHE, DYNAMIC_CACHE, RUNTIME_CACHE];
    const cacheNames = await caches.keys();
    
    const cachesToDelete = cacheNames.filter(cacheName => {
        // Delete any cache that doesn't match our current cache names
        return !currentCaches.includes(cacheName) && cacheName.startsWith('todo-app-');
    });
    
    const deletePromises = cachesToDelete.map(async (cacheToDelete) => {
        console.log('SW: Deleting old cache:', cacheToDelete);
        return caches.delete(cacheToDelete);
    });
    
    return Promise.all(deletePromises);
};

const cleanupExpiredEntries = async (cacheName) => {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    const now = Date.now();
    
    const expiredRequests = [];
    
    for (const request of requests) {
        const response = await cache.match(request);
        if (response) {
            const dateHeader = response.headers.get('date');
            const cacheTime = dateHeader ? new Date(dateHeader).getTime() : 0;
            
            if (now - cacheTime > CONFIG.maxAge) {
                expiredRequests.push(request);
            }
        }
    }
    
    // Remove expired entries
    const deletePromises = expiredRequests.map(request => {
        console.log('SW: Removing expired cache entry:', request.url);
        return cache.delete(request);
    });
    
    return Promise.all(deletePromises);
};

const limitCacheSize = async (cacheName, maxEntries) => {
    const cache = await caches.open(cacheName);
    const requests = await cache.keys();
    
    if (requests.length > maxEntries) {
        // Remove oldest entries (FIFO)
        const requestsToDelete = requests.slice(0, requests.length - maxEntries);
        const deletePromises = requestsToDelete.map(request => cache.delete(request));
        
        console.log(`SW: Limiting cache size, removing ${requestsToDelete.length} entries from ${cacheName}`);
        return Promise.all(deletePromises);
    }
};

// Install event - cache static resources
self.addEventListener('install', event => {
    console.log(`SW: Installing version ${CACHE_VERSION}`);
    
    event.waitUntil(
        (async () => {
            try {
                const cache = await caches.open(STATIC_CACHE);
                console.log('SW: Caching static assets');
                
                // Cache assets individually to handle failures gracefully
                const cachePromises = STATIC_ASSETS.map(async (asset) => {
                    try {
                        const response = await fetch(asset);
                        if (response.status === 200) {
                            await cache.put(asset, response);
                            console.log(`SW: Cached ${asset}`);
                        } else {
                            console.warn(`SW: Failed to cache ${asset}: ${response.status}`);
                        }
                    } catch (error) {
                        console.warn(`SW: Failed to cache ${asset}:`, error);
                    }
                });
                
                await Promise.allSettled(cachePromises);
                console.log('SW: Static assets caching completed');
                
                // Force activation immediately
                self.skipWaiting();
                
            } catch (error) {
                console.error('SW: Install failed:', error);
                throw error;
            }
        })()
    );
});

// Activate event - clean up and take control
self.addEventListener('activate', event => {
    console.log(`SW: Activating version ${CACHE_VERSION}`);
    
    event.waitUntil(
        (async () => {
            try {
                // Clean up old caches
                await cleanupOldCaches();
                
                // Clean up expired entries
                await cleanupExpiredEntries(DYNAMIC_CACHE);
                await cleanupExpiredEntries(RUNTIME_CACHE);
                
                // Limit cache sizes
                await limitCacheSize(DYNAMIC_CACHE, CONFIG.maxEntries);
                await limitCacheSize(RUNTIME_CACHE, CONFIG.maxEntries);
                
                // Take control of all clients immediately
                await self.clients.claim();
                
                console.log('SW: Activation completed');
                
                // Notify clients about the update
                const clients = await self.clients.matchAll();
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_ACTIVATED',
                        version: CACHE_VERSION
                    });
                });
                
            } catch (error) {
                console.error('SW: Activation failed:', error);
            }
        })()
    );
});

// Fetch event - intelligent caching strategies
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);
    
    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }
    
    // Skip Chrome extensions and other non-http(s) requests
    if (!url.protocol.startsWith('http')) {
        return;
    }
    
    event.respondWith(handleFetch(request));
});

const handleFetch = async (request) => {
    const url = request.url;
    
    try {
        // Navigation requests (HTML pages)
        if (isNavigationRequest(request)) {
            return await handleNavigationRequest(request);
        }
        
        // Network-first strategy for specific assets
        if (isNetworkFirstAsset(url)) {
            return await handleNetworkFirst(request);
        }
        
        // Cache-first strategy for static assets
        if (isCacheFirstAsset(url)) {
            return await handleCacheFirst(request);
        }
        
        // Default: Stale-while-revalidate for everything else
        return await handleStaleWhileRevalidate(request);
        
    } catch (error) {
        console.error('SW: Fetch error:', error);
        return await handleFallback(request);
    }
};

const handleNavigationRequest = async (request) => {
    try {
        // Try network first with timeout
        const networkPromise = fetch(request);
        const timeoutPromise = createNetworkTimeoutPromise(CONFIG.networkTimeoutSeconds);
        
        const response = await Promise.race([networkPromise, timeoutPromise]);
        
        // Cache successful navigation responses
        if (response && response.status === 200) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(request, response.clone());
        }
        
        return response;
        
    } catch (error) {
        console.log('SW: Navigation request failed, trying cache:', error);
        
        // Try cache fallback
        const cachedResponse = await caches.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        // Final fallback: offline page
        const offlineResponse = await caches.match(CONFIG.offlinePagePath);
        if (offlineResponse) {
            return offlineResponse;
        }
        
        // Absolute fallback
        return new Response(
            `<!DOCTYPE html>
            <html>
            <head>
                <title>Offline - Todo App</title>
                <meta charset="utf-8">
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <style>
                    body { font-family: -apple-system, sans-serif; text-align: center; padding: 50px; }
                    h1 { color: #ef4444; }
                    .retry-btn { background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 5px; cursor: pointer; }
                </style>
            </head>
            <body>
                <h1>You're Offline</h1>
                <p>The Todo app is not available offline.</p>
                <button class="retry-btn" onclick="window.location.reload()">Try Again</button>
            </body>
            </html>`,
            {
                status: 200,
                headers: { 'Content-Type': 'text/html' }
            }
        );
    }
};

const handleNetworkFirst = async (request) => {
    const cache = await caches.open(DYNAMIC_CACHE);
    
    try {
        // Try network first
        const networkResponse = await fetch(request);
        
        if (networkResponse && networkResponse.status === 200) {
            // Update cache with fresh content
            cache.put(request, networkResponse.clone());
            console.log(`SW: Network-first cache update for: ${request.url}`);
        }
        
        return networkResponse;
        
    } catch (error) {
        console.log(`SW: Network failed for ${request.url}, trying cache`);
        
        // Fallback to cache
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            return cachedResponse;
        }
        
        throw error; // Re-throw if no cache available
    }
};

const handleCacheFirst = async (request) => {
    const cache = await caches.open(STATIC_CACHE);
    
    // Try cache first
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
        // Background update for cache
        fetch(request).then(response => {
            if (response && response.status === 200) {
                cache.put(request, response.clone());
            }
        }).catch(() => {
            // Ignore background update failures
        });
        
        return cachedResponse;
    }
    
    // Fallback to network
    try {
        const networkResponse = await fetch(request);
        
        if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
        }
        
        return networkResponse;
        
    } catch (error) {
        console.error(`SW: Cache-first failed for ${request.url}:`, error);
        throw error;
    }
};

const handleStaleWhileRevalidate = async (request) => {
    const cache = await caches.open(RUNTIME_CACHE);
    
    // Get cached response
    const cachedResponse = await cache.match(request);
    
    // Start network request (don't await)
    const networkPromise = fetch(request).then(response => {
        if (response && response.status === 200) {
            cache.put(request, response.clone());
        }
        return response;
    }).catch(error => {
        console.log(`SW: Background update failed for ${request.url}:`, error);
        return null;
    });
    
    // Return cached response immediately if available
    if (cachedResponse) {
        return cachedResponse;
    }
    
    // Wait for network if no cache available
    return networkPromise;
};

const handleFallback = async (request) => {
    if (isNavigationRequest(request)) {
        const offlineResponse = await caches.match(CONFIG.offlinePagePath);
        if (offlineResponse) {
            return offlineResponse;
        }
    }
    
    // Return a generic offline response
    return new Response('Content not available offline', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'text/plain' }
    });
};

// Background sync for offline functionality
self.addEventListener('sync', event => {
    console.log('SW: Background sync event:', event.tag);
    
    if (event.tag === 'todo-sync') {
        event.waitUntil(handleTodoSync());
    }
});

const handleTodoSync = async () => {
    console.log('SW: Handling todo sync');
    
    try {
        // Get offline actions from IndexedDB or localStorage
        // This would sync any offline actions when network returns
        const clients = await self.clients.matchAll();
        
        clients.forEach(client => {
            client.postMessage({
                type: 'SYNC_TODOS',
                timestamp: Date.now()
            });
        });
        
        return Promise.resolve();
        
    } catch (error) {
        console.error('SW: Todo sync failed:', error);
        throw error;
    }
};

// Push notification support
self.addEventListener('push', event => {
    console.log('SW: Push notification received');
    
    let options = {
        body: 'You have pending tasks!',
        icon: '/icon-192x192.png',
        badge: '/icon-192x192.png',
        vibrate: [100, 50, 100],
        data: {
            dateOfArrival: Date.now(),
            primaryKey: Math.random()
        },
        actions: [
            {
                action: 'view',
                title: 'View Tasks',
                icon: '/icon-192x192.png'
            },
            {
                action: 'dismiss',
                title: 'Dismiss',
                icon: '/icon-192x192.png'
            }
        ],
        requireInteraction: true,
        tag: 'todo-notification'
    };
    
    // Parse push data if available
    if (event.data) {
        try {
            const data = event.data.json();
            options = { ...options, ...data };
        } catch (error) {
            console.warn('SW: Failed to parse push data:', error);
            options.body = event.data.text() || options.body;
        }
    }
    
    event.waitUntil(
        self.registration.showNotification('Todo App', options)
    );
});

// Notification click handler
self.addEventListener('notificationclick', event => {
    console.log('SW: Notification clicked:', event.action);
    
    event.notification.close();
    
    if (event.action === 'view' || !event.action) {
        event.waitUntil(
            (async () => {
                const clients = await self.clients.matchAll({ type: 'window' });
                
                // Check if app is already open
                for (const client of clients) {
                    if (client.url.includes(self.location.origin)) {
                        await client.focus();
                        return;
                    }
                }
                
                // Open new window
                await self.clients.openWindow('/');
            })()
        );
    }
});

// Message handler for communication with main app
self.addEventListener('message', event => {
    console.log('SW: Message received:', event.data);
    
    if (!event.data || !event.data.action) return;
    
    switch (event.data.action) {
        case 'skipWaiting':
            self.skipWaiting();
            break;
            
        case 'clearCache':
            event.waitUntil(clearSpecificCache(event.data.cacheName));
            break;
            
        case 'clearAllCaches':
            event.waitUntil(clearAllCaches());
            break;
            
        case 'getCacheStatus':
            event.waitUntil(sendCacheStatus(event.ports[0]));
            break;
            
        default:
            console.warn('SW: Unknown message action:', event.data.action);
    }
});

const clearSpecificCache = async (cacheName) => {
    try {
        const deleted = await caches.delete(cacheName);
        console.log(`SW: Cache ${cacheName} deleted:`, deleted);
        return deleted;
    } catch (error) {
        console.error(`SW: Failed to delete cache ${cacheName}:`, error);
        throw error;
    }
};

const clearAllCaches = async () => {
    try {
        const cacheNames = await caches.keys();
        const deletePromises = cacheNames.map(name => caches.delete(name));
        await Promise.all(deletePromises);
        console.log('SW: All caches cleared');
    } catch (error) {
        console.error('SW: Failed to clear all caches:', error);
        throw error;
    }
};

const sendCacheStatus = async (port) => {
    try {
        const cacheNames = await caches.keys();
        const status = {
            version: CACHE_VERSION,
            caches: cacheNames,
            timestamp: Date.now()
        };
        
        port.postMessage(status);
    } catch (error) {
        console.error('SW: Failed to get cache status:', error);
        port.postMessage({ error: error.message });
    }
};

// Error handler
self.addEventListener('error', event => {
    console.error('SW: Unhandled error:', event.error);
});

self.addEventListener('unhandledrejection', event => {
    console.error('SW: Unhandled promise rejection:', event.reason);
});

console.log(`SW: Service Worker v${CACHE_VERSION} loaded`);