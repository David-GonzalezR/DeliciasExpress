-- =============================================================
-- CORRECCIÓN DEL FLUJO DE PEDIDOS
-- Elimina 'despachado' como paso obligatorio.
-- El admin ahora va de 'preparando' → 'buscando_domiciliario' directamente.
--
-- Ejecutar en el SQL Editor de Supabase
-- Proyecto: sjoytwcrdewealudjxep
-- =============================================================

-- 1. Actualizar request_delivery para aceptar pedidos en 'preparando' O 'despachado' (legacy)
CREATE OR REPLACE FUNCTION public.request_delivery(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_updated_rows INT;
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  -- Acepta el pedido desde 'preparando' (nuevo flujo) O desde 'despachado' (compatibilidad legacy)
  UPDATE public.orders
  SET status = 'buscando_domiciliario',
      delivery_requested_at = now()
  WHERE id = p_order_id
    AND status IN ('preparando', 'despachado');

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;

  IF v_updated_rows = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'estado_invalido');
  END IF;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 2. Actualizar cancel_delivery_request para volver a 'preparando' (no a 'despachado')
CREATE OR REPLACE FUNCTION public.cancel_delivery_request(p_order_id UUID)
RETURNS JSON AS $$
DECLARE
  v_updated_rows INT;
BEGIN
  IF public.get_user_role() IS DISTINCT FROM 'admin' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado');
  END IF;

  -- Vuelve a 'preparando' en lugar de 'despachado' para que el cliente no vea estado incorrecto
  UPDATE public.orders
  SET status = 'preparando',
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

-- 3. (OPCIONAL) Migrar pedidos que quedaron en 'despachado' sin domiciliario → 'preparando'
--    Descomenta si quieres limpiar la base de datos de estados legacy:
-- UPDATE public.orders
-- SET status = 'preparando'
-- WHERE status = 'despachado'
--   AND assigned_rider_id IS NULL;

-- 4. Verificar el resultado
SELECT id, status, delivery_requested_at, assigned_rider_id
FROM public.orders
WHERE status IN ('preparando', 'despachado', 'buscando_domiciliario')
ORDER BY created_at DESC
LIMIT 20;
