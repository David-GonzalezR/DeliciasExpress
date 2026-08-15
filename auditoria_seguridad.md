# Auditoría de Seguridad y Análisis de Fallas - DeliciasExpress

Este documento detalla los hallazgos del análisis de seguridad y posibles fallas de lógica en la integración de Supabase, autenticación y base de datos para la aplicación DeliciasExpress.

---

## 🚨 Hallazgos Críticos

### 1. Falta de RLS en la tabla `order_items` (Privacidad / Fuga de Datos)
* **Gravedad**: Crítica
* **Descripción**: En el script de base de datos `supabase-auth-setup.sql` no se inicializan políticas de seguridad (RLS) para la tabla `order_items`. Si no se habilita explícitamente en Supabase, la tabla queda expuesta públicamente. Cualquier usuario (incluso anónimo) podría consultar la tabla y ver qué productos compró cada cliente, filtrando datos sensibles.
* **Solución**: Habilitar RLS en `order_items` y permitir lectura solo a los dueños del pedido (mediante una relación con la tabla `orders`) o a administradores.
  ```sql
  ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "Clientes ven sus propios items"
    ON public.order_items FOR SELECT
    USING (
      EXISTS (
        SELECT 1 FROM public.orders 
        WHERE orders.id = order_items.order_id 
        AND (orders.user_id = auth.uid() OR orders.user_id IS NULL)
      )
    );

  CREATE POLICY "Admins ven todos los items"
    ON public.order_items FOR SELECT
    USING (public.get_user_role() = 'admin');
  ```

---

## ⚠️ Hallazgos Medios (Lógica y Funcionalidad)

### 2. El Trigger de nuevos usuarios no guarda el Email (Bloquea Email Marketing)
* **Gravedad**: Alta
* **Descripción**: La función `handle_new_user()` que crea el perfil en `public.profiles` cuando alguien se registra solo inserta `id`, `full_name` y `role`. **No copia el correo electrónico (`email`)**. Si implementas la función de "Ofertas Relámpago y Email Marketing", la base de datos de correos estará vacía y no podrás enviar alertas.
* **Solución**: Modificar el trigger para capturar el email de la cuenta de autenticación de Supabase:
  ```sql
  CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS TRIGGER AS $$
  BEGIN
    INSERT INTO public.profiles (id, full_name, email, role)
    VALUES (
      NEW.id,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
      NEW.email, -- Guarda el correo del usuario
      'cliente'
    );
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;
  ```

### 3. Vulnerabilidad de Escalación de Privilegios (Modificar Rol de Usuario)
* **Gravedad**: Media
* **Descripción**: La política de actualización de perfiles (`Profiles Update`) permite que un usuario modifique su propia fila. Aunque existe una verificación de rol `role = (SELECT role FROM public.profiles WHERE id = auth.uid())`, en bases de datos relacionales confiar únicamente en políticas RLS para evitar que el usuario altere su rol a `'admin'` mediante una consulta directa (`UPDATE profiles SET role = 'admin'`) puede ser riesgoso o saltarse si la política se desactiva o altera por error.
* **Solución**: Crear un trigger de base de datos (`BEFORE UPDATE`) que bloquee específicamente cualquier intento de modificar la columna `role` a menos que quien edite sea un administrador real.
  ```sql
  CREATE OR REPLACE FUNCTION public.prevent_role_escalation()
  RETURNS TRIGGER AS $$
  BEGIN
    IF NEW.role <> OLD.role AND (public.get_user_role() IS DISTINCT FROM 'admin') THEN
      RAISE EXCEPTION 'No tienes permisos para modificar tu rol.';
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql SECURITY DEFINER;

  CREATE TRIGGER trigger_check_role_change
    BEFORE UPDATE ON public.profiles
    FOR EACH ROW
    EXECUTE FUNCTION public.prevent_role_escalation();
  ```

---

## ℹ️ Hallazgos Menores (Experiencia de Usuario / Robustez)

### 4. Seguimiento de Pedidos Anónimos (Posible Bloqueo de RLS)
* **Gravedad**: Baja
* **Descripción**: La política `Clientes ven sus pedidos` usa `auth.uid() = user_id`. Para los clientes que compran como invitados (anónimos), ambos valores son `NULL`. En SQL, la comparación `NULL = NULL` **no es verdadera** (devuelve `NULL`). Si la aplicación intenta consultar la tabla `orders` directamente desde el navegador de un cliente anónimo para mostrarle su estado de entrega, Supabase denegará la lectura.
* **Nota**: Esto se soluciona si la lectura del estado se realiza exclusivamente a través de una función RPC con `SECURITY DEFINER` (que evade RLS), pero es un punto crítico a vigilar si se cambia la lógica del cliente a consultas directas.
* **Solución**: Asegurarse de que la función `get_order_status` esté definida en la base de datos con `SECURITY DEFINER` para permitir a usuarios anónimos consultar únicamente su propio `order_id` (el cual ya está protegido al ser un UUID indescifrable).
