# Frontend (Angular + Ionic)

Interfaz de FoodAware. Permite buscar productos reales de Open Food Facts, ver su detalle con alérgenos y procedencia, consultar las métricas del sistema y, con sesión iniciada, saber si cada producto es apto según el perfil del usuario (alergias, dietas y modo estricto). Funciona como sitio web, como PWA instalable y como app de Android.

- **Stack:** Angular 22 (NgModules, sin zone.js, signals), Ionic 9, Capacitor 8.
- **Puerto local:** 4200 (`npm start`).
- **Comunicación:** solo con el backend NestJS (nunca directamente con FastAPI).

## Páginas

| Ruta | Página | Descripción |
|---|---|---|
| `/home` | Inicio | Presentación, buscador y análisis manual de un producto (heredado de la EP1). Botón "Instalar FoodAware" si el navegador lo permite |
| `/busqueda` | Búsqueda | Buscador con lista de resultados (imagen, nombre, marca, veredicto y alérgenos), paginación con "Cargar más". Con sesión, interruptor "Personalizar según mi perfil" (ver abajo) |
| `/producto/:codigo` | Detalle | Imagen, Nutri-Score, alérgenos, trazas, dieta, ingredientes, explicación de los alérgenos, procedencia y atribución. Con sesión: veredicto, confianza y aviso orientativo |
| `/metricas` | Métricas | Calidad de los datos, evaluación de la búsqueda (Precision@K, Recall@K) y última ingesta |
| `/login`, `/registro` | Cuenta | Inicio de sesión y registro con selección de alergias |
| `/perfil` | Perfil (protegida) | Edición de nombre, alergias, dietas y modo estricto; cerrar sesión y borrar la cuenta |
| `/admin` | Administración (solo administradores) | Lista de usuarios (nombre, correo y rol) y alimentos analizados a mano |

### Búsqueda personalizada

Con sesión aparece el interruptor **"Personalizar según mi perfil"** y, activado, un selector: **"Ocultar no aptos"** (modo `filtrar`) o **"Mostrar al final"** (modo `reordenar`). Las dos elecciones se recuerdan entre visitas (`localStorage`, clave `foodaware.busqueda`, con `try/catch`). Sin sesión, la página invita a iniciar sesión para personalizar.

Con la búsqueda personalizada, cada resultado muestra un chip de veredicto ("Apto", "Con advertencia" o "No apto", con ícono y texto, no solo color) y la página agrega:

- Cómo se interpretó la consulta (por ejemplo, "sin leche") y qué restricciones no se reconocieron.
- Cuántos productos se ocultaron o pasaron al final, y por qué.
- El aviso orientativo.

Si el motor adaptativo no responde, se avisa: "El servicio de evaluación no está disponible: revisión básica con productos guardados anteriormente."

La interfaz **ya no tiene** el interruptor "Solo aptos para mí" ni usa `GET /api/products/compatibles`; ese endpoint sigue disponible en el backend ([backend.md](backend.md#motor-adaptativo)).

## Roles y administración

- `AuthService` expone `rol` y `esAdmin` (signals), a partir del perfil que devuelve el backend. Hay dos roles, `usuario` y `administrador`; el administrador se asigna con un script del backend ([backend.md](backend.md#roles)), no desde la interfaz.
- `adminGuard` protege `/admin`: sin sesión redirige a `/login?volver=/admin`; con sesión de usuario, a `/home`.
- La barra superior muestra el botón "Administración" solo a los administradores.
- El guard es solo comodidad: la seguridad está en el backend, que responde 403 a `GET /api/usuarios` y `GET /api/food` si el rol no es administrador.
- La lista de usuarios no incluye alergias ni dietas.

## Perfil

`/perfil` edita una copia local y envía los cambios con **Guardar cambios** (`PATCH /api/usuarios/me`), que solo se habilita si hay cambios y el nombre no está vacío:

- **Nombre.**
- **Mis alergias** y **Mis dietas**: chips seleccionables.
- **Modo estricto:** las trazas, los posibles alérgenos y los productos con pocos datos se marcan como no aptos en vez de con advertencia.
- **Borrar mi cuenta:** pide confirmación (no se puede deshacer), borra la cuenta con `DELETE /api/usuarios/me` y cierra la sesión.

El registro pide nombre, correo, contraseña (mínimo 8 caracteres) y alergias; las dietas y el modo estricto se configuran después en el perfil.

## Servicios

| Servicio | Endpoints del backend |
|---|---|
| `ProductsService` | `/api/products/search`, `/api/products/search/personalizada`, `/api/products/:codigo_barras`, `/api/products/:codigo_barras/compatibilidad` |
| `MetricasService` | `/api/metricas/calidad`, `/api/metricas/evaluacion`, `/api/ingesta/ultima` |
| `AuthService` | `/api/auth/login`, `/api/users`, `/api/usuarios/me` (GET, PATCH y DELETE) |
| `AdminService` | `/api/usuarios`, `/api/food` (solo administradores) |

Los modelos están tipados según el contrato (`docs/contratos/`), sin `any`.

## Manejo de errores y estados

- Todo error HTTP se convierte en un `ErrorApi` (`status`, `codigo`, `mensaje`, `requestId`): con el mensaje del contrato si viene, "No hay conexión a internet." si el dispositivo está sin conexión, "No se pudo conectar con el servidor." si no hay respuesta, o un mensaje genérico en otros casos. Las páginas solo muestran `mensaje`.
- **Límite de peticiones:** un 429 del backend (login, registro, análisis o detalle de producto) muestra siempre "Demasiados intentos, espera un minuto.", venga en el formato de NestJS o en el del contrato. El registro exige una contraseña de al menos 8 caracteres (el botón queda deshabilitado y se indica el mínimo), igual que el backend; el login no exige largo mínimo, para que las cuentas anteriores sigan entrando.
- Cada página tiene estados de **carga**, **sin resultados** y **error** (con reintento en el detalle).
- **Aviso de respaldo:** si el backend responde con `X-Fuente-Datos: respaldo`, se muestra "El servicio de búsqueda no está disponible; mostrando productos guardados anteriormente." En el detalle, con sesión, el veredicto de respaldo lleva además "Revisión básica: el servicio de evaluación no estaba disponible."
- **Servidor dormido:** si la búsqueda tarda más de 5 s (por ejemplo, en el plan gratuito de Render), aparece "Despertando el servidor…".
- En el panel de métricas, cada tarjeta carga y falla por separado; sin ingestas muestra un aviso en vez de un error.

## Sesión

- `AuthService` guarda el token en `localStorage` (con `try/catch`) y expone `autenticado`, `usuario` y `esAdmin` como signals.
- Un interceptor funcional agrega `Authorization: Bearer` **solo** a las peticiones al backend; ante un 401 con token, cierra la sesión. Esto incluye el caso en que el backend rechaza el token porque la cuenta se borró o cambió de rol.
- `authGuard` protege `/perfil` y redirige a `/login?volver=<ruta>` (solo rutas internas).
- Sin sesión, la aplicación funciona completa, salvo el perfil y el veredicto personalizado.

## Veredicto, confianza y aviso

El detalle del producto, con sesión, muestra lo que devuelve el motor adaptativo ([capacidad-adaptativa.md](capacidad-adaptativa.md)):

- **Franja de veredicto:** "Apto para ti" (verde), "Apto con advertencia" o "No apto para ti" (rojo), cada una con su ícono, su título y la explicación en español.
- **Confianza** (alta, media o baja) con puntos y una frase: "Datos completos y declarados por la fuente.", "Parte de la información está incompleta o se dedujo del texto." o "Faltan datos o es una revisión básica: revisa la etiqueta."
- **Aviso permanente:** "Clasificación orientativa según tu perfil y los datos de Open Food Facts. No es una garantía de que el producto sea seguro para ti: revisa siempre la etiqueta del envase."

## Navegación

La barra superior (`app-barra-superior`) es la misma en todas las páginas: título, botón "Volver" opcional y las acciones, con `aria-current="page"` en la activa.

| Acción | Cuándo se ve |
|---|---|
| Buscar (`/busqueda`) y Métricas (`/metricas`) | Siempre |
| Administración (`/admin`) | Solo administradores |
| Perfil (`/perfil`) | Con sesión |
| Ingresar (`/login`) | Sin sesión |

`/home` es la ruta de inicio. `/perfil` exige sesión y `/admin` exige el rol de administrador (ver arriba). La tabla de rutas está en [`app-routing.module.ts`](../frontend/src/app/app-routing.module.ts) y la prueba `navegacion.spec.ts` la recorre.

## Atribución y procedencia

El detalle de cada producto muestra la fecha de recuperación, un enlace a la ficha original y la atribución exigida por la licencia de los datos:

> Datos de Open Food Facts (openfoodfacts.org), disponibles bajo la licencia Open Database License (ODbL).

## Tema visual

- Paleta propia en las variables de Ionic: fondo crema, verde bosque como color principal, lima solo para el botón principal, ámbar para los alérgenos y rojo para los errores, con contraste AA verificado.
- **Chips de alérgenos neutros y del perfil** (`app-chips-alergenos`, en la búsqueda y el detalle): sin sesión, todos los alérgenos y trazas van en **neutro** (texto casi negro y borde gris, contraste AA) después de "Contiene:". Con sesión, solo los que están en las alergias del perfil van en **ámbar**, primero, con ícono de advertencia y el texto "(en tus alergias)" para lectores de pantalla, así no dependen solo del color; los demás siguen en neutro. Las trazas conservan el borde discontinuo.
- Fuente Inter empaquetada (`@fontsource-variable/inter`), disponible sin conexión.
- Solo tema claro. `index.html` con `lang="es"` y `translate="no"` para evitar que el navegador traduzca la app y rompa los componentes de Ionic.

## Accesibilidad y diseño adaptable

- **Teclado y foco:** contorno verde de 3 px (9,6:1 sobre crema) en enlaces, botones y controles de Ionic, también en las opciones de alergias y dietas, que son botones nativos.
- **Áreas táctiles** de al menos 44 px en el contenido (botones, interruptores, segmentos, opciones y la "x" del buscador). En pantallas de hasta 480 px, la barra superior usa botones de 36 × 48 px para que el título no se corte, por encima del mínimo de 24 px de WCAG 2.2 AA.
- **Lectores de pantalla:** un `h1` por página (oculto visualmente si no hay título visible), `aria-label` en los controles de solo ícono, regiones `role="status"` para el aviso de respaldo, el aviso sin conexión y el estado de carga, y `role="alert"` en los errores.
- **No depende del color:** cada veredicto lleva ícono y título; los alérgenos del perfil, ícono y texto.
- **Movimiento reducido:** con `prefers-reduced-motion`, sin transiciones propias y con las animaciones de Ionic desactivadas.
- **Diseño adaptable:** el contenido va en una columna de hasta 640 px, centrada, y se ajusta desde teléfonos hasta escritorio. Respeta las áreas seguras del dispositivo.

## PWA

La app se puede instalar y sigue abriendo sin conexión. El service worker de Angular solo se activa en el build de producción y fuera de la app de Android ([`ngsw-config.json`](../frontend/ngsw-config.json), [`app.module.ts`](../frontend/src/app/app.module.ts)).

- **Qué guarda:** la propia app (código, estilos, fuente e íconos) y **solo datos públicos del backend**: la búsqueda (`/api/products/search?`), el detalle (`/api/products/<código>`) y las métricas (`/api/metricas/`, `/api/ingesta/ultima`). Con estrategia *freshness*: va primero a la red (8 s) y usa la copia guardada si falla. Las copias duran 7 días (catálogo, hasta 100 respuestas) o 1 día (métricas).
- **Qué nunca guarda:** nada personal. Ni `/api/usuarios`, ni el login, ni el registro, ni la búsqueda personalizada, `/compatibilidad` o `/compatibles`, ni `/api/food` ni `/api/health`. [`ngsw-config.spec.ts`](../frontend/src/app/pwa/ngsw-config.spec.ts) usa el mismo `Generator` que el worker y falla si un patrón deja entrar una de esas URL, tanto con la API en otro origen (staging) como en el mismo (`pwa:local`).
- **Aviso sin conexión:** mientras no hay conexión aparece una franja debajo de la app: "Puedes ver las páginas y los resultados que ya visitaste; para buscar algo nuevo, iniciar sesión o ver el veredicto para tu perfil necesitas internet." Con el dispositivo sin conexión, los errores dicen "No hay conexión a internet."
- **Instalar:** si el navegador lo permite (Chrome, Edge, Android), el inicio muestra "Instalar FoodAware". No aparece en Safari, si la app ya está instalada ni en la app de Android. El [`manifest.webmanifest`](../frontend/src/manifest.webmanifest) define nombre, íconos (incluidos los maskable) y colores.
- **Probarla en local:** el service worker no se registra con `npm start`. Para verla como se publica:

  ```bash
  cd frontend
  npm run pwa:local                     # compila en producción y sirve en http://localhost:8080
  npm run pwa:local -- --sin-compilar   # sirve el www/ que ya existe
  ```

  Sirve la app y reenvía `/api` y `/docs` al backend local (`BACKEND_URL`, por defecto `http://localhost:3000`; `PUERTO`, por defecto 8080), todo en un solo origen y sin CORS.

## App de Android

La misma app web se empaqueta con Capacitor ([`capacitor.config.ts`](../frontend/capacitor.config.ts): `appId` `cl.foodaware.app`, esquema `https`, sin contenido mixto). El service worker no se registra en la app: no lo necesita y evita mezclar cachés.

```bash
cd frontend
npm run android:sync   # build de producción contra staging y copia la app a frontend/android/
npm run android:apk    # lo anterior y compila el APK de depuración (android/app/build/outputs/apk/debug/app-debug.apk)
```

- Por defecto apunta al backend de **staging**; `API_URL` lo cambia.
- `android:apk` necesita `JAVA_HOME` (JDK 21) y `ANDROID_HOME` (SDK de Android) o `android/local.properties`. El APK queda firmado con la clave de depuración local.
- **CORS:** la app tiene el origen `https://localhost`, que **ya está en `CORS_ORIGINS` de staging**. Si se despliega otro backend, hay que agregarlo.
- **Estado de la prueba:** la app se probó en un emulador de Android contra staging ([capturas](#android)). No se probó en un dispositivo físico, y el APK es de depuración, no de publicación.

## Configuración y build

La URL del backend se define **al compilar** con la variable `API_URL` (por defecto `http://localhost:3000`). El script `scripts/generar-api-url.js` genera `src/environments/api-url.ts` (ignorado por git) antes de `start`, `build`, `test` y `watch`.

```bash
cd frontend
npm ci
API_URL=https://<backend>.onrender.com npm run build   # salida en frontend/www/
```

## Pruebas

```bash
cd frontend
npm test -- --configuration ci
npm run test:scripts
```

| Suite | Cantidad | Qué cubre |
|---|---|---|
| `npm test` (Vitest) | 378 (23 archivos) | Servicios, interceptor, guards (sesión y administrador), formato, veredicto y confianza, chips de alérgenos, la configuración del service worker, el aviso sin conexión, la instalación, la tabla de navegación y las páginas: búsqueda (normal y personalizada), detalle, métricas, login, registro, perfil y administración |
| `npm run test:scripts` (`node --test`) | 6 | El servidor de `pwa:local` (qué rutas va al backend y cuáles no) y `index.html` |

Cifras del 20 de noviembre de 2026. Las dos corren sin el backend.

## Ejecución local

Con el backend corriendo en `localhost:3000`:

```bash
cd frontend
npm start   # http://localhost:4200
```

## Evidencia

Las capturas web se tomaron en el escritorio y las de Android, en un emulador contra staging. Los correos de otras personas están pixelados.

### Web

| Captura | Muestra |
|---|---|
| [respaldo-chocolate.png](evidencia/respaldo-chocolate.png) | Aviso de respaldo con resultados desde la base |
| [busqueda.png](evidencia/busqueda.png) | Búsqueda "Leche" sin sesión: 197 resultados, alérgenos en neutro e invitación a iniciar sesión para personalizar |
| [busqueda-personalizada.png](evidencia/busqueda-personalizada.png) | Búsqueda "Chocolate" con "Personalizar según mi perfil" y "Ocultar no aptos": 23 resultados con chip "Apto", resumen de los 84 ocultos (75 por lácteos y 49 por gluten) y aviso orientativo |
| [chips-alergenos.png](evidencia/chips-alergenos.png) | "Chocolate" con la personalización apagada: con sesión, solo lácteos y gluten (las alergias del perfil) van en ámbar con ícono de advertencia, y los demás alérgenos en neutro |
| [detalle-producto.png](evidencia/detalle-producto.png) | Detalle con alérgenos, procedencia y atribución ODbL |
| [producto.png](evidencia/producto.png) | Detalle sin sesión: sin veredicto, con la invitación "Inicia sesión para saber si es apto para ti" y el alérgeno en neutro |
| [apto-para-ti.png](evidencia/apto-para-ti.png) | Franja "Apto para ti" con sesión iniciada |
| [no-apto.png](evidencia/no-apto.png) | Franja "No apto para ti: Contiene lácteos, que está en tu perfil", con "Confianza alta" y el aviso orientativo |
| [perfil.png](evidencia/perfil.png) | Perfil: nombre, alergias (lácteos y gluten marcadas), dietas, modo estricto, guardar cambios, cerrar sesión y borrar la cuenta |
| [admin.png](evidencia/admin.png) | Panel de administración: usuarios (nombre, correo y rol, sin alergias) y alimentos analizados |
| [panel-metricas.png](evidencia/panel-metricas.png) | Panel de métricas con el botón de administración visible: Precision@5 = 53 %, Recall@5 = 48,2 %, 20 consultas y 385 productos (ver [recuperacion-y-evaluacion.md](recuperacion-y-evaluacion.md)) |
| [limite-login.png](evidencia/limite-login.png) | Login tras superar el límite de peticiones: "Demasiados intentos, espera un minuto." |

### PWA

| Captura | Muestra |
|---|---|
| [pwa-instalada.png](evidencia/pwa-instalada.png) | La app instalada, en su propia ventana, con sesión de administrador |
| [pwa-sin-conexion.png](evidencia/pwa-sin-conexion.png) | Sin conexión: la búsqueda "Leche" ya visitada se sigue viendo desde la caché y aparece el aviso "Sin conexión" |
| [pwa-sin-conexion-busqueda-nueva.png](evidencia/pwa-sin-conexion-busqueda-nueva.png) | Sin conexión, una búsqueda que no se había hecho ("chocolate"): "No hay conexión a internet." |

### Android

| Captura | Muestra |
|---|---|
| [android-home.png](evidencia/android-home.png) | Inicio sin sesión, con "Inicia sesión para personalizar" |
| [android-registro.png](evidencia/android-registro.png) | Registro: contraseña de mínimo 8 caracteres y selección de alergias |
| [android-busqueda-personalizada.png](evidencia/android-busqueda-personalizada.png) | Búsqueda personalizada con "Ocultar no aptos": 10 resultados con chip "Apto" y 97 ocultos por soya, lácteos y maní |
| [android-con-advertencia.png](evidencia/android-con-advertencia.png) | Resultados con chip "Con advertencia" (borde discontinuo) junto a otros "Apto" |
| [android-no-apto.png](evidencia/android-no-apto.png) | Detalle con "No apto para ti", confianza alta, aviso orientativo y el alérgeno del perfil en ámbar |
| [android-admin.png](evidencia/android-admin.png) | Panel de administración en el celular |

## Limitaciones

- La app usa `IonicModule`, que Ionic 9 marca como obsoleto; la migración a `provideIonicAngular()` queda pendiente.
- En desarrollo (`npm start`), después de cambiar de rama o instalar dependencias, el navegador puede mezclar módulos en caché y dejar la página en blanco. Se resuelve borrando `frontend/.angular/cache` y la caché del navegador, o usando una ventana privada. No afecta al build de producción.
- `npm audit` reporta vulnerabilidades altas heredadas de Angular 22.0.1, que se corrigen subiendo a 22.2.3.
- Sin conexión no se puede buscar algo nuevo ni ver el veredicto: lo personal nunca se guarda en el dispositivo.
- La instalación como PWA no está disponible en Safari (no existe `beforeinstallprompt`).
- La app de Android es un APK de depuración, probado en emulador; no está publicada en una tienda.
- El administrador no puede gestionar usuarios desde la interfaz: solo los ve.
