# Capacidad adaptativa: clasificador de compatibilidad alimentaria

> **Estado:** implementada en la Entrega Final. El motor vive en FastAPI (contrato en [contratos/README.md](contratos/README.md#capacidad-adaptativa)); este documento describe cómo la usan el backend y el frontend. Los resultados de su evaluación están en [recuperacion-y-evaluacion.md](recuperacion-y-evaluacion.md#8-evaluación-de-la-capacidad-adaptativa), y los límites en [limitaciones.md](limitaciones.md).

## 1. Qué parte del sistema se adapta

Dos partes del sistema cambian según el perfil de cada usuario:

- **Los resultados de búsqueda**: qué productos se muestran y en qué orden. Un usuario alérgico a los lácteos no debería tener que revisar uno por uno los productos que lo contienen.
- **El detalle del producto**: el sistema entrega un veredicto personalizado ("Apto para ti", "Apto con advertencia" o "No apto para ti") con su explicación, su confianza y un aviso orientativo.

## 2. Usuario beneficiado

- Personas con **alergias o intolerancias alimentarias**, para quienes consumir un alérgeno no declarado es un riesgo de salud.
- Personas con **dietas específicas** (vegana, vegetariana, sin gluten, sin lactosa).
- En general, cualquier consumidor que necesite interpretar etiquetas con nombres técnicos o alérgenos ocultos.

## 3. Información recuperada desde la Web que se utiliza

Los datos provienen de **Open Food Facts**, obtenidos y preparados por el servicio FastAPI (ver `docs/fuente-web.md`) y guardados en la tabla `products` del backend:

| Campo | Uso en la adaptación |
|---|---|
| `alergenos` | Alérgenos declarados por la fuente **más** los detectados en el texto de ingredientes. Es la base de la decisión apto / no apto |
| `trazas` | Alérgenos que el producto "puede contener". Generan advertencia (o "no apto" en modo estricto) |
| `ingredientes`, `ingredientes_texto` | Permiten detectar alérgenos no declarados y mostrar la composición |
| `etiquetas_dieta` | Compatibilidad con dietas (vegano, vegetariano, sin gluten, sin lactosa) |
| `calidad.problemas` | Explica al usuario **por qué** se marcó un alérgeno (por ejemplo, `alergeno_detectado_en_texto:lacteos`) |
| `calidad.es_valido`, `calidad.completitud` | Indican si hay datos suficientes para emitir un veredicto confiable |
| `procedencia` | Fuente, URL y fecha de recuperación, para que el usuario pueda verificar el dato |

## 4. Variables de usuario y de contexto

**Del usuario (el perfil):**
- **Alergias**: los 14 códigos de alérgenos del contrato (`lacteos`, `gluten`, `huevo`, `mani`, `frutos_secos`, `soya`, `pescado`, `crustaceos`, `moluscos`, `sesamo`, `mostaza`, `apio`, `sulfitos`, `altramuces`), en `users.alergias`.
- **Dietas** (`DietLabel`: vegana, vegetariana, sin gluten, sin lactosa), en `users.dietas`.
- **Modo estricto**, en `users.modo_estricto`: las trazas, los posibles alérgenos (indicios) y los productos con datos insuficientes hacen el producto **no apto** en vez de apto con advertencia.

**De la consulta:** las restricciones que el motor entiende en el texto de la búsqueda ("chocolate **sin leche**", "galletas **sin gluten**"). Se suman al perfil solo para esa búsqueda y no se guardan.

**Del contexto:**
- Qué tan completos son los datos del producto (completitud, ingredientes, alérgenos reconocidos).
- Si la respuesta viene del motor o del respaldo local (`X-Fuente-Datos`, `estado_fuente`).

**Fuera del alcance:** el historial de productos consultados o descartados no se implementó.

## 5. Decisión que toma el sistema

Para cada par (producto, perfil), el motor decide:

1. **No apto**: el producto contiene un alérgeno del perfil. En modo estricto, también si tiene trazas o indicios de uno, o si los datos no alcanzan para decidir.
2. **Apto con advertencia**: no contiene alérgenos del perfil, pero sí **trazas** de alguno, un indicio, una dieta del perfil que no declara cumplir, o datos incompletos que no permiten confirmar.
3. **Apto**: no contiene alérgenos ni trazas del perfil, cumple (declara) las dietas y los datos son suficientes.

Los datos son **insuficientes** si el producto no tiene ingredientes, trae alérgenos no reconocidos o su completitud es menor que 0,5.

Cada veredicto trae:

- **Conflictos**, cada uno con su tipo (`alergeno`, `traza`, `posible`, `dieta`) y su **origen**: `fuente` (lo declara Open Food Facts), `texto` (solo se detectó en los ingredientes) o `indicio` (alérgeno posible).
- **Confianza** `alta`, `media` o `baja`, con sus motivos (`completitud_media`, `completitud_baja`, `sin_ingredientes`, `alergenos_no_reconocidos`, `conflicto_solo_en_texto`, `indicio_sin_confirmar`).
- **Explicación** en español, lista para mostrar, y el **aviso** permanente de que la clasificación es orientativa.

Además, en la búsqueda decide **qué productos mostrar y en qué orden**: primero los aptos, después los aptos con advertencia y al final los no aptos, que en el modo `filtrar` se ocultan (`reordenar` los deja al final). En los dos casos informa cuántos no aptos hay y por qué.

## 6. Resultado visible para el usuario

Con sesión iniciada:

- En el **detalle del producto**: una franja con el veredicto ("Apto para ti", "Apto con advertencia" o "No apto para ti"), cada una con su ícono y su título, la explicación del motor, la **confianza** (alta, media o baja, con puntos y una frase) y el aviso orientativo. Si el motor no respondió, se indica "Revisión básica: el servicio de evaluación no estaba disponible."
- En la **búsqueda**: el interruptor **"Personalizar según mi perfil"**, con el selector **"Ocultar no aptos"** o **"Mostrar al final"**. Cada resultado lleva un chip de veredicto, y la página muestra cómo se interpretó la consulta, qué restricciones no se reconocieron y cuántos no aptos se ocultaron y por qué.
- Los **alérgenos que están en las alergias del perfil** van destacados en ámbar, con ícono y texto para lectores de pantalla; los demás, en neutro.
- La sección **"Por qué se marcaron estos alérgenos"**, que traduce los códigos de `calidad.problemas` a texto legible y distingue los alérgenos declarados por Open Food Facts de los detectados en el texto.
- El perfil (alergias, dietas y modo estricto) se edita en `/perfil`.

Sin sesión, la aplicación funciona igual que antes, sin veredicto personalizado y con los alérgenos en neutro.

## 7. Mecanismo

Es un mecanismo de **reglas deterministas**, priorizando la seguridad, con la detección de alérgenos en el texto de los ingredientes como entrada.

**a) Dónde se decide.** El motor es FastAPI (`POST /products/{codigo}/compatibility` y `POST /search/personalized`). No guarda estado y no conoce al usuario: recibe un **perfil sin identidad**, solo `alergias`, `dietas` y `modo_estricto`.

```
Frontend ──► NestJS ──► FastAPI (motor adaptativo)
              │            └─► veredicto, confianza, ranking
              ├─ lee el perfil del usuario del token
              └─ si el motor falla ──► respaldo local sobre PostgreSQL
```

**b) Qué hace el backend** ([backend.md](backend.md#motor-adaptativo)):
- Lee el perfil del usuario autenticado y lo envía al motor. **Nunca** viajan su id, nombre, correo ni rol.
- `GET /api/products/:codigo_barras/compatibilidad` devuelve el veredicto del motor, más `apto`, que es `true` solo con veredicto `apto`.
- `GET /api/products/search/personalizada` devuelve el ranking del motor, con `no_aptos`, la interpretación de la consulta, la comparación con la búsqueda base y el aviso.
- Cada llamada lleva `X-Request-ID` y `X-Clave-Servicio`, con timeout y reintentos.

**c) Respaldo cuando el motor no responde.** Si falla (500, 502, 503 o 504 tras los reintentos), el backend aplica una revisión básica del perfil a los productos guardados (`compatibilidad-local.ts`). La respuesta lleva `X-Fuente-Datos: respaldo` y `estado_fuente: "cache"`, y es **más conservadora que el motor**:
- La confianza es siempre baja, con `evaluacion_de_respaldo` en los motivos.
- **Nunca devuelve `apto`**, solo `apto_con_advertencia` o `no_apto`.
- La búsqueda de respaldo no interpreta las restricciones de la consulta y no tiene comparación con la búsqueda base (`comparacion: null`).
- El orden y los no aptos salen de la misma regla del veredicto, así que la lista no contradice al detalle.

**d) Qué hace el frontend:** muestra el veredicto, la confianza, la explicación y el aviso tal como vienen (sin recalcularlos), el chip de cada resultado, el resumen de la búsqueda y el aviso de respaldo ([frontend.md](frontend.md#veredicto-confianza-y-aviso)). Los datos personales no se guardan en el dispositivo: el service worker solo guarda las respuestas públicas.

**e) `/compatibles`** sigue en el backend, pero el frontend ya no lo usa; lo reemplaza la búsqueda personalizada.

**Principio de diseño:** el error más grave es un **falso "apto"** (decirle a alguien que puede consumir algo que contiene su alérgeno). Por eso el sistema es conservador: une lo declarado por la fuente con lo detectado en el texto, ante la duda marca el alérgeno, ante datos incompletos advierte en vez de confirmar, y `apto` exige que los datos alcancen y que las dietas se declaren.

## 8. Cómo se evaluó la utilidad de la adaptación

La evaluación completa (método, etiquetado manual, resultados y limitaciones) está en [recuperacion-y-evaluacion.md](recuperacion-y-evaluacion.md#8-evaluación-de-la-capacidad-adaptativa). No se repite aquí.

| Métrica | Qué mide | Dónde está |
|---|---|---|
| **Tasa de falsos "apto"** | Seguridad: productos marcados aptos que contienen un alérgeno del perfil. Objetivo: cercano a 0 | Sección 8 de la evaluación, sobre 30 productos etiquetados a mano |
| **Falsos "no apto" y coincidencia con lo esperado** | Calidad del clasificador, y cuánta utilidad se pierde por ser conservador | Misma sección |
| **Detección de alérgenos y trazas** | Precisión y exhaustividad de lo que el motor reconoce | Misma sección |
| **Precision@5 con restricción: búsqueda base contra personalizada** | Utilidad de la búsqueda personalizada | Misma sección |
| **Veredictos con explicación** | Transparencia | Todos los veredictos traen su explicación y sus conflictos |

**Línea base:** la búsqueda general obtiene **Precision@5 = 0,53** sobre 20 consultas de prueba (`GET /api/metricas/evaluacion`, panel de métricas). En las 8 consultas con restricción, como "chocolate sin leche" o "snack sin maní", la búsqueda no adaptativa baja a **P@5 = 0,20**, porque BM25 no entiende que el usuario quiere **excluir** un ingrediente. Esa es la línea de comparación de la búsqueda personalizada.

**Lo que no se midió:** una evaluación con usuarios, una prueba A/B y el uso real (por ejemplo, la tasa de productos aptos entre los abiertos). Los resultados dependen de una muestra de 30 productos elegida por ser difícil, como explica la evaluación.

## 9. Lo implementado

| Pieza | Dónde |
|---|---|
| Perfil: alergias, dietas y modo estricto (`text[]` y `boolean`), con migraciones | `backend/src/users`, `backend/src/migrations` |
| `GET` y `PATCH /api/usuarios/me` (el `PUT …/alergias` quedó obsoleto) | `backend/src/users` |
| Veredicto: `GET /api/products/:codigo_barras/compatibilidad` | `backend/src/products` |
| Búsqueda personalizada: `GET /api/products/search/personalizada` (`filtrar` o `reordenar`) | `backend/src/products` |
| `GET /api/products/compatibles` (solo los `apto`; el frontend ya no lo usa) | `backend/src/products` |
| Perfil sin identidad y `X-Clave-Servicio` hacia el motor | `backend/src/products` |
| Respaldo local conservador (`compatibilidad-local.ts`, `respaldo-local.ts`) y header `X-Fuente-Datos` | `backend/src/products` |
| Franja de veredicto, confianza y aviso en el detalle | `frontend/src/app/producto` |
| "Personalizar según mi perfil", chips de veredicto y resumen de la búsqueda | `frontend/src/app/busqueda` |
| Edición del perfil: alergias, dietas, modo estricto | `frontend/src/app/cuenta` |
| Alérgenos del perfil destacados; los demás, neutros | `frontend/src/app/compartido/chips-alergenos.component.ts` |

**Evidencia de la Entrega Final** (más en [frontend.md](frontend.md#evidencia)):

| Captura | Muestra |
|---|---|
| [no-apto.png](evidencia/no-apto.png) | Veredicto "No apto para ti" con explicación, confianza alta y aviso orientativo |
| [busqueda-personalizada.png](evidencia/busqueda-personalizada.png) | Búsqueda con el perfil: chips de veredicto, resumen de los productos ocultos y aviso |
| [android-con-advertencia.png](evidencia/android-con-advertencia.png) | Resultados "Con advertencia" junto a "Apto", en Android |
| [perfil.png](evidencia/perfil.png) | Alergias, dietas y modo estricto, que forman el perfil enviado al motor |

**Ejemplo (EP2):** la búsqueda "chocolate" devolvió 32 productos guardados. Para un usuario alérgico a los lácteos, el filtro de aquella versión devolvió 9. Hoy esa decisión la toma el motor y además considera trazas, dietas y el modo estricto. Evidencia de la EP2: `docs/evidencia/compatibles-swagger.png`.

## 10. Riesgos, sesgos y limitaciones

- **Calidad de la fuente:** Open Food Facts es colaborativa; puede haber productos sin ingredientes, con alérgenos no declarados o con errores de digitación. Un veredicto "apto" depende de la calidad del dato, y por eso lo acompaña la confianza.
- **Falsos positivos:** el criterio conservador marca alérgenos que no están (por ejemplo, "sabor leche" o una traza leída como ingrediente) y deja en "advertencia" lo que no puede confirmar, como los productos sin etiqueta de dieta. Es preferible a un falso negativo, pero reduce la utilidad, sobre todo en modo estricto. La evaluación los cuenta.
- **Respaldo menos preciso:** sin el motor, la revisión es básica, nunca da "apto" y no interpreta las restricciones de la consulta.
- **Cobertura:** el respaldo trabaja solo con los productos ya guardados; un producto que nadie ha buscado todavía no aparece.
- **Datos de salud:** alergias y dietas son datos de salud. Solo viajan al motor sin identidad, el usuario puede borrarlas o borrar su cuenta, y no se guardan en el dispositivo ni en los logs.
- **No reemplaza la etiqueta:** la aplicación muestra siempre el aviso de que la información es orientativa y el usuario debe verificar la etiqueta física.
