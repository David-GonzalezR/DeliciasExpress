



# 📋 Checklist: Configuración Final Web Push - DeliciasExpress

> **Objetivo**: Que el domiciliario reciba notificación del sistema aunque la app esté **cerrada completamente**.

---

## ✅ Lo que YA está implementado (no tocar)

| Componente | Archivo | Estado |
|------------|---------|--------|
| Service Worker (`push`, `notificationclick`) | `service-worker.js` | ✅ Listo |
| Registro SW + Suscripción Push + Diagnóstico | `pwa.js` | ✅ Listo |
| Edge Function: `get-vapid-public-key` | `supabase/functions/get-vapid-public-key/` | ✅ Listo |
| Edge Function: `send-push-notification` | `supabase/functions/send-push-notification/` | ✅ Listo |
| Tabla `push_subscriptions` + RPCs | `push_subscriptions_setup.sql` | ✅ Listo |
| Trigger BD → Edge Function (corregido) | `push_trigger_setup.sql` | ✅ Corregido |

---

## 🔴 PASOS PENDIENTES (ejecutar en orden)

### 1. Habilitar extensión `pg_net` en Supabase
```
Dashboard → Database → Extensions → Buscar "pg_net" → Enable
```

---

### 2. Configurar Service Role / Secret Key y Trigger (Todo en uno)
Copia el contenido de [push_trigger_setup.sql](file:///c:/Users/SOLO%20DESARROLLADORES/Documents/DAVID/Proyectos/ecomerce%C2%B4s%20comida/catalogos_comidaR/push_trigger_setup.sql), reemplaza `'TU_SECRET_KEY_AQUI'` por tu clave secreta real (`sb_secret_...` o `eyJ...`) y ejecútalo en **SQL Editor**.

> 💡 **Nota sobre permisos**: Usamos `vault.create_secret` de **Supabase Vault** en lugar de `ALTER DATABASE`, evitando el error de permisos `permission denied to set parameter`.

Esto creará:
- Almacenamiento cifrado de tu clave en `vault.secrets`
- Función `notify_order_change()` que lee del Vault y dispara la Edge Function con `pg_net`
- Trigger `trigger_notify_order_change` en la tabla `orders` (AFTER INSERT OR UPDATE)

---

### 4. Verificar/Crear VAPID Keys en Edge Function Secrets
```
Dashboard → Functions → send-push-notification → Settings → Secrets
```

**Deben existir estas 4 claves:**
| Secret | Valor | Dónde conseguirlo |
|--------|-------|-------------------|
| `VAPID_PUBLIC_KEY` | `BEl62...` (87 chars) | `npx web-push generate-vapid-keys` |
| `VAPID_PRIVATE_KEY` | `UUxJ4...` (43 chars) | `npx web-push generate-vapid-keys` |
| `VAPID_SUBJECT` | `mailto:admin@tudominio.com` | Tu email real |
| `APP_SERVICE_ROLE_KEY` | `sb_secret_...` (tu Secret Key) | Dashboard → Project Settings → API Keys |

**Si no existen → créalas → Save → Redeploy la función.**

---

### 5. Desplegar Edge Functions (si no están desplegadas)
```bash
# Desde la raíz del proyecto (donde está supabase/config.toml)
supabase functions deploy get-vapid-public-key
supabase functions deploy send-push-notification
```

---

### 6. Verificar que `get-vapid-public-key` responde
En navegador abre:
```
https://sjoytwcrdewealudjxep.supabase.co/functions/v1/get-vapid-public-key
```
Debe devolver: `{"publicKey":"BEl62..."}`

---

## 🧪 PRUEBA OBLIGATORIA (FASE 13 del plan)

### Dispositivo A: Teléfono del domiciliario
1. Abre `https://tudominio.com/domiciliario.html`
2. Inicia sesión como domiciliario
3. Pulsa **"🔔 Activar notificaciones"**
4. Pulsa **"🔧 Diagnosticar Push"** → Verifica que todo diga **SÍ/REGISTRADA/ACTIVO**
5. **CIERRA COMPLETAMENTE LA APP** (swipe away, no solo home)

### Dispositivo B: PC / Admin
1. Abre `https://tudominio.com/admin.html`
2. Inicia sesión como admin
3. Crea un pedido de prueba (cualquier producto)
4. En el pedido nuevo → Pulsa **"🛵 Buscar Domiciliario"**

### Resultado esperado en Dispositivo A (app CERRADA)
- ✅ Notificación del sistema Android/iOS: **"🛵 Nuevo pedido disponible"**
- ✅ Texto: **"Pedido #ABC12345 listo para tomar"**
- ✅ Sonido suave del sistema (no custom)
- ✅ Al tocar → Abre `domiciliario.html` con el pedido visible
- ✅ El domiciliario puede **"Aceptar pedido"**

---

## ❌ Si la prueba FALLA - Debug rápido

| Síntoma | Qué revisar |
|---------|-------------|
| No sale notificación | 1. `pg_net` habilitado? 2. Service role key configurada? 3. Trigger creado? |
| Error 401/403 en logs Edge Function | `SUPABASE_SERVICE_ROLE_KEY` mal en secrets |
| Error "VAPID_PUBLIC_KEY no configurada" | Secrets faltantes en `send-push-notification` |
| Diagnosticar Push dice "NO REGISTRADA" | Usuario no logueado o RLS bloquea inserción |
| Notificación sale pero no abre app | `notificationclick` handler en `service-worker.js` |

**Logs útiles:**
- Edge Function logs: Dashboard → Functions → send-push-notification → Logs
- BD logs: Dashboard → Database → Logs → Filtrar por `notify_order_change`
- Navegador: DevTools → Application → Service Worker → Console

---

## 📁 Archivos clave de referencia

```
catalogos_comidaR/
├── service-worker.js          # SW handlers push + notificationclick
├── pwa.js                     # Registro SW, suscripción, diagnóstico
├── push_subscriptions_setup.sql  # Tabla + RPCs (register, link, delete)
├── push_trigger_setup.sql     # Trigger pg_net → Edge Function (CORREGIDO)
├── supabase/functions/
│   ├── get-vapid-public-key/index.ts
│   └── send-push-notification/index.ts
├── domiciliario.html/js       # Panel domiciliario (usa pwa.js)
├── admin.html/js              # Panel admin (dispara request_delivery)
└── index.html/js              # Cliente (usa pwa.js)
```

---

## 🎯 Criterio de ÉXITO (Definición de Terminado)

> **APP CERRADA → PUSH RECIBIDO → NOTIFICACIÓN MOSTRADA → CLICK → APP ABIERTA CON PEDIDO**

Si esto funciona → **TAREA COMPLETA**. Si no → revisar logs y repetir pasos.