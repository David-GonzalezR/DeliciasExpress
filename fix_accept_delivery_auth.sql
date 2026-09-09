-- Correccion de autenticacion para accept_delivery/mark_delivered
-- La funcion usa el mismo get_user_role() que valida el panel del domiciliario.

CREATE OR REPLACE FUNCTION public.accept_delivery(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated_rows int;
  v_role text;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  v_role := public.get_user_role();

  IF v_user_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'sesion_no_autenticada');
  END IF;

  IF v_role IS DISTINCT FROM 'domiciliario' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado', 'role_detectado', v_role);
  END IF;

  UPDATE public.orders
  SET assigned_rider_id = v_user_id,
      status = 'en_camino',
      delivery_accepted_at = now()
  WHERE id = p_order_id
    AND status = 'buscando_domiciliario'
    AND assigned_rider_id IS NULL;

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'pedido_no_disponible');
  END IF;

  INSERT INTO public.riders (id, is_available, updated_at)
  VALUES (v_user_id, false, now())
  ON CONFLICT (id) DO UPDATE
    SET is_available = false,
        updated_at = now();

  RETURN json_build_object('ok', true);
END;
$function$;

CREATE OR REPLACE FUNCTION public.mark_delivered(p_order_id uuid)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_updated_rows int;
  v_role text;
  v_user_id uuid;
BEGIN
  v_user_id := auth.uid();
  v_role := public.get_user_role();

  IF v_user_id IS NULL THEN
    RETURN json_build_object('ok', false, 'error', 'sesion_no_autenticada');
  END IF;

  IF v_role IS DISTINCT FROM 'domiciliario' THEN
    RETURN json_build_object('ok', false, 'error', 'no_autorizado', 'role_detectado', v_role);
  END IF;

  UPDATE public.orders
  SET status = 'entregado',
      delivered_at = now()
  WHERE id = p_order_id
    AND assigned_rider_id = v_user_id
    AND status = 'en_camino';

  GET DIAGNOSTICS v_updated_rows = ROW_COUNT;
  IF v_updated_rows = 0 THEN
    RETURN json_build_object('ok', false, 'error', 'pedido_no_valido');
  END IF;

  INSERT INTO public.riders (id, is_available, total_deliveries, updated_at)
  VALUES (v_user_id, true, 1, now())
  ON CONFLICT (id) DO UPDATE
    SET is_available = true,
        total_deliveries = COALESCE(public.riders.total_deliveries, 0) + 1,
        updated_at = now();

  RETURN json_build_object('ok', true);
END;
$function$;
