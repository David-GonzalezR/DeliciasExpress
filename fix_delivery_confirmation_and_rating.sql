-- Confirmación de entrega idempotente + calificación del domiciliario.
-- Aplicada en Supabase: 2026-09-08

CREATE OR REPLACE FUNCTION public.confirm_order_received(p_order_id UUID)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_status text;
  v_rider_id uuid;
  v_acknowledged_at timestamptz;
BEGIN
  SELECT status, assigned_rider_id, acknowledged_at INTO v_status, v_rider_id, v_acknowledged_at
  FROM public.orders WHERE id = p_order_id;
  IF v_status IS NULL THEN RETURN false; END IF;
  IF v_status = 'en_camino' THEN
    UPDATE public.orders SET status='entregado', delivered_at=COALESCE(delivered_at, now()), acknowledged_at=COALESCE(acknowledged_at, now()) WHERE id=p_order_id;
    IF v_rider_id IS NOT NULL THEN
      INSERT INTO public.riders(id,is_available,total_deliveries,updated_at) VALUES(v_rider_id,true,1,now())
      ON CONFLICT(id) DO UPDATE SET is_available=true,total_deliveries=COALESCE(public.riders.total_deliveries,0)+1,updated_at=now();
    END IF;
    RETURN true;
  END IF;
  IF v_status = 'entregado' THEN
    IF v_acknowledged_at IS NULL THEN UPDATE public.orders SET acknowledged_at=now() WHERE id=p_order_id; END IF;
    RETURN true;
  END IF;
  RETURN false;
END;
$function$;

CREATE OR REPLACE FUNCTION public.submit_order_rating(p_order_id UUID, p_rating INTEGER)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_rider_id uuid; v_existing_rating integer; v_user_id uuid; v_order_user_id uuid; v_status text; v_new_rating numeric;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN RETURN json_build_object('ok',false,'error','calificacion_invalida'); END IF;
  v_user_id := auth.uid();
  SELECT assigned_rider_id,customer_rating,user_id,status INTO v_rider_id,v_existing_rating,v_order_user_id,v_status FROM public.orders WHERE id=p_order_id;
  IF v_status IS NULL THEN RETURN json_build_object('ok',false,'error','pedido_no_encontrado'); END IF;
  IF v_status <> 'entregado' THEN RETURN json_build_object('ok',false,'error','pedido_no_entregado'); END IF;
  IF v_order_user_id IS NOT NULL AND v_user_id IS DISTINCT FROM v_order_user_id THEN RETURN json_build_object('ok',false,'error','no_autorizado'); END IF;
  IF v_rider_id IS NULL THEN RETURN json_build_object('ok',false,'error','sin_domiciliario'); END IF;
  IF v_existing_rating IS NOT NULL THEN RETURN json_build_object('ok',false,'error','ya_calificado','rating',v_existing_rating); END IF;
  UPDATE public.orders SET customer_rating=p_rating WHERE id=p_order_id AND customer_rating IS NULL;
  IF NOT FOUND THEN SELECT customer_rating INTO v_existing_rating FROM public.orders WHERE id=p_order_id; RETURN json_build_object('ok',false,'error','ya_calificado','rating',v_existing_rating); END IF;
  SELECT ROUND(AVG(customer_rating)::numeric,2) INTO v_new_rating FROM public.orders WHERE assigned_rider_id=v_rider_id AND customer_rating IS NOT NULL;
  UPDATE public.riders SET rating=COALESCE(v_new_rating,rating),updated_at=now() WHERE id=v_rider_id;
  RETURN json_build_object('ok',true,'rating',p_rating,'rider_rating',v_new_rating);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.confirm_order_received(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_order_rating(UUID, INTEGER) TO anon, authenticated;
