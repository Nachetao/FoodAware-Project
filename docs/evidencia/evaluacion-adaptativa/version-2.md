# Evaluación de la capacidad adaptativa

- Fecha: 2026-11-18 20:27 UTC
- Corpus: semilla del corpus (python-service/semilla), 385 productos indexados
- Versión de procesamiento: 2
- Etiquetado: 30 productos revisados por el equipo, 30 en el índice

## Veredictos contra el etiquetado manual

| Perfil | Modo | Contienen | Falsos apto | Tasa | Falsos apto por traza | Falsos no apto | Tasa | Coinciden |
|---|---|---:|---:|---:|---:|---:|---:|---:|
| alergia a lácteos | normal | 5 de 30 | 0 | 0.00 | 0 | 5 de 25 | 0.20 | 20 de 30 |
| alergia a lácteos | estricto | 5 de 30 | 0 | 0.00 | 0 | 7 de 19 | 0.37 | 23 de 30 |
| alergia al gluten | normal | 14 de 30 | 0 | 0.00 | 0 | 1 de 16 | 0.06 | 26 de 30 |
| alergia al gluten | estricto | 14 de 30 | 0 | 0.00 | 0 | 3 de 14 | 0.21 | 27 de 30 |
| alergia al maní | normal | 1 de 30 | 0 | 0.00 | 0 | 2 de 28 | 0.07 | 22 de 29 |
| alergia al maní | estricto | 1 de 30 | 0 | 0.00 | 0 | 5 de 26 | 0.19 | 24 de 29 |
| alergia a la soya | normal | 7 de 30 | 0 | 0.00 | 0 | 3 de 22 | 0.14 | 21 de 29 |
| alergia a la soya | estricto | 7 de 30 | 0 | 0.00 | 0 | 6 de 19 | 0.32 | 23 de 29 |
| alergia a frutos secos | normal | 3 de 30 | 0 | 0.00 | 0 | 3 de 26 | 0.12 | 22 de 29 |
| alergia a frutos secos | estricto | 3 de 30 | 0 | 0.00 | 0 | 4 de 21 | 0.19 | 25 de 29 |
| dieta vegana | normal | 5 de 30 | 0 | 0.00 | 0 | 6 de 25 | 0.24 | 11 de 30 |
| dieta vegana | estricto | 5 de 30 | 0 | 0.00 | 0 | 7 de 19 | 0.37 | 14 de 30 |

Productos con falsos apto o falsos no apto:

| Perfil | Modo | Falsos apto | Falsos no apto |
|---|---|---|---|
| alergia a lácteos | normal | - | 7613036637558, 7790045000907, 7802000010606, 7804659650998, 8445291736245 |
| alergia a lácteos | estricto | - | 0661596797684, 0700083652997, 7790045000907, 7804659650998, 7807910045038, 8411414012275, 8436551192291 |
| alergia al gluten | normal | - | 7613287157294 |
| alergia al gluten | estricto | - | 0661596797684, 0700083652997, 7802000010606 |
| alergia al maní | normal | - | 7613287157294, 7802215303388 |
| alergia al maní | estricto | - | 0661596797684, 0700083652997, 4000446001780, 7802000010606, 7804659650066 |
| alergia a la soya | normal | - | 0628915232295, 4000446001780, 7807910045038 |
| alergia a la soya | estricto | - | 0661596797684, 0700083652997, 7622300847364, 7804659650066, 7807910045038, 8436551192291 |
| alergia a frutos secos | normal | - | 0400050613296, 7613287157294, 7802215303388 |
| alergia a frutos secos | estricto | - | 0661596797684, 7802000010606, 7804659650066, 8411414012275 |
| dieta vegana | normal | - | 7613036637558, 7790045000907, 7802000010606, 7804659650998, 7807910045038, 8445291736245 |
| dieta vegana | estricto | - | 0661596797684, 0700083652997, 7790045000907, 7804659650998, 7807910045038, 8411414012275, 8436551192291 |

## Matrices de confusión

Esperado → sistema. A = apto, W = apto_con_advertencia, N = no_apto. Las celdas de la diagonal (A→A, W→W, N→N) son coincidencias; N→A es un falso apto.

| Perfil | Modo | A→A | A→W | A→N | W→A | W→W | W→N | N→A | N→W | N→N |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| alergia a lácteos | normal | 12 | 5 | 2 | 0 | 3 | 3 | 0 | 0 | 5 |
| alergia a lácteos | estricto | 12 | 0 | 7 | 0 | 0 | 0 | 0 | 0 | 11 |
| alergia al gluten | normal | 11 | 3 | 0 | 0 | 1 | 1 | 0 | 0 | 14 |
| alergia al gluten | estricto | 11 | 0 | 3 | 0 | 0 | 0 | 0 | 0 | 16 |
| alergia al maní | normal | 21 | 5 | 0 | 0 | 0 | 2 | 0 | 0 | 1 |
| alergia al maní | estricto | 21 | 0 | 5 | 0 | 0 | 0 | 0 | 0 | 3 |
| alergia a la soya | normal | 13 | 5 | 1 | 0 | 1 | 2 | 0 | 0 | 7 |
| alergia a la soya | estricto | 13 | 0 | 6 | 0 | 0 | 0 | 0 | 0 | 10 |
| alergia a frutos secos | normal | 17 | 4 | 0 | 0 | 2 | 3 | 0 | 0 | 3 |
| alergia a frutos secos | estricto | 17 | 0 | 4 | 0 | 0 | 0 | 0 | 0 | 8 |
| dieta vegana | normal | 3 | 13 | 3 | 0 | 3 | 3 | 0 | 0 | 5 |
| dieta vegana | estricto | 3 | 9 | 7 | 0 | 0 | 0 | 0 | 0 | 11 |

## Detección de alérgenos contra el etiquetado

| Campo | Productos | Correctos | De más | Faltantes | Precisión | Exhaustividad |
|---|---:|---:|---:|---:|---:|---:|
| Alérgenos | 30 | 35 | 22 | 0 | 0.61 | 1.00 |
| Trazas | 29 | 11 | 10 | 15 | 0.52 | 0.42 |

| Producto | Código | Campo | Marcados de más | Faltantes |
|---|---|---|---|---|
| Wafers trisabor | 0400050613296 | alérgenos | frutos_secos | - |
| leche vegetal | 0628915232295 | alérgenos | soya | - |
| Fitnessbrot | 4000446001780 | alérgenos | sesamo, soya | - |
| Pocky Double Chocolate Decorated Cookies | 6901845041491 | alérgenos | sesamo, soya | - |
| Mini Tritón Sabor Chocolate | 7613036637558 | alérgenos | lacteos | - |
| Trencito | 7613287157294 | alérgenos | frutos_secos, gluten, mani | - |
| Galletitas Crackers Sin Sal | 7790045000907 | alérgenos | lacteos | - |
| papas lays sensacion original | 7802000010606 | alérgenos | lacteos | - |
| Barra cereal frutos rojos y yogurt | 7802215303388 | alérgenos | frutos_secos, huevo, mani, sesamo, sulfitos | - |
| Pan Integral Multigrano | 7803468001762 | alérgenos | altramuces | - |
| Not Milk Zero Sugar - NotCo - NotCo - No | 7804659650998 | alérgenos | lacteos | - |
| Molde Integral Libre de Gluten | 7807910045038 | alérgenos | huevo, soya | - |
| Triton | 8445291736245 | alérgenos | lacteos | - |
| Wafers trisabor | 0400050613296 | trazas | - | frutos_secos |
| leche vegetal | 0628915232295 | trazas | - | soya |
| Pan de Molde Blanco sin gluten | 0661596797684 | trazas | sesamo | - |
| Fitnessbrot | 4000446001780 | trazas | - | sesamo, soya |
| Mini Tritón Sabor Chocolate | 7613036637558 | trazas | - | lacteos |
| Trencito | 7613287157294 | trazas | - | frutos_secos, gluten, mani |
| Express Light | 7622300847364 | trazas | soya | - |
| papas lays sensacion original | 7802000010606 | trazas | - | lacteos |
| Barra cereal frutos rojos y yogurt | 7802215303388 | trazas | - | frutos_secos, huevo, mani, sesamo, sulfitos |
| not milk | 7804659650066 | trazas | frutos_secos, mani, soya | - |
| Molde Integral Libre de Gluten | 7807910045038 | trazas | lacteos | - |
| Wafers chocolate 0% azúcares | 8411414012275 | trazas | frutos_secos, lacteos | - |
| PAN con ROMERO | 8436551192291 | trazas | lacteos, soya | - |
| Triton | 8445291736245 | trazas | - | lacteos |

## Búsqueda base contra personalizada (top 5)

Base: `GET /search`. Personalizada: `POST /search/personalized` con perfil vacío y modo filtrar (la restricción sale de la consulta).

| Consulta | Relevantes | P@5 base | P@5 personalizada | No aptos en el top 5 base | No aptos personalizada |
|---|---:|---:|---:|---:|---:|
| galletas sin gluten | 8 | 0.20 | 1.00 | 2 | 0 |
| chocolate sin leche | 6 | 0.00 | 0.60 | 5 | 0 |
| snack sin maní | 46 | 0.00 | 1.00 | 5 | 0 |
| leche sin lactosa | 2 | 0.40 | 0.20 | 0 | 0 |
| pan sin gluten | 6 | 0.60 | 1.00 | 1 | 0 |
| cereal sin gluten | 7 | 0.00 | 0.80 | 2 | 0 |
| bebida vegetal sin soya | 22 | 0.00 | 1.00 | 5 | 0 |
| galletas sin huevo | 36 | 0.40 | 1.00 | 3 | 0 |
| **Promedio** (8 consultas) | | 0.20 | 0.83 | 23 | 0 |

## Cómo leer estos resultados

- **Falso "apto"** (el error más grave): el sistema dice `apto` y, según el
  etiquetado manual, el producto contiene algo que el perfil evita. La tasa
  se calcula sobre los productos que lo contienen.
- **Falso "no apto"**: el sistema dice `no_apto` y, según el etiquetado, no
  correspondía. En una app de alergias es el error menos grave (esconde un
  producto que servía), pero hace la app menos útil.
- **Veredicto esperado**: sale del etiquetado con las mismas reglas del
  veredicto (contiene → `no_apto`; traza → `apto_con_advertencia`, o
  `no_apto` en modo estricto; si no, `apto`). Que el sistema advierta cuando
  se esperaba `apto` no es un error: es "ante la duda, advertir".
- **Detección**: precisión y exhaustividad contando pares producto-alérgeno.
  En trazas se comparan las del sistema que no son ya ingrediente.
- **Búsqueda**: Precision@5 con las reglas de `consultas.json`. Esas reglas
  y el veredicto usan la detección del sistema, así que esta tabla mide el
  ranking dada la detección; la seguridad de la detección la miden las
  tablas anteriores, contra el etiquetado.
- **Etiquetado**: propuesto con asistencia de IA leyendo solo los
  ingredientes y revisado por el equipo; son 30 productos elegidos
  por ser difíciles, no una muestra al azar. Ver
  docs/recuperacion-y-evaluacion.md.
