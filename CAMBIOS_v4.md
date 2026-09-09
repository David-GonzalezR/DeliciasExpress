# DeliciasExpress — correcciones v4

## Problemas corregidos

1. **Cliente confirma después del domiciliario**
   - `confirm_order_received` ahora es idempotente.
   - Si el domiciliario ya marcó `entregado`, el cliente puede confirmar sin recibir el mensaje incorrecto de que el pedido aún no está en camino.
   - Se registra `acknowledged_at` para saber que el cliente confirmó recepción.
   - Si el cliente confirma primero, también se libera al domiciliario y se suma la entrega una sola vez.

2. **Calificación del domiciliario**
   - Se agregó la interfaz de 1 a 5 estrellas en el seguimiento del cliente.
   - Aparece después de que el cliente confirma la recepción.
   - Se guarda en `orders.customer_rating` mediante `submit_order_rating`.
   - Se recalcula el promedio de `riders.rating`.
   - No permite calificar dos veces el mismo pedido.

3. **Carrera cliente ↔ domiciliario**
   - `mark_delivered` también es tolerante si el cliente confirma primero.
   - No duplica `total_deliveries`.

4. **Carrito intermitente**
   - Se corrigió la lectura insegura de `localStorage`: un `shoppingCart` corrupto ya no rompe toda la inicialización de la página.
   - Se validan y normalizan los artículos recuperados.
   - El botón flotante del carrito ya no comparte posición con los controles PWA.
   - Se añadió soporte para el área segura inferior de móviles mediante CSS existente del layout.

5. **Service Worker / PWA**
   - Se actualizó la versión de caché a v4.
   - HTML/JS/CSS ya no quedan servidos desde una copia vieja del caché; esto evita que cambios de código parezcan aleatorios durante pruebas.
   - Los iconos y manifest siguen pudiendo quedar en caché.

6. **Notificaciones Push**
   - Se corrigió el campo de cliente: la tabla `orders` usa `user_id`.
   - Cuando un pedido pasa a `buscando_domiciliario`, se notifican los domiciliarios que estén disponibles y tengan suscripción push.
   - Se eliminó el uso de `badge-72.png`, que no existe en el proyecto, y se usa `icon-192.png`.

## Cambios en Supabase

Migraciones aplicadas al proyecto:
- `fix_delivery_confirmation_and_rating`
- `make_delivery_completion_idempotent`
- `tighten_delivery_rpc_access`

Edge Function actualizada:
- `send-push-notification` v5

## Prueba recomendada

Probar dos órdenes:

### Caso A — domiciliario primero
1. Admin solicita domiciliario.
2. Domiciliario acepta.
3. Domiciliario marca entregado.
4. Cliente abre seguimiento.
5. Cliente pulsa **Confirmar que recibí mi pedido**.
6. Debe quedar confirmado y aparecer la calificación.

### Caso B — cliente primero
1. Admin solicita domiciliario.
2. Domiciliario acepta.
3. Cliente pulsa **Confirmar que recibí mi pedido**.
4. El pedido queda entregado.
5. Domiciliario debe desaparecer de "Mis entregas" y quedar disponible.
6. La entrega debe contarse una sola vez.
7. Debe aparecer la calificación para el cliente.
