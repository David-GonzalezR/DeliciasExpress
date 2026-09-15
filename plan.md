TAREA PRIORITARIA: CORREGIR WEB PUSH EN DELICIASEXpress

NO MODIFIQUES todavía el flujo de pedidos, estados, domiciliarios, carrito, GPS ni upselling.

El único objetivo de esta tarea es conseguir que las notificaciones Web Push funcionen correctamente en segundo plano.

PROBLEMA ACTUAL:

En el teléfono:

- Si la app está abierta, recibo/veo el nuevo pedido.
- Si la app está cerrada, NO recibo nada.
- Si tengo otra aplicación abierta, NO recibo nada.
- Si el panel del domiciliario está cerrado, cuando el admin pulsa "Buscar domiciliario" el domiciliario NO recibe el nuevo servicio.
- Tengo que abrir nuevamente la aplicación y actualizar para descubrir el pedido.

ESTO NO ES EL COMPORTAMIENTO DESEADO.

OBJETIVO:

El domiciliario debe recibir una notificación del sistema aunque la aplicación DeliciasExpress esté cerrada o en segundo plano.

Ejemplo:

Admin:
    Buscar domiciliario
        ↓
Servidor
        ↓
Push
        ↓
Teléfono del domiciliario
        ↓
Notificación del sistema
        ↓
"Nuevo domicilio disponible"
        ↓
sonido suave
        ↓
al tocar la notificación abrir domiciliario.html

También debe funcionar para notificaciones del cliente relacionadas con su pedido.

IMPORTANTE:

NO confundir Supabase Realtime con Web Push.

Realtime sirve para actualizar la aplicación cuando está conectada.

Web Push debe permitir recibir una notificación cuando la página está cerrada, mediante el Service Worker.

--------------------------------------------------
FASE 1 — AUDITORÍA
--------------------------------------------------

Antes de modificar código, inspecciona:

1. service-worker.js
2. pwa.js
3. scripts.js
4. domiciliario.js
5. admin.js
6. manifest.json
7. Edge Function send-push-notification
8. Edge Function get-vapid-public-key
9. tabla push_subscriptions
10. funciones RPC relacionadas con push
11. triggers/webhooks de orders
12. configuración VAPID
13. cualquier código que use PushManager
14. cualquier código que use Notification
15. cualquier código que use ServiceWorkerRegistration
16. cualquier código que use supabase.functions.invoke
17. cualquier código relacionado con order_ids
18. cualquier mecanismo que registre la suscripción

NO cambies nada todavía.

Primero produce un diagnóstico.

--------------------------------------------------
FASE 2 — COMPROBAR EL SERVICE WORKER
--------------------------------------------------

El Service Worker debe contener un handler real:

self.addEventListener('push', ...)

y debe poder ejecutar:

event.waitUntil(
    self.registration.showNotification(...)
)

Comprueba que:

- el Service Worker realmente está registrado;
- está activo;
- controla el origen;
- tiene scope correcto;
- puede recibir eventos push;
- no depende de que la página esté abierta;
- no depende de variables JavaScript de la página;
- no depende de Supabase Realtime para recibir el push.

Si no existe un handler push real, ese es un problema crítico.

--------------------------------------------------
FASE 3 — SUSCRIPCIÓN
--------------------------------------------------

Comprueba que el móvil tiene realmente:

PushSubscription

y que contiene:

- endpoint
- p256dh
- auth

Comprueba:

Notification.permission

Debe ser:

granted

Comprueba:

registration.pushManager.getSubscription()

Debe devolver una suscripción válida.

Comprueba que esa suscripción se registra correctamente en:

push_subscriptions

y que queda asociada al usuario/rol correcto.

MUY IMPORTANTE:

No registrar una suscripción solamente cuando la aplicación está abierta si después no queda persistida correctamente.

--------------------------------------------------
FASE 4 — VAPID
--------------------------------------------------

Comprueba:

- VAPID_PUBLIC_KEY
- VAPID_PRIVATE_KEY

La clave privada NUNCA debe estar en frontend.

La pública sí puede llegar al frontend.

Comprueba que:

get-vapid-public-key

devuelve una clave válida.

Comprueba que la Edge Function:

send-push-notification

utiliza correctamente la clave privada para firmar el mensaje.

--------------------------------------------------
FASE 5 — WEB PUSH REAL
--------------------------------------------------

Audita completamente send-push-notification.

Debe:

1. recibir el evento;
2. determinar qué usuario debe recibirlo;
3. buscar sus push_subscriptions;
4. enviar el Web Push al endpoint;
5. manejar correctamente respuestas 201/202;
6. eliminar suscripciones inválidas con respuestas 404/410;
7. registrar errores útiles.

NO simular Push con:

- Realtime;
- polling;
- alert();
- cambios visuales;
- sonidos de la página.

Debe ser Web Push real.

--------------------------------------------------
FASE 6 — EVENTO DE NUEVO DOMICILIO
--------------------------------------------------

Cuando el admin cambia el pedido a:

buscando_domiciliario

debe producirse una notificación Push dirigida a los domiciliarios disponibles.

No enviar solamente a un domiciliario.

Debe respetarse:

riders.is_available = true

y el rol:

domiciliario

La notificación debe decir algo como:

"Nuevo domicilio disponible"

y mostrar información útil:

- pedido;
- total;
- dirección resumida si corresponde.

No incluir datos sensibles innecesarios.

--------------------------------------------------
FASE 7 — CLIENTE
--------------------------------------------------

Cuando haya cambios relevantes en un pedido del cliente, comprobar que el Push se envía a la suscripción correspondiente.

Ejemplos:

- pedido recibido;
- pedido en preparación;
- domiciliario asignado;
- pedido en camino;
- pedido entregado.

No generar notificaciones duplicadas.

--------------------------------------------------
FASE 8 — SERVICE WORKER CERRADO
--------------------------------------------------

Este es el punto más importante de la prueba.

La aplicación debe poder estar:

A) abierta
B) en otra pestaña
C) en segundo plano
D) cerrada

y el Push debe seguir pudiendo activar el Service Worker.

El Service Worker NO debe depender de:

window
document
localStorage
variables de la página
Realtime

para procesar el evento push.

El handler push debe ser autónomo.

--------------------------------------------------
FASE 9 — SONIDO
--------------------------------------------------

Queremos un sonido suave para la notificación.

NO intentar reproducir:

new Audio(...).play()

desde el Service Worker.

El sonido debe utilizar el comportamiento de notificación del sistema operativo/navegador.

Configura la notificación de forma apropiada para que el sistema pueda emitir su sonido normal.

No crear sonidos molestos ni bucles.

--------------------------------------------------
FASE 10 — CLICK DE NOTIFICACIÓN
--------------------------------------------------

Implementar/revisar:

self.addEventListener('notificationclick', ...)

Al tocar:

"Nuevo domicilio disponible"

debe abrir/focalizar:

domiciliario.html

Si hay un order_id, pasarlo de forma segura para poder abrir el pedido correspondiente.

Si ya existe una pestaña abierta de la aplicación:

- focalizarla;
- no abrir 10 pestañas.

--------------------------------------------------
FASE 11 — DIAGNÓSTICO EN FRONTEND
--------------------------------------------------

Añadir temporalmente un diagnóstico claro para el botón:

"Activar notificaciones"

Debe mostrar:

Notification.permission
Service Worker registrado
Service Worker activo
PushSubscription existente
Endpoint presente
VAPID pública disponible
Usuario autenticado
Rol
Suscripción registrada en Supabase

NO mostrar secretos ni claves privadas.

Si falla algo, mostrar exactamente qué parte falló.

--------------------------------------------------
FASE 12 — NO ROMPER LO EXISTENTE
--------------------------------------------------

No modificar:

- flujo de pedidos;
- estados;
- aceptar pedido;
- marcar entregado;
- rating;
- GPS;
- carrito;
- negocio abierto/cerrado;
- demora;
- upselling.

Solamente Push.

--------------------------------------------------
FASE 13 — PRUEBA OBLIGATORIA
--------------------------------------------------

Después del cambio realizar esta prueba:

DISPOSITIVO A:
teléfono del domiciliario.

DISPOSITIVO B:
PC/admin.

1. Activar notificaciones en el teléfono.
2. Confirmar permission = granted.
3. Confirmar PushSubscription.
4. Confirmar registro en push_subscriptions.
5. Cerrar completamente la app DeliciasExpress en el teléfono.
6. Desde PC crear pedido.
7. Desde admin pulsar:
   "Buscar domiciliario"
8. NO abrir la app del domiciliario.
9. Esperar la notificación.

RESULTADO ESPERADO:

El teléfono debe mostrar:

"Nuevo domicilio disponible"

aunque DeliciasExpress esté cerrada.

Después:

10. Pulsar la notificación.
11. Debe abrir/focalizar domiciliario.html.
12. El pedido debe aparecer.
13. El domiciliario puede aceptarlo.

--------------------------------------------------
REGLA CRÍTICA
--------------------------------------------------

NO declares que Push funciona solamente porque funciona con la app abierta.

La prueba válida es:

APP CERRADA → PUSH RECIBIDO → NOTIFICACIÓN MOSTRADA → CLICK → APP ABIERTA.

Si eso no funciona, la tarea NO está terminada.

Al finalizar responde:

1. Diagnóstico
2. Causa exacta
3. Archivos modificados
4. Edge Functions modificadas
5. SQL/migraciones modificadas
6. Cómo se registra la suscripción
7. Cómo se dispara el Push
8. Cómo el Service Worker procesa el Push
9. Cómo probar con app cerrada
10. Resultado esperado

NO generes ZIP.