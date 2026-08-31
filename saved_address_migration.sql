-- Migración 1.1: Agregar columnas de dirección guardada a profiles
-- Ejecutar en Supabase SQL Editor

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS saved_address text,
  ADD COLUMN IF NOT EXISTS saved_lat double precision,
  ADD COLUMN IF NOT EXISTS saved_lng double precision;

-- Comentario para documentación
COMMENT ON COLUMN public.profiles.saved_address IS 'Dirección de entrega guardada por el usuario para checkout rápido';
COMMENT ON COLUMN public.profiles.saved_lat IS 'Latitud guardada de la dirección de entrega';
COMMENT ON COLUMN public.profiles.saved_lng IS 'Longitud guardada de la dirección de entrega';

-- Política RLS: usuarios pueden actualizar su propia dirección guardada
-- (Asumiendo que ya existe política de UPDATE para el propio usuario en profiles)
-- Si no existe, descomenta lo siguiente:
-- CREATE POLICY "Users can update own saved address" ON public.profiles
--   FOR UPDATE USING (auth.uid() = id)
--   WITH CHECK (auth.uid() = id);