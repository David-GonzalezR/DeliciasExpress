# Especificación técnica: Rol "Domiciliario" — DeliciasExpress

> Documento de traspaso para que otro modelo/desarrollador implemente la funcionalidad.
> Basado en auditoría real del repo `catalogos_comidaR` (Supabase + HTML/JS estático, sin framework, desplegado en Vercel).
> Fecha de auditoría: 2026-08-15.

---

## 0. Resumen para quien va a implementar

El proyecto es una tienda de comida con:
- `index.html` / `scripts.js` / `styles.css` → tienda pública (cliente hace el pedido, se guarda en Supabase vía RPC `create_order` y además se manda un mensaje de WhatsApp).
- `admin.html` / `admin.js` / `admin.css` → panel del dueño (login con Supabase Auth, rol `admin`, gestiona pedidos, productos y ofertas relámpago).
- Supabase como backend: Auth + Postgres + Realtime + Storage. Roles actuales en `public.profiles.role`: `cliente`, `admin`.
- El flujo de estados de un pedido hoy es: `recibido → preparando → despachado → entregado` (o `cancelado`). El estado se cambia manualmente por el admin con un botón que avanza al siguiente estado.
- La dirección de entrega (`orders.delivery_address`) es **texto libre**, no hay coordenadas, no hay integración con Google Maps, no se captura teléfono del cliente en la tabla `orders`.
- La función `create_order` (RPC) **no está en los archivos del repo** — fue creada directamente en el SQL Editor de Supabase y no quedó versionada. Quien implemente esto **debe pedir al usuario un dump actual del esquema** (`supabase db dump` o exportar desde el Dashboard → Database → Functions) antes de tocar `orders`/`order_items`, o al menos confirmar la definición exacta de `create_order` para no romperla. Todo lo que se agrega abajo es **aditivo** (nuevas columnas nullable, nuevas tablas, nuevas policies) para minimizar el riesgo de romper lo existente.

### Qué se va a construir
1. Un tercer rol `domiciliario` en `profiles.role`.
2. Un botón **"Pedir domicilio"** en el panel admin, visible cuando un pedido está `despachado`.
3. Al pulsarlo, el pedido pasa a estado `buscando_domiciliario` y **todos los domiciliarios conectados** (todas las "motos") reciben la notificación en tiempo real con toda la info del pedido: dirección, items, valor total, y un enlace a Google Maps con la ubicación.
4. El **primer domiciliario que acepte** se queda con el pedido (asignación atómica, sin condiciones de carrera); a los demás se les oculta automáticamente.
5. El domiciliario asignado ve el pedido en su pestaña "Mis entregas" y tiene un botón **"Marcar como entregado"**, que es la única acción que le queda disponible a ese rol sobre ese pedido.
6. Ubicación en Google Maps "si se puede": se resuelve **sin necesitar API Key de pago** usando (a) coordenadas GPS reales si el cliente las compartió al hacer el pedido, o (b) un enlace de búsqueda de Google Maps con el texto de la dirección como respaldo. Se detalla abajo.

### Archivos que hay que crear o tocar

| Archivo | Acción |
|---|---|
| SQL (nuevo, ejecutar en Supabase SQL Editor) | **Crear** `domiciliario-setup.sql` con todo lo de la sección 2 |
| `index.html` | Modificar: agregar botón opcional "Usar mi ubicación GPS" cerca del textarea de dirección |
| `scripts.js` | Modificar: capturar lat/lng si el cliente lo permite y mandarlo a `create_order` (requiere ampliar el RPC, ver 2.6) |
| `admin.html` | Modificar: agregar botón "Pedir domicilio" en la tarjeta de pedido despachado, y una nueva pestaña "Domiciliarios" en el sidebar |
| `admin.js` | Modificar: lógica del botón "Pedir domicilio" y CRUD ligero de domiciliarios (promover/degradar rol) |
| `admin.css` | Modificar: estilos del nuevo botón/badge de estado `buscando_domiciliario` / `en_camino` |
| `domiciliario.html` (nuevo) | **Crear**: panel del repartidor, calcado de la estructura de `admin.html` pero solo con pedidos |
| `domiciliario.js` (nuevo) | **Crear**: lógica de login, verificación de rol, listado de pedidos disponibles, aceptar, marcar entregado |
| `domiciliario.css` (nuevo, opcional) | Puede reusar `admin.css` casi tal cual, o crear una copia reducida |

No se necesita backend adicional (no Node/Express): todo sigue siendo estático + Supabase, igual que hoy.

---

## 1. Modelo de estados del pedido (nuevo flujo completo)

```
recibido → preparando → despachado → buscando_domiciliario → en_camino → entregado
                                                                              ↑
                                                              (cualquier estado antes de "entregado" puede pasar a)
                                                                          cancelado
```

Reglas:
- `recibido`, `preparando`, `despachado`: los cambia el **admin**, igual que hoy (sin cambios en esa parte).
- `despachado → buscando_domiciliario`: lo dispara el **admin** con el nuevo botón "Pedir domicilio". Se guarda `delivery_requested_at = now()`.
- `buscando_domiciliario → en_camino`: lo dispara **cualquier domiciliario** al pulsar "Aceptar pedido". Debe ser atómico: solo el primero que lo intente lo consigue. Se guarda `assigned_rider_id` y `delivery_accepted_at`.
- `en_camino → entregado`: lo dispara **únicamente el domiciliario asignado** (`assigned_rider_id = auth.uid()`). Se guarda `delivered_at`.
- `cancelado`: el admin sigue pudiendo cancelar en cualquier estado anterior a `entregado`, sin cambios respecto a hoy.
- Un pedido en `buscando_domiciliario` o `en_camino` **no debe volver a mostrarle al admin el botón "Pedir domicilio"** (ya está en curso).
- Si el admin necesita "deshacer" una solicitud de domicilio sin repartidor todavía (ej. se equivocó), agregar opcionalmente un botón "Cancelar solicitud de domicilio" que regresa el estado a `despachado` y limpia `delivery_requested_at` — solo permitido mientras `assigned_rider_id IS NULL`.

---

## 2. Cambios en la base de datos (Supabase / Postgres)

Ejecutar todo esto en el SQL Editor de Supabase, en este orden. Es idempotente donde fue posible (`IF NOT EXISTS`), pero revisar antes de correr en producción porque toca `profiles` y `orders`, que ya tienen datos.

### 2.1 Ampliar el rol permitido en `profiles`

```sql
-- Quitar el CHECK viejo y crear uno nuevo con el tercer rol
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('cliente', 'admin', 'domiciliario'));

-- Disponibilidad del domiciliario (para no despertar a los que están offline)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT false;
```

`is_available` la controla el propio domiciliario desde su panel con un switch "Disponible / No disponible". El admin solo notifica a quienes tengan `is_available = true`. Si nadie está disponible, igual se guarda `buscando_domiciliario` y en cuanto alguien se ponga disponible verá el pedido pendiente (no depende de que estuviera "escuchando" en el momento exacto, porque se consulta también al cargar la pantalla, no solo por Realtime).

### 2.2 Falta una policy crítica que ya existía como hueco: admin no podía actualizar el rol de otros

Revisando `supabase-auth-setup.sql`, la única policy de `UPDATE` sobre `profiles` es la del propio usuario (`Usuarios actualizan su perfil`). No existe una policy que permita al admin cambiar el `role` de otra persona (por ejemplo, para convertir a un cliente en domiciliario). Sin esto, el panel de gestión de domiciliarios no podrá funcionar. Agregar:

```sql
CREATE POLICY "Admins actualizan cualquier perfil"
  ON public.profiles FOR UPDATE
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
```

Esto es compatible con el trigger `prevent_role_escalation()` de `auditoria_seguridad.md` (hallazgo #3), que ya deja pasar los cambios de rol cuando quien edita es admin. No hay que tocar ese trigger.

### 2.3 Columnas nuevas en `orders`

```sql
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS assigned_rider_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS delivery_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_rider ON public.orders(assigned_rider_id);
```

Notas:
- `delivery_lat`/`delivery_lng` quedan **nullable** porque hoy la dirección es texto libre y no siempre habrá coordenadas (ver sección 4 para cuándo sí se llenan).
- `customer_phone` no existe hoy en ningún lado del esquema. Se agrega porque el domiciliario necesita poder llamar al cliente si no encuentra la dirección; el admin ve la dirección pero el contacto real hoy pasa por WhatsApp del lado del cliente, no queda guardado. Es opcional de llenar (nullable), pero se recomienda capturarlo en el checkout (sección 4.3).

### 2.4 Actualizar el `CHECK` de `status` si existe uno explícito

El código de `admin.js` maneja los estados como strings libres (`STATUS_FLOW`), así que es posible que `orders.status` sea simplemente `TEXT` sin `CHECK`. **Verificar primero** con:

```sql
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = 'public.orders'::regclass AND contype = 'c';
```

Si aparece un `CHECK` que limita los valores de `status`, hay que reemplazarlo para incluir los dos nuevos: `buscando_domiciliario` y `en_camino`. Ejemplo (ajustar el nombre real del constraint que devuelva la consulta anterior):

```sql
ALTER TABLE public.orders DROP CONSTRAINT IF EXISTS orders_status_check;
ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('recibido','preparando','despachado','buscando_domiciliario','en_camino','entregado','cancelado'));
```

Si no existe ningún `CHECK` (status es TEXT libre), este paso se puede omitir, pero es buena práctica agregarlo igual para evitar estados inválidos a futuro.

### 2.5 RLS: políticas nuevas para `orders` y `order_items` con el rol `domiciliario`

```sql
-- Los domiciliarios ven: pedidos disponibles para tomar, y los que ya tienen asignados
CREATE POLICY "Domiciliarios ven pedidos disponibles o propios"
  ON public.orders FOR SELECT
  USING (
    public.get_user_role() = 'domiciliario'
    AND (
      status = 'buscando_domiciliario'
      OR assigned_rider_id = auth.uid()
    )
  );

-- Aceptar un pedido: SOLO si sigue libre. Esta policy por sí sola no evita la
-- condición de carrera (dos UPDATE concurrentes); la seguridad real de "solo
-- el primero gana" la da la función RPC atómica de la sección 2.6, que corre
-- con permisos elevados. Esta policy es una capa adicional de defensa en caso
-- de que alguien intente hacer el UPDATE directo desde el cliente.
CREATE POLICY "Domiciliarios aceptan pedidos libres"
  ON public.orders FOR UPDATE
  USING (
    public.get_user_role() = 'domiciliario'
    AND (
      (status = 'buscando_domiciliario' AND assigned_rider_id IS NULL)
      OR assigned_rider_id = auth.uid()
    )
  )
  WITH CHECK (
    public.get_user_role() = 'domiciliario'
    AND assigned_rider_id = auth.uid()
  );

-- Items del pedido: el domiciliario necesita ver qué es lo que va a entregar
CREATE POLICY "Domiciliarios ven items de pedidos disponibles o propios"
  ON public.order_items FOR SELECT
  USING (
    public.get_user_role() = 'domiciliario'
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (o.status = 'buscando_domiciliario' OR o.assigned_rider_id = auth.uid())
    )
  );
```

### 2.6 Función RPC atómica para "aceptar pedido" (evita condición de carrera entre motos)

Este es el punto más delicado: varios domiciliarios pueden pulsar "Aceptar" casi al mismo tiempo. Un `UPDATE` normal desde el cliente, aunque tenga `WHERE assigned_rider_id IS NULL`, en Postgres **sí es seguro** porque el motor bloquea la fila durante el `UPDATE`, así que solo una transacción gana la carrera y las demás no afectan filas. Aun así, es mejor encapsularlo en una función `SECURITY DEFINER` para:
- devolver un resultado claro (`{ok: true}` o `{ok: false, reason: 'ya_tomado'}`) en vez de que el frontend tenga que inferirlo contando `rowCount`.
- evitar depender de que las policies de RLS queden exactamente bien configuradas en el cliente.

```sql
CREATE OR REPLACE FUNCTION public.accept_delivery(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_updated_rows INT;
BEGIN
  v_role := public.get_user_role();
  IF v_role <> 'domiciliario' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  UPDATE public.orders
  SET status = 'en_camino',
      assigned_rider_id = auth.uid(),
      delivery_accepted_at = now()
  WHERE id = p_order_id
    AND status = 'buscando_domiciliario'
    AND assigned_rider_id IS NULL;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ya_tomado');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Función para marcar como entregado (misma lógica de defensa):

```sql
CREATE OR REPLACE FUNCTION public.mark_delivered(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_updated_rows INT;
BEGIN
  UPDATE public.orders
  SET status = 'entregado',
      delivered_at = now()
  WHERE id = p_order_id
    AND status = 'en_camino'
    AND assigned_rider_id = auth.uid();

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'no_permitido');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

Función para que el admin dispare la búsqueda de domiciliario (encapsula la validación de que el pedido esté `despachado`):

```sql
CREATE OR REPLACE FUNCTION public.request_delivery(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_updated_rows INT;
BEGIN
  IF public.get_user_role() <> 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  UPDATE public.orders
  SET status = 'buscando_domiciliario',
      delivery_requested_at = now()
  WHERE id = p_order_id
    AND status = 'despachado';

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'estado_invalido');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

> Nota de seguridad: estas tres funciones son `SECURITY DEFINER`, así que corren con más privilegios que el rol del usuario que las llama. Por eso cada una **valida el rol internamente con `public.get_user_role()`** antes de tocar la tabla — no confiar solo en RLS para estas rutas.

---

## 3. Notificación en tiempo real a "todas las motos"

Ya existe el patrón en `admin.js` (función `subscribeToOrders`, usa `supabase.channel(...).on('postgres_changes', ...)`). Se replica igual para el panel de domiciliarios:

```javascript
// En domiciliario.js
function subscribeToAvailableOrders() {
    if (ridersChannel) supabase.removeChannel(ridersChannel);

    ridersChannel = supabase
        .channel('domiciliarios-orders-changes')
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders' }, (payload) => {
            // Un pedido cambió de estado. Si ahora es 'buscando_domiciliario', aparece
            // en la lista de disponibles para TODOS los domiciliarios conectados.
            // Si cambió a 'en_camino' con otro assigned_rider_id, hay que quitarlo
            // de la lista de "disponibles" en las pantallas de los que no lo tomaron.
            handleOrderRealtimeUpdate(payload.new);
        })
        .subscribe();
}
```

Puntos clave que la IA que implemente debe respetar:
- Como todos los domiciliarios están suscritos a la tabla completa (igual que hace el admin hoy), el filtrado de "qué me sirve a mí" se hace en el cliente, no en el filtro del canal — es el mismo patrón que ya usa `admin.js`, así que no hay nada nuevo que aprender de Realtime.
- Cuando llega un `UPDATE` con `status === 'buscando_domiciliario'` y `assigned_rider_id === null`, se agrega a la lista "Pedidos disponibles" y se reproduce un sonido (reusar `playNewOrderChime()` de `admin.js`, cortado y pegado en `domiciliario.js`).
- Cuando llega un `UPDATE` de un pedido que estaba en la lista de disponibles pero ahora tiene `assigned_rider_id` distinto al propio `auth.uid()`, se quita de la lista silenciosamente (alguien más lo tomó primero). Esto es lo que hace que "solo una moto se quede con el pedido" a nivel de experiencia visual — la asignación real y segura ya la garantizó `accept_delivery()` en la base de datos.
- Al pulsar "Aceptar pedido", llamar a `supabase.rpc('accept_delivery', { p_order_id: id })`. Si `data.ok === false` con `error === 'ya_tomado'`, mostrar un mensaje tipo "Este pedido ya fue tomado por otro domiciliario" y quitarlo de la lista. No usar un `UPDATE` directo desde el cliente para esta acción — usar siempre la función RPC.

---

## 4. Ubicación en Google Maps ("si se puede")

Contexto real del proyecto: hoy `delivery_address` es un `<textarea>` de texto libre (`index.html` línea ~132), no hay ninguna llave de Google Maps configurada, y no hay geocodificación. Hay dos niveles de solución, de menor a mayor esfuerzo. **Se recomienda implementar el Nivel 1 ahora** (cero configuración, cero costo) y dejar el Nivel 2 como mejora opcional documentada.

### Nivel 1 (recomendado, sin API key, sin costo) — enlace de búsqueda por texto

Cualquier navegador o la app de Google Maps puede abrir este enlace y buscar la dirección tal cual la escribió el cliente:

```
https://www.google.com/maps/search/?api=1&query=<direccion_urlencoded>
```

En el panel del domiciliario, junto a la dirección del pedido, se agrega un botón/enlace:

```javascript
function buildMapsLink(order) {
    if (order.delivery_lat && order.delivery_lng) {
        // Nivel 2: coordenadas reales -> pin exacto
        return `https://www.google.com/maps?q=${order.delivery_lat},${order.delivery_lng}`;
    }
    // Nivel 1: búsqueda por texto de la dirección
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.delivery_address)}`;
}
```

```html
<a href="#" class="btn btn-status-advance" data-action="open-maps" data-id="${order.id}">
    <i class="fas fa-location-arrow"></i> Ver en Google Maps
</a>
```

Esto funciona hoy mismo, sin tocar nada del checkout del cliente, y no requiere facturación de Google Cloud.

### Nivel 2 (opcional, mejora de precisión) — capturar GPS real del cliente al hacer el pedido

Si se quiere el pin exacto (no solo "buscar la dirección escrita", que puede fallar si el cliente escribe mal o da una dirección ambigua), se puede pedir la ubicación GPS del navegador del cliente **en el momento de hacer el pedido**, usando la API nativa `navigator.geolocation` — esto **tampoco requiere ninguna API key de Google**, es una API del navegador.

En `index.html`, junto al textarea de dirección:

```html
<button type="button" id="use-gps-btn" class="btn btn-secondary">
    <i class="fas fa-location-crosshairs"></i> Usar mi ubicación actual
</button>
<p id="gps-status" class="gps-status"></p>
```

En `scripts.js`:

```javascript
let capturedLat = null;
let capturedLng = null;

document.getElementById('use-gps-btn').addEventListener('click', () => {
    if (!navigator.geolocation) {
        document.getElementById('gps-status').textContent = 'Tu navegador no soporta geolocalización.';
        return;
    }
    document.getElementById('gps-status').textContent = 'Obteniendo ubicación...';
    navigator.geolocation.getCurrentPosition(
        (pos) => {
            capturedLat = pos.coords.latitude;
            capturedLng = pos.coords.longitude;
            document.getElementById('gps-status').textContent = '✅ Ubicación capturada. Se enviará junto con tu dirección.';
        },
        (err) => {
            document.getElementById('gps-status').textContent = 'No se pudo obtener tu ubicación. Puedes seguir solo con la dirección escrita.';
        },
        { enableHighAccuracy: true, timeout: 10000 }
    );
});
```

Y al llamar `create_order`, mandar los dos campos opcionales adicionales:

```javascript
const { data: orderId, error: orderError } = await supabase.rpc('create_order', {
    p_delivery_address: address,
    p_total: total,
    p_items: orderItemsPayload,
    p_lat: capturedLat,   // puede ser null
    p_lng: capturedLng,   // puede ser null
    p_customer_phone: customerPhoneInput ? customerPhoneInput.value.trim() : null
});
```

**Importante:** como `create_order` ya existe en la base de datos y no está en el repo, hay que **leer su definición actual primero** (`SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'create_order';` en el SQL Editor) y luego recrearla agregando los 3 parámetros nuevos con `DEFAULT NULL` para no romper la firma actual, e insertando esos valores en las columnas `delivery_lat`, `delivery_lng`, `customer_phone` de `orders` que ya se agregaron en la sección 2.3. No se incluye aquí el `CREATE OR REPLACE FUNCTION create_order(...)` completo porque su cuerpo actual no está disponible en el repo entregado — quien implemente debe obtenerlo del dashboard antes de tocarlo.

### 4.3 Captura de teléfono del cliente (recomendado junto con lo anterior)

Agregar un `<input type="tel">` en el checkout (cerca de `delivery-address`) para `customer_phone`, opcional pero recomendado, y mandarlo igual que `p_customer_phone` arriba. Esto le da al domiciliario un dato de contacto directo sin depender del hilo de WhatsApp que solo ve el admin.

---

## 5. Cambios en el panel de administrador (`admin.html` / `admin.js`)

### 5.1 Botón "Pedir domicilio"

En `buildOrderCard(order)` (admin.js, función existente), agregar la condición:

```javascript
if (order.status === 'despachado') {
    actionsHtml += `<button class="btn btn-status-advance" data-action="request-delivery" data-id="${order.id}">
        <i class="fas fa-motorcycle"></i> Pedir Domicilio
    </button>`;
}
```

Y en el listener de clicks de `ordersContainer` (ya existe, junto a `advance` y `cancel`):

```javascript
} else if (btn.dataset.action === 'request-delivery') {
    const { data, error } = await supabase.rpc('request_delivery', { p_order_id: orderId });
    if (error || !(data && data.ok)) {
        alert('No se pudo solicitar el domiciliario. Intenta de nuevo.');
        btn.disabled = false;
        return;
    }
    // El cambio de estado llega también por Realtime, pero se puede refrescar localmente
    const idx = allOrders.findIndex(o => o.id === orderId);
    if (idx !== -1) { allOrders[idx].status = 'buscando_domiciliario'; renderOrders(); }
}
```

También hay que:
- Agregar `'buscando_domiciliario'` y `'en_camino'` a `STATUS_LABELS` (ej: `'Buscando domiciliario'`, `'En camino'`).
- Agregar esos dos estados a los filtros de estado en `admin.html` (`status-filter-bar`), y decidir si se cuentan dentro de "Activos" (`currentFilter === 'activos'` en `getFilteredOrders()` — sí deberían incluirse ahí junto con `recibido, preparando, despachado`).
- Mostrar en la tarjeta, si `order.assigned_rider_id` existe, el nombre del domiciliario asignado (requiere hacer join con `profiles` en el `select` de `loadOrders()`, similar a como ya se hace join con `order_items`):

```javascript
.select(`
    id, delivery_address, status, total, created_at,
    assigned_rider_id, delivery_requested_at, delivered_at,
    delivery_lat, delivery_lng, customer_phone,
    rider:assigned_rider_id ( full_name, phone ),
    order_items ( id, product_name, quantity, unit_price, customizations, instructions )
`)
```

(el alias `rider:assigned_rider_id` funciona si existe una foreign key de `orders.assigned_rider_id` hacia `profiles.id` reconocida por PostgREST; como la FK real apunta a `auth.users(id)`, puede que haya que exponerlo distinto — alternativa simple y robusta: hacer un segundo `select` a `profiles` por los `assigned_rider_id` únicos de la página actual y mapear en el cliente, evitando depender de que PostgREST infiera la relación).

### 5.2 Nueva pestaña "Domiciliarios" en el sidebar

Agregar en `admin.html`:

```html
<button class="sidebar-btn" data-view="domiciliarios"><i class="fas fa-motorcycle"></i> Domiciliarios</button>
```

```html
<section id="domiciliarios-view" class="productos-view" style="display:none;">
    <div class="productos-header">
        <h2>Domiciliarios</h2>
    </div>
    <div class="form-field" style="margin-bottom:1rem;">
        <label>Buscar usuario por correo para convertir en domiciliario</label>
        <input id="rider-search-email" type="email" placeholder="correo@ejemplo.com">
        <button id="rider-promote-btn" class="btn btn-primary">Convertir en domiciliario</button>
    </div>
    <main id="riders-container" class="products-container">
        <p id="riders-empty-message" class="orders-empty-message">Cargando domiciliarios...</p>
    </main>
</section>
```

En `admin.js`, lógica de esta vista:

```javascript
async function loadRiders() {
    const { data, error } = await supabase
        .from('profiles')
        .select('id, full_name, phone, is_available, role')
        .eq('role', 'domiciliario');
    // renderRiders(data) -> tarjeta simple por cada uno con nombre, teléfono,
    // estado "Disponible/No disponible" (solo lectura desde el admin) y un botón
    // "Quitar rol de domiciliario" (vuelve el role a 'cliente').
}

async function promoteToRider(email) {
    // Este flujo asume que la persona ya se registró como cliente normal
    // (con su correo/contraseña o Google) en index.html. El admin no crea
    // contraseñas nuevas desde aquí porque el cliente anon-key de Supabase
    // no puede crear usuarios de Auth (eso requiere el service_role key,
    // que nunca debe exponerse en el frontend). Si el negocio quiere que el
    // admin cree la cuenta del domiciliario directamente (con su propio
    // correo/clave inventados), eso requiere una Supabase Edge Function
    // con el service_role key del lado del servidor — ver sección 6.
    //
    // Buscar el perfil por email requiere un RPC propio porque profiles no
    // tiene columna email por defecto en auth de Supabase visible al cliente
    // vía PostgREST directamente ligado a auth.users. Alternativa: pedir que
    // el registro guarde el email en profiles (ya se hizo en el hallazgo #2
    // de auditoria_seguridad.md: "email" ya se guarda en profiles). Entonces:
    const { data: profile, error } = await supabase
        .from('profiles')
        .select('id')
        .eq('email', email)
        .maybeSingle();
    if (!profile) { alert('No existe un usuario registrado con ese correo.'); return; }

    const { error: updateError } = await supabase
        .from('profiles')
        .update({ role: 'domiciliario' })
        .eq('id', profile.id);
    if (updateError) { alert('No se pudo asignar el rol.'); return; }
    loadRiders();
}
```

> Nota: esto asume que `profiles` ya tiene columna `email` según el hallazgo #2 ya resuelto de `auditoria_seguridad.md`. Confirmarlo antes de escribir este código; si no existe, agregar `ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;` y hacer un backfill, o buscar por otro campo (ej. pedir que el propio domiciliario comparta su `id` de usuario, menos amigable).

---

## 6. Alta de cuentas de domiciliario — dos caminos posibles

El punto delicado: para que exista un "domiciliario" con login, tiene que existir una cuenta en Supabase Auth. El cliente (frontend con `anon key`) **no puede crear usuarios de Auth directamente** con contraseña elegida por el admin — eso requiere `service_role key`, que **nunca** debe ir en `admin.js` porque es público en el navegador.

**Camino A — Autoregistro + promoción (recomendado, cero infraestructura nueva):**
1. El repartidor se registra en `index.html` como cualquier cliente (correo/contraseña o Google).
2. El admin, desde la nueva pestaña "Domiciliarios", busca su correo y lo promueve con el flujo de la sección 5.2.
3. El repartidor ahora, al iniciar sesión en `domiciliario.html`, es reconocido con `get_user_role() = 'domiciliario'`.

**Camino B — Admin crea la cuenta directamente (requiere una Edge Function):**
1. Crear una Supabase Edge Function (Deno) que use el `service_role key` **guardado como secreto del proyecto** (nunca en el código del cliente) y llame a `supabase.auth.admin.createUser({ email, password, email_confirm: true })`, y luego actualice `profiles.role = 'domiciliario'` para ese usuario.
2. El admin la invoca desde `admin.js` con `supabase.functions.invoke('create-rider', { body: { email, password, full_name } })`.
3. Esto es más trabajo (requiere Supabase CLI, `supabase functions deploy`) — se documenta aquí como alternativa, pero el Camino A cumple el mismo objetivo sin desplegar nada nuevo.

Se recomienda **Camino A** para la primera versión.

---

## 7. Panel del domiciliario — `domiciliario.html` + `domiciliario.js`

Estructura (calcada de `admin.html`, simplificada — reusar `admin.css` con clases ya existentes: `.login-screen`, `.btn`, `.order-card`, etc., para no reinventar estilos):

```html
<!-- domiciliario.html -->
<div id="login-screen" class="login-screen"> ... (igual que admin, mismo formulario) ... </div>

<div id="dashboard" class="dashboard" style="display:none;">
    <header class="admin-header">
        <h1 class="admin-logo">DeliciasExpress <span>· Domiciliarios</span></h1>
        <div class="admin-header-right">
            <label class="availability-toggle">
                <input type="checkbox" id="availability-toggle"> Disponible
            </label>
            <button id="logout-btn" class="btn btn-secondary">Salir</button>
        </div>
    </header>
    <div class="admin-layout">
        <div class="admin-content">
            <nav class="status-filter-bar">
                <button class="status-filter-btn active" data-view="disponibles">Pedidos disponibles</button>
                <button class="status-filter-btn" data-view="mis-entregas">Mis entregas</button>
            </nav>
            <main id="available-orders-container" class="orders-container"></main>
            <main id="my-deliveries-container" class="orders-container" style="display:none;"></main>
        </div>
    </div>
</div>
```

Lógica en `domiciliario.js` (estructura, no todo el código línea por línea — quien implemente sigue el patrón exacto de `admin.js`):

1. `checkSession()` / `verifyAdminAccess()` → renombrar a `verifyRiderAccess()`, mismo patrón pero comparando `role === 'domiciliario'`.
2. Al entrar, cargar dos listas:
   - `loadAvailableOrders()`: `select` de `orders` con `status = 'buscando_domiciliario'` y join a `order_items`.
   - `loadMyDeliveries()`: `select` de `orders` con `assigned_rider_id = auth.uid()` y `status = 'en_camino'`.
3. Suscripción Realtime (sección 3) para refrescar ambas listas en vivo.
4. Toggle de disponibilidad:
   ```javascript
   availabilityToggle.addEventListener('change', async (e) => {
       await supabase.from('profiles').update({ is_available: e.target.checked }).eq('id', currentUserId);
   });
   ```
5. Tarjeta de pedido disponible (`buildAvailableOrderCard`): muestra dirección, items, total, enlace a Maps (sección 4), y botón:
   ```html
   <button data-action="accept" data-id="${order.id}">Aceptar pedido</button>
   ```
   ```javascript
   if (btn.dataset.action === 'accept') {
       const { data, error } = await supabase.rpc('accept_delivery', { p_order_id: orderId });
       if (error || !data.ok) {
           if (data && data.error === 'ya_tomado') {
               alert('Este pedido ya fue tomado por otro domiciliario.');
           } else {
               alert('No se pudo aceptar el pedido.');
           }
           removeOrderFromAvailableList(orderId); // por si ya no aplica
           return;
       }
       moveOrderToMyDeliveries(orderId);
   }
   ```
6. Tarjeta de "Mis entregas" (`buildMyDeliveryCard`): mismo contenido + botón:
   ```javascript
   if (btn.dataset.action === 'deliver') {
       const { data, error } = await supabase.rpc('mark_delivered', { p_order_id: orderId });
       if (error || !data.ok) { alert('No se pudo marcar como entregado.'); return; }
       removeOrderFromMyDeliveries(orderId);
   }
   ```
7. Reusar `formatPrice()` y `playNewOrderChime()` de `admin.js` (copiar la función, no importar módulos — el proyecto no usa bundler).

---

## 8. Checklist de QA antes de dar por terminado

- [ ] Un admin nuevo (rol `admin`) sigue pudiendo hacer todo lo que hacía antes sin errores (no se rompió nada de pedidos/productos/ofertas).
- [ ] Un `cliente` normal no puede ver `domiciliario.html` (debe redirigir a login o mostrar "acceso denegado", igual que hoy pasa en `admin.html` con `verifyAdminAccess`).
- [ ] Dos usuarios domiciliario en pestañas distintas del navegador: al pulsar "Aceptar" casi al mismo tiempo en el mismo pedido, solo uno lo consigue y al otro le aparece "ya fue tomado".
- [ ] El pedido desaparece de "Pedidos disponibles" en la pantalla del domiciliario que NO lo tomó, en tiempo real, sin recargar la página.
- [ ] El botón "Pedir domicilio" solo aparece cuando `status === 'despachado'`, y desaparece una vez se pulsa.
- [ ] El domiciliario asignado, y solo él, puede marcar como entregado (probar con otro domiciliario intentando forzar `mark_delivered` sobre un pedido que no es suyo — debe fallar con `no_permitido`).
- [ ] El enlace de Google Maps abre correctamente tanto con coordenadas (si se implementó el Nivel 2) como con solo texto de dirección (Nivel 1).
- [ ] RLS: un domiciliario no puede leer pedidos de otros estados (`recibido`, `preparando`, `entregado` de otros, etc.) haciendo una consulta directa desde la consola del navegador con su propia sesión.
- [ ] El admin puede promover un cliente existente a domiciliario y luego revertirlo, y el `prevent_role_escalation()` sigue bloqueando que un usuario normal se autopromueva.
- [ ] Verificar que `create_order` (si se modificó para aceptar `p_lat`/`p_lng`/`p_customer_phone`) sigue funcionando igual para pedidos anónimos (sin sesión), que es el caso de uso principal hoy.

---

## 9. Resumen de todo lo que hay que correr en Supabase (orden sugerido)

1. Sección 2.1 (rol + `is_available`)
2. Sección 2.2 (policy de admin sobre profiles)
3. Sección 2.3 (columnas nuevas en `orders`)
4. Sección 2.4 (revisar y ajustar CHECK de `status` si existe)
5. Sección 2.5 (policies RLS de domiciliario)
6. Sección 2.6 (las 3 funciones RPC: `request_delivery`, `accept_delivery`, `mark_delivered`)
7. Opcional, sección 4.2: obtener la definición real de `create_order` y recrearla con los 3 parámetros opcionales nuevos.

Todo lo anterior es aditivo y no borra ni modifica datos existentes, salvo el `DROP CONSTRAINT` / `ADD CONSTRAINT` de los `CHECK`, que es seguro porque solo cambia las reglas de validación hacia adelante, no toca filas ya guardadas.