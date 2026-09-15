-- ================================================================
-- TRIGGER PARA INVOCAR EDGE FUNCTION send-push-notification
-- Usa Supabase Vault (almacenamiento encriptado de secretos) y pg_net
-- ================================================================

-- 1. Habilitar extensiones necesarias
CREATE EXTENSION IF NOT EXISTS pg_net;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- 2. Guardar o actualizar la clave en el Vault de Supabase
-- REEMPLAZA 'TU_SECRET_KEY_AQUI' POR TU CLAVE REAL (sb_secret_... o eyJ...)
DO $$
BEGIN
  -- Eliminar secreto anterior si existía para evitar duplicados
  DELETE FROM vault.secrets WHERE name = 'push_service_role_key';
  
  -- Crear el secreto seguro en el Vault
  PERFORM vault.create_secret(
    'TU_SECRET_KEY_AQUI', 
    'push_service_role_key',
    'Service role / Secret key para disparar push notifications'
  );
END $$;

-- 3. Crear función trigger que invoca la Edge Function via HTTP
CREATE OR REPLACE FUNCTION public.notify_order_change()
RETURNS TRIGGER AS $$
DECLARE
  v_payload JSON;
  v_url TEXT := 'https://sjoytwcrdewealudjxep.supabase.co/functions/v1/send-push-notification';
  v_service_role_key TEXT;
BEGIN
  -- Obtener la clave desencriptada directamente desde Supabase Vault
  SELECT decrypted_secret INTO v_service_role_key 
  FROM vault.decrypted_secrets 
  WHERE name = 'push_service_role_key' 
  LIMIT 1;

  IF v_service_role_key IS NULL OR v_service_role_key = '' THEN
    RAISE NOTICE 'push_service_role_key no configurada en vault.decrypted_secrets';
    RETURN NEW;
  END IF;

  -- Solo procesar INSERT y UPDATE relevantes
  IF TG_OP = 'INSERT' THEN
    v_payload := json_build_object(
      'type', 'INSERT',
      'record', to_jsonb(NEW),
      'old_record', NULL
    );
  ELSIF TG_OP = 'UPDATE' THEN
    -- Solo notificar si cambió el status, assigned_rider_id o delivered_at
    IF NEW.status IS DISTINCT FROM OLD.status
       OR NEW.assigned_rider_id IS DISTINCT FROM OLD.assigned_rider_id
       OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
      v_payload := json_build_object(
        'type', 'UPDATE',
        'record', to_jsonb(NEW),
        'old_record', to_jsonb(OLD)
      );
    ELSE
      RETURN NEW; -- No cambió nada relevante
    END IF;
  ELSE
    RETURN NEW;
  END IF;

  -- Invocación HTTP asíncrona mediante pg_net
  BEGIN
    PERFORM net.http_post(
      url := v_url,
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_service_role_key
      ),
      body := v_payload,
      timeout_milliseconds => 5000
    );
  EXCEPTION WHEN OTHERS THEN
    -- Log error pero no fallar la transacción principal del pedido
    RAISE NOTICE 'Error invocando send-push-notification: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Recrear el trigger en la tabla orders
DROP TRIGGER IF EXISTS trigger_notify_order_change ON public.orders;
CREATE TRIGGER trigger_notify_order_change
  AFTER INSERT OR UPDATE ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION public.notify_order_change();