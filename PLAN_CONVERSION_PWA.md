# 📱 Plan de Conversión a PWA — DeliciasExpress
> **Proyecto:** catalogos_comidaR  
> **Objetivo:** Convertir la app en una Progressive Web App (PWA) con notificaciones push reales que lleguen aunque el celular esté bloqueado o la app cerrada.  
> **Fecha del plan:** Septiembre 2026  
> **Stack actual:** HTML + Vanilla JS + Supabase (PostgreSQL + Auth + Realtime)  
> **Proyecto en GitHub:** `David-GonzalezR/DeliciasExpress`

---

## 🔍 Diagnóstico del Problema Actual

Actualmente las "notificaciones" del sistema son solo alertas visuales dentro de la app (`showCustomAlert`). Funcionan así:

- El cliente ve actualizaciones **solo si tiene la app abierta** (`subscribeToOrderStatus` + polling cada 5s).
- El domiciliario escucha pedidos **solo si está en `domiciliario.html` activa** (polling cada 5s).
- El admin recibe pedidos **solo si tiene `admin.html` abierta** (Supabase Realtime `subscribeToOrders`).
- **Cuando la pantalla se bloquea**, el navegador suspende JavaScript → no llegan notificaciones.

**Solución:** Web Push API + Service Worker. El Service Worker vive separado del tab, escucha mensajes del servidor y muestra notificaciones nativas del sistema operativo aunque la app esté cerrada.

---

## 🗺️ Arquitectura de la Solución

```
[Supabase DB] → change en tabla orders
       ↓
[Supabase Edge Function] → detecta el cambio (Database Webhook)
       ↓
[Edge Function] → llama Web Push API con clave VAPID
       ↓
[FCM/Browser Push Service] → entrega push al dispositivo
       ↓
[Service Worker en el celular] → recibe el mensaje aunque la app esté cerrada
       ↓
[Notificación nativa del sistema] → aparece en la barra de notificaciones
```

---

## 📋 LISTA COMPLETA DE TAREAS

### FASE 0 — Cosas que DEBE HACER EL DUEÑO DEL PROYECTO (tú)

> ⚠️ Estas tareas requieren acceso a cuentas y no puede hacerlas el modelo. Hazlas ANTES de que el modelo empiece a ejecutar el plan.

---

#### 0.1 — Generar claves VAPID

Las claves VAPID son el par de llaves pública/privada que autentican tu servidor para enviar push notifications.

**Pasos:**
1. Abre una terminal en el proyecto
2. Ejecuta:
   ```bash
   npx web-push generate-vapid-keys
   ```
3. Guarda el resultado. Vas a obtener algo así:
   ```
   Public Key: BEl62iUYgUivxIkv69yViEuiBIa40Xd27YD...
   Private Key: UUxI4O8-HoGgZ57xBU7oXj4...
   ```
4. **Guarda estas dos claves en un lugar seguro**, las necesitarás en los pasos 0.2 y 0.3.

---

#### 0.2 — Configurar Secrets en Supabase

1. Ve a tu proyecto en [supabase.com](https://supabase.com) → proyecto `sjoytwcrdewealudjxep`
2. Ve a **Settings → Edge Functions → Secrets**
3. Agrega estos 3 secrets:

| Nombre | Valor |
|--------|-------|
| `VAPID_PUBLIC_KEY` | La clave pública generada en 0.1 |
| `VAPID_PRIVATE_KEY` | La clave privada generada en 0.1 |
| `VAPID_SUBJECT` | `mailto:tu-email@gmail.com` (pon tu email real) |

---

#### 0.3 — Configurar Database Webhooks en Supabase

Los webhooks disparan la Edge Function cuando cambia un pedido.

1. En Supabase → **Database → Webhooks**
2. Crea un webhook con estos datos:
   - **Name:** `notify-order-change`
   - **Table:** `orders`
   - **Events:** ✅ UPDATE (también ✅ INSERT si quieres notificar al admin de nuevos pedidos)
   - **Type:** Supabase Edge Function
   - **Edge Function:** `send-push-notification` ← (este lo creará el modelo)
3. Haz clic en **Create Webhook**

---

#### 0.4 — Instalar Supabase CLI (para desplegar la Edge Function)

```bash
npm install -g supabase
supabase --version
supabase login
```

---

#### 0.5 — Verificar que el sitio tiene HTTPS

Las PWA y Web Push **solo funcionan en HTTPS** (o localhost para desarrollo).
- Si usas GitHub Pages: ya tiene HTTPS ✅
- Si usas Vercel / Netlify: ya tiene HTTPS ✅

---

### FASE 1 — Base de Datos (SQL Migrations)

> 🤖 **Esta fase la ejecuta el modelo.** Aplicar en Supabase SQL Editor o con la CLI.

#### 1.1 — Crear tabla `push_subscriptions`

```sql
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    order_ids TEXT[] DEFAULT '{}',
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    role TEXT DEFAULT 'cliente' CHECK (role IN ('cliente', 'admin', 'domiciliario')),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_push_subs_user_id ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_role ON public.push_subscriptions(role);
CREATE INDEX IF NOT EXISTS idx_push_subs_endpoint ON public.push_subscriptions(endpoint);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own subscriptions"
    ON public.push_subscriptions
    FOR ALL
    USING (user_id = auth.uid() OR user_id IS NULL)
    WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

CREATE OR REPLACE FUNCTION update_push_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER push_subscriptions_updated_at
    BEFORE UPDATE ON public.push_subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION update_push_subscriptions_updated_at();
```

#### 1.2 — Agregar columna `push_notified_admin` en orders

```sql
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'push_notified_admin'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN push_notified_admin BOOLEAN DEFAULT FALSE;
    END IF;
END $$;
```

#### 1.3 — RPC para vincular order_id anónimo a suscripción push

```sql
CREATE OR REPLACE FUNCTION link_order_to_push_subscription(
    p_endpoint TEXT,
    p_order_id TEXT
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.push_subscriptions
    SET order_ids = array_append(
        array_remove(order_ids, p_order_id),
        p_order_id
    )
    WHERE endpoint = p_endpoint;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

---

### FASE 2 — Edge Function: `send-push-notification`

> 🤖 **Esta fase la ejecuta el modelo.**

Crear el archivo en: `supabase/functions/send-push-notification/index.ts`

```typescript
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as webpush from "https://esm.sh/web-push@3.6.7";

const VAPID_PUBLIC_KEY = Deno.env.get("VAPID_PUBLIC_KEY")!;
const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY")!;
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT")!;

webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const STATUS_LABELS: Record<string, string> = {
  recibido: "Recibido ✅",
  preparando: "Preparando 👨‍🍳",
  buscando_domiciliario: "Buscando domiciliario 🔍",
  en_camino: "En camino 🛵",
  entregado: "Entregado 🏠",
  cancelado: "Cancelado ❌",
};

async function sendPush(subs: any[], payload: string) {
  await Promise.allSettled(
    subs.map((sub) =>
      webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload
      ).catch(async (err: any) => {
        if (err.statusCode === 410 || err.statusCode === 404) {
          await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
        }
      })
    )
  );
}

serve(async (req) => {
  try {
    const payload = await req.json();
    const { type, record, old_record } = payload;
    if (!record) return new Response("OK", { status: 200 });

    const order = record;
    const orderId = order.id;
    const newStatus = order.status;
    const oldStatus = old_record?.status;
    const isNewOrder = type === "INSERT";

    // Notificar al ADMIN cuando llega un pedido nuevo
    if (isNewOrder) {
      const { data: adminSubs } = await supabase
        .from("push_subscriptions").select("endpoint, p256dh, auth").eq("role", "admin");

      if (adminSubs?.length) {
        await sendPush(adminSubs, JSON.stringify({
          title: "🔔 Nuevo Pedido - DeliciasExpress",
          body: `Pedido #${orderId.slice(0, 8).toUpperCase()} recibido`,
          icon: "/icon-192.png",
          badge: "/badge-72.png",
          tag: `new-order-${orderId}`,
          data: { url: "/admin.html", orderId },
        }));
      }
    }

    // Notificar al CLIENTE cuando cambia el estado
    if (type === "UPDATE" && oldStatus !== newStatus) {
      const statusLabel = STATUS_LABELS[newStatus] || newStatus;
      const shortId = orderId.slice(0, 8).toUpperCase();
      let clientSubs: any[] = [];

      if (order.customer_user_id) {
        const { data } = await supabase
          .from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", order.customer_user_id);
        if (data) clientSubs = data;
      }

      const { data: anonSubs } = await supabase
        .from("push_subscriptions").select("endpoint, p256dh, auth").contains("order_ids", [orderId]);
      if (anonSubs) clientSubs = [...clientSubs, ...anonSubs];

      const uniqueSubs = Array.from(new Map(clientSubs.map((s) => [s.endpoint, s])).values());

      if (uniqueSubs.length) {
        await sendPush(uniqueSubs, JSON.stringify({
          title: "DeliciasExpress 🍔",
          body: `Tu pedido #${shortId} está: ${statusLabel}`,
          icon: "/icon-192.png",
          badge: "/badge-72.png",
          tag: `order-status-${orderId}`,
          renotify: true,
          data: { url: "/index.html", orderId },
        }));
      }

      // Notificar al DOMICILIARIO si hay pedido asignado
      const riderId = order.rider_id;
      if (riderId && (newStatus === "buscando_domiciliario" || newStatus === "en_camino")) {
        const { data: riderSubs } = await supabase
          .from("push_subscriptions").select("endpoint, p256dh, auth").eq("user_id", riderId);

        if (riderSubs?.length) {
          await sendPush(riderSubs, JSON.stringify({
            title: "🛵 Pedido disponible - DeliciasExpress",
            body: `Pedido #${shortId} listo para entrega`,
            icon: "/icon-192.png",
            badge: "/badge-72.png",
            tag: `rider-order-${orderId}`,
            data: { url: "/domiciliario.html", orderId },
          }));
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" }, status: 200,
    });
  } catch (error: any) {
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { "Content-Type": "application/json" }, status: 500,
    });
  }
});
```

**Desplegar:**
```bash
supabase functions deploy send-push-notification --project-ref sjoytwcrdewealudjxep
```

---

### FASE 3 — Service Worker (`sw.js`)

> 🤖 **Esta fase la ejecuta el modelo.** Crear en la raíz del proyecto.

```javascript
// sw.js — Service Worker de DeliciasExpress PWA
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
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(ASSETS_TO_CACHE.map(url => cache.add(url).catch(() => null)))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.hostname.includes('supabase.co')) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && url.origin === self.location.origin) {
          const cloned = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, cloned));
        }
        return response;
      }).catch(() => cached || new Response('Sin conexión', { status: 503 }));
    })
  );
});

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let data;
  try { data = event.data.json(); }
  catch (e) { data = { title: 'DeliciasExpress', body: event.data.text(), icon: '/icon-192.png' }; }

  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body || '',
      icon: data.icon || '/icon-192.png',
      badge: data.badge || '/badge-72.png',
      tag: data.tag || 'delicias-express',
      renotify: data.renotify || false,
      vibrate: [200, 100, 200],
      data: data.data || {},
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data?.url || '/';
  const orderId = event.notification.data?.orderId;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.includes(targetUrl.split('?')[0]) && 'focus' in client) {
          if (orderId) client.postMessage({ type: 'OPEN_ORDER_STATUS', orderId });
          return client.focus();
        }
      }
      const url = orderId ? `${targetUrl}?openOrder=${orderId}` : targetUrl;
      return clients.openWindow(url);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
```

---

### FASE 4 — Web App Manifest (`manifest.json`)

> 🤖 **Esta fase la ejecuta el modelo.**

```json
{
  "name": "DeliciasExpress",
  "short_name": "DeliciasExpress",
  "description": "Tu comida favorita a domicilio",
  "start_url": "/index.html",
  "display": "standalone",
  "background_color": "#0f172a",
  "theme_color": "#e11d48",
  "orientation": "portrait-primary",
  "scope": "/",
  "lang": "es",
  "icons": [
    { "src": "/icon-72.png",  "sizes": "72x72",   "type": "image/png", "purpose": "maskable any" },
    { "src": "/icon-96.png",  "sizes": "96x96",   "type": "image/png", "purpose": "maskable any" },
    { "src": "/icon-128.png", "sizes": "128x128", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icon-144.png", "sizes": "144x144", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icon-152.png", "sizes": "152x152", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icon-384.png", "sizes": "384x384", "type": "image/png", "purpose": "maskable any" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable any" }
  ],
  "shortcuts": [
    { "name": "Ver Menú",     "url": "/index.html", "icons": [{ "src": "/icon-96.png", "sizes": "96x96" }] },
    { "name": "Panel Admin",  "url": "/admin.html",  "icons": [{ "src": "/icon-96.png", "sizes": "96x96" }] }
  ],
  "categories": ["food", "shopping"]
}
```

---

### FASE 5 — Íconos de la PWA

> 🤖 **Esta fase la ejecuta el modelo.** Usar la herramienta `generate_image` para crear los íconos.

**Tamaños requeridos:**

| Archivo | Tamaño |
|---------|--------|
| `icon-72.png`  | 72×72  |
| `icon-96.png`  | 96×96  |
| `icon-128.png` | 128×128 |
| `icon-144.png` | 144×144 |
| `icon-152.png` | 152×152 |
| `icon-192.png` | 192×192 |
| `icon-384.png` | 384×384 |
| `icon-512.png` | 512×512 |
| `badge-72.png` | 72×72 (monochrome) |

**Prompt para generar el ícono principal 512×512:**
> "App icon for a food delivery app called DeliciasExpress. Circular icon, dark red background (#e11d48), white bold letters 'DE' centered in modern sans-serif font, small delivery motorcycle icon below letters. Flat design, no shadows, suitable for PWA app icon."

El modelo debe generar el ícono 512×512 y luego redimensionarlo con comandos para los otros tamaños.

---

### FASE 6 — Módulo de Push Notifications (`push-manager.js`)

> 🤖 **Esta fase la ejecuta el modelo.** Crear en la raíz del proyecto.

**IMPORTANTE:** El modelo debe reemplazar `REEMPLAZAR_CON_VAPID_PUBLIC_KEY` con el valor real de la clave pública VAPID si el dueño ya lo proporcionó. Si no, dejarlo como placeholder visible.

```javascript
// push-manager.js
// Módulo de gestión de Web Push para DeliciasExpress
const PushManager = (() => {
  // ⚠️ REEMPLAZAR con la clave pública VAPID generada en el paso 0.1
  const VAPID_PUBLIC_KEY = 'REEMPLAZAR_CON_VAPID_PUBLIC_KEY';

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[PWA] Service Workers no soportados');
      return null;
    }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[PWA] SW registrado:', reg.scope);
      return reg;
    } catch (err) {
      console.error('[PWA] Error registrando SW:', err);
      return null;
    }
  }

  async function requestPermission() {
    if (!('Notification' in window)) return 'denied';
    if (Notification.permission === 'granted') return 'granted';
    if (Notification.permission === 'denied') return 'denied';
    return await Notification.requestPermission();
  }

  async function subscribeToPush(supabaseClient, role = 'cliente', userId = null) {
    const permission = await requestPermission();
    if (permission !== 'granted') return null;

    const registration = await registerServiceWorker();
    if (!registration) return null;
    await navigator.serviceWorker.ready;

    let subscription;
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch (err) {
      console.error('[PWA] Error suscribiendo:', err);
      return null;
    }

    const subJson = subscription.toJSON();
    const { data, error } = await supabaseClient
      .from('push_subscriptions')
      .upsert(
        { endpoint: subJson.endpoint, p256dh: subJson.keys?.p256dh, auth: subJson.keys?.auth,
          role, user_id: userId, user_agent: navigator.userAgent },
        { onConflict: 'endpoint' }
      ).select().single();

    if (error) { console.error('[PWA] Error guardando suscripción:', error); return null; }
    console.log('[PWA] ✅ Suscripción push guardada');
    return { subscription, record: data };
  }

  async function linkOrderToPush(supabaseClient, orderId) {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    await supabaseClient.rpc('link_order_to_push_subscription', {
      p_endpoint: subscription.endpoint, p_order_id: orderId,
    });
    console.log('[PWA] ✅ Pedido vinculado al push:', orderId);
  }

  async function unsubscribeFromPush(supabaseClient) {
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return;
    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;
    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();
    await supabaseClient.from('push_subscriptions').delete().eq('endpoint', endpoint);
    console.log('[PWA] Suscripción eliminada');
  }

  async function isSubscribed() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;
    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return false;
    const sub = await registration.pushManager.getSubscription();
    return !!sub;
  }

  // Auto-registrar SW al cargar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerServiceWorker);
  } else {
    registerServiceWorker();
  }

  return { registerServiceWorker, requestPermission, subscribeToPush,
           linkOrderToPush, unsubscribeFromPush, isSubscribed };
})();
```

---

### FASE 7 — Modificar `index.html`

> 🤖 **Esta fase la ejecuta el modelo.**

#### 7.1 — Agregar en el `<head>` (después del `<meta viewport>`):

```html
<!-- PWA Meta Tags -->
<meta name="theme-color" content="#e11d48">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="DeliciasExpress">
<link rel="manifest" href="/manifest.json">
<link rel="apple-touch-icon" href="/icon-192.png">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
```

#### 7.2 — Agregar script de push-manager ANTES del script de supabase:

```html
<script src="push-manager.js"></script>
```

#### 7.3 — Agregar botón de notificaciones en el header (dentro de `header-actions`, después del botón `share-app-btn`):

```html
<button id="enable-push-btn"
        class="cart-icon-button transition-all-smooth"
        title="Activar notificaciones"
        style="display:none;"
        aria-label="Activar notificaciones">
    <i class="fas fa-bell"></i>
</button>
```

---

### FASE 8 — Modificar `scripts.js`

> 🤖 **Esta fase la ejecuta el modelo.**

#### 8.1 — Agregar referencia al botón en la sección de DOM (después de la línea del `shareAppBtn`):

```javascript
const enablePushBtn = document.getElementById('enable-push-btn');
```

#### 8.2 — Agregar función `initPWA` y su event listener (después de la función `showOrderAcknowledgedNotification`, alrededor de línea 594):

```javascript
// --- INICIALIZACIÓN PWA Y PUSH NOTIFICATIONS ---
async function initPWA() {
    if ('Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window) {
        const alreadySubscribed = await PushManager.isSubscribed();
        if (!alreadySubscribed && enablePushBtn) {
            enablePushBtn.style.display = 'inline-flex';
        }
    }

    // Escuchar mensajes del Service Worker (click en notificación)
    navigator.serviceWorker?.addEventListener('message', (event) => {
        if (event.data?.type === 'OPEN_ORDER_STATUS') {
            selectedOrderId = event.data.orderId;
            openOrderStatusModal();
        }
    });

    // Si la URL tiene ?openOrder=xxx (desde notificationclick del SW)
    const urlParams = new URLSearchParams(window.location.search);
    const openOrderId = urlParams.get('openOrder');
    if (openOrderId) {
        selectedOrderId = openOrderId;
        setTimeout(() => openOrderStatusModal(), 1200);
    }
}

enablePushBtn?.addEventListener('click', async () => {
    enablePushBtn.disabled = true;
    enablePushBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    const result = await PushManager.subscribeToPush(supabase, 'cliente', currentUser?.id || null);
    if (result) {
        enablePushBtn.style.display = 'none';
        showCustomAlert('🔔 ¡Notificaciones activadas! Te avisaremos cuando tu pedido cambie de estado.');
    } else {
        enablePushBtn.disabled = false;
        enablePushBtn.innerHTML = '<i class="fas fa-bell"></i>';
        showCustomAlert('No se pudieron activar las notificaciones. Verifica los permisos del navegador en Configuración.');
    }
});
```

#### 8.3 — En la función de checkout, DESPUÉS de guardar el pedido en Supabase y obtener el `orderId`, agregar:

```javascript
// Vincular el pedido recién creado a la suscripción push del cliente
if (orderId && await PushManager.isSubscribed()) {
    await PushManager.linkOrderToPush(supabase, orderId);
}
```

#### 8.4 — Después del login exitoso (donde se actualiza `currentUser`), agregar:

```javascript
// Actualizar la suscripción push con el user_id del usuario logueado
if (session?.user?.id && await PushManager.isSubscribed()) {
    const reg = await navigator.serviceWorker?.getRegistration('/');
    if (reg) {
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
            await supabase.from('push_subscriptions')
                .update({ user_id: session.user.id, role: 'cliente' })
                .eq('endpoint', sub.endpoint);
        }
    }
}
```

#### 8.5 — Al final del bloque DOMContentLoaded (antes del cierre `}`), llamar:

```javascript
initPWA();
```

#### 8.6 — Agregar banner de instalación PWA al final de `scripts.js`:

```javascript
// ── PWA Install Banner ──
let deferredInstallPrompt = null;

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;

    const banner = document.createElement('div');
    banner.id = 'pwa-install-banner';
    banner.className = 'pwa-install-banner show';
    banner.innerHTML = `
        <div class="pwa-install-banner-text">
            <strong>📱 Instala DeliciasExpress</strong>
            <span>Recibe notificaciones aunque cierres el navegador</span>
        </div>
        <button class="pwa-install-btn" id="pwa-install-confirm">Instalar</button>
        <button class="pwa-install-close" id="pwa-install-dismiss" aria-label="Cerrar">
            <i class="fas fa-times"></i>
        </button>
    `;
    document.body.appendChild(banner);

    document.getElementById('pwa-install-confirm')?.addEventListener('click', async () => {
        if (deferredInstallPrompt) {
            deferredInstallPrompt.prompt();
            const { outcome } = await deferredInstallPrompt.userChoice;
            if (outcome === 'accepted') {
                banner.remove();
                setTimeout(() => PushManager.subscribeToPush(supabase, 'cliente', currentUser?.id || null), 2000);
            }
            deferredInstallPrompt = null;
        }
    });

    document.getElementById('pwa-install-dismiss')?.addEventListener('click', () => banner.remove());
});

window.addEventListener('appinstalled', () => {
    console.log('[PWA] ✅ App instalada');
    deferredInstallPrompt = null;
});
```

---

### FASE 9 — Modificar `admin.html` y `admin.js`

> 🤖 **Esta fase la ejecuta el modelo.**

#### 9.1 — En `admin.html`, agregar en `<head>` los mismos meta tags PWA del paso 7.1.

#### 9.2 — En `admin.html`, agregar `<script src="push-manager.js"></script>` antes del script de supabase.

#### 9.3 — En `admin.js`, agregar función `initAdminPush` y llamarla dentro de `showDashboard()`:

```javascript
async function initAdminPush() {
    if (!('PushManager' in window)) return;
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id || null;
    const alreadySubscribed = await PushManager.isSubscribed();

    if (!alreadySubscribed) {
        const result = await PushManager.subscribeToPush(supabase, 'admin', userId);
        if (result) console.log('[Admin PWA] Notificaciones push activadas ✅');
    } else if (userId) {
        const reg = await navigator.serviceWorker?.getRegistration('/');
        if (reg) {
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                await supabase.from('push_subscriptions')
                    .update({ user_id: userId, role: 'admin' })
                    .eq('endpoint', sub.endpoint);
            }
        }
    }
}

// Dentro de showDashboard(), al final, agregar:
// initAdminPush();
```

---

### FASE 10 — Modificar `domiciliario.html` y `domiciliario.js`

> 🤖 **Esta fase la ejecuta el modelo.**

#### 10.1 — En `domiciliario.html`, agregar los mismos meta tags PWA del paso 7.1 en `<head>`.

#### 10.2 — En `domiciliario.html`, agregar `<script src="push-manager.js"></script>` antes del script de supabase.

#### 10.3 — En `domiciliario.js`, agregar función `initRiderPush` y llamarla dentro de `showDashboard()`:

```javascript
async function initRiderPush() {
    if (!('PushManager' in window)) return;
    const { data: { session } } = await supabase.auth.getSession();
    const userId = session?.user?.id || null;
    const alreadySubscribed = await PushManager.isSubscribed();

    if (!alreadySubscribed) {
        const result = await PushManager.subscribeToPush(supabase, 'domiciliario', userId);
        if (result) console.log('[Rider PWA] Notificaciones push activadas ✅');
    } else if (userId) {
        const reg = await navigator.serviceWorker?.getRegistration('/');
        if (reg) {
            const sub = await reg.pushManager.getSubscription();
            if (sub) {
                await supabase.from('push_subscriptions')
                    .update({ user_id: userId, role: 'domiciliario' })
                    .eq('endpoint', sub.endpoint);
            }
        }
    }
}

// Dentro de showDashboard(), al final, agregar:
// initRiderPush();
```

---

### FASE 11 — Estilos PWA (`styles.css`)

> 🤖 **Esta fase la ejecuta el modelo.** Agregar al final de `styles.css`:

```css
/* ── PWA Install Banner ── */
.pwa-install-banner {
    display: none;
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    background: linear-gradient(135deg, #1e293b, #0f172a);
    border: 1px solid rgba(225, 29, 72, 0.3);
    border-radius: 16px;
    padding: 1rem 1.5rem;
    color: white;
    font-size: 0.875rem;
    z-index: 9999;
    box-shadow: 0 8px 32px rgba(0,0,0,0.4);
    width: calc(100% - 2rem);
    max-width: 400px;
    gap: 1rem;
    align-items: center;
    backdrop-filter: blur(10px);
}
.pwa-install-banner.show { display: flex; }
.pwa-install-banner-text { flex: 1; }
.pwa-install-banner-text strong { display: block; color: #e11d48; margin-bottom: 0.25rem; }
.pwa-install-btn {
    background: #e11d48; color: white; border: none;
    border-radius: 8px; padding: 0.5rem 1rem;
    font-weight: 700; cursor: pointer; white-space: nowrap;
    transition: background 0.2s;
}
.pwa-install-btn:hover { background: #be185d; }
.pwa-install-close {
    background: transparent; border: none;
    color: rgba(255,255,255,0.5); cursor: pointer;
    padding: 0.25rem; font-size: 1rem;
}
```

---

## 🔧 Estructura de Archivos Final

```
catalogos_comidaR/
├── index.html          ← MODIFICAR (meta tags PWA, push-manager.js, botón bell)
├── scripts.js          ← MODIFICAR (initPWA, linkOrderToPush, banner install)
├── styles.css          ← MODIFICAR (agregar estilos PWA al final)
├── admin.html          ← MODIFICAR (meta tags PWA, push-manager.js)
├── admin.js            ← MODIFICAR (initAdminPush en showDashboard)
├── domiciliario.html   ← MODIFICAR (meta tags PWA, push-manager.js)
├── domiciliario.js     ← MODIFICAR (initRiderPush en showDashboard)
│
├── sw.js               ← NUEVO
├── manifest.json       ← NUEVO
├── push-manager.js     ← NUEVO
├── icon-72.png         ← NUEVO
├── icon-96.png         ← NUEVO
├── icon-128.png        ← NUEVO
├── icon-144.png        ← NUEVO
├── icon-152.png        ← NUEVO
├── icon-192.png        ← NUEVO (principal)
├── icon-384.png        ← NUEVO
├── icon-512.png        ← NUEVO
├── badge-72.png        ← NUEVO
│
└── supabase/
    └── functions/
        └── send-push-notification/
            └── index.ts  ← NUEVO
```

---

## ✅ Orden de Ejecución para el Modelo

1. Aplicar SQL de **Fase 1** (copiar en Supabase SQL Editor y ejecutar)
2. Crear **`sw.js`** (Fase 3)
3. Crear **`manifest.json`** (Fase 4)
4. Generar **íconos** (Fase 5) con `generate_image` → guardar como PNG en la raíz
5. Crear **`push-manager.js`** (Fase 6) — poner clave VAPID si el dueño la proporcionó
6. Modificar **`index.html`** (Fase 7)
7. Modificar **`scripts.js`** (Fase 8)
8. Modificar **`admin.html`** (Fase 9, html)
9. Modificar **`admin.js`** (Fase 9, js)
10. Modificar **`domiciliario.html`** (Fase 10, html)
11. Modificar **`domiciliario.js`** (Fase 10, js)
12. Modificar **`styles.css`** (Fase 11)
13. Crear carpeta **`supabase/functions/send-push-notification/`** y el `index.ts` (Fase 2)
14. Instruir al dueño que ejecute:
    ```bash
    supabase functions deploy send-push-notification --project-ref sjoytwcrdewealudjxep
    ```

---

## ⚠️ Notas Importantes

### Clave VAPID pública
- La clave **pública** VAPID no es secreta y puede estar en el código del frontend.
- La clave **privada** VAPID **NUNCA** debe estar en el frontend; solo en los Supabase Secrets.

### iOS (iPhone/iPad)
- iOS soporta Web Push desde **iOS 16.4+** solo si la app está instalada (añadida a pantalla de inicio).
- En Safari iOS **no existe** `beforeinstallprompt`. Mostrar instrucciones: _"Toca el botón Compartir → Agregar a pantalla de inicio"_.
- Agregar estas instrucciones en el botón `enable-push-btn` en iOS: detectar con `navigator.userAgent.includes('iPhone')`.

### Coexistencia con Supabase Realtime
- El Realtime actual (WebSockets) sigue funcionando cuando la app está abierta → actualizaciones instantáneas en UI.
- El Push nuevo funciona cuando la app está cerrada/bloqueada → notificaciones nativas.
- Ambos sistemas son **complementarios**, no excluyentes.

### Polling del domiciliario
- El `setInterval(pollForUpdates, 5000)` puede reducirse a `30000` (30s) como respaldo cuando el Push esté activo, para ahorrar batería.

---

## 🧪 Plan de Pruebas

1. **Chrome DevTools Desktop:** Application → Service Workers → verificar `sw.js` activo. Application → Push → enviar push de prueba.
2. **Android Chrome:** Instalar PWA. Activar notificaciones. Bloquear pantalla. Cambiar estado de pedido desde admin. Verificar notificación nativa.
3. **iOS Safari 16.4+:** Añadir a pantalla de inicio. Abrir app instalada. Activar notificaciones. Bloquear y verificar.
4. **Admin push:** Crear pedido desde cliente. Verificar que admin recibe push aunque tenga `admin.html` cerrado.
5. **Domiciliario push:** Asignar pedido. Verificar push en `domiciliario.html` cerrado.

---

## 📚 Referencias

- [Web Push Protocol RFC 8030](https://datatracker.ietf.org/doc/html/rfc8030)
- [Supabase Edge Functions](https://supabase.com/docs/guides/functions)
- [Supabase Database Webhooks](https://supabase.com/docs/guides/database/webhooks)
- [web-push npm package](https://www.npmjs.com/package/web-push)
- [PWA en iOS — Apple WebKit Blog](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/)
- [Service Worker API — MDN](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API)
- [VAPID RFC 8292](https://datatracker.ietf.org/doc/html/rfc8292)
