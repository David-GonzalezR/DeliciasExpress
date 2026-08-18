-- =============================================================
-- ROL "DOMICILIARIO" — DeliciasExpress
-- Ejecutar en el SQL Editor de Supabase, en este orden.
-- Es aditivo: no borra datos existentes. Solo se ajustan CHECKs.
-- =============================================================

-- -------------------------------------------------------------
-- 2.1 Ampliar el rol permitido en profiles + disponibilidad
-- -------------------------------------------------------------
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('cliente', 'admin', 'domiciliario'));

-- Disponibilidad del domiciliario (para no notificar a los offline)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_available BOOLEAN NOT NULL DEFAULT false;

-- Por si el email no quedó agregado (hallazgo #2 de auditoria_seguridad.md)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

-- -------------------------------------------------------------
-- 2.2 Policy: admins actualizan cualquier perfil (promover/degradar rol)
-- -------------------------------------------------------------
CREATE POLICY "Admins actualizan cualquier perfil"
  ON public.profiles FOR UPDATE
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- -------------------------------------------------------------
-- 2.3 Columnas nuevas en orders
-- -------------------------------------------------------------
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS assigned_rider_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS delivery_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_accepted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_lat DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS delivery_lng DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_assigned_rider ON public.orders(assigned_rider_id);

-- -------------------------------------------------------------
-- 2.4 CHECK de status: reemplazar cualquier constraint existente
--     y crear/ajustar el de los estados completos.
--     Si orders.status no tenía CHECK, este bloque lo agrega.
-- -------------------------------------------------------------
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
  WHERE c.conrelid = 'public.orders'::regclass
    AND c.contype = 'c'
    AND a.attname = 'status'
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.orders DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE public.orders
  ADD CONSTRAINT orders_status_check
  CHECK (status IN ('recibido','preparando','despachado','buscando_domiciliario','en_camino','entregado','cancelado'));

-- -------------------------------------------------------------
-- 2.5 RLS: políticas nuevas para orders y order_items
-- -------------------------------------------------------------
-- Los domiciliarios ven: pedidos disponibles para tomar, y los suyos
CREATE POLICY "Domiciliarios ven pedidos disponibles o propios"
  ON public.orders FOR SELECT
  USING (
    public.get_user_role() = 'domiciliario'
    AND (
      status = 'buscando_domiciliario'
      OR assigned_rider_id = auth.uid()
    )
  );

-- Aceptar un pedido: SOLO si sigue libre (la carrera real la gana el RPC atómico)
CREATE POLICY "Domiciliarios aceptan pedidos libres"
  ON public.orders FOR UPDATE
  USING (
    public.get_user_role() = 'domiciliario'
    AND (
      (status = 'buscando_domiciliario' AND assigned_rider_id IS NULL)
      OR assigned_rider_id = auth.uid()
    )
  )
  WITH CHECK (
    public.get_user_role() = 'domiciliario'
    AND assigned_rider_id = auth.uid()
  );

-- Items del pedido: el domiciliario necesita ver qué va a entregar
CREATE POLICY "Domiciliarios ven items de pedidos disponibles o propios"
  ON public.order_items FOR SELECT
  USING (
    public.get_user_role() = 'domiciliario'
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_items.order_id
        AND (o.status = 'buscando_domiciliario' OR o.assigned_rider_id = auth.uid())
    )
  );

-- -------------------------------------------------------------
-- 2.6 Funciones RPC (SECURITY DEFINER, validan rol internamente)
-- -------------------------------------------------------------

-- Admin: dispara la búsqueda de domiciliario
-- NOTA: se usa IS DISTINCT FROM (no <>) porque get_user_role() devuelve NULL
-- para usuarios anónimos y 'NULL <> x' evalúa a NULL (se salta la validación).
CREATE OR REPLACE FUNCTION public.request_delivery(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_updated_rows INT;
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  UPDATE public.orders
  SET status = 'buscando_domiciliario',
      delivery_requested_at = now()
  WHERE id = p_order_id
    AND status = 'despachado';

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'estado_invalido');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Admin: deshace una solicitud sin repartidor (opcional, botón "Cancelar solicitud")
CREATE OR REPLACE FUNCTION public.cancel_delivery_request(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_updated_rows INT;
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  UPDATE public.orders
  SET status = 'despachado',
      delivery_requested_at = NULL
  WHERE id = p_order_id
    AND status = 'buscando_domiciliario'
    AND assigned_rider_id IS NULL;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'estado_invalido');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Domiciliario: acepta un pedido. Solo el primero que intente lo consigue.
CREATE OR REPLACE FUNCTION public.accept_delivery(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_role TEXT;
  v_updated_rows INT;
BEGIN
  v_role := public.get_user_role();
  IF v_role IS DISTINCT FROM 'domiciliario' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  UPDATE public.orders
  SET status = 'en_camino',
      assigned_rider_id = auth.uid(),
      delivery_accepted_at = now()
  WHERE id = p_order_id
    AND status = 'buscando_domiciliario'
    AND assigned_rider_id IS NULL;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'ya_tomado');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Domiciliario: marca como entregado (solo el asignado)
CREATE OR REPLACE FUNCTION public.mark_delivered(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_updated_rows INT;
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'domiciliario' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  UPDATE public.orders
  SET status = 'entregado',
      delivered_at = now()
  WHERE id = p_order_id
    AND status = 'en_camino'
    AND assigned_rider_id = auth.uid();

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'no_permitido');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------------
-- 4.2 (OPCIONAL) Ampliar create_order con p_lat / p_lng / p_customer_phone
-- -------------------------------------------------------------
-- YA EJECUTADO el 2026-08-17 contra el proyecto sjoytwcrdewealudjxep.
-- La definición original (solo 3 parámetros) se obtuvo del dashboard y
-- se recreó agregando los 3 parámetros nuevos con DEFAULT NULL.
-- Definición actual aplicada en la base:
CREATE OR REPLACE FUNCTION public.create_order(p_delivery_address text, p_total numeric, p_items jsonb, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL, p_customer_phone text DEFAULT NULL)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ declare v_order_id uuid; v_item jsonb; begin insert into public.orders (delivery_address, total, user_id, status, delivery_lat, delivery_lng, customer_phone) values (p_delivery_address, p_total, auth.uid(), 'recibido', p_lat, p_lng, p_customer_phone) returning id into v_order_id; for v_item in select * from jsonb_array_elements(p_items) loop insert into public.order_items (order_id, product_id, product_name, quantity, unit_price, customizations, instructions) values (v_order_id, (v_item->>'product_id')::uuid, v_item->>'product_name', (v_item->>'quantity')::int, (v_item->>'unit_price')::numeric, v_item->'customizations', v_item->>'instructions'); end loop; return v_order_id; end; $function$
-- NOTA: al existir la firma vieja de 3 parámetros y esta nueva de 6, ambas
-- conviven como overloads; el frontend (scripts.js) usa la de 6 y si falla
-- reintenta con la de 3, así que el checkout funciona en ambos casos.
