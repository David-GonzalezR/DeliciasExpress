-- =============================================================
-- BORRAR TODO EL HISTORIAL DE PEDIDOS
-- Ejecutar en SQL Editor de Supabase
-- =============================================================

-- Primero borrar order_items (tabla hija)
TRUNCATE TABLE public.order_items CASCADE;

-- Luego borrar orders (tabla padre)
TRUNCATE TABLE public.orders CASCADE;

-- Verificar que estén vacías
SELECT 'orders' as tabla, count(*) as registros FROM public.orders
UNION ALL
SELECT 'order_items' as tabla, count(*) as registros FROM public.order_items;