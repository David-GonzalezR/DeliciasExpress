-- =============================================================
-- DIAGNÓSTICO Y CORRECCIÓN: Domiciliario sin rol asignado
-- Ejecutar en el SQL Editor de Supabase
-- Proyecto: sjoytwcrdewealudjxep
-- =============================================================

-- PASO 1: Ver todos los usuarios con correo que contenga "maria"
--         para identificar cuál es el perfil problemático
SELECT 
    p.id,
    p.email,
    p.full_name,
    p.role,
    r.is_available,
    r.vehicle_type
FROM public.profiles p
LEFT JOIN public.riders r ON r.id = p.id
WHERE 
    p.email ILIKE '%maria%'
    OR p.full_name ILIKE '%maria%';

-- =============================================================
-- PASO 2: Si encuentras el usuario de "maria" en el resultado,
--         reemplaza 'CORREO_DE_MARIA@ejemplo.com' con su correo real
--         y ejecuta el bloque siguiente:
-- =============================================================

DO $$
DECLARE
    v_user_id UUID;
BEGIN
    -- Busca el perfil de maria por correo (cambia el correo aquí)
    SELECT id INTO v_user_id
    FROM public.profiles
    WHERE email ILIKE '%maria%'  -- ajusta si es necesario
    LIMIT 1;

    IF v_user_id IS NULL THEN
        RAISE NOTICE 'No se encontró el perfil. Verifica el correo.';
        RETURN;
    END IF;

    -- 1. Asignar rol domiciliario en profiles
    UPDATE public.profiles
    SET role = 'domiciliario'
    WHERE id = v_user_id;

    RAISE NOTICE 'Rol domiciliario asignado al perfil: %', v_user_id;

    -- 2. Crear/asegurar fila en riders
    INSERT INTO public.riders (id, is_available)
    VALUES (v_user_id, false)
    ON CONFLICT (id) DO NOTHING;

    RAISE NOTICE 'Fila en riders asegurada para: %', v_user_id;
END;
$$;

-- PASO 3: Verificar el resultado final
SELECT 
    p.id,
    p.email,
    p.full_name,
    p.role,
    r.is_available
FROM public.profiles p
LEFT JOIN public.riders r ON r.id = p.id
WHERE 
    p.email ILIKE '%maria%'
    OR p.full_name ILIKE '%maria%';
