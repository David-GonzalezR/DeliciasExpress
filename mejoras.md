# Plan de mejoras de producto y experiencia — DeliciasExpress
## (Excluye pago en línea — queda para una fase futura aparte)

> Documento de traspaso para que otro modelo/desarrollador ejecute las mejoras.
> Basado en la revisión completa de `index.html`, `scripts.js`, `admin.js`, `admin.html`, `domiciliario.js`
> y el esquema real de la base de datos (Supabase, proyecto `sjoytwcrdewealudjxep`, confirmado por consulta
> directa a `information_schema` y `pg_proc`).
> Fecha: 2026-08-21.

---

## 0. Cómo está organizado este documento

Cada mejora indica: **qué problema resuelve**, **qué tan lista está la base de datos** (para que no se
reconstruya algo que ya existe) y **el cambio concreto a hacer**. Están agrupadas en 3 fases por
impacto/esfuerzo. La integración de pasarela de pago (Wompi/PayU/etc.) queda **fuera de este documento** a
petición del negocio — se recomienda retomarla como Fase 4 cuando el negocio esté listo.

---

## FASE 1 — Alto impacto, bajo esfuerzo (hacer primero)

### 1.1 Perfil con dirección y teléfono guardados (dejar de pedirlos en cada compra)

**Problema:** hoy el checkout pide escribir la dirección, activar GPS y escribir el teléfono **en cada
pedido**, incluso para clientes que ya iniciaron sesión y ya compraron antes. Es fricción repetida
innecesaria y es la causa más probable de carritos abandonados en el paso final.

**Estado de la base de datos:** la tabla `profiles` ya tiene la columna `phone`, pero **no tiene**
columnas de dirección guardada ni coordenadas guardadas. Hay que agregarlas.

**Cambio de base de datos:**
```sql
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saved_address text,
  ADD COLUMN IF NOT EXISTS saved_lat double precision,
  ADD COLUMN IF NOT EXISTS saved_lng double precision;
```

**Cambio de frontend (`index.html` + `scripts.js`):**
- Si `currentUser` existe al abrir el carrito, precargar `delivery-address`, `customer-phone` y las
  coordenadas GPS desde `profiles` (una sola consulta `select saved_address, saved_lat, saved_lng, phone
  from profiles where id = auth.uid()`).
- Agregar un checkbox "Guardar esta dirección para la próxima vez" (marcado por defecto) que, al confirmar
  el pedido, haga `update profiles set saved_address=..., saved_lat=..., saved_lng=..., phone=... where id
  = auth.uid()`.
- Para usuarios anónimos (sin cuenta) no cambia nada — seguir pidiendo los datos como hasta ahora.

---

### 1.2 Historial real de pedidos ligado a la cuenta (no solo `localStorage`)

**Problema:** el botón "Mis pedidos" (`my-orders-btn`, ya existe en el header) hoy solo abre el mismo modal
de seguimiento que usa `localStorage` (`trackedOrderIds`). Si el cliente cambia de dispositivo o borra
caché, pierde todo su historial, aunque haya iniciado sesión.

**Estado de la base de datos:** ya está listo. La función `create_order()` **ya guarda `user_id =
auth.uid()`** automáticamente en cada pedido cuando el cliente está logueado. El problema es **100%
de frontend** — nunca se consulta esa columna.

**Cambio de frontend (`scripts.js`):**
- Nueva función `loadAccountOrderHistory()` que, si `currentUser` existe, haga:
  ```js
  const { data } = await supabase
    .from('orders')
    .select('id, status, total, created_at')
    .eq('user_id', currentUser.id)
    .order('created_at', { ascending: false })
    .limit(20);
  ```
  (Esto ya está permitido por la política RLS existente `"Clientes ven sus pedidos"` — no requiere tocar
  seguridad.)
- Cuando el usuario está logueado, `my-orders-btn` debe mostrar esta lista real en vez de (o además de)
  la lista de `localStorage`. Recomendado: mostrar primero los de la cuenta, y fusionar sin duplicar con
  los `trackedOrderIds` locales (por si hizo algún pedido anónimo antes de loguearse).
- Cada fila del historial debe tener un botón **"Pedir de nuevo"** que vuelva a meter esos mismos
  `order_items` al carrito actual (trae precios frescos de `products`, no los precios congelados del
  pedido viejo, para respetar cambios de precio/stock).

---

### 1.3 Calificación del domiciliario y del pedido después de la entrega

**Problema:** la tabla `riders` ya tiene las columnas `rating` (default 5.00) y `total_deliveries`, pero
`total_deliveries` solo se incrementa automáticamente al marcar entrega (ver auditoría técnica anterior) y
**`rating` nunca se actualiza en ningún lugar del código** — es un campo muerto que siempre muestra 5.0
para todos los domiciliarios, sin importar el desempeño real.

**Cambio de base de datos — nueva función:**
```sql
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_rating int; -- 1 a 5, nullable

CREATE OR REPLACE FUNCTION public.rate_order(p_order_id uuid, p_rating int)
RETURNS json AS $$
DECLARE
  v_rider_id uuid;
BEGIN
  IF p_rating < 1 OR p_rating > 5 THEN
    RETURN json_build_object('ok', false, 'error', 'rating_invalido');
  END IF;

  UPDATE public.orders
  SET customer_rating = p_rating
  WHERE id = p_order_id
    AND status = 'entregado'
    AND customer_rating IS NULL
  RETURNING assigned_rider_id INTO v_rider_id;

  IF v_rider_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'no_calificable');
  END IF;

  -- Recalcula el promedio del domiciliario contra todos sus pedidos calificados
  UPDATE public.riders r
  SET rating = sub.avg_rating
  FROM (
    SELECT assigned_rider_id, AVG(customer_rating)::numeric(3,2) AS avg_rating
    FROM public.orders
    WHERE assigned_rider_id = v_rider_id AND customer_rating IS NOT NULL
    GROUP BY assigned_rider_id
  ) sub
  WHERE r.id = sub.assigned_rider_id;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Cambio de frontend (`scripts.js` + `index.html`):**
- Cuando `renderOrderStatus` detecta `status === 'entregado'` y `customer_rating` viene `null` (hay que
  agregar esa columna al `select` de `get_order_status`, ver nota abajo), mostrar 5 estrellas debajo del
  timeline con el texto "¿Cómo estuvo tu pedido?".
- Al tocar una estrella, llamar `supabase.rpc('rate_order', { p_order_id, p_rating })` y reemplazar las
  estrellas por "¡Gracias por tu calificación!".
- **Nota:** hay que actualizar también `get_order_status()` para que devuelva `customer_rating` en su
  `SELECT` (agregar la columna al `RETURNS TABLE` y al `select` interno).

---

### 1.4 Interruptor de "Tienda abierta / cerrada"

**Problema:** no existe ningún control de horario. El catálogo y el checkout están siempre disponibles,
así que un cliente puede hacer un pedido a las 2am sin que nadie lo vea ni lo confirme durante horas.

**Estado de la base de datos:** ya existe la tabla `app_settings` (`key text, value text`) que ya se usa
para otras configuraciones (`store_url`, etc.) — se reutiliza sin crear tabla nueva.

**Cambio de base de datos:**
```sql
INSERT INTO public.app_settings (key, value) VALUES ('store_open', 'true')
ON CONFLICT (key) DO NOTHING;
```

**Cambio de frontend:**
- **Admin (`admin.html`/`admin.js`):** agregar un switch grande y visible en el header del dashboard
  ("🟢 Tienda abierta" / "🔴 Tienda cerrada") que haga
  `supabase.from('app_settings').update({ value: checked ? 'true' : 'false' }).eq('key', 'store_open')`.
- **Cliente (`index.html`/`scripts.js`):** al cargar la tienda, leer `app_settings.store_open`. Si es
  `'false'`, mostrar un banner fijo ("Estamos cerrados en este momento, vuelve pronto") y deshabilitar el
  botón de checkout (dejar navegar el catálogo, pero no comprar).
- Nota de RLS: como `app_settings` hoy no tiene ninguna política y RLS está activo, por defecto nadie
  externo puede leerla. Hay que agregar explícitamente una política de `SELECT` pública **solo** para esta
  llave, o (más simple y más seguro) exponer este único valor a través de una función `SECURITY DEFINER`
  liviana, por ejemplo `get_store_status()`, en vez de abrir `SELECT` sobre toda la tabla (que también
  contiene la API key de Resend).

---

## FASE 2 — Mejora de conversión y ticket promedio

### 2.1 Tiempo estimado de entrega (ETA) en el seguimiento

**Problema:** el timeline de estado (`order-status-timeline`) muestra pasos pero no un tiempo. La
incertidumbre de "¿cuánto falta?" es lo que más ansiedad genera en el seguimiento de un pedido de comida.

**Cambio recomendado (versión simple, sin cálculo de ruta real):**
- Agregar columna `estimated_ready_at timestamptz` a `orders`, calculada al pasar a `preparando` como
  `now() + interval '35 minutes'` (o el valor que el negocio defina, ajustable después por categoría de
  producto si se quiere refinar).
- Mostrar en el modal de seguimiento un texto tipo "Llega aprox. a las 7:45 PM" que cuenta regresivo,
  actualizado cada vez que se hace polling del estado (ya existe el `setInterval` de 5s de la sección de
  seguimiento, se reutiliza).
- No requiere integración de mapas ni cálculo de tráfico — es una expectativa fija razonable, mucho mejor
  que no tener ninguna.

### 2.2 Búsqueda que también mire descripción y categoría

**Problema:** `search-input` filtra literal contra el nombre del producto. Si el cliente busca "pollo" y
el producto se llama "Combo Familiar #2" pero su descripción dice "incluye pollo asado...", no aparece.

**Cambio (`scripts.js`):** en la función de filtrado de productos, cambiar la condición de
`p.name.toLowerCase().includes(query)` a que también compare contra `p.description` y `p.category`.
Cambio de una función, sin tocar base de datos.

### 2.3 Upsell / combos sugeridos en el modal de producto y en el carrito

**Problema:** no hay ningún mecanismo para subir el ticket promedio más allá de lo que el cliente ya
decidió comprar.

**Cambio recomendado (versión simple sin tabla nueva):** en el modal de producto (`modal-customization-section`
ya existe para extras/customizaciones), agregar una sección "Complementa tu pedido" que muestre 2-3
productos de la categoría "bebidas" o "postres" (filtrando `products` por categoría) con un botón rápido
"+ Agregar por $X" que los mete al carrito sin abrir su propio modal. No requiere cambios de esquema,
solo una consulta adicional a `products` filtrada por categoría al abrir el modal.

### 2.4 Badges de oferta por producto (no solo el banner global)

**Problema:** el sistema de ofertas relámpago (`flash-banner`) ya funciona bien pero es un único banner
genérico arriba de la página. La urgencia no está en el punto de decisión (la tarjeta del producto).

**Cambio (`scripts.js` + `styles.css`):** en `buildProductCard()` (o la función equivalente que arma cada
tarjeta), si el producto tiene una oferta relámpago activa (ya se calcula `flashDiscountMap` en el código
actual), agregar un badge visual sobre la imagen del producto tipo "🔥 -20% · termina en 11:42" usando el
mismo temporizador que ya alimenta el banner. Es reutilizar datos que ya se cargan, solo agregar el
elemento visual en la tarjeta.

---

## FASE 3 — Lado operativo (admin y domiciliario)

### 3.1 Dashboard con métricas básicas en el panel admin

**Problema:** `admin.js` hoy solo gestiona pedidos y productos uno por uno; no hay ninguna vista agregada.

**Cambio recomendado:** una nueva vista "Resumen" (junto a "Pedidos" y "Productos" en el sidebar) con:
- Ventas de hoy (`sum(total) where created_at::date = current_date and status != 'cancelado'`).
- Pedidos por estado en tiempo real (ya se tiene `allOrders` cargado en memoria, es solo agregar).
- Top 5 productos más vendidos (requiere un `group by product_name` sobre `order_items` unido con
  `orders` para excluir cancelados — una función SQL simple o una consulta directa desde el admin, ya que
  el rol admin tiene `SELECT` sobre todo).
- Tiempo promedio entre `created_at` y `delivered_at` de los últimos 7 días.

No requiere tablas nuevas, todo el dato ya existe en `orders`/`order_items`. Es una vista nueva +
2-3 consultas de agregación.

### 3.2 Ruta con múltiples paradas para el domiciliario (si en el futuro lleva más de un pedido a la vez)

Hoy cada pedido asignado enlaza a Google Maps por separado (`buildMapsLink`). Si el negocio decide permitir
que un domiciliario acepte más de un pedido activo a la vez, va a necesitar ver las paradas en un orden
sugerido, no links sueltos. **No es urgente hoy** porque el flujo actual es de un pedido a la vez por
domiciliario — se deja documentado para cuando el volumen lo justifique.

---

## Explícitamente fuera de este documento (a pedido del negocio)

- **Pasarela de pago en línea** (Wompi/PayU/Nequi/tarjeta). Se identificó como el cambio de mayor impacto
  en la conversación anterior, pero el negocio pidió dejarlo para más adelante. Cuando se retome, el punto
  de enganche más limpio en el código actual es reemplazar el paso final de `scripts.js` que hoy arma el
  mensaje de WhatsApp (función de checkout, alrededor de la línea 749 donde se llama a `create_order`) por
  la redirección al checkout de la pasarela, manteniendo `create_order` igual y agregando una columna
  `payment_status` a `orders`.

---

## Orden de ejecución sugerido

1. **1.1** Perfil con dirección/teléfono guardados — mayor reducción de fricción por menor esfuerzo.
2. **1.2** Historial real de pedidos — la base de datos ya está lista, es prácticamente solo frontend.
3. **1.4** Toggle de tienda abierta/cerrada — evita pedidos fantasma fuera de horario, muy bajo esfuerzo.
4. **1.3** Calificación de domiciliario — activa datos que ya existen pero están muertos.
5. **2.2** Búsqueda mejorada — cambio de una función, sin riesgo.
6. **2.4** Badges de oferta por producto — reutiliza datos que ya se calculan.
7. **2.1** ETA estimado — mejora percibida alta, esfuerzo medio.
8. **2.3** Upsell en carrito/modal — impacto en ticket promedio, esfuerzo medio.
9. **3.1** Dashboard admin — no bloquea nada del cliente, se puede hacer en paralelo.
10. **3.2** Ruta multi-parada — queda pendiente hasta que el volumen de pedidos lo justifique.