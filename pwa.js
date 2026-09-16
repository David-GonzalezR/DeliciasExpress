(() => {
  const SUPABASE_URL = 'https://sjoytwcrdewealudjxep.supabase.co';
  const SUPABASE_KEY = 'sb_publishable_ntEGkpHa7MVUq-nDw9fp-w_fAtOztkF';
  const VAPID_URL = `${SUPABASE_URL}/functions/v1/get-vapid-public-key`;
  let deferredInstallPrompt = null;
  let pushSubscription = null;

  async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return null;
    try {
      const registration = await navigator.serviceWorker.register('./service-worker.js', { scope: './' });
      return registration;
    } catch (error) {
      console.warn('[PWA] No se pudo registrar el service worker:', error);
      return null;
    }
  }

  function createPwaControls() {
    if (document.getElementById('pwa-controls')) return;
    const wrap = document.createElement('div');
    wrap.id = 'pwa-controls';
    wrap.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:9999;display:flex;gap:8px;flex-direction:column;align-items:flex-start;';
    wrap.innerHTML = `
      <button id="pwa-install-btn" type="button" style="display:none;border:0;border-radius:999px;padding:11px 15px;background:#111;color:#fff;font-weight:700;box-shadow:0 4px 18px rgba(0,0,0,.2);cursor:pointer;">📲 Instalar app</button>
      <button id="pwa-push-btn" type="button" style="display:none;border:0;border-radius:999px;padding:11px 15px;background:#e63946;color:#fff;font-weight:700;box-shadow:0 4px 18px rgba(0,0,0,.2);cursor:pointer;">🔔 Activar notificaciones</button>
      <button id="pwa-diagnostic-btn" type="button" style="display:none;border:0;border-radius:999px;padding:11px 15px;background:#6c757d;color:#fff;font-weight:700;box-shadow:0 4px 18px rgba(0,0,0,.2);cursor:pointer;">🔧 Diagnosticar Push</button>`;
    document.body.appendChild(wrap);
    document.getElementById('pwa-install-btn').addEventListener('click', installPwa);
    document.getElementById('pwa-push-btn').addEventListener('click', enablePush);
    document.getElementById('pwa-diagnostic-btn').addEventListener('click', showPushDiagnostic);
  }

  async function installPwa() {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch (_) {}
    deferredInstallPrompt = null;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
  }

  function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
  }

  function getCurrentStorageKey() {
    const path = (window.location.pathname || '').toLowerCase();
    if (path.includes('domiciliario')) return 'deliciasexpress-rider-auth';
    if (path.includes('admin')) return 'deliciasexpress-admin-auth';
    return 'deliciasexpress-client-auth';
  }

  async function getSupabaseClient() {
    if (!window.supabase) return null;
    return window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { storageKey: getCurrentStorageKey() } });
  }

  async function getVapidPublicKey() {
    const response = await fetch(VAPID_URL, { cache: 'no-store' });
    if (!response.ok) throw new Error('No se pudo obtener la clave pública VAPID');
    const data = await response.json();
    if (!data.publicKey) throw new Error('VAPID_PUBLIC_KEY no está configurada');
    return data.publicKey;
  }

  async function saveSubscription(subscription) {
    const json = subscription.toJSON();
    const keys = json.keys || {};
    if (!json.endpoint || !keys.p256dh || !keys.auth) throw new Error('La suscripción del navegador está incompleta');
    const client = await getSupabaseClient();
    if (!client) throw new Error('Supabase no está disponible');
    const { data } = await client.auth.getSession();
    const session = data?.session || null;
    const userId = session?.user?.id || null;
    let role = 'cliente';
    if (userId) {
      const { data: userRole, error: roleError } = await client.rpc('get_user_role');
      if (roleError) console.warn('[PWA] Error obteniendo rol:', roleError);
      if (userRole) role = userRole;
    }
    const { data: saved, error } = await client.rpc('register_push_subscription', {
      p_endpoint: json.endpoint,
      p_p256dh: keys.p256dh,
      p_auth: keys.auth,
      p_role: role
    });
    if (error) throw error;
    if (!saved || saved.ok !== true) throw new Error(saved?.error || 'No se pudo guardar la suscripción');
    pushSubscription = subscription;
    return { userId, role };
  }

  async function enablePush() {
    const btn = document.getElementById('pwa-push-btn');
    if (!('Notification' in window) || !('PushManager' in window) || !('serviceWorker' in navigator)) {
      alert('Este navegador no permite notificaciones web push.');
      return;
    }
    try {
      btn.disabled = true;
      if (Notification.permission === 'denied') {
        throw new Error('Las notificaciones están bloqueadas para este sitio. En Chrome: candado de la barra de direcciones → Configuración del sitio → Notificaciones → Permitir. Luego recarga.');
      }
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') throw new Error('Permiso de notificaciones no concedido');
      const registration = await navigator.serviceWorker.ready;
      const publicKey = await getVapidPublicKey();
      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey)
        });
      }
      await saveSubscription(subscription);
      btn.textContent = '🔔 Notificaciones activas';
      btn.style.background = '#2a9d8f';
      btn.disabled = false;
    } catch (error) {
      console.error('[Push]', error);
      alert(`No se pudieron activar las notificaciones: ${error.message || error}`);
      btn.disabled = false;
    }
  }

  async function showPushDiagnostic() {
    const btn = document.getElementById('pwa-diagnostic-btn');
    btn.disabled = true;
    btn.textContent = '🔧 Diagnóstico...';

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      const client = await getSupabaseClient();
      let sessionData = null;
      let userRole = null;
      let dbSubscribed = false;

      if (client) {
        const { data } = await client.auth.getSession();
        sessionData = data?.session || null;
        if (sessionData?.user?.id) {
          const { data: roleData } = await client.rpc('get_user_role');
          userRole = roleData || null;
        }
      }

      if (client && subscription) {
        const { data: subs } = await client
          .from('push_subscriptions')
          .select('endpoint')
          .eq('endpoint', subscription.endpoint)
          .maybeSingle();
        dbSubscribed = !!subs;
      }

      let vapidOk = false;
      try {
        const resp = await fetch(VAPID_URL, { cache: 'no-store' });
        const data = await resp.json();
        vapidOk = !!data?.publicKey;
      } catch (_) {}

      const lines = [
        `Notification.permission: ${Notification.permission}`,
        `Service Worker: ${registration.active ? 'ACTIVO' : registration.installing ? 'INSTALANDO' : registration.waiting ? 'ESPERANDO' : 'NO REGISTRADO'}`,
        `Service Worker scope: ${registration.scope}`,
        `PushSubscription: ${subscription ? 'EXISTE' : 'NO EXISTE'}`,
        subscription ? `  Endpoint: ${subscription.endpoint.slice(0, 50)}...` : '',
        subscription ? `  p256dh: ${subscription.toJSON().keys?.p256dh ? 'SÍ' : 'NO'}` : '',
        subscription ? `  auth: ${subscription.toJSON().keys?.auth ? 'SÍ' : 'NO'}` : '',
        `VAPID pública: ${vapidOk ? 'DISPONIBLE' : 'NO DISPONIBLE'}`,
        `Usuario autenticado: ${sessionData?.user?.id ? 'SÍ (' + sessionData.user.id.slice(0, 8) + '...)' : 'NO (anónimo)'}`,
        `Rol: ${userRole || 'desconocido'}`,
        `Suscripción en BD: ${dbSubscribed ? 'REGISTRADA' : 'NO REGISTRADA'}`
      ].filter(Boolean);

      alert('🔧 DIAGNÓSTICO PUSH\n\n' + lines.join('\n'));
    } catch (error) {
      console.error('[Push Diagnostic]', error);
      alert(`Error en diagnóstico: ${error.message || error}`);
    } finally {
      btn.disabled = false;
      btn.textContent = '🔧 Diagnosticar Push';
    }
  }

  async function linkOrder(orderId) {
    try {
      const client = await getSupabaseClient();
      if (!client || !orderId) return;
      if (!pushSubscription) {
        const registration = await navigator.serviceWorker.ready;
        pushSubscription = await registration.pushManager.getSubscription();
      }
      if (!pushSubscription) return;
      const endpoint = pushSubscription.endpoint;
      await client.rpc('link_order_to_push_subscription', { p_endpoint: endpoint, p_order_id: String(orderId) });
    } catch (error) {
      console.warn('[Push] No se pudo vincular el pedido:', error);
    }
  }

  window.DeliciasPush = { enable: enablePush, linkOrder };

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'block';
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    const btn = document.getElementById('pwa-install-btn');
    if (btn) btn.style.display = 'none';
  });

  document.addEventListener('DOMContentLoaded', async () => {
    createPwaControls();
    await registerServiceWorker();
    const pushBtn = document.getElementById('pwa-push-btn');
    const diagBtn = document.getElementById('pwa-diagnostic-btn');
    if (pushBtn && 'Notification' in window && 'PushManager' in window) {
      try {
        const registration = await navigator.serviceWorker.ready;
        const existing = await registration.pushManager.getSubscription();
        if (existing) {
          try {
            await saveSubscription(existing);
            pushBtn.textContent = '🔔 Notificaciones activas';
            pushBtn.style.background = '#2a9d8f';
          } catch (syncError) {
            console.warn('[Push] No se pudo sincronizar la suscripción existente:', syncError);
            pushBtn.style.display = 'block';
          }
        } else {
          pushBtn.style.display = 'block';
          if (Notification.permission === 'denied') {
            pushBtn.textContent = '🔔 Permitir notificaciones en Chrome';
          }
        }
        if (diagBtn) diagBtn.style.display = 'block';
      } catch (_) {}
    }
  });
})();
