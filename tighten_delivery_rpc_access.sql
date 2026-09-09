-- Endurece el acceso a RPC que solo deben usar usuarios autenticados.
REVOKE EXECUTE ON FUNCTION public.accept_delivery(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mark_delivered(UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.request_delivery(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.accept_delivery(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_delivered(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_delivery(UUID) TO authenticated;

-- Índices para las consultas que hace el panel de domiciliarios.
CREATE INDEX IF NOT EXISTS idx_orders_available_delivery
  ON public.orders (created_at DESC)
  WHERE status = 'buscando_domiciliario' AND assigned_rider_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_orders_assigned_rider_status
  ON public.orders (assigned_rider_id, status, created_at DESC);
