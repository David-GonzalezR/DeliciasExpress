-- Hace mark_delivered tolerante a la carrera "cliente confirma primero".
-- Aplicada en Supabase: 2026-09-08

CREATE OR REPLACE FUNCTION public.mark_delivered(p_order_id UUID)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_updated_rows int; v_role text; v_user_id uuid; v_status text; v_assigned_rider_id uuid;
BEGIN
  v_user_id := auth.uid(); v_role := public.get_user_role();
  IF v_user_id IS NULL THEN RETURN json_build_object('ok',false,'error','sesion_no_autenticada'); END IF;
  IF v_role IS DISTINCT FROM 'domiciliario' THEN RETURN json_build_object('ok',false,'error','no_autorizado','role_detectado',v_role); END IF;
  SELECT status,assigned_rider_id INTO v_status,v_assigned_rider_id FROM public.orders WHERE id=p_order_id;
  IF v_status='entregado' AND v_assigned_rider_id=v_user_id THEN
    UPDATE public.riders SET is_available=true,updated_at=now() WHERE id=v_user_id;
    RETURN json_build_object('ok',true,'already_delivered',true);
  END IF;
  UPDATE public.orders SET status='entregado',delivered_at=COALESCE(delivered_at,now()) WHERE id=p_order_id AND assigned_rider_id=v_user_id AND status='en_camino';
  GET DIAGNOSTICS v_updated_rows=ROW_COUNT;
  IF v_updated_rows=0 THEN RETURN json_build_object('ok',false,'error','pedido_no_valido'); END IF;
  INSERT INTO public.riders(id,is_available,total_deliveries,updated_at) VALUES(v_user_id,true,1,now())
  ON CONFLICT(id) DO UPDATE SET is_available=true,total_deliveries=COALESCE(public.riders.total_deliveries,0)+1,updated_at=now();
  RETURN json_build_object('ok',true);
END;
$function$;
