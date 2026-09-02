-- Actualizar get_order_status para incluir estimated_ready_at
-- Ejecutar en Supabase SQL Editor

DROP FUNCTION IF EXISTS public.get_order_status(uuid);

CREATE OR REPLACE FUNCTION public.get_order_status(order_id uuid)
RETURNS TABLE (
  id uuid,
  status text,
  total numeric,
  customer_rating int,
  assigned_rider_id uuid,
  delivery_requested_at timestamptz,
  delivered_at timestamptz,
  estimated_ready_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT o.id, o.status, o.total, o.customer_rating, o.assigned_rider_id, o.delivery_requested_at, o.delivered_at, o.estimated_ready_at
  FROM public.orders o
  WHERE o.id = order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION public.get_order_status(uuid) TO anon, authenticated;

-- Verificar
SELECT public.get_store_status();