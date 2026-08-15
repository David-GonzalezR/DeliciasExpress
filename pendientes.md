# Pendientes por hacer

## 📧 Correo (Email Marketing)

- [ ] **Verificar un dominio en Resend** (`resend.com/domains`)
  - Requiere comprar un dominio propio (~$10/año en Porkbun o Cloudflare). El subdominio `vercel.app` no sirve (no permite registrar DNS).
  - Al verificar, agregar los registros SPF/DKIM indicados por Resend.
- [ ] **Cuando el dominio esté verificado** (avisar al asistente para que lo haga):
  - Quitar el ajuste `test_email` de la tabla `app_settings` en Supabase (actualmente solo envía a `davi.gr7@gmail.com`).
  - Cambiar el remitente en la función `send_flash_email` de `onboarding@resend.dev` a `pedidos@tudominio.com`.
  - Actualizar `store_url` en `app_settings` si la tienda cambia de dominio.
- [ ] Con dominio verificado los correos dejarán de caer en spam (ahora llegan a spam por el dominio de pruebas de Resend).

## 🌐 Safe Browsing (aviso "sitio engañoso")

- [ ] Hacer el reporte de falso positivo en https://safebrowsing.google.com/safebrowsing/report_phish/?hl=es para `delicias-express-seven.vercel.app`
  - Alternativa: crear un proyecto nuevo en Vercel (subdominio distinto) si el aviso molesta a los clientes.

## 🔐 Seguridad / Limpieza

- [ ] **Eliminar el token personal de Supabase** (`sbp_...`) creado para esta sesión en https://supabase.com/dashboard/account/tokens (ya no se necesita).
- [ ] Considerar rotar la API Key de Resend (`re_ZMktz9SM...`) si alguna vez se compartió en un chat público.

## 🛠️ Pendientes opcionales de la tienda

- [ ] Evitar ofertas duplicadas sobre el mismo producto (actualmente pueden existir varias activas a la vez sobre un mismo producto; el banner muestra la que termina primero).
- [ ] La alerta del admin dice "Correo enviado a 1 clientes" en modo prueba — es correcto, no es un error.
