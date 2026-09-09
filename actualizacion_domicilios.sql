-- =============================================================
-- accept_delivery: además de asignar el pedido, pone al domiciliario
-- como NO disponible automáticamente (deja de recibir más pedidos
-- mientras tiene uno en curso).
-- =============================================================
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

  -- Nuevo: al aceptar, el domiciliario pasa a NO disponible automáticamente.
  -- Se usa upsert por si por alguna razón no existiera aún su fila en riders.
  INSERT INTO public.riders (id, is_available)
  VALUES (auth.uid(), false)
  ON CONFLICT (id) DO UPDATE SET is_available = false;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- =============================================================
-- mark_delivered: además de marcar el pedido como entregado, pone
-- al domiciliario como disponible de nuevo automáticamente, y le
-- suma 1 a su contador de entregas (total_deliveries), que ya existe
-- en la tabla riders pero hasta ahora nunca se incrementaba.
-- =============================================================
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

  -- Nuevo: al entregar, el domiciliario vuelve a estar disponible
  -- automáticamente y se le suma una entrega a su historial.
  INSERT INTO public.riders (id, is_available, total_deliveries)
  VALUES (auth.uid(), true, 1)
  ON CONFLICT (id) DO UPDATE
    SET is_available = true,
        total_deliveries = public.riders.total_deliveries + 1;

  RETURN json_build_object('ok', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
