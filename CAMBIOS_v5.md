# DeliciasExpress — correcciones v5

## Corregido tras pruebas reales

1. **Calificación del domiciliario**
   - `submit_order_rating` ya no depende de que la sesión Auth coincida con `orders.user_id`.
   - Esto es compatible con el seguimiento de pedidos invitados y con pedidos históricos que quedaron asociados a otra sesión.
   - Se mantiene una sola calificación por pedido.
   - Se recalcula el promedio del domiciliario.
   - El frontend muestra el código de error real cuando una operación falla.

2. **Push intermitente**
   - Se añadió `register_push_subscription()` como RPC SECURITY DEFINER para registrar/actualizar la suscripción sin depender de que el `upsert` del navegador pase RLS.
   - La suscripción existente se sincroniza al cargar la página, por lo que al cambiar de sesión/rol no queda asociada al usuario anterior.
   - Los visitantes también pueden registrar una suscripción.
   - Se muestran mensajes específicos cuando Chrome tiene las notificaciones bloqueadas.

3. **Servidor Web Push**
   - `send-push-notification` actualizado a v6.
   - Se corrigió la derivación HKDF del cifrado `aes128gcm` de Web Push.
   - Se corrigió la importación de claves VAPID privadas en formato raw de 32 bytes.
   - Se conserva la limpieza automática de suscripciones vencidas (404/410).

4. **Service Worker / carrito**
   - Se mantiene el Service Worker v4 sin cachear HTML/JS/CSS durante pruebas locales.
   - El carrito sigue protegido frente a datos corruptos de localStorage y separado de los controles PWA.

## Pruebas realizadas

- La función de calificación se probó dentro de una transacción y respondió `ok=true`; la transacción fue revertida, por lo que no se modificó el pedido real.
- La función de registro de Push se probó dentro de una transacción y respondió `ok=true`; la transacción fue revertida.
- En la base existen actualmente suscripciones Push completas para admin, cliente y domiciliario.
