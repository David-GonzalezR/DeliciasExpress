// sw.js — Service Worker de DeliciasExpress PWA
// Versión 1.0.0
// Este archivo DEBE estar en la raíz del proyecto para tener scope completo.

const CACHE_NAME = 'delicias-express-v1';

const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/styles.css',
  '/scripts.js',
  '/admin.html',
  '/admin.css',
  '/admin.js',
  '/domiciliario.html',
  '/domiciliario.js',
  '/push-manager.js',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

// ── INSTALL: pre-cachear assets estáticos ────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        ASSETS_TO_CACHE.map((url) => cache.add(url).catch(() => null))
      )
    )
  );
  // Tomar control inmediatamente sin esperar a que se cierren las pestañas viejas
  self.skipWaiting();
});

// ── ACTIVATE: limpiar caches de versiones anteriores ─────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
      )
    )
  );
  // Tomar control de todos los clientes ya abiertos
  self.clients.claim();
});

// ── FETCH: Cache-First para assets, Network para Supabase API ─────────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Supabase y CDNs externos → siempre red (datos siempre frescos)
  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('googleapis.com') ||
    url.hostname.includes('cloudflare.com') ||
    url.hostname.includes('jsdelivr.net')
  ) {
    return; // no interceptar, deja pasar al navegador
  }

  // Solo cachear peticiones GET
  if (event.request.method !== 'GET') return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;

      return fetch(event.request)
        .then((response) => {
          // Cachear solo respuestas exitosas del mismo origen
          if (response.ok && url.origin === self.location.origin) {
            const cloned = response.clone();
            caches
              .open(CACHE_NAME)
              .then((cache) => cache.put(event.request, cloned));
          }
          return response;
        })
        .catch(() => {
          // Sin red y sin cache: respuesta de emergencia
          if (event.request.destination === 'document') {
            return caches.match('/index.html');
          }
          return new Response('Sin conexión', { status: 503 });
        });
    })
  );
});

// ── PUSH: recibir notificación del servidor ───────────────────────────────
self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data;
  try {
    data = event.data.json();
  } catch (_e) {
    data = {
      title: 'DeliciasExpress',
      body: event.data.text(),
      icon: '/icon-192.png',
    };
  }

  const options = {
    body:             data.body     || '',
    icon:             data.icon     || '/icon-192.png',
    badge:            data.badge    || '/badge-72.png',
    tag:              data.tag      || 'delicias-express',
    renotify:         data.renotify || false,
    requireInteraction: false,
    vibrate:          [200, 100, 200],
    data:             data.data     || {},
    actions:          data.actions  || [],
  };

  event.waitUntil(
    self.registration.showNotification(data.title, options)
  );
});

// ── NOTIFICATIONCLICK: abrir/enfocar la app al tocar la notificación ──────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const targetUrl = event.notification.data?.url || '/';
  const orderId   = event.notification.data?.orderId;

  event.waitUntil(
    clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((windowClients) => {
        // Buscar si ya hay una pestaña de la app abierta
        const base = targetUrl.split('?')[0];
        for (const client of windowClients) {
          if (client.url.includes(base) && 'focus' in client) {
            if (orderId) {
              client.postMessage({ type: 'OPEN_ORDER_STATUS', orderId });
            }
            return client.focus();
          }
        }
        // No hay pestaña abierta → abrir una nueva
        const url = orderId
          ? `${targetUrl}?openOrder=${encodeURIComponent(orderId)}`
          : targetUrl;
        return clients.openWindow(url);
      })
  );
});

// ── MESSAGE: recibir mensajes del cliente JS ──────────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
