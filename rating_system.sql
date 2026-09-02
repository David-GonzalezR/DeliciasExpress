-- Item 1.3: Calificación de domiciliario/pedido
-- Ejecutar en Supabase SQL Editor

-- 1. Agregar columna customer_rating a orders
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS customer_rating int;

-- 2. Función para calificar pedido y actualizar rating del domiciliario
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

-- 3. Permisos
GRANT EXECUTE ON FUNCTION public.rate_order(uuid, int) TO anon, authenticated;

-- 4. Actualizar get_order_status para incluir customer_rating
-- Primero dropear la función existente (si existe) porque cambia el tipo de retorno
DROP FUNCTION IF EXISTS public.get_order_status(uuid);

CREATE OR REPLACE FUNCTION public.get_order_status(order_id uuid)
RETURNS TABLE (
  id uuid,
  status text,
  total numeric,
  customer_rating int,
  assigned_rider_id uuid,
  delivery_requested_at timestamptz,
  delivered_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.status, o.total, o.customer_rating, o.assigned_rider_id, o.delivery_requested_at, o.delivered_at
  FROM public.orders o
  WHERE o.id = order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_order_status(uuid) TO anon, authenticated;

-- Verificar
SELECT column_name FROM information_schema.columns WHERE table_name = 'orders' AND column_name = 'customer_rating';
SELECT public.rate_order('00000000-0000-0000-0000-000000000000', 5) as test;