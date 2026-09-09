# DeliciasExpress v7

## Correcciones de esta versión

### 1. Un domiciliario no puede aceptar varios pedidos activos
La función `accept_delivery` ahora verifica en la base de datos si el domiciliario ya tiene un pedido en `en_camino`. Además usa un bloqueo transaccional por domiciliario para evitar que dos clics/pestañas simultáneos permitan aceptar dos pedidos.

### 2. `buscando_domiciliario` ya no aparece como `en_camino` para el cliente
El cliente mantiene activo el paso `Preparando` mientras el admin está buscando domiciliario. El pedido pasa a `En camino` únicamente después de que un domiciliario lo acepta.

### 3. Importante
Esta versión NO modifica todavía las funciones de negocio que faltan (negocio abierto/cerrado, aviso de demora, upselling). Se implementarán una por una para no mezclar cambios ni perder funcionalidades.
