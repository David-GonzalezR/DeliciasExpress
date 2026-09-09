-- FASE 1: Configuración de Supabase (SQL + Dashboard)

-- 1.1 Crear tabla profiles
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  role TEXT NOT NULL DEFAULT 'cliente' CHECK (role IN ('cliente', 'admin')),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_profiles_role ON public.profiles(role);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- 1.2 Trigger para crear perfil automáticamente al registrarse
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    'cliente'  -- Todo usuario nuevo es 'cliente' por defecto
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- 1.3 Función SQL para obtener el rol del usuario actual
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS TEXT AS $$
  SELECT role FROM public.profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- 1.4 Políticas RLS para profiles
CREATE POLICY "Usuarios leen su perfil"
  ON public.profiles FOR SELECT
  USING (id = auth.uid());

CREATE POLICY "Usuarios actualizan su perfil"
  ON public.profiles FOR UPDATE
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid() AND role = (SELECT role FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY "Admins leen todos los perfiles"
  ON public.profiles FOR SELECT
  USING (public.get_user_role() = 'admin');

-- 1.5 Modificar tabla orders para vincular al usuario
ALTER TABLE public.orders ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id);

ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clientes crean sus pedidos"
  ON public.orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Clientes ven sus pedidos"
  ON public.orders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins ven todos los pedidos"
  ON public.orders FOR SELECT
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Admins actualizan pedidos"
  ON public.orders FOR UPDATE
  USING (public.get_user_role() = 'admin');

CREATE POLICY "Inserción anónima de pedidos"
  ON public.orders FOR INSERT
  WITH CHECK (user_id IS NULL AND auth.uid() IS NULL);

-- 1.6 RLS para products
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Lectura pública de productos"
  ON public.products FOR SELECT
  USING (true);

CREATE POLICY "Admins gestionan productos"
  ON public.products FOR ALL
  USING (public.get_user_role() = 'admin')
  WITH CHECK (public.get_user_role() = 'admin');
