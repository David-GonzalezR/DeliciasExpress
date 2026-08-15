# Plan de Implementación: Panel de Administración de Productos

## Objetivo
Crear una interfaz dentro del panel de administración (`admin.html`) para que el dueño del negocio pueda realizar un CRUD (Crear, Leer, Actualizar, Eliminar) de los productos del catálogo, sincronizado directamente con la tabla `products` en Supabase.

---

## 🛠️ Arquitectura de la Solución (Para el modelo ejecutor)

### 1. HTML (`admin.html`)
Se debe transformar el diseño actual en un panel de control con barra lateral (Sidebar).
- **Sidebar de Navegación**: Crear un menú lateral con dos opciones: "Gestión de Pedidos" (activo por defecto) y "Gestión de Productos".
- **Contenedores de Vista**: Envolver el contenido actual de pedidos en un `<div id="pedidos-view">` y crear un nuevo `<div id="productos-view" style="display: none;">`.
- **Vista de Productos**:
  - Encabezado con título "Catálogo de Productos" y botón "+ Nuevo Producto".
  - Cuadrícula o Tabla para listar los productos (Imagen, Nombre, Categoría, Precio, Acciones).
- **Modal de Formulario**:
  - Crear un modal (`#product-modal`) para agregar/editar productos.
  - Campos requeridos: `name` (text), `description` (textarea), `price` (number), selector de archivo `image_file` (file input, `accept="image/*"`), `category` (select).
  - Agregar un contenedor de vista previa de imagen (`#product-image-preview`) para mostrar la foto actual del producto.

### 2. CSS (`admin.css`)
- Estilos para la estructura tipo *Dashboard* (Sidebar izquierdo fijo + Contenido principal a la derecha).
- Estilos para la tabla o grilla de productos (cards o listado tabular).
- Estilos para el modal de productos y botones de acción (Editar: Azul, Eliminar: Rojo).

### 3. JavaScript (`admin.js`)
- **Navegación**: Lógica para alternar entre las vistas (`pedidos-view` y `productos-view`) ocultando/mostrando los divs correspondientes.
- **CRUD de Supabase**:
  - `loadAdminProducts()`: Consulta a la tabla `products` y renderiza el listado.
  - `openProductModal(product)`: Abre el formulario. Muestra la vista previa si ya existe una foto guardada.
  - `saveProduct(event)`:
    1. Si el usuario seleccionó una imagen nueva, subir el archivo al storage:
       ```javascript
       const file = productImageInput.files[0];
       let imagePath = editingProductId ? currentProduct.image_path : null;
       if (file) {
           const fileExt = file.name.split('.').pop();
           const fileName = `${Date.now()}.${fileExt}`;
           const { error: uploadError } = await supabase.storage
               .from('product-images')
               .upload(fileName, file);
           if (uploadError) throw uploadError;
           imagePath = fileName;
       }
       ```
    2. Guardar el registro en la tabla `products` con el valor de `image_path`.
  - `deleteProduct(id)`: Lanza un `confirm()`, realiza el `delete` en la tabla y, opcionalmente, elimina la foto del storage si es necesario.

### 4. Configuración de Almacenamiento (Supabase Storage)
Se debe asegurar la creación del bucket `product-images` y sus políticas:
- **Bucket**: `product-images` (Público).
- **Políticas RLS en `storage.objects`**:
  ```sql
  -- Permitir lectura pública de imágenes
  CREATE POLICY "Acceso público de lectura" ON storage.objects
    FOR SELECT USING (bucket_id = 'product-images');

  -- Permitir a administradores subir y gestionar imágenes
  CREATE POLICY "Admins gestionan imágenes" ON storage.objects
    FOR ALL USING (
      bucket_id = 'product-images' 
      AND (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'admin'
    );
  ```

### 4. Pasos de Ejecución Recomendados
1. [ ] Modificar `admin.html` (Layout de Sidebar + Modal de productos).
2. [ ] Modificar `admin.css` (Estilos del nuevo layout y formularios).
3. [ ] Modificar `admin.js` (Funciones de navegación por pestañas).
4. [ ] Modificar `admin.js` (Implementar `loadAdminProducts()`, `saveProduct()`, `deleteProduct()`).

---

## 📖 Manual de Usuario: Gestión de Productos (Para el Administrador)

¡Bienvenido al Panel de Gestión de Productos! Aquí podrás actualizar tu catálogo en tiempo real sin necesidad de tocar código.

### ¿Cómo entrar a la gestión de productos?
1. Inicia sesión en el panel de administración usando tu cuenta de dueño (`admin`).
2. En el menú lateral izquierdo, haz clic en la pestaña **"Productos"** (justo debajo de "Pedidos").

### 1. Agregar un nuevo platillo
- Haz clic en el botón verde **"+ Nuevo Producto"** ubicado en la esquina superior derecha.
- Se abrirá un formulario emergente. Rellena la información:
  - **Nombre**: El título de tu platillo (ej. "Hamburguesa Doble").
  - **Descripción**: Ingredientes y detalles atractivos para el cliente.
  - **Precio**: El valor numérico sin puntos ni signos (ej. `15000`).
  - **Imagen**: Haz clic en el selector y sube una foto desde tu computadora o celular.
  - **Categoría**: Selecciona a qué sección de tu menú pertenece.
- Haz clic en **"Guardar Producto"**. ¡Aparecerá inmediatamente en la tienda de tus clientes con su respectiva foto!

### 2. Editar un producto existente
- En la lista de productos, busca el que quieres modificar o cambiar de precio.
- Haz clic en el botón azul de **"Editar"** (ícono de lápiz) situado a la derecha del producto.
- Modifica el precio, la descripción o sube una **nueva foto** si lo deseas, y dale a **"Guardar cambios"**.

### 3. Eliminar o quitar un producto
- Si ya no vendes un platillo, búscalo en la lista.
- Haz clic en el botón rojo de **"Eliminar"** (ícono de papelera).
- El sistema te preguntará si estás seguro. Si aceptas, el producto desaparecerá de tu catálogo y tus clientes ya no podrán pedirlo.

### 💡 Consejos importantes:
- **Cambios en tiempo real:** Todo lo que guardes aquí se reflejará al instante en tu página principal. Si un cliente está viendo el menú, el precio se actualizará mágicamente.
- **Formato de imágenes:** Sube imágenes claras, preferiblemente cuadradas y en formato `.jpg` o `.png` para que se vean perfectas en la web.
