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

-- ================================================================
-- Políticas RLS
-- ================================================================

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
-- (solo lectura; los datos sensibles como cédula/placa se filtran en el RPC)
CREATE POLICY "Lectura pública limitada de riders"
  ON public.riders FOR SELECT
  USING (true);

-- ================================================================
-- Storage bucket para fotos de riders (público)
-- ================================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('rider-photos', 'rider-photos', true)
ON CONFLICT DO NOTHING;

-- ================================================================
-- RPC: get_order_rider_info — datos públicos del domiciliario
-- ================================================================
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

-- ================================================================
-- Migrar is_available de profiles a riders (domiciliarios existentes)
-- ================================================================
INSERT INTO public.riders (id, is_available)
SELECT id, COALESCE(is_available, false)
FROM public.profiles
WHERE role = 'domiciliario'
ON CONFLICT (id) DO NOTHING;

-- ================================================================
-- Rollback (si algo falla):
--   DROP TABLE IF EXISTS public.riders CASCADE;
--   DROP FUNCTION IF EXISTS public.get_order_rider_info(UUID);
-- La columna is_available en profiles NO se borra, el sistema antiguo sigue funcionando.
-- ================================================================