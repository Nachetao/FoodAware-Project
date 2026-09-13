# Flujo de datos entre frontend, NestJS, Python y PostgreSQL

Cuando alguien analiza un producto en la app, esto es lo que pasa detrás:

El formulario en Angular junta el nombre del producto y los ingredientes que escribió el usuario, y los manda por POST a `/api/food/analizar`.

Del lado del backend, NestJS primero valida esos datos con el DTO que armamos (`AnalizarProductoDto`) — si vienen vacíos o mal formados, corta ahí mismo con un 400 y ni siquiera llega a tocar la base de datos ni el servicio de Python.

Si todo viene bien, NestJS le pasa el nombre y los ingredientes al servicio de FastAPI por HTTP. Python revisa los ingredientes contra una lista de alérgenos conocidos y evalúa si el producto es saludable, y devuelve ese resultado como JSON.

NestJS toma esa respuesta, calcula si el producto es apto para consumo (viendo si hay alérgenos, y si se manda un `userId`, comparando además contra las alergias guardadas de ese usuario), y guarda todo en la tabla `foods` de PostgreSQL. Finalmente le devuelve el resultado completo al frontend, que lo muestra en una tarjeta verde o roja según si es apto o no para el usuario.

Si el servicio de Python está caído, NestJS no se queda esperando para siempre: responde con un error controlado y el frontend le muestra un mensaje claro al usuario en vez de trabarse.

También armamos endpoints de salud (`/api/health` en NestJS, `/health` en Python) para poder revisar rápido si algo se cayó — el de NestJS además chequea si logra hablar con la base de datos y con Python.