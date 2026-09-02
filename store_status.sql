-- Función para leer el estado de la tienda (abierta/cerrada) sin exponer toda la tabla app_settings
-- Ejecutar en Supabase SQL Editor

-- 1. Asegurar que existe la clave store_open en app_settings
INSERT INTO public.app_settings (key, value) VALUES ('store_open', 'true')
ON CONFLICT (key) DO NOTHING;

-- 2. Función SECURITY DEFINER para leer solo store_open (pública, no requiere auth)
CREATE OR REPLACE FUNCTION public.get_store_status()
RETURNS boolean AS $$
DECLARE
    v_value text;
BEGIN
    SELECT value INTO v_value
    FROM public.app_settings
    WHERE key = 'store_open'
    LIMIT 1;

    RETURN COALESCE(v_value, 'true') = 'true';
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Dar permiso de ejecución a anon y authenticated
GRANT EXECUTE ON FUNCTION public.get_store_status() TO anon, authenticated;

-- Verificar
SELECT public.get_store_status() as store_open;