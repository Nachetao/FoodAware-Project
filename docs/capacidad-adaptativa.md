# Capacidad adaptativa: clasificador de compatibilidad alimentaria

> **Estado:** especificación preliminar (EP2). La implementación completa del modelo de usuario, el motor de decisión y la evaluación final corresponden al Módulo 3. La base de datos, los endpoints y la interfaz que la soportan ya están implementados en la EP2 (ver sección 9).

## 1. Qué parte del sistema se adapta

Dos partes del sistema cambian según el perfil de cada usuario:

- **Los resultados de búsqueda**: qué productos se muestran y en qué orden. Un usuario alérgico a los lácteos no debería tener que revisar uno por uno los productos que lo contienen.
- **El detalle del producto**: el sistema entrega un veredicto personalizado ("Apto para ti" / "No apto: contiene …") junto con la explicación de por qué se marcó cada alérgeno.

## 2. Usuario beneficiado

- Personas con **alergias o intolerancias alimentarias**, para quienes consumir un alérgeno no declarado es un riesgo de salud.
- Personas con **dietas específicas** (vegana, vegetariana, sin gluten, sin lactosa).
- En general, cualquier consumidor que necesite interpretar etiquetas con nombres técnicos o alérgenos ocultos.

## 3. Información recuperada desde la Web que se utiliza

Los datos provienen de **Open Food Facts**, obtenidos y preparados por el servicio FastAPI (ver `docs/fuente-web.md`) y guardados en la tabla `products` del backend:

| Campo | Uso en la adaptación |
|---|---|
| `alergenos` | Alérgenos declarados por la fuente **más** los detectados en el texto de ingredientes. Es la base de la decisión apto / no apto |
| `trazas` | Alérgenos que el producto "puede contener". Generan advertencia |
| `ingredientes`, `ingredientes_texto` | Permiten detectar alérgenos no declarados y mostrar la composición |
| `etiquetas_dieta` | Compatibilidad con dietas (vegano, vegetariano, sin gluten, sin lactosa) |
| `calidad.problemas` | Explica al usuario **por qué** se marcó un alérgeno (por ejemplo, `alergeno_detectado_en_texto:lacteos`) |
| `calidad.es_valido`, `calidad.completitud` | Indican si hay datos suficientes para emitir un veredicto confiable |
| `procedencia` | Fuente, URL y fecha de recuperación, para que el usuario pueda verificar el dato |

## 4. Variables de usuario y de contexto

**Ya implementadas (EP2):**
- **Alergias del usuario**: lista de los 14 códigos de alérgenos del contrato (`lacteos`, `gluten`, `huevo`, `mani`, `frutos_secos`, `soya`, `pescado`, `crustaceos`, `moluscos`, `sesamo`, `mostaza`, `apio`, `sulfitos`, `altramuces`), guardada en `users.alergias`.

**Candidatas para el Módulo 3:**
- **Dietas** del usuario (vegana, vegetariana, sin gluten, sin lactosa).
- **Nivel de exigencia** por alérgeno: en modo estricto, las trazas también hacen que un producto sea no apto.
- **Historial**: productos consultados, descartados o marcados como consumidos sin problemas.
- **Contexto de los datos**: si la respuesta viene de la fuente en línea o del respaldo (`estado_fuente`) y qué tan completo está el producto.

## 5. Decisión que toma el sistema

Para cada par (producto, usuario), el sistema decide:

1. **No apto**: el producto contiene al menos un alérgeno del usuario.
2. **Apto con advertencia**: no contiene alérgenos del usuario, pero sí **trazas** de alguno, o los datos del producto están incompletos (sin ingredientes o con completitud baja), por lo que no se puede confirmar.
3. **Apto**: no contiene alérgenos ni trazas del usuario y los datos son suficientes.

Además, en la búsqueda, decide **qué productos mostrar y en qué orden**: filtrar los no aptos o mostrarlos después de los aptos.

## 6. Resultado visible para el usuario

Ya implementado en la EP2 (con sesión iniciada):

- En el **detalle del producto**: una franja verde **"Apto para ti"** o roja **"No apto: contiene Lácteos, Soya"**, más una advertencia aparte **"Puede contener …"** para las trazas.
- En la **búsqueda**: un interruptor **"Solo aptos para mí"** que muestra solo los productos sin los alérgenos del usuario.
- La sección **"Por qué se marcaron estos alérgenos"**, que traduce los códigos de `calidad.problemas` a texto legible y distingue los alérgenos declarados por Open Food Facts de los detectados en el texto.

Sin sesión, la aplicación funciona igual que antes, sin veredicto personalizado.

## 7. Mecanismo

Se propone un mecanismo de **reglas más clasificación**, priorizando la seguridad.

**a) Reglas deterministas (implementadas en la EP2):**
- `alergenos ∩ alergias_usuario ≠ ∅` → **no apto**, indicando qué alérgenos están en conflicto.
- `trazas ∩ alergias_usuario ≠ ∅` → **advertencia** (no cambia el veredicto en el modo por defecto).
- La consulta de productos compatibles usa el operador de arrays de PostgreSQL `NOT (alergenos && alergias)` sobre un índice GIN, por lo que escala sin recorrer toda la tabla.

**b) Clasificación y ranking (Módulo 3):**
- **Detección de alérgenos en el texto** de ingredientes con un diccionario de sinónimos (ya implementado en FastAPI con un criterio conservador: ante la duda, se marca), con la opción de evolucionar a un clasificador entrenado.
- **Re-ranking personalizado** sobre el ranking BM25: los productos no aptos se penalizan o se excluyen, y los aptos con datos completos se priorizan.
- **Confianza del veredicto** según la completitud de los datos y el origen del alérgeno (declarado o detectado).

**Principio de diseño:** el error más grave es un **falso "apto"** (decirle a alguien que puede consumir algo que contiene su alérgeno). Por eso el sistema es conservador: une lo declarado por la fuente con lo detectado en el texto, y ante datos incompletos advierte en vez de confirmar.

## 8. Cómo se evaluará la utilidad de la adaptación

| Métrica | Qué mide | Cómo se obtiene |
|---|---|---|
| **Tasa de falsos "apto"** | Seguridad: productos marcados aptos que contienen un alérgeno del usuario. Objetivo: cercano a 0 | Conjunto de productos etiquetados manualmente contra perfiles de prueba |
| **Precisión y exhaustividad del veredicto** | Calidad del clasificador apto / no apto | Mismo conjunto etiquetado |
| **Precision@5 en búsquedas con restricción** | Utilidad de la búsqueda personalizada | Comparar `/search` (no adaptativa) con `/compatibles` (adaptativa) para las mismas consultas y perfiles |
| **Porcentaje de veredictos con explicación** | Transparencia | Veredictos acompañados de su motivo (`calidad.problemas` o alérgeno en conflicto) |
| **Tasa de productos aptos entre los abiertos** | Utilidad percibida | Registro de uso (Módulo 3) |

**Justificación con datos actuales:** la búsqueda general obtiene **Precision@5 = 0,56** sobre 20 consultas de prueba (panel de métricas). Sin embargo, en consultas con restricción, como "chocolate sin leche" o "snack sin maní", la búsqueda no adaptativa baja a **P@5 = 0,20** y en algunos casos a **0,00**, porque BM25 no entiende que el usuario quiere **excluir** un ingrediente. Esto muestra que la búsqueda por texto no basta y que se necesita la adaptación según el perfil.

En el Módulo 3 se hará la comparación formal entre la versión adaptativa y la no adaptativa (incluida una prueba A/B, si corresponde) y la evaluación con usuarios.

## 9. Lo ya implementado en la EP2

| Pieza | Dónde |
|---|---|
| Alergias del usuario como códigos (`text[]`), con migración de los datos existentes | `backend/src/users` |
| Índices GIN sobre `alergenos`, `trazas` y `etiquetas_dieta` | migración `IndicesProductos` |
| `GET /api/usuarios/me` y `PUT /api/usuarios/me/alergias` | `backend/src/users` |
| `GET /api/products/:codigo_barras/compatibilidad` → `{ apto, alergenos_en_conflicto, trazas_en_conflicto }` | `backend/src/products` |
| `GET /api/products/compatibles?q=` → productos sin los alérgenos del usuario | `backend/src/products` |
| Franjas "Apto para ti" / "No apto", advertencia de trazas e interruptor "Solo aptos para mí" | `frontend/src/app/producto`, `frontend/src/app/busqueda` |

**Ejemplo real:** la búsqueda "chocolate" devuelve 32 productos guardados. Para un usuario alérgico a los lácteos, `/compatibles` devuelve **9**; si además es alérgico a la soya, devuelve **2**. Evidencia: `docs/evidencia/compatibles-swagger.png`.

## 10. Riesgos, sesgos y limitaciones

- **Calidad de la fuente:** Open Food Facts es colaborativa; puede haber productos sin ingredientes, con alérgenos no declarados o con errores de digitación. Un veredicto "apto" depende de la calidad del dato.
- **Falsos positivos:** el criterio conservador puede marcar alérgenos que no están (por ejemplo, "sabor leche" en una bebida vegetal, ya corregido). Es preferible a un falso negativo, pero reduce la utilidad.
- **Cobertura:** los productos compatibles se buscan entre los guardados; un producto que nadie ha buscado todavía no aparece.
- **No reemplaza la etiqueta:** la aplicación debe recordar que la información es orientativa y que el usuario debe verificar la etiqueta física.
