-- ================================================================
-- TABLA push_subscriptions — Web Push subscriptions
-- Ejecutar en Supabase SQL Editor (proyecto sjoytwcrdewealudjxep)
-- ================================================================

CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id              BIGSERIAL PRIMARY KEY,
  endpoint        TEXT NOT NULL UNIQUE,
  p256dh          TEXT NOT NULL,
  auth            TEXT NOT NULL,
  user_id         UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'cliente' CHECK (role IN ('cliente', 'admin', 'domiciliario')),
  order_ids       UUID[] DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_role ON public.push_subscriptions(role);
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_order_ids ON public.push_subscriptions USING GIN(order_ids);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Políticas RLS
-- El usuario puede ver/gestionar sus propias suscripciones
CREATE POLICY "Usuario lee sus suscripciones"
  ON public.push_subscriptions FOR SELECT
  USING (user_id = auth.uid() OR auth.uid() IS NULL);

CREATE POLICY "Usuario inserta sus suscripciones"
  ON public.push_subscriptions FOR INSERT
  WITH CHECK (user_id = auth.uid() OR auth.uid() IS NULL);

CREATE POLICY "Usuario actualiza sus suscripciones"
  ON public.push_subscriptions FOR UPDATE
  USING (user_id = auth.uid() OR auth.uid() IS NULL)
  WITH CHECK (user_id = auth.uid() OR auth.uid() IS NULL);

CREATE POLICY "Usuario borra sus suscripciones"
  ON public.push_subscriptions FOR DELETE
  USING (user_id = auth.uid() OR auth.uid() IS NULL);

-- Admins ven todas las suscripciones
CREATE POLICY "Admins leen todas las suscripciones"
  ON public.push_subscriptions FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins gestionan suscripciones"
  ON public.push_subscriptions FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');

-- ================================================================
-- RPC: register_push_subscription — Registra/actualiza suscripción
-- ================================================================
CREATE OR REPLACE FUNCTION public.register_push_subscription(
  p_endpoint TEXT,
  p_p256dh   TEXT,
  p_auth     TEXT,
  p_role     TEXT DEFAULT 'cliente'
)
RETURNS JSON AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_result  JSON;
BEGIN
  -- Validar role
  IF p_role NOT IN ('cliente', 'admin', 'domiciliario') THEN
    RETURN json_build_object('ok', false, 'error', 'role_invalido');
  END IF;

  -- Upsert: si existe el endpoint, actualiza; si no, crea
  INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, user_id, role)
  VALUES (p_endpoint, p_p256dh, p_auth, v_user_id, p_role)
  ON CONFLICT (endpoint) DO UPDATE SET
    p256dh = EXCLUDED.p256dh,
    auth   = EXCLUDED.auth,
    user_id = EXCLUDED.user_id,
    role   = EXCLUDED.role,
    updated_at = now()
  RETURNING json_build_object('ok', true, 'endpoint', endpoint) INTO v_result;

  RETURN COALESCE(v_result, json_build_object('ok', true));
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- RPC: link_order_to_push_subscription — Vincula pedido anónimo
-- ================================================================
CREATE OR REPLACE FUNCTION public.link_order_to_push_subscription(
  p_endpoint TEXT,
  p_order_id UUID
)
RETURNS JSON AS $$
DECLARE
  v_updated INT;
BEGIN
  UPDATE public.push_subscriptions
  SET order_ids = array_append(order_ids, p_order_id),
      updated_at = now()
  WHERE endpoint = p_endpoint
    AND NOT (p_order_id = ANY(order_ids));

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN json_build_object('ok', true, 'linked', v_updated > 0);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- RPC: unlink_order_from_push_subscription — Desvincula pedido
-- ================================================================
CREATE OR REPLACE FUNCTION public.unlink_order_from_push_subscription(
  p_endpoint TEXT,
  p_order_id UUID
)
RETURNS JSON AS $$
BEGIN
  UPDATE public.push_subscriptions
  SET order_ids = array_remove(order_ids, p_order_id),
      updated_at = now()
  WHERE endpoint = p_endpoint;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- RPC: delete_push_subscription — Borra suscripción por endpoint
-- ================================================================
CREATE OR REPLACE FUNCTION public.delete_push_subscription(
  p_endpoint TEXT
)
RETURNS JSON AS $$
BEGIN
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint;
  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ================================================================
-- Trigger function para notificar cambios en orders
-- La implementación real está en push_trigger_setup.sql
-- Ejecutar ese archivo después de habilitar pg_net y configurar la clave
-- ================================================================
-- Ver push_trigger_setup.sql para la implementación completa con pg_net
-- Requiere:
-- 1. Habilitar pg_net: CREATE EXTENSION IF NOT EXISTS pg_net;
-- 2. Configurar service role key: ALTER DATABASE postgres SET app.push_service_role_key = 'TU_SERVICE_ROLE_KEY';
-- 3. Ejecutar push_trigger_setup.sql