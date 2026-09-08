# 🔍 Auditoría Completa — DeliciasExpress PWA

> **Fecha:** 2026-09-08 | **Auditor:** Antigravity Senior Dev Agent  
> **Proyecto Supabase:** `sjoytwcrdewealudjxep` (catalogo_comidaR)

---

## ✅ Estado General del Backend (Supabase)

| Componente | Estado | Detalle |
|---|---|---|
| Edge Function `send-push-notification` | 🟢 ACTIVA | Versión 1, desplegada |
| Secret `VAPID_PUBLIC_KEY` | 🟢 Presente | Configurado |
| Secret `VAPID_PRIVATE_KEY` | 🟢 Presente | Configurado |
| Secret `VAPID_SUBJECT` | 🟢 Presente | Configurado |
| Secret `SUPABASE_SERVICE_ROLE_KEY` | 🟢 Presente | Configurado |
| Tabla `push_subscriptions` | 🟢 Existe | Con al menos 1 registro |
| Migración SQL | 🟢 Aplicada | `20260903_pwa_push_subscriptions.sql` |

---

## 🚨 BUGS ENCONTRADOS

### BUG #1 — 🔴 CRÍTICO: Edge Function rechaza llamadas del Webhook (verify_jwt=true)

**Archivo:** `supabase/functions/send-push-notification/index.ts`  
**Síntoma:** Las notificaciones push **nunca llegan** ni en PC ni en Android.

**Causa raíz:** La Edge Function tiene activado `"verify_jwt": true`.  
Los **Database Webhooks** de Supabase no envían un JWT — llaman la función como petición HTTP anónima. Si `verify_jwt` es `true`, Supabase rechaza la petición con `401` antes de que entre al código.

**Flujo roto:** Webhook dispara → Supabase devuelve 401 → función nunca ejecuta → nadie recibe push.

**Solución backend:** Desactivar `verify_jwt` en la función. **(Lo corrijo yo)**

---

### BUG #2 — 🔴 CRÍTICO: Edge Function usa campo incorrecto para buscar rider

**Archivo:** `supabase/functions/send-push-notification/index.ts` línea 312  

```typescript
// BUG: El campo real de la tabla orders es assigned_rider_id, no rider_id
const riderId = order.rider_id as string | undefined;
```

El domiciliario **nunca recibe notificación push** de pedidos asignados.

**Solución:** Cambiar `order.rider_id` → `order.assigned_rider_id`. **(Lo corrijo yo)**

---

### BUG #3 — 🔴 CRÍTICO: Cifrado obsoleto `aesgcm` — rechazado por navegadores modernos

**Archivo:** `supabase/functions/send-push-notification/index.ts` líneas 141,142, 207  

```typescript
// BUG: Chrome 124+, Firefox 128+, Samsung Internet 26+ requieren "aes128gcm"
// "aesgcm" fue deprecado en el RFC 8291
"Content-Encoding": "aesgcm",   // ← INCORRECTO
```

Los navegadores modernos **rechazan silenciosamente** notificaciones cifradas con `aesgcm`. Este es probablemente el bug principal por el que no llegan notificaciones.

**Solución:** Reescribir el cifrado para usar `aes128gcm` (RFC 8291). **(Lo corrijo yo)**

---

### BUG #4 — 🔴 CRÍTICO: Database Webhook no configurado o falta

**Síntoma:** Aunque la función exista y sea correcta, si no hay un Webhook activo, nunca se dispara.

**Lo que debe existir en Supabase → Database → Webhooks:**
- Tabla: `orders`
- Eventos: `INSERT` y `UPDATE`
- URL: `https://sjoytwcrdewealudjxep.supabase.co/functions/v1/send-push-notification`

**Solución:** Verificar y crear el webhook. **(Lo corrijo yo)**

---

### BUG #5 — 🟡 IMPORTANTE: Botón "Marcar entregado" queda bloqueado si falla la red

**Archivo:** [`domiciliario.js`](file:///c:/Users/SOLO%20DESARROLLADORES/Documents/DAVID/Proyectos/ecomerce´s%20comida/catalogos_comidaR/domiciliario.js#L604-L620)

```javascript
btn.disabled = true;
const { data, error } = await supabase.rpc('mark_delivered', { p_order_id: orderId });
if (error || !(data && data.ok)) {
    alert('No se pudo marcar como entregado. Intenta de nuevo.');
    btn.disabled = false;  // ← Solo se reactiva en error
    return;
}
removeOrderFromMyDeliveries(orderId);
// ← Si mark_delivered tiene éxito pero hay lag de red, el item
//    desaparece de la UI pero la siguiente carga puede re-aparecerlo
//    con el botón deshabilitado permanentemente
```

Falta un bloque `finally` que garantice reactiva el botón si la operación es exitosa pero luego falla algo.

**Solución:** Usar `try/finally`. **(Para el prompt de frontend)**

---

### BUG #6 — 🟡 IMPORTANTE: PWA no se instala en Android

**Síntoma:** No aparece el botón/banner "Instalar" en Android Chrome.

**Causa:** Android Chrome 113+ exige al menos 1 `screenshot` en `manifest.json` para mostrar el banner de instalación. El `manifest.json` actual no tiene esta sección.

Además, `"start_url": "/index.html"` debería ser `"/"` para mayor compatibilidad.

**Solución:** Agregar `screenshots` y arreglar `start_url`. **(Para el prompt de frontend)**

---

### BUG #7 — 🟡 IMPORTANTE: Race condition en Android al activar push

**Archivo:** [`push-manager.js`](file:///c:/Users/SOLO%20DESARROLLADORES/Documents/DAVID/Proyectos/ecomerce´s%20comida/catalogos_comidaR/push-manager.js#L79-L95)

En Android, `pushManager.subscribe()` puede lanzar `AbortError` porque `navigator.serviceWorker.ready` no garantiza que el SW esté en estado `active` — solo que está disponible. Si el SW aún está en `installing` en el momento de la suscripción, el push falla.

**Solución:** Esperar explícitamente a `registration.active` antes de suscribirse. **(Para el prompt de frontend)**

---

### BUG #8 — 🟠 MENOR: Nombre `PushManager` colisiona con la API nativa del browser

**Archivo:** [`push-manager.js`](file:///c:/Users/SOLO%20DESARROLLADORES/Documents/DAVID/Proyectos/ecomerce´s%20comida/catalogos_comidaR/push-manager.js#L5) línea 5

```javascript
const PushManager = (() => { ... })();  // ← Shadowing del PushManager nativo
```

En `scripts.js` línea 598: `if ('PushManager' in window)` evalúa la API **nativa** del browser, no el módulo. Luego en línea 599: `await PushManager.isSubscribed()` llama al módulo custom. Esto es confuso y puede causar bugs en algunos entornos.

**Solución:** Renombrar a `DeliPushManager`. **(Para el prompt de frontend)**

---

### BUG #9 — 🟠 MENOR: `removeChannel` no esperado en subscribeToOrderStatus

**Archivo:** [`scripts.js`](file:///c:/Users/SOLO%20DESARROLLADORES/Documents/DAVID/Proyectos/ecomerce´s%20comida/catalogos_comidaR/scripts.js#L1392-L1430)

```javascript
supabase.removeChannel(orderRealtimeChannel);  // ← sin await
```

`removeChannel` es asíncrono. Sin `await`, el canal anterior puede seguir recibiendo eventos mientras se suscribe al nuevo, causando actualizaciones duplicadas.

---

## 📋 RESUMEN DE RESPONSABILIDADES

### 🔧 LO QUE CORRIJO YO EN SUPABASE (Backend)

| # | Acción | Impacto |
|---|---|---|
| 1 | Desactivar `verify_jwt` en Edge Function | Desbloquea todas las push |
| 2 | Corregir `rider_id` → `assigned_rider_id` | Push al domiciliario funciona |
| 3 | Actualizar cifrado `aesgcm` → `aes128gcm` | Push llegan en Chrome/Android modernos |
| 4 | Crear/verificar Database Webhook | Dispara la función al cambiar pedidos |

### 📝 LO QUE VA AL PROMPT DE FRONTEND (otro modelo)

| # | Bug | Archivo |
|---|---|---|
| 5 | Fix botón "entregado" con finally | domiciliario.js |
| 6 | Agregar screenshots + fix start_url | manifest.json |
| 7 | Race condition Android en subscribeToPush | push-manager.js |
| 8 | Renombrar PushManager → DeliPushManager | push-manager.js, scripts.js, domiciliario.js |
| 9 | await removeChannel() | scripts.js |

---

## 🤖 PROMPT LISTO PARA OTRO MODELO (Copia y pega esto)

```
Eres un desarrollador senior con 20 años de experiencia en JavaScript y PWAs.
Debes corregir los siguientes bugs en una aplicación web de delivery llamada "DeliciasExpress".
La app usa Supabase como backend y Vanilla JS en el frontend.

## ARCHIVOS A MODIFICAR
- push-manager.js
- scripts.js  
- domiciliario.js
- manifest.json

## BUG #1 — Renombrar PushManager para evitar colisión con API nativa del browser

En push-manager.js la línea 5 dice:
  const PushManager = (() => {
Cámbiala a:
  const DeliPushManager = (() => {
Y al final del archivo (línea 207-216 del return), cambia el nombre que se expone:
  return { ... }; // no hay que cambiarlo aquí

Luego busca TODAS las ocurrencias de "PushManager." en:
- scripts.js (hay unas 6-7 ocurrencias: PushManager.isSubscribed, PushManager.subscribeToPush, PushManager.linkOrderToPush, etc.)
- domiciliario.js (hay 2-3 ocurrencias: PushManager.isSubscribed, PushManager.subscribeToPush)
Y cámbialas a "DeliPushManager."

IMPORTANTE: NO cambies las ocurrencias de "'PushManager' in window" (esas evalúan la API nativa del browser, deben quedarse igual).

## BUG #2 — Botón "Marcar como entregado" queda bloqueado con errores de red

En domiciliario.js, en el listener de clicks de myDeliveriesContainer (alrededor de línea 604),
el código actual es aproximadamente:

  const orderId = btn.dataset.id;
  btn.disabled = true;

  const { data, error } = await supabase.rpc('mark_delivered', { p_order_id: orderId });
  if (error || !(data && data.ok)) {
      alert('No se pudo marcar como entregado. Intenta de nuevo.');
      btn.disabled = false;
      return;
  }

  removeOrderFromMyDeliveries(orderId);
  loadAvailability();

CORRECCIÓN: Envuelve la llamada RPC en try/finally para que el botón siempre
se reactiva si ocurre un error inesperado (error de red, timeout, etc.):

  const orderId = btn.dataset.id;
  btn.disabled = true;
  btn.textContent = 'Procesando...';

  try {
      const { data, error } = await supabase.rpc('mark_delivered', { p_order_id: orderId });
      if (error || !(data && data.ok)) {
          alert('No se pudo marcar como entregado. Intenta de nuevo.');
          btn.disabled = false;
          btn.innerHTML = '<i class="fas fa-check-double"></i> Marcar como entregado';
          return;
      }
      removeOrderFromMyDeliveries(orderId);
      loadAvailability();
  } catch (e) {
      alert('Error de conexión. Intenta de nuevo.');
      btn.disabled = false;
      btn.innerHTML = '<i class="fas fa-check-double"></i> Marcar como entregado';
  }

## BUG #3 — Android Chrome no muestra el banner de instalación PWA

En manifest.json, agrega la sección "screenshots" (requerida por Android Chrome 113+)
y corrige start_url. El archivo actual tiene:
  "start_url": "/index.html",

CORRECCIÓN: Cámbialo a:
  "start_url": "/",

Y agrega esta sección ANTES del cierre del objeto JSON (antes del último }):
  "screenshots": [
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "form_factor": "narrow",
      "label": "DeliciasExpress — Tu comida favorita a domicilio"
    },
    {
      "src": "/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "form_factor": "wide",
      "label": "DeliciasExpress — Panel de pedidos"
    }
  ]

## BUG #4 — Race condition en Android al activar notificaciones push

En push-manager.js, en la función subscribeToPush(), después de:
  await navigator.serviceWorker.ready;

Agrega este bloque para esperar a que el SW esté en estado "active":

  // Esperar a que el SW esté activo (evita AbortError en Android)
  const activeRegistration = await navigator.serviceWorker.ready;
  if (!activeRegistration.active) {
    await new Promise((resolve, reject) => {
      const sw = activeRegistration.installing || activeRegistration.waiting;
      if (!sw) { resolve(); return; }
      const timeout = setTimeout(() => reject(new Error('SW activation timeout')), 10000);
      sw.addEventListener('statechange', function handler(e) {
        if (e.target.state === 'activated') {
          clearTimeout(timeout);
          sw.removeEventListener('statechange', handler);
          resolve();
        }
      });
    });
  }

Y en el catch del bloque de suscripción (err.name === 'AbortError'), mejora el mensaje:
  msg = 'No se pudo activar las notificaciones. ' +
        'Asegúrate de estar en una conexión HTTPS, ' +
        'que Google Play Services esté activo, y vuelve a intentarlo.';

## BUG #5 — removeChannel sin await causa eventos duplicados

En scripts.js, en la función subscribeToOrderStatus (busca "orderRealtimeChannel = supabase"),
el código actual tiene:

  supabase.removeChannel(orderRealtimeChannel);

CORRECCIÓN: La función subscribeToOrderStatus debe ser async y usar await:

  async function subscribeToOrderStatus(orderId) {
    if (orderRealtimeChannel) {
      await supabase.removeChannel(orderRealtimeChannel);
      orderRealtimeChannel = null;
    }
    stopOrderPolling();
    // ... resto del código igual ...
  }

Actualiza también las llamadas a subscribeToOrderStatus() para que sean await si están
dentro de funciones async (openOrderStatusModal y selectTrackedOrder ya son async o
pueden serlo).

## NOTAS IMPORTANTES
- NO modifiques sw.js
- Mantén todos los comentarios existentes
- NO cambies nada de CSS ni HTML
- NO cambies la lógica de negocio, solo los bugs listados
- El archivo push-manager.js expone el módulo como variable global;
  asegúrate de que DeliPushManager sea accesible globalmente igual que antes
```
