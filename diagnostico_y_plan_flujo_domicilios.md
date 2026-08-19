# Diagnóstico y plan de corrección — Flujo "despachado → buscar domiciliario → entregado"
## DeliciasExpress (`catalogos_comidaR`)

> Documento de traspaso para que otro modelo/desarrollador aplique la corrección.
> Auditoría realizada sobre el repo tal como fue entregado (incluye historial de `git log`).
> Fecha de auditoría: 2026-08-18.

---

## 0. Resumen ejecutivo (léelo primero)

**La funcionalidad de domiciliarios YA ESTÁ CONSTRUIDA CASI POR COMPLETO** (tabla `riders`, políticas RLS,
funciones RPC `request_delivery` / `accept_delivery` / `mark_delivered` / `cancel_delivery_request`,
panel `domiciliario.html`/`.js`, tarjeta de domiciliario en el seguimiento del cliente, captura de GPS y
teléfono en el checkout, enlaces a Google Maps, badges de estado en CSS). Todo eso corresponde al trabajo
descrito en `tercer_rol.md`, `PLAN_tabla_riders.md` y los commits `2360a88`, `21085d4`, `146db0e`, `610a53e`.

**El problema no es que falte lógica: es que hay UN bug de una sola línea en `admin.js` que le corta el
paso a todo lo demás.** El pedido nunca llega realmente a estado `despachado` en la base de datos, así que
el botón "Pedir Domicilio" (que solo aparece cuando `status === 'despachado'`) nunca se muestra, y por lo
tanto ninguno de los pasos posteriores (buscar domiciliario, aceptar, ver quién lleva el pedido, marcar
entregado, volver a disponible) se puede disparar. No es que esos pasos estén mal programados: **nunca se
llega a ejecutarlos** porque la puerta de entrada está rota.

Además hay una segunda causa, más pequeña, que si no se corrige va a hacer que —una vez arreglado el bug
principal— el domiciliario no se ponga "no disponible" automáticamente al aceptar un pedido, ni "disponible"
de nuevo al entregarlo (tal como pediste). Esa parte de la lógica automática simplemente no fue escrita.

Este documento explica ambas causas con evidencia, y da el plan exacto de cambios para corregirlas.

---

## 1. Causa raíz #1 (CRÍTICA): `STATUS_FLOW` en `admin.js` le falta el estado `despachado`

### 1.1 El código tal como está hoy

`admin.js`, línea 11:

```javascript
const STATUS_FLOW = ['recibido', 'preparando'];
```

`admin.js`, línea 21-24:

```javascript
const NEXT_ACTION_LABEL = {
    recibido: 'Marcar Preparando',
    preparando: 'Marcar Despachado'
};
```

`admin.js`, línea 382-385 (listener del botón "avanzar"):

```javascript
if (btn.dataset.action === 'advance') {
    const currentStatus = btn.dataset.current;
    const nextStatus = STATUS_FLOW[STATUS_FLOW.indexOf(currentStatus) + 1];
    await updateOrderStatus(orderId, nextStatus);
}
```

### 1.2 Por qué esto rompe todo

Cuando el pedido está en `preparando` y el admin pulsa el botón **"Marcar Despachado"**, el código calcula:

```
STATUS_FLOW.indexOf('preparando')  →  1
STATUS_FLOW[1 + 1]                 →  STATUS_FLOW[2]  →  undefined
```

Porque el arreglo `STATUS_FLOW` **solo tiene 2 elementos** (índices 0 y 1). El resultado es que
`updateOrderStatus(orderId, undefined)` termina ejecutando:

```javascript
await supabase.from('orders').update({ status: undefined }).eq('id', orderId);
```

Y como `JSON.stringify({ status: undefined })` produce `"{}"` (un objeto vacío — cualquier propiedad con
valor `undefined` se elimina al serializar a JSON en JavaScript), la petición que realmente llega a
Supabase/PostgREST **no incluye ninguna columna para actualizar**. El pedido se queda con `status =
'preparando'` en la base de datos para siempre, sin importar cuántas veces se pulse el botón.

Lo confirmé ejecutando exactamente esa lógica de forma aislada:

```
nextStatus = undefined
JSON body enviado a Supabase: {}
```

Y confirmé además, revisando **todo el código y todo el SQL del repo**, que no existe ningún otro lugar
donde se asigne `status = 'despachado'` a un pedido (no hay un `<select>` manual, no hay otro botón, no hay
otro trigger). Es decir: **hoy en día es literalmente imposible que un pedido llegue a `despachado`**, sin
excepción.

Como consecuencia directa:
- El botón "Pedir Domicilio" (`admin.js` línea 325, solo se muestra si `order.status === 'despachado'`)
  nunca aparece.
- La función RPC `request_delivery` (que exige `WHERE status = 'despachado'`) nunca tiene un pedido válido
  al que aplicarse.
- Nada de lo que sigue en la cadena (notificar domiciliarios, aceptar, ver quién lleva el pedido, entregar)
  se llega a disparar — no porque esté mal, sino porque nunca se alcanza el punto de partida.

### 1.3 Confirmación con el historial de git: esto es una regresión, no un diseño intencional

El `git log -p` de `admin.js` muestra que, antes de implementar el rol de domiciliario, la línea era:

```diff
-    const STATUS_FLOW = ['recibido', 'preparando', 'despachado', 'entregado'];
+    const STATUS_FLOW = ['recibido', 'preparando'];
```

Es decir: al implementar el flujo de domiciliarios (commit `2360a88`, "Rol domiciliario: panel de
repartidores, asignación atómica y GPS en checkout"), la intención correcta era que **`entregado` ya no se
alcance por el botón manual** (ahora lo dispara `mark_delivered` desde el panel del domiciliario, correcto),
pero por error también se quitó `'despachado'` del arreglo, cuando `despachado` **sigue siendo un paso
manual del admin** y debía quedarse en el arreglo. El arreglo correcto es:

```javascript
const STATUS_FLOW = ['recibido', 'preparando', 'despachado'];
```

### 1.4 El fix (un cambio de una línea)

**Archivo:** `admin.js`
**Línea:** 11

```diff
- const STATUS_FLOW = ['recibido', 'preparando'];
+ const STATUS_FLOW = ['recibido', 'preparando', 'despachado'];
```

No hace falta tocar `NEXT_ACTION_LABEL` (ya no necesita entrada para `despachado`, porque una vez despachado
el siguiente paso es el botón "Pedir Domicilio", que es un botón aparte con su propia condición en la línea
325 — eso ya está bien escrito).

Con este único cambio, el flujo completo que ya estaba programado en `domiciliario-setup.sql`,
`domiciliario.js` y el modal de seguimiento en `scripts.js` debería empezar a funcionar de punta a punta.

---

## 2. Causa raíz #2 (gap funcional, no bug): el domiciliario no cambia de disponible ⇄ no disponible automáticamente

Pediste explícitamente que al aceptar un pedido el domiciliario quede "apagado" (no disponible) hasta que
marque el pedido como entregado, momento en el que debe volver a "disponible" solo. Revisé las funciones
RPC `accept_delivery` y `mark_delivered` en `domiciliario-setup.sql`, y **ninguna de las dos toca la tabla
`riders`** — solo actualizan la tabla `orders`. El campo `is_available` hoy en día solo lo cambia el propio
domiciliario a mano, con el switch "Disponible" de su panel (`domiciliario.js`, función
`availabilityToggle.addEventListener('change', ...)`). No hay ninguna automatización.

### 2.1 El fix — recrear las dos funciones agregando el toggle automático

Ejecutar en el **SQL Editor de Supabase** (reemplaza las funciones existentes, es seguro porque
`CREATE OR REPLACE FUNCTION` no borra datos, solo cambia el comportamiento):

```sql
-- =============================================================
-- accept_delivery: además de asignar el pedido, pone al domiciliario
-- como NO disponible automáticamente (deja de recibir más pedidos
-- mientras tiene uno en curso).
-- =============================================================
CREATE OR REPLACE FUNCTION public.accept_delivery(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_updated_rows INT;
BEGIN
  v_role := public.get_user_role();
  IF v_role IS DISTINCT FROM 'domiciliario' THEN
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

  -- Nuevo: al aceptar, el domiciliario pasa a NO disponible automáticamente.
  -- Se usa upsert por si por alguna razón no existiera aún su fila en riders.
  INSERT INTO public.riders (id, is_available)
  VALUES (auth.uid(), false)
  ON CONFLICT (id) DO UPDATE SET is_available = false;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- mark_delivered: además de marcar el pedido como entregado, pone
-- al domiciliario como disponible de nuevo automáticamente, y le
-- suma 1 a su contador de entregas (total_deliveries), que ya existe
-- en la tabla riders pero hasta ahora nunca se incrementaba.
-- =============================================================
CREATE OR REPLACE FUNCTION public.mark_delivered(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_updated_rows INT;
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'domiciliario' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

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

  -- Nuevo: al entregar, el domiciliario vuelve a estar disponible
  -- automáticamente y se le suma una entrega a su historial.
  INSERT INTO public.riders (id, is_available, total_deliveries)
  VALUES (auth.uid(), true, 1)
  ON CONFLICT (id) DO UPDATE
    SET is_available = true,
        total_deliveries = public.riders.total_deliveries + 1;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

No hace falta tocar `request_delivery` ni `cancel_delivery_request`: en esos dos casos todavía no hay
ningún domiciliario asignado al pedido (`assigned_rider_id IS NULL`), así que no hay disponibilidad de
nadie que cambiar.

### 2.2 Efecto en el panel del domiciliario (`domiciliario.js`)

No es necesario modificar `domiciliario.js`. El switch de disponibilidad (`availabilityToggle`) sigue
funcionando igual para que el domiciliario se apague manualmente cuando quiera (por ejemplo, al final de su
turno); ahora simplemente el sistema **también** lo apaga y lo prende solo en los momentos correctos. Eso
sí: como el checkbox del switch no se actualiza en tiempo real por sí solo cuando el cambio lo hace el
propio backend (RPC), conviene que después de `accept_delivery` y de `mark_delivered` el frontend refresque
el estado del switch llamando a `loadAvailability()` (función que ya existe en `domiciliario.js`, línea
133), así el switch visual no queda desincronizado con lo que hay en la base de datos. Esto son 2 líneas:

```diff
  const { data, error } = await supabase.rpc('accept_delivery', { p_order_id: orderId });
  if (error || !(data && data.ok)) { ... }
  const order = availableOrders.find(o => o.id === orderId);
  if (order) {
      removeOrderFromAvailable(orderId);
      insertOrderIntoMyDeliveries({ ...order, status: 'en_camino', assigned_rider_id: currentUserId });
      setTab('mis-entregas');
+     loadAvailability(); // refleja que el sistema lo puso "no disponible"
  }
```

```diff
  const { data, error } = await supabase.rpc('mark_delivered', { p_order_id: orderId });
  if (error || !(data && data.ok)) { ... }
  removeOrderFromMyDeliveries(orderId);
+ loadAvailability(); // refleja que el sistema lo puso "disponible" otra vez
```

---

## 3. Hallazgo adicional, no bloqueante (revisar cuando haya tiempo, no forma parte del bug reportado)

En `admin.js`, la función `createRider()` (línea 651) crea la cuenta del domiciliario llamando a
`supabase.auth.signUp({ email, password, ... })` **desde la misma sesión del navegador donde el admin tiene
su propia sesión abierta**. Dependiendo de la configuración de "Confirm email" del proyecto en Supabase Auth
(Dashboard → Authentication → Providers → Email), si la confirmación de correo está desactivada,
`auth.signUp()` puede **reemplazar la sesión activa del navegador por la del usuario recién creado**, es
decir, dejar al admin "logueado como" el domiciliario nuevo hasta que vuelva a iniciar sesión. No es parte
de lo que reportaste (la creación de domiciliarios en sí no es el flujo que falla), pero como quedó al
alcance durante la auditoría lo dejo anotado por si en algún momento el admin nota que su sesión "se cierra
sola" justo después de crear un domiciliario. Si eso pasa, la solución más simple es usar siempre el
"Camino A" ya documentado en `tercer_rol.md` sección 6 (el domiciliario se autoregistra en `index.html`
y el admin solo lo promueve con el botón "Convertir en domiciliario", que sí es seguro porque no toca la
sesión de nadie), y dejar "Crear cuenta" del modal como alternativa secundaria.

---

## 4. Lo que NO hay que tocar (ya funciona correctamente, confirmado por lectura de código)

Para que quien ejecute este plan no pierda tiempo reconstruyendo algo que ya existe:

- La tabla `riders`, sus políticas RLS y el bucket `rider-photos` (`riders-table-setup.sql`) — completos.
- Las políticas RLS de `orders`/`order_items` para el rol `domiciliario` (`domiciliario-setup.sql` sección
  2.5) — completas.
- Las funciones RPC `request_delivery` y `cancel_delivery_request` — completas, no requieren cambios.
- La captura de GPS (`navigator.geolocation`) y teléfono del cliente en el checkout (`index.html` +
  `scripts.js` líneas ~692-750) y su envío a `create_order` con fallback a la firma vieja de 3 parámetros —
  completo y ya ejecutado contra producción (nota en `domiciliario-setup.sql`: "YA EJECUTADO el
  2026-08-17").
- El panel `domiciliario.html`/`domiciliario.js`: login, verificación de rol, listar pedidos disponibles,
  aceptar (con manejo del caso "ya fue tomado por otro"), listar "mis entregas", marcar entregado, subir
  foto de perfil — completo.
- El modal de seguimiento del cliente (`scripts.js` función `loadOrderRiderInfo`, línea 921): cuando el
  pedido está en `en_camino` o `entregado`, llama a `get_order_rider_info` y muestra foto, nombre, vehículo,
  rating y botón de llamada del domiciliario — completo, esto es exactamente lo que pediste ("ver quien es
  el que va a llevar el pedido con sus datos").
- Los enlaces a Google Maps (por coordenadas si existen, o por texto de dirección si no) tanto en el panel
  admin como en el del domiciliario — completo.
- Los estilos CSS para los estados nuevos (`status-buscando_domiciliario`, `status-en_camino`, etc.) en
  `admin.css` — completo.

---

## 5. Plan de ejecución (orden sugerido)

1. **`admin.js` línea 11** — aplicar el fix de la sección 1.4 (`STATUS_FLOW`). Este es el cambio que
   desbloquea todo. Subir a Vercel (o el hosting que uses) y probar antes de seguir.
2. **Supabase → SQL Editor** — ejecutar el bloque de la sección 2.1 (recrear `accept_delivery` y
   `mark_delivered`).
3. **`domiciliario.js`** — aplicar los 2 `loadAvailability()` opcionales de la sección 2.2 (mejora de
   sincronización visual, no crítico).
4. Correr el checklist de QA de la sección 6.
5. (Opcional, sin urgencia) revisar el punto 3 sobre `auth.signUp()` si en algún momento se nota que la
   sesión del admin se cierra sola al crear un domiciliario nuevo.

---

## 6. Checklist de QA end-to-end (probar después de aplicar el fix)

- [ ] Crear un pedido de prueba desde `index.html`. Debe aparecer en el admin como `recibido`.
- [ ] En el admin, pulsar "Marcar Preparando". El cliente debe ver "Preparando" en su seguimiento (esto ya
      funcionaba antes del fix).
- [ ] En el admin, pulsar "Marcar Despachado". **Verificar en Supabase (tabla `orders`) que la columna
      `status` realmente cambió a `despachado`** — antes del fix se quedaba en `preparando` sin avisar del
      error.
- [ ] Con el pedido en `despachado`, debe aparecer el botón "Pedir Domicilio" en la misma tarjeta.
- [ ] Al pulsar "Pedir Domicilio", el estado pasa a `buscando_domiciliario` y el pedido debe aparecer en
      tiempo real en el panel de cualquier domiciliario logueado (probar con una segunda pestaña/usuario
      domiciliario).
- [ ] El domiciliario ve la dirección, el contenido del pedido y el enlace a Google Maps antes de aceptar.
- [ ] Al aceptar desde el panel del domiciliario, el pedido pasa a `en_camino`, se le asigna
      `assigned_rider_id`, y **su propio switch de disponibilidad debe pasar a "No disponible" sin que él lo
      toque**.
- [ ] Probar la condición de carrera: abrir el mismo pedido `buscando_domiciliario` en dos
      sesiones/dispositivos de domiciliario distintos y aceptar casi al mismo tiempo — solo uno debe
      quedarse con el pedido, al otro le debe salir "Este pedido ya fue tomado por otro domiciliario".
- [ ] En el panel admin, la tarjeta del pedido debe mostrar ahora el nombre del domiciliario asignado.
- [ ] En el seguimiento del cliente (`index.html`), en cuanto el pedido está `en_camino`, debe aparecer la
      tarjeta con foto, nombre, vehículo y botón de llamada del domiciliario.
- [ ] El domiciliario pulsa "Marcar como entregado". El pedido pasa a `entregado`, el cliente lo ve
      reflejado, y **el switch de disponibilidad del domiciliario debe volver a "Disponible" sin que él lo
      toque**.
- [ ] Verificar en la tabla `riders` que `total_deliveries` subió en 1 para ese domiciliario.
- [ ] Repetir todo el flujo una vez más para confirmar que no fue casualidad.

---

## 7. Resumen de archivos a tocar

| Archivo | Cambio | Tipo |
|---|---|---|
| `admin.js` | Corregir `STATUS_FLOW` (línea 11) | 1 línea — **crítico, es la causa raíz** |
| SQL (Supabase SQL Editor) | Recrear `accept_delivery` y `mark_delivered` con toggle de `is_available` y `total_deliveries` | Sección 2.1 de este documento |
| `domiciliario.js` | Agregar `loadAvailability()` tras aceptar/entregar | 2 líneas — mejora visual, no crítico |

Con solo el primer cambio (una línea) el flujo completo que ya estaba construido debería empezar a
funcionar de punta a punta. El segundo cambio (SQL) es el que le da la automatización de disponibilidad que
pediste explícitamente.
