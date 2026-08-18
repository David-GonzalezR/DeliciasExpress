# Plan de implementación — Tabla `riders` para DeliciasExpress

## Objetivo

Extraer los datos operativos del domiciliario fuera de `profiles` y crear una tabla
`riders` dedicada, que permita: foto de perfil, datos del vehículo, disponibilidad,
rating, y que el cliente pueda ver la información del domiciliario que lleva su pedido
en tiempo real desde el modal de seguimiento.

---

## Contexto del proyecto

- **Ruta:** `c:\Users\SOLO DESARROLLADORES\Documents\DAVID\Proyectos\ecomerce´s comida\catalogos_comidaR`
- **Supabase proyecto:** `sjoytwcrdewealudjxep`
- **URL Supabase:** `https://sjoytwcrdewealudjxep.supabase.co`
- **Deploy:** Vercel → `https://delicias-express-seven.vercel.app`
- **Anon key:** `sb_publishable_ntEGkpHa7MVUq-nDw9fp-w_fAtOztkF`

### Archivos que se modifican

| Archivo | Tipo de cambio |
|---|---|
| `riders-table-setup.sql` | **NUEVO** — SQL a ejecutar en Supabase |
| `admin.js` | MODIFICAR — crear rider, listar, quitar rol |
| `admin.html` | MODIFICAR — agregar campos foto, vehículo, placa al modal |
| `admin.css` | MODIFICAR — estilo para imagen de rider en tarjeta |
| `domiciliario.js` | MODIFICAR — leer/escribir `is_available` desde `riders` |
| `domiciliario.html` | MODIFICAR — sección "Mi perfil" con foto |
| `scripts.js` | MODIFICAR — mostrar info del rider en el modal de seguimiento |
| `index.html` | MODIFICAR — agregar sección del rider en el modal de estado del pedido |

---

## FASE 1 — Base de datos

### 1.1 Crear la tabla `riders`

Ejecutar en **Supabase → SQL Editor**:

```sql
-- ================================================================
-- TABLA riders — datos operativos del domiciliario
-- Ejecutar en Supabase SQL Editor (proyecto sjoytwcrdewealudjxep)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.riders (
  id            UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  photo_url     TEXT,
  vehicle_type  TEXT DEFAULT 'moto'
                  CHECK (vehicle_type IN ('moto', 'bicicleta', 'a_pie', 'carro')),
  vehicle_plate TEXT,
  id_number     TEXT,                          -- Cédula
  is_available  BOOLEAN NOT NULL DEFAULT false,
  rating        NUMERIC(3,2) DEFAULT 5.00
                  CHECK (rating >= 0 AND rating <= 5),
  total_deliveries INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.riders ENABLE ROW LEVEL SECURITY;

-- Índice para queries por disponibilidad
CREATE INDEX IF NOT EXISTS idx_riders_available ON public.riders(is_available);
```

### 1.2 Políticas RLS para `riders`

```sql
-- Admins: acceso total
CREATE POLICY "Admins gestionan riders"
  ON public.riders FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- El propio domiciliario puede leer y actualizar su fila
CREATE POLICY "Rider lee su propio perfil"
  ON public.riders FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Rider actualiza su disponibilidad"
  ON public.riders FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Clientes pueden leer datos del rider que tiene su pedido
-- (solo lectura, campos públicos — photo_url, vehicle_type, rating)
-- Se expone vía RPC para no revelar id_number ni vehicle_plate
CREATE POLICY "Lectura pública limitada de riders"
  ON public.riders FOR SELECT
  USING (true);
```

> **Nota:** La policy de "lectura pública" devuelve todas las columnas,
> pero los datos sensibles (cédula, placa) se filtran en el RPC, no en la policy.

### 1.3 Storage bucket para fotos

```sql
-- En Supabase → Storage → New Bucket
-- Nombre: rider-photos
-- Public: SÍ (para que la foto sea accesible sin auth)

-- Policy de storage: solo el propio rider o un admin puede subir
-- Se configura desde el Dashboard → Storage → Policies, o con:
INSERT INTO storage.buckets (id, name, public)
VALUES ('rider-photos', 'rider-photos', true)
ON CONFLICT DO NOTHING;
```

> Si storage.buckets no es accesible por SQL, crear el bucket manualmente
> desde Supabase → Storage → "New bucket" → name: `rider-photos` → toggle Public ON.

### 1.4 Función RPC: `get_order_rider_info`

Retorna los datos públicos del domiciliario de un pedido (para que el cliente lo vea).

```sql
CREATE OR REPLACE FUNCTION public.get_order_rider_info(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_rider_id UUID;
  v_result JSON;
BEGIN
  -- Verificar que el pedido existe y tiene rider asignado
  SELECT assigned_rider_id INTO v_rider_id
  FROM public.orders
  WHERE id = p_order_id
    AND status IN ('en_camino', 'entregado');

  IF v_rider_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'sin_domiciliario');
  END IF;

  SELECT json_build_object(
    'ok', true,
    'full_name',     p.full_name,
    'phone',         p.phone,
    'photo_url',     r.photo_url,
    'vehicle_type',  r.vehicle_type,
    'rating',        r.rating,
    'total_deliveries', r.total_deliveries
  ) INTO v_result
  FROM public.profiles p
  LEFT JOIN public.riders r ON r.id = p.id
  WHERE p.id = v_rider_id;

  RETURN COALESCE(v_result, json_build_object('ok', false, 'error', 'no_encontrado'));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

### 1.5 Modificar la función `get_order_status` para incluir rider

Si la función `get_order_status` ya existe, agregarle el campo `assigned_rider_id`:

```sql
-- Ver la definición actual primero:
-- SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname = 'get_order_status';
-- Luego ajustarla para que retorne también assigned_rider_id y status.
-- Si devuelve una tabla, agregar la columna; si devuelve JSON, agregar el campo.
```

> **IMPORTANTE:** Antes de modificar `get_order_status`, leer su definición actual
> en Supabase → Database → Functions → `get_order_status`.

### 1.6 Migrar `is_available` de `profiles` a `riders`

```sql
-- Crear fila en riders para cada domiciliario existente en profiles
INSERT INTO public.riders (id, is_available)
SELECT id, COALESCE(is_available, false)
FROM public.profiles
WHERE role = 'domiciliario'
ON CONFLICT (id) DO NOTHING;

-- Opcional: quitar is_available de profiles (después de verificar que todo funciona)
-- ALTER TABLE public.profiles DROP COLUMN IF EXISTS is_available;
-- ⚠️  NO ejecutar esto hasta haber actualizado todo el código JS primero.
```

---

## FASE 2 — Panel Admin (`admin.js` + `admin.html`)

### 2.1 Actualizar `createRider()` en `admin.js`

Después de hacer `upsert` en `profiles`, también hacer `insert` en `riders`:

```javascript
// Después del upsert en profiles (línea ~640 en admin.js actual):
const { error: riderError } = await supabase
    .from('riders')
    .upsert({
        id: userId,
        vehicle_type: vehicleTypeInput.value || 'moto',
        vehicle_plate: vehiclePlateInput.value.trim() || null,
        id_number: idNumberInput.value.trim() || null,
        is_available: false
    }, { onConflict: 'id' });

if (riderError) {
    console.error('Error creando fila riders:', riderError);
    // No fallar por esto — el rider puede completar su perfil después
}
```

### 2.2 Agregar campos al modal de crear rider en `admin.html`

Dentro del `<form id="rider-form">`, agregar después del campo "Teléfono":

```html
<!-- Tipo de vehículo + placa -->
<div class="form-row">
    <label class="form-field">
        Tipo de vehículo
        <select id="rider-vehicle-type">
            <option value="moto">🏍️ Moto</option>
            <option value="bicicleta">🚲 Bicicleta</option>
            <option value="carro">🚗 Carro</option>
            <option value="a_pie">🚶 A pie</option>
        </select>
    </label>
    <label class="form-field">
        Placa
        <input id="rider-vehicle-plate" type="text" placeholder="Ej: ABC123">
    </label>
</div>
<!-- Cédula -->
<label class="form-field">
    Cédula (opcional)
    <input id="rider-id-number" type="text" placeholder="Número de identificación">
</label>
```

### 2.3 Actualizar `buildRiderCard()` en `admin.js`

Mostrar foto, vehículo y rating en la tarjeta del rider. Cambiar la query `loadRiders()` para hacer JOIN con `riders`:

```javascript
// En loadRiders(), cambiar el select:
const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, phone, email, role, riders ( photo_url, vehicle_type, vehicle_plate, is_available, rating, total_deliveries )')
    .eq('role', 'domiciliario');

// En buildRiderCard(rider), leer rider.riders (objeto anidado):
const riderData = rider.riders || {};
const availabilityBadge = riderData.is_available
    ? '<span class="product-badge product-badge-offer">Disponible</span>'
    : '<span class="product-badge product-badge-new">No disponible</span>';
const vehicleIcon = { moto: '🏍️', bicicleta: '🚲', carro: '🚗', a_pie: '🚶' }[riderData.vehicle_type] || '🏍️';
const photoHtml = riderData.photo_url
    ? `<img src="${riderData.photo_url}" class="rider-photo-thumb" alt="${rider.full_name}">`
    : `<div class="rider-photo-thumb rider-photo-placeholder"><i class="fas fa-user"></i></div>`;
```

---

## FASE 3 — Panel del domiciliario (`domiciliario.js` + `domiciliario.html`)

### 3.1 Redirigir `is_available` a tabla `riders`

Buscar en `domiciliario.js` las dos referencias a `profiles` para disponibilidad:

**`loadAvailability()` (línea ~127):** cambiar `.from('profiles')` por `.from('riders')`

```javascript
async function loadAvailability() {
    const { data: rider, error } = await supabase
        .from('riders')
        .select('is_available')
        .eq('id', currentUserId)
        .maybeSingle();  // maybeSingle porque puede no existir aún la fila
    if (!error && rider) {
        availabilityToggle.checked = !!rider.is_available;
    }
}
```

**`availabilityToggle` listener (línea ~137):** cambiar `.from('profiles')` por `.from('riders')`. Usar `upsert` en vez de `update` para crear la fila si no existe:

```javascript
availabilityToggle.addEventListener('change', async (e) => {
    if (!currentUserId) return;
    const { error } = await supabase
        .from('riders')
        .upsert({ id: currentUserId, is_available: e.target.checked }, { onConflict: 'id' });
    if (error) {
        console.error('Error actualizando disponibilidad:', error);
        alert('No se pudo actualizar tu disponibilidad.');
        e.target.checked = !e.target.checked;
    }
});
```

### 3.2 Agregar sección "Mi perfil" en `domiciliario.html`

Agregar una tercera pestaña en el panel del domiciliario para que pueda:
- Ver y cambiar su foto de perfil (upload a bucket `rider-photos`)
- Ver sus estadísticas (rating, total entregas)

```html
<!-- Agregar en la nav (después de "Mis entregas"): -->
<button class="status-filter-btn" id="my-profile-tab">Mi perfil</button>

<!-- Agregar sección (después de my-deliveries-container): -->
<main id="my-profile-container" class="orders-container" style="display:none;">
    <div class="rider-profile-card">
        <div class="rider-photo-section">
            <img id="rider-profile-photo" src="" alt="Foto de perfil" class="rider-profile-photo-img">
            <button id="change-photo-btn" class="btn btn-secondary">
                <i class="fas fa-camera"></i> Cambiar foto
            </button>
            <input id="rider-photo-file" type="file" accept="image/*" style="display:none;">
        </div>
        <div class="rider-stats">
            <div class="stat-item">
                <span class="stat-value" id="rider-rating">5.0</span>
                <span class="stat-label">⭐ Rating</span>
            </div>
            <div class="stat-item">
                <span class="stat-value" id="rider-deliveries">0</span>
                <span class="stat-label">📦 Entregas</span>
            </div>
        </div>
    </div>
</main>
```

**En `domiciliario.js`**, agregar la función `loadMyProfile()` que:
1. Lee datos de `riders` (photo_url, rating, total_deliveries)
2. Muestra la foto si existe (URL pública del bucket `rider-photos`)
3. Al hacer click en "Cambiar foto" → abre el file picker → sube a Storage → actualiza `riders.photo_url`

```javascript
async function loadMyProfile() {
    const { data, error } = await supabase
        .from('riders')
        .select('photo_url, rating, total_deliveries, vehicle_type, vehicle_plate')
        .eq('id', currentUserId)
        .maybeSingle();

    if (!error && data) {
        const ratingEl = document.getElementById('rider-rating');
        const deliveriesEl = document.getElementById('rider-deliveries');
        const photoImg = document.getElementById('rider-profile-photo');

        if (ratingEl) ratingEl.textContent = (data.rating || 5).toFixed(1);
        if (deliveriesEl) deliveriesEl.textContent = data.total_deliveries || 0;
        if (photoImg) {
            photoImg.src = data.photo_url || 'https://ui-avatars.com/api/?name=Rider&background=d32f2f&color=fff&size=128';
        }
    }
}

// Upload de foto:
async function uploadRiderPhoto(file) {
    const ext = file.name.split('.').pop();
    const path = `${currentUserId}.${ext}`;
    const { error: uploadError } = await supabase.storage
        .from('rider-photos')
        .upload(path, file, { upsert: true, contentType: file.type });

    if (uploadError) {
        alert('No se pudo subir la foto. Intenta de nuevo.');
        return;
    }

    const { data: urlData } = supabase.storage.from('rider-photos').getPublicUrl(path);
    const photoUrl = urlData.publicUrl;

    await supabase.from('riders').upsert({ id: currentUserId, photo_url: photoUrl }, { onConflict: 'id' });
    document.getElementById('rider-profile-photo').src = photoUrl;
}
```

---

## FASE 4 — Vista del cliente (`scripts.js` + `index.html`)

### 4.1 Mostrar info del rider en el modal de seguimiento

Cuando el pedido pasa a `en_camino`, mostrar una tarjeta con la info del domiciliario.

**En `scripts.js`**, dentro de `renderOrderStatus()` (línea ~895), agregar:

```javascript
async function renderOrderStatus(status, orderId) {
    // ... código existente ...

    // Si está en camino → mostrar info del rider
    const riderInfoEl = document.getElementById('order-rider-info');
    if (riderInfoEl) {
        if (status === 'en_camino' || status === 'entregado') {
            const { data: riderInfo, error } = await supabase.rpc('get_order_rider_info', { p_order_id: orderId });
            if (!error && riderInfo && riderInfo.ok) {
                const vehicleEmoji = { moto: '🏍️', bicicleta: '🚲', carro: '🚗', a_pie: '🚶' }[riderInfo.vehicle_type] || '🏍️';
                const photoSrc = riderInfo.photo_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(riderInfo.full_name || 'D')}&background=d32f2f&color=fff&size=80`;
                riderInfoEl.innerHTML = `
                    <div class="rider-info-card">
                        <img src="${photoSrc}" alt="${riderInfo.full_name}" class="rider-info-photo">
                        <div class="rider-info-details">
                            <strong>${riderInfo.full_name || 'Domiciliario'}</strong>
                            <span>${vehicleEmoji} ${riderInfo.vehicle_type || 'Moto'}</span>
                            <span>⭐ ${(riderInfo.rating || 5).toFixed(1)} · ${riderInfo.total_deliveries || 0} entregas</span>
                            ${riderInfo.phone ? `<a href="tel:${riderInfo.phone}" class="btn btn-secondary btn-sm"><i class="fas fa-phone"></i> Llamar</a>` : ''}
                        </div>
                    </div>
                `;
                riderInfoEl.style.display = 'block';
            } else {
                riderInfoEl.style.display = 'none';
            }
        } else {
            riderInfoEl.style.display = 'none';
        }
    }
}
```

### 4.2 Agregar `#order-rider-info` en `index.html`

Dentro del modal de estado de pedido (`#order-status-modal`), después del timeline:

```html
<!-- Agregar después de #order-status-timeline -->
<div id="order-rider-info" style="display:none;" class="order-rider-section">
    <!-- Se rellena dinámicamente por JS cuando el pedido está "en camino" -->
</div>
```

### 4.3 CSS para las tarjetas del rider

Agregar en `styles.css` (tienda) y `admin.css` (panel):

```css
/* --- INFO DEL RIDER EN MODAL DE SEGUIMIENTO (styles.css) --- */
.order-rider-section {
    margin: 1rem 0;
    padding: 1rem;
    background: #fff8f8;
    border: 1px solid #ffd5d5;
    border-radius: 0.75rem;
}
.rider-info-card {
    display: flex;
    align-items: center;
    gap: 1rem;
}
.rider-info-photo {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid var(--color-primario, #d32f2f);
}
.rider-info-details {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.88rem;
}
.rider-info-details strong {
    font-size: 1rem;
    color: #2a2a2a;
}
.btn-sm {
    padding: 0.35rem 0.75rem;
    font-size: 0.8rem;
    margin-top: 0.25rem;
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
}

/* --- FOTO EN PANEL ADMIN (admin.css) --- */
.rider-photo-thumb {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    object-fit: cover;
    border: 2px solid var(--color-borde);
}
.rider-photo-placeholder {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f0efe9;
    color: var(--color-texto-secundario);
    font-size: 1.1rem;
}

/* --- PERFIL DEL DOMICILIARIO (admin.css o nueva hoja) --- */
.rider-profile-card {
    max-width: 400px;
    margin: 2rem auto;
    background: #fff;
    border-radius: 1rem;
    padding: 2rem;
    box-shadow: 0 4px 16px rgba(0,0,0,0.08);
    text-align: center;
}
.rider-profile-photo-img {
    width: 120px;
    height: 120px;
    border-radius: 50%;
    object-fit: cover;
    border: 3px solid var(--color-primario, #d32f2f);
    margin-bottom: 1rem;
}
.rider-stats {
    display: flex;
    justify-content: center;
    gap: 2rem;
    margin-top: 1.5rem;
}
.stat-item {
    display: flex;
    flex-direction: column;
    align-items: center;
}
.stat-value {
    font-size: 1.8rem;
    font-weight: 700;
    color: var(--color-primario, #d32f2f);
}
.stat-label {
    font-size: 0.8rem;
    color: #6b6b6b;
}
```

---

## FASE 5 — Verificación

### 5.1 Checklist después de ejecutar el SQL

- [ ] La tabla `riders` aparece en Supabase → Table Editor
- [ ] Las policies RLS de `riders` aparecen en Authentication → Policies
- [ ] El bucket `rider-photos` aparece en Storage con acceso público

### 5.2 Checklist funcional

- [ ] Admin puede crear un domiciliario nuevo con tipo de vehículo y placa
- [ ] El nuevo domiciliario aparece en la lista con foto placeholder
- [ ] El domiciliario puede entrar al panel, cambiar su disponibilidad (ahora desde `riders`)
- [ ] El domiciliario puede subir su foto desde "Mi perfil"
- [ ] Cuando un pedido pasa a "en camino", el modal de seguimiento del cliente muestra la tarjeta del rider (foto, nombre, vehículo, rating, botón de llamar)
- [ ] Si el rider no tiene foto, se muestra el avatar generado con sus iniciales

### 5.3 Rollback (si algo falla)

```sql
-- Para revertir completamente:
DROP TABLE IF EXISTS public.riders CASCADE;
DROP FUNCTION IF EXISTS public.get_order_rider_info(UUID);
-- La columna is_available en profiles NO se borró, así que el sistema antiguo sigue funcionando.
```

---

## Notas para el modelo que ejecute esto

1. **Orden de ejecución:** SQL primero → admin.js/html → domiciliario.js/html → scripts.js/index.html
2. **No eliminar `is_available` de `profiles`** hasta que todo el código JS esté actualizado y probado
3. **La función `get_order_status`** en `scripts.js` se llama en línea ~819 y ~868. Verificar si retorna `assigned_rider_id` antes de modificarla; si no lo retorna, no es necesario modificarla ya que `get_order_rider_info` es un RPC separado
4. **El bucket de Storage** puede requerir configuración manual en el Dashboard si el SQL no funciona
5. **`ui-avatars.com`** es un servicio externo gratuito para generar avatares con iniciales — si no se quiere depender de él, usar un SVG placeholder inline
6. **Supabase anon key** ya está en los archivos JS existentes, no cambiar
