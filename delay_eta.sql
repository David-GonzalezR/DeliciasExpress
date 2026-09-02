-- Cambios para ETA y sistema de retrasos
-- Ejecutar en Supabase SQL Editor

-- 1. Agregar columna estimated_ready_at a orders
ALTER TABLE public.orders
ADD COLUMN IF NOT EXISTS estimated_ready_at timestamptz;

-- 2. Agregar settings de retraso en app_settings
INSERT INTO public.app_settings (key, value) VALUES ('store_delay_minutes', '0')
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.app_settings (key, value) VALUES ('store_delay_message', '')
ON CONFLICT (key) DO NOTHING;

-- 3. Función para obtener estado de tienda + retraso (reemplaza get_store_status)
CREATE OR REPLACE FUNCTION public.get_store_status()
RETURNS json AS $$
DECLARE
    v_open text;
    v_delay_min text;
    v_delay_msg text;
BEGIN
    SELECT value INTO v_open FROM public.app_settings WHERE key = 'store_open' LIMIT 1;
    SELECT value INTO v_delay_min FROM public.app_settings WHERE key = 'store_delay_minutes' LIMIT 1;
    SELECT value INTO v_delay_msg FROM public.app_settings WHERE key = 'store_delay_message' LIMIT 1;

    RETURN json_build_object(
        'is_open', COALESCE(v_open, 'true') = 'true',
        'delay_minutes', COALESCE(v_delay_min, '0')::int,
        'delay_message', COALESCE(v_delay_msg, '')
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_store_status() TO anon, authenticated;

-- 4. Función para actualizar estimated_ready_at cuando el pedido pasa a 'preparando'
CREATE OR REPLACE FUNCTION public.set_estimated_ready_at(p_order_id uuid)
RETURNS void AS $$
DECLARE
    v_delay_min int;
BEGIN
    -- Obtener minutos de retraso configurados
    SELECT COALESCE(value, '0')::int INTO v_delay_min
    FROM public.app_settings
    WHERE key = 'store_delay_minutes'
    LIMIT 1;

    -- Calcular ETA: ahora + 35 min base + retraso configurado
    UPDATE public.orders
    SET estimated_ready_at = now() + (interval '35 minutes') + (v_delay_min || ' minutes')::interval
    WHERE id = p_order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.set_estimated_ready_at(uuid) TO authenticated;

-- 5. Actualizar get_order_status para devolver estimated_ready_at
-- (Asumiendo que existe get_order_status, agregar la columna al SELECT)
-- Nota: Esta función ya existe según el código, hay que modificarla manualmente en Supabase
-- para agregar 'estimated_ready_at' al RETURNS TABLE y al SELECT interno.

-- Verificar
SELECT public.get_store_status();