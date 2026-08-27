-- =============================================================
-- DIAGNÓSTICO: ¿Por qué el admin no ve pedidos entregados?
-- Ejecutar en SQL Editor de Supabase
-- =============================================================

-- 1. Verificar tu usuario actual y rol
SELECT 
  auth.uid() as tu_user_id,
  p.role as tu_rol,
  p.full_name,
  p.email,
  public.get_user_role() as funcion_get_user_role
FROM public.profiles p
WHERE p.id = auth.uid();

-- 2. Ver todas las políticas RLS en orders
SELECT 
  policyname,
  cmd,
  permissive,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public' AND tablename = 'orders'
ORDER BY policyname;

-- 3. Contar pedidos por estado (sin RLS - usando service role o bypass)
SELECT status, count(*) as total
FROM public.orders
GROUP BY status
ORDER BY status;

-- 4. Probar consulta como admin (simulando RLS)
-- Esto te dirá qué ve realmente el admin
SET ROLE authenticated;
SET request.jwt.claims = '{"role": "admin"}';
SELECT count(*) as pedidos_visibles_admin FROM public.orders;
RESET ROLE;

-- 5. Verificar si hay pedidos con status 'entregado'
SELECT id, status, user_id, created_at, delivered_at
FROM public.orders
WHERE status = 'entregado'
ORDER BY created_at DESC
LIMIT 10;

-- 6. Verificar orders con user_id NULL (pedidos anónimos)
SELECT status, count(*) as total
FROM public.orders
WHERE user_id IS NULL
GROUP BY status;