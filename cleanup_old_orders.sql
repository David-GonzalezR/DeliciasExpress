-- Función para limpiar pedidos antiguos, manteniendo solo los últimos N por usuario
-- Ejecutar en Supabase SQL Editor

CREATE OR REPLACE FUNCTION public.cleanup_old_orders(p_user_id uuid, p_keep int DEFAULT 10)
RETURNS void AS $$
DECLARE
    v_order_ids uuid[];
BEGIN
    -- Obtener IDs de pedidos a eliminar (los que están después de los últimos p_keep)
    SELECT array_agg(id) INTO v_order_ids
    FROM (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY created_at DESC) as rn
        FROM public.orders
        WHERE user_id = p_user_id
    ) sub
    WHERE rn > p_keep;

    IF v_order_ids IS NOT NULL AND array_length(v_order_ids, 1) > 0 THEN
        -- Primero eliminar order_items (por FK)
        DELETE FROM public.order_items
        WHERE order_id = ANY(v_order_ids);

        -- Luego eliminar orders
        DELETE FROM public.orders
        WHERE id = ANY(v_order_ids);
    END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Verificar que existe
SELECT proname FROM pg_proc WHERE proname = 'cleanup_old_orders';