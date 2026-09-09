# DeliciasExpress v6

## Corrección principal: sesiones independientes por panel

Se detectó que `admin.html`, `domiciliario.html` e `index.html` usaban el mismo almacenamiento de sesión de Supabase Auth. En el mismo navegador/origen, iniciar sesión como domiciliario podía reemplazar la sesión del administrador o cliente. Esto explica errores intermitentes como `no_autorizado` y pedidos creados con el usuario equivocado.

Cada aplicación ahora usa un `storageKey` distinto:
- Admin: `deliciasexpress-admin-auth`
- Domiciliario: `deliciasexpress-rider-auth`
- Cliente/PWA: `deliciasexpress-client-auth`

Así se pueden probar simultáneamente las tres áreas en pestañas del mismo navegador sin que una sesión sustituya a otra.

## Importante al probar v6

1. Cerrar pestañas antiguas de DeliciasExpress.
2. Abrir v6.
3. Iniciar sesión por separado en admin y domiciliario.
4. El cliente puede usar su propia sesión/guest.
5. No borrar almacenamiento durante la prueba.

La corrección no cambia contraseñas, usuarios ni datos de pedidos existentes.
