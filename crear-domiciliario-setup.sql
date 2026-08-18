-- =============================================================
-- SETUP: Permitir que los admins inserten/upserten perfiles
-- desde el frontend (para el flujo "Crear domiciliario").
-- Ejecutar UNA SOLA VEZ en el SQL Editor de Supabase.
-- =============================================================

-- Policy: admins pueden insertar perfiles nuevos (al crear un domiciliario)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'profiles'
      AND policyname = 'Admins insertan perfiles nuevos'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Admins insertan perfiles nuevos"
        ON public.profiles FOR INSERT
        WITH CHECK (public.get_user_role() = 'admin')
    $pol$;
  END IF;
END $$;

-- Verificar que la columna phone exista (por si acaso)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone TEXT;

-- Verificar que la columna full_name exista (por si acaso)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS full_name TEXT;
