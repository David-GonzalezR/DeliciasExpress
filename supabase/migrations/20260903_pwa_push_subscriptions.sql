-- ============================================================
-- MIGRACIÓN PWA: tabla push_subscriptions + RPC helpers
-- Ejecutar en: Supabase → SQL Editor
-- Proyecto: sjoytwcrdewealudjxep (DeliciasExpress)
-- ============================================================

-- 1. Crear tabla push_subscriptions
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
    id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id     UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    order_ids   TEXT[] DEFAULT '{}',
    endpoint    TEXT NOT NULL UNIQUE,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    role        TEXT DEFAULT 'cliente' CHECK (role IN ('cliente', 'admin', 'domiciliario')),
    user_agent  TEXT,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Índices para búsquedas frecuentes
CREATE INDEX IF NOT EXISTS idx_push_subs_user_id  ON public.push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_push_subs_role      ON public.push_subscriptions(role);
CREATE INDEX IF NOT EXISTS idx_push_subs_endpoint  ON public.push_subscriptions(endpoint);

-- 3. Row Level Security
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own subscriptions" ON public.push_subscriptions;
CREATE POLICY "Users manage own subscriptions"
    ON public.push_subscriptions
    FOR ALL
    USING  (user_id = auth.uid() OR user_id IS NULL)
    WITH CHECK (user_id = auth.uid() OR user_id IS NULL);

-- 4. Trigger para updated_at
CREATE OR REPLACE FUNCTION update_push_subscriptions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS push_subscriptions_updated_at ON public.push_subscriptions;
CREATE TRIGGER push_subscriptions_updated_at
    BEFORE UPDATE ON public.push_subscriptions
    FOR EACH ROW EXECUTE FUNCTION update_push_subscriptions_updated_at();

-- 5. Columna push_notified_admin en orders (si no existe)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'orders' AND column_name = 'push_notified_admin'
    ) THEN
        ALTER TABLE public.orders ADD COLUMN push_notified_admin BOOLEAN DEFAULT FALSE;
    END IF;
END $$;

-- 6. RPC para vincular un order_id anónimo a su suscripción push
CREATE OR REPLACE FUNCTION link_order_to_push_subscription(
    p_endpoint TEXT,
    p_order_id TEXT
)
RETURNS VOID AS $$
BEGIN
    UPDATE public.push_subscriptions
    SET order_ids = array_append(
        array_remove(order_ids, p_order_id),
        p_order_id
    )
    WHERE endpoint = p_endpoint;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================
-- FIN DE MIGRACIÓN
-- ============================================================
