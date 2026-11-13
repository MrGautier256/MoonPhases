// Service worker : le site marche hors connexion, sans jamais servir une version périmée quand on est en ligne.
// Incrémenter CACHE quand la liste PRECACHE change.
const CACHE = 'phase-lunaire-v1';

const PRECACHE = [
    './',
    'index.html',
    'confidentialite.html',
    'styles.css',
    'script.js',
    'moon.js',
    'moon-drawing.js',
    'moon-textures.js',
    'manifest.webmanifest',
    'fonts/fredoka-variable.woff2',
    'icons/icon-192.png',
    'icons/icon-512.png',
    'icons/apple-touch-icon.png',
    'vendor/suncalc-2.1.2/suncalc.js',
    'vendor/tz-lookup-11.7.0/tz.js',
    'vendor/leaflet-1.9.4/leaflet.js',
    'vendor/leaflet-1.9.4/leaflet.css',
    'vendor/leaflet-1.9.4/images/layers.png',
    'vendor/leaflet-1.9.4/images/layers-2x.png',
    'vendor/leaflet-1.9.4/images/marker-icon.png',
    'vendor/leaflet-1.9.4/images/marker-icon-2x.png',
    'vendor/leaflet-1.9.4/images/marker-shadow.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(PRECACHE))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

// Réseau d'abord pour tous les fichiers du site : en ligne, on reçoit toujours la dernière version, et la
// page ne mélange jamais un nouveau HTML avec un ancien script. La copie en cache, rafraîchie à chaque
// passage, ne sert que hors connexion. Les autres sites (Photon, tuiles OpenStreetMap) ne sont pas touchés :
// la politique d'OpenStreetMap interdit de garder ses tuiles pour un usage hors connexion.
self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

    // La page elle-même est toujours revalidée auprès du serveur : une mise à jour du site se voit dès
    // l'ouverture suivante. Les autres fichiers suivent le cache HTTP habituel du navigateur.
    const options = request.mode === 'navigate' ? { cache: 'no-cache' } : {};

    event.respondWith(
        fetch(request, options)
            .then((response) => {
                if (response.ok) {
                    const copy = response.clone();
                    event.waitUntil(caches.open(CACHE).then((cache) => cache.put(request, copy)));
                }
                return response;
            })
            .catch(async () => {
                const cached = await caches.match(request, { ignoreSearch: request.mode === 'navigate' });
                if (cached) return cached;
                if (request.mode === 'navigate') return caches.match('index.html');
                return Response.error();
            })
    );
});
