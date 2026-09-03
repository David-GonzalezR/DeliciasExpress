-- =============================================================
-- ACKNOWLEDGMENT ORDER FEATURE
-- Add acknowledged_at timestamp and RPC for admin acknowledgment
-- =============================================================

-- 1. Add acknowledged_at column to orders table
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ;

-- 2. Create RPC function for admin to acknowledge order
CREATE OR REPLACE FUNCTION public.acknowledge_order(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_updated_rows INT;
  v_status TEXT;
BEGIN
  -- Only admins can acknowledge
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  -- Get current status
  SELECT status INTO v_status FROM public.orders WHERE id = p_order_id;
  
  IF v_status IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'pedido_no_encontrado');
  END IF;

  -- Only allow acknowledgment from 'recibido' status
  IF v_status != 'recibido' THEN
    RETURN json_build_object('ok', false, 'error', 'estado_invalido', 'current_status', v_status);
  END IF;

  -- Update with acknowledgment timestamp
  UPDATE public.orders
  SET acknowledged_at = now()
  WHERE id = p_order_id
    AND status = 'recibido';

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ya_reconocido_o_cambio_estado');
  END IF;

  RETURN json_build_object('ok', true, 'acknowledged_at', now());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Update get_order_status to include acknowledged_at
DROP FUNCTION IF EXISTS public.get_order_status(uuid);

CREATE FUNCTION public.get_order_status(order_id uuid)
RETURNS TABLE (
  id uuid,
  status text,
  total numeric,
  created_at timestamptz,
  assigned_rider_id uuid,
  delivery_lat double precision,
  delivery_lng double precision,
  customer_phone text,
  customer_rating int,
  estimated_ready_at timestamptz,
  acknowledged_at timestamptz
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    o.id,
    o.status,
    o.total,
    o.created_at,
    o.assigned_rider_id,
    o.delivery_lat,
    o.delivery_lng,
    o.customer_phone,
    o.customer_rating,
    o.estimated_ready_at,
    o.acknowledged_at
  FROM public.orders o
  WHERE o.id = order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;