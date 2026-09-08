// push-manager.js — Módulo de gestión de Web Push para DeliciasExpress PWA
// Incluir con: <script src="push-manager.js"></script>
// Debe cargarse ANTES de scripts.js, admin.js y domiciliario.js

const PushManager = (() => {
  // ⚠️ REEMPLAZAR con la clave pública VAPID que generaste en el paso 0.1
  // Es la línea "Public Key: ..." del resultado de: npx web-push generate-vapid-keys
  // Esta clave NO es secreta, es seguro tenerla en el código del cliente.
  const VAPID_PUBLIC_KEY = 'BLGtD5sXMITc3FooIS82m76PYENfua0k5-DmLOuIZGpflMq9nWy0-M8PGSO2sOOG7l0LoeEabSv9Qm64rQawiz8';

  // ── Utilidad: convertir base64url a Uint8Array (necesario para subscribe) ──
  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
    const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
  }

  // ── Registrar el Service Worker ───────────────────────────────────────────
  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
      console.warn('[PWA] Service Workers no soportados en este navegador');
      return null;
    }
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      console.log('[PWA] Service Worker registrado. Scope:', reg.scope);
      return reg;
    } catch (err) {
      console.error('[PWA] Error registrando Service Worker:', err);
      return null;
    }
  }

  // ── Pedir permiso de notificaciones ──────────────────────────────────
  async function requestPermission() {
    if (!('Notification' in window)) {
      console.warn('[PWA] Notificaciones no soportadas en este navegador');
      return { status: 'unsupported', reason: 'Tu navegador no soporta notificaciones.' };
    }
    if (Notification.permission === 'denied') {
      return {
        status: 'denied',
        reason:
          'Ya habías bloqueado las notificaciones. Para activarlas:\n' +
          '1. Toca el ícono del candado (🔒) en la barra de la URL.\n' +
          '2. Entra a "Permisos del sitio".\n' +
          '3. Cambia "Notificaciones" a "Permitir".\n' +
          '4. Recarga la página y vuelve a intentarlo.',
      };
    }
    if (Notification.permission === 'granted') return { status: 'granted', reason: '' };
    try {
      const result = await Notification.requestPermission();
      if (result === 'granted') return { status: 'granted', reason: '' };
      return { status: result, reason: 'Permiso no concedido. Intenta de nuevo o revisa la configuración del navegador.' };
    } catch (err) {
      console.error('[PWA] Error al solicitar permiso:', err);
      return { status: 'error', reason: `Error al solicitar permiso: ${err.message}` };
    }
  }

  // ── Suscribir al Push y guardar en Supabase ───────────────────────────────
  // Retorna: { subscription, record } si OK
  //          { error: string } si falla (para que el caller muestre el mensaje correcto)
  async function subscribeToPush(supabaseClient, role = 'cliente', userId = null) {
    if (VAPID_PUBLIC_KEY === 'REEMPLAZAR_CON_TU_VAPID_PUBLIC_KEY') {
      console.error('[PWA] ⚠️ La clave VAPID_PUBLIC_KEY no ha sido configurada en push-manager.js');
      return null;
    }

    const permResult = await requestPermission();
    if (permResult.status !== 'granted') {
      console.warn('[PWA] Permiso no concedido:', permResult.reason);
      return { error: permResult.reason };
    }

    // Asegurar que el SW esté registrado y listo
    let registration;
    try {
      registration = await registerServiceWorker();
      if (!registration) throw new Error('No se pudo registrar el Service Worker.');
      await navigator.serviceWorker.ready;
    } catch (err) {
      console.error('[PWA] Error con Service Worker:', err);
      return { error: `Error interno del Service Worker: ${err.message}` };
    }

    // Intentar suscribirse al push
    let subscription;
    try {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    } catch (err) {
      console.error('[PWA] Error al suscribirse al Push Manager:', err.name, err.message);
      // Diagnóstico específico
      let msg = `Error al suscribirse: ${err.name} — ${err.message}`;
      if (err.name === 'AbortError') {
        msg = 'El navegador canceló la suscripción. Asegúrate de que Chrome esté actualizado y que el sitio sea HTTPS.';
      } else if (err.name === 'NotAllowedError') {
        msg = 'El permiso de notificaciones fue bloqueado. Sigue los pasos de la configuración del navegador para habilitarlo.';
      }
      return { error: msg };
    }

    const subJson = subscription.toJSON();
    const endpoint = subJson.endpoint;
    const p256dh   = subJson.keys?.p256dh;
    const auth     = subJson.keys?.auth;

    if (!endpoint || !p256dh || !auth) {
      console.error('[PWA] Suscripción incompleta (falta endpoint, p256dh o auth)');
      return { error: 'Suscripción push incompleta. Intenta desde otro navegador.' };
    }

    // Guardar / actualizar en Supabase
    const { data, error: dbError } = await supabaseClient
      .from('push_subscriptions')
      .upsert(
        {
          endpoint,
          p256dh,
          auth,
          role,
          user_id:    userId,
          user_agent: navigator.userAgent,
        },
        { onConflict: 'endpoint' }
      )
      .select()
      .single();

    if (dbError) {
      console.error('[PWA] Error guardando suscripción en Supabase:', dbError);
      return { error: `Error de base de datos: ${dbError.message}` };
    }

    console.log('[PWA] ✅ Suscripción push guardada exitosamente. Role:', role);
    return { subscription, record: data };
  }

  // ── Vincular un order_id a la suscripción push actual ────────────────────
  // Usado cuando un cliente anónimo hace un pedido, para que el servidor
  // sepa a qué suscripción push enviar la notificación de ese pedido.
  async function linkOrderToPush(supabaseClient, orderId) {
    if (!('serviceWorker' in navigator)) return;

    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const { error } = await supabaseClient.rpc('link_order_to_push_subscription', {
      p_endpoint: subscription.endpoint,
      p_order_id: orderId,
    });

    if (error) {
      console.error('[PWA] Error vinculando pedido a push subscription:', error);
    } else {
      console.log('[PWA] ✅ Pedido vinculado a push subscription:', orderId);
    }
  }

  // ── Cancelar suscripción push ─────────────────────────────────────────────
  async function unsubscribeFromPush(supabaseClient) {
    if (!('serviceWorker' in navigator)) return;

    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return;

    const subscription = await registration.pushManager.getSubscription();
    if (!subscription) return;

    const endpoint = subscription.endpoint;
    await subscription.unsubscribe();

    await supabaseClient
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', endpoint);

    console.log('[PWA] Suscripción push cancelada y eliminada de Supabase');
  }

  // ── Verificar si ya hay una suscripción activa ────────────────────────────
  async function isSubscribed() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return false;

    const registration = await navigator.serviceWorker.getRegistration('/');
    if (!registration) return false;

    const sub = await registration.pushManager.getSubscription();
    return !!sub;
  }

  // ── Auto-registrar el SW al cargar el módulo ──────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', registerServiceWorker);
  } else {
    registerServiceWorker();
  }

  // ── API pública ───────────────────────────────────────────────────────────
  return {
    registerServiceWorker,
    requestPermission,
    subscribeToPush,
    linkOrderToPush,
    unsubscribeFromPush,
    isSubscribed,
  };
})();
