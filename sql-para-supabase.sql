-- =============================================
-- FASE 1.1: Perfil con dirección guardada
-- =============================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saved_address text,
  ADD COLUMN IF NOT EXISTS saved_lat double precision,
  ADD COLUMN IF NOT EXISTS saved_lng double precision;

-- =============================================
-- FASE 1.3 + 2.1: Calificación + ETA en orders
-- =============================================
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS customer_rating int,
  ADD COLUMN IF NOT EXISTS estimated_ready_at timestamptz;

-- =============================================
-- FASE 1.4: Toggle tienda + retrasos
-- =============================================
INSERT INTO public.app_settings (key, value) VALUES 
  ('store_open', 'true'),
  ('store_delay_minutes', '0'),
  ('store_delay_message', '')
ON CONFLICT (key) DO NOTHING;

-- =============================================
-- ACTUALIZAR get_order_status() - DROP y CREATE
-- =============================================
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
  estimated_ready_at timestamptz
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
    o.estimated_ready_at
  FROM public.orders o
  WHERE o.id = order_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- ACTUALIZAR get_store_status() - DROP y CREATE
-- =============================================
DROP FUNCTION IF EXISTS public.get_store_status();

CREATE FUNCTION public.get_store_status()
RETURNS json AS $$
DECLARE
  v_open text;
  v_delay_min text;
  v_delay_msg text;
BEGIN
  SELECT value INTO v_open FROM public.app_settings WHERE key = 'store_open';
  SELECT value INTO v_delay_min FROM public.app_settings WHERE key = 'store_delay_minutes';
  SELECT value INTO v_delay_msg FROM public.app_settings WHERE key = 'store_delay_message';
  
  RETURN json_build_object(
    'is_open', COALESCE(v_open, 'true') = 'true',
    'delay_minutes', COALESCE(v_delay_min, '0')::int,
    'delay_message', COALESCE(v_delay_msg, '')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================
-- POLÍTICA RLS para que clientes lean store_open
-- (ejecutar solo si get_store_status falla por RLS)
-- =============================================
CREATE POLICY "Public read store_open" ON public.app_settings
  FOR SELECT USING (key = 'store_open');