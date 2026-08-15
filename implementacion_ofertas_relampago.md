# Plan de Implementación: Ofertas Relámpago y Email Marketing

## Objetivo
Implementar un sistema de **Ofertas Relámpago** que permita al administrador publicar promociones con límite de tiempo (cuenta regresiva) y enviar un correo masivo instantáneo a todos los clientes registrados para incentivar compras rápidas.

---

## 🛠️ Arquitectura de la Solución (Para el modelo ejecutor)

### 1. Base de Datos (Supabase SQL)
Crear la tabla para guardar las ofertas activas e históricas:
```sql
CREATE TABLE public.flash_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID REFERENCES public.products(id) ON DELETE CASCADE,
  discount_percentage INT NOT NULL CHECK (discount_percentage BETWEEN 1 AND 100),
  starts_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ends_at TIMESTAMPTZ NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Asegurar que los perfiles almacenen el correo (si no se hace ya)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;
```

### 2. Proveedor de Correo e Integración (Resend)
Usaremos **Resend** (gratuito, hasta 3,000 correos al mes) para realizar los envíos masivos.
- Se creará una **Supabase Edge Function** (`send-flash-email`) que:
  1. Reciba los detalles de la oferta relámpago.
  2. Obtenga la lista de correos de la tabla `public.profiles`.
  3. Envíe el correo en lote (Batch) usando la API de Resend.

### 3. Panel de Administración (`admin.html` / `admin.js`)
- **Sección en Sidebar**: Pestaña "Ofertas Relámpago".
- **Formulario de Creación**:
  - Seleccionar producto del catálogo.
  - Definir descuento (%).
  - Definir duración (en minutos u horas).
- **Control de Campañas**:
  - Un listado de ofertas programadas.
  - Botón **"🚀 Enviar Alerta por Email"** que llame a la Edge Function de Supabase.
  - Botón **"Terminar Oferta"** para apagar la promoción antes de tiempo.

### 4. Interfaz del Cliente (`index.html` / `styles.css` / `scripts.js`)
- **Banner Superior (Sticky Banner)**:
  - Se muestra automáticamente arriba de la app cuando hay una fila activa en `flash_offers` (donde `ends_at > ahora` e `is_active = true`).
  - Muestra un texto atractivo: *"🔥 ¡OFERTA RELÁMPAGO! 20% OFF en Pizza Especial. Termina en: [reloj_cuenta_regresiva]"*.
- **Lógica de Cuenta Regresiva**:
  - Un temporizador en JS (`setInterval`) que calcule la diferencia entre `ends_at` y el tiempo actual y la muestre en formato `MM:SS` u `HH:MM:SS`.
  - Al llegar a cero, oculta el banner dinámicamente.
- **Aplicación del Descuento**:
  - Cuando la oferta está activa, modificar temporalmente el precio del producto en la tienda y en el carrito.

---

## 📖 Manual de Operación: Cómo Lanzar una Oferta Relámpago (Para el Administrador)

¡Aprende a llenar tu restaurante en las horas con menos ventas usando esta herramienta!

### Paso 1: Crear la Oferta Relámpago
1. Entra a tu panel de administración y ve a la sección **"Ofertas Relámpago"**.
2. Haz clic en **"+ Crear Nueva Oferta"**.
3. Rellena los datos:
   - **Producto**: Elige el producto que quieres promocionar (ej. *Hamburguesa Suprema*).
   - **Descuento**: Ingresa el porcentaje a rebajar (ej. `25` para un 25% de descuento).
   - **Duración**: Define cuánto tiempo estará activa la oferta (ej. `60` minutos).
4. Guarda la oferta. Inmediatamente aparecerá un banner rojo arriba de tu tienda con una cuenta regresiva en tiempo real para todos los clientes que la estén visitando.

### Paso 2: Enviar el correo masivo a tus clientes
Una vez creada la oferta, querrás avisar a la gente que no está en la página web:
1. En la lista de ofertas, busca tu promoción activa.
2. Haz clic en el botón azul **"🚀 Enviar Alerta por Email"**.
3. El sistema enviará automáticamente un correo electrónico a todos los clientes que se hayan registrado previamente en tu tienda con el asunto: *"🔥 ¡Oferta Relámpago de última hora en DeliciasExpress! 25% de descuento en Hamburguesa Suprema"*.
4. El correo llevará un botón directo para que tus clientes vayan a pedirlo en un solo clic.

### Consejos de Marketing para el Éxito:
- **Usa descuentos reales y atractivos:** La gente reacciona muy rápido a los descuentos de entre el 20% y el 40%.
- **Limita el tiempo:** Las ofertas que mejor funcionan duran entre 30 minutos y 2 horas. Si duran demasiado, se pierde el sentido de urgencia.
- **Hora ideal:** Actívalo en tus días y horas más lentas (como los martes de 3:00 PM a 5:00 PM) para reactivar la cocina.
