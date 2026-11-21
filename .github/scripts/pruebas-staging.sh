#!/usr/bin/env bash
# Pruebas de salud del staging por sus URL públicas, después de desplegar.
# Lo usan cd-staging.yml y rollback-staging.yml.
#
# Variables:
#   URL_PYTHON, URL_BACKEND, URL_FRONTEND   URL públicas, sin "/" al final
#   COMMIT_ESPERADO   commit que se acaba de desplegar (completo)
#   PLAZO_SEGUNDOS    reintentos por prueba hasta este plazo (por defecto
#                     300: un servicio dormido tarda ~1 min en despertar)
#   PAUSA_SEGUNDOS    entre reintentos (por defecto 15)
#   CONSULTA          búsqueda de prueba (por defecto "galletas")
#   CLAVE_SERVICIO    clave entre servicios (Secret CLAVE_SERVICIO_STAGING),
#                     para las pruebas funcionales contra FastAPI
#   PRODUCTO_PRUEBA   producto de la semilla con lácteos declarados por Open
#                     Food Facts (por defecto la Leche Semidescremada
#                     0400050270413)
#
# Además de la salud de cada servicio, hace un recorrido funcional corto que
# no escribe datos: una búsqueda personalizada, el veredicto de un producto
# conocido y la evaluación adaptativa. Escribe una tabla en el resumen de la
# ejecución y termina con error si alguna prueba falla.
set -euo pipefail

PLAZO_SEGUNDOS=${PLAZO_SEGUNDOS:-300}
PAUSA_SEGUNDOS=${PAUSA_SEGUNDOS:-15}
CONSULTA=${CONSULTA:-galletas}
PRODUCTO_PRUEBA=${PRODUCTO_PRUEBA:-0400050270413}
RESUMEN=${GITHUB_STEP_SUMMARY:-/dev/null}

for variable in URL_PYTHON URL_BACKEND URL_FRONTEND; do
  if [[ -z "${!variable:-}" ]]; then
    echo "::error::Falta la Variable STAGING_${variable} del Environment staging"
    exit 1
  fi
done
if [[ -z "${CLAVE_SERVICIO:-}" ]]; then
  echo "::error::Falta el Secret CLAVE_SERVICIO_STAGING (docs/pipeline-devsecops.md)"
  exit 1
fi
if [[ ! "${COMMIT_ESPERADO:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::COMMIT_ESPERADO debe ser un commit completo"
  exit 1
fi

# Cada prueba imprime una línea con lo que vio y sale con 0 si pasó.
salud_python() {
  local cuerpo estado
  cuerpo=$(curl -sS --fail-with-body --max-time 60 "$URL_PYTHON/health") || return 1
  estado=$(jq -r .estado <<< "$cuerpo")
  echo "estado $estado, $(jq -r .detalle.cache.productos <<< "$cuerpo") productos en caché"
  [[ "$estado" == ok || "$estado" == degradado ]]
}
commit_python() {
  local commit
  commit=$(curl -sS --fail-with-body --max-time 60 "$URL_PYTHON/health" | jq -r '.commit // ""') || return 1
  if [[ -z "$commit" ]]; then
    echo "python-service no informa el commit (falta RENDER_GIT_COMMIT)"
    return 1
  fi
  echo "informa ${commit:0:7}, se desplegó ${COMMIT_ESPERADO:0:7}"
  [[ "$commit" == "$COMMIT_ESPERADO" ]]
}
salud_backend() {
  local cuerpo
  cuerpo=$(curl -sS --fail-with-body --max-time 60 "$URL_BACKEND/api/health") || return 1
  jq -r '"postgresql \(.dependencias.postgresql), fastapi \(.dependencias.fastapi)"' <<< "$cuerpo"
  jq -e '.dependencias.postgresql == "ok" and .dependencias.fastapi == "ok"' <<< "$cuerpo" > /dev/null
}
busqueda() {
  local fuente total
  curl -sS --fail-with-body --max-time 60 -D cabeceras.txt -o busqueda.json \
    "$URL_BACKEND/api/products/search?q=$CONSULTA&limit=5" || return 1
  fuente=$(grep -i '^x-fuente-datos:' cabeceras.txt | cut -d: -f2- | tr -d ' \r')
  total=$(jq '.resultados | length' busqueda.json)
  echo "$total productos desde ${fuente:-(sin header)}; el primero: $(jq -r '.resultados[0].producto.nombre // "-"' busqueda.json)"
  # "respaldo" significaría que NestJS no llegó a FastAPI.
  (( total > 0 )) && [[ "$fuente" == fastapi ]]
}
metricas() {
  local cuerpo
  cuerpo=$(curl -sS --fail-with-body --max-time 60 "$URL_BACKEND/api/metricas/calidad") || return 1
  jq -r '"válidos \(.porcentaje_validos) %, duplicados \(.porcentaje_duplicados) %, cobertura \(.cobertura_ingredientes) %"' <<< "$cuerpo"
  jq -e '.porcentaje_validos > 0' <<< "$cuerpo" > /dev/null
}
frontend() {
  local respuesta
  respuesta=$(curl -sS --max-time 60 -o index.html -w '%{http_code} %{content_type}' "$URL_FRONTEND/") || return 1
  echo "HTTP $respuesta"
  [[ "$respuesta" == "200 text/html"* ]] && grep -q '<app-root' index.html
}

# --- recorrido funcional contra FastAPI (no escribe datos) -------------------

fastapi() {
  # fastapi <método> <ruta> [cuerpo JSON]
  local argumentos=(-sS --fail-with-body --max-time 60 -X "$1"
                    -H "X-Clave-Servicio: $CLAVE_SERVICIO"
                    -H "Content-Type: application/json")
  if [[ $# -ge 3 ]]; then
    argumentos+=(-d "$3")
  fi
  curl "${argumentos[@]}" "$URL_PYTHON$2"
}
busqueda_personalizada() {
  local cuerpo
  cuerpo=$(fastapi POST /search/personalized \
    '{"consulta": "chocolate sin leche", "perfil": {"alergias": ["mani"]}, "limit": 5}') || return 1
  jq -r '"\(.total) visibles, \(.no_aptos.texto) Perfil aplicado: \(.perfil_aplicado.alergias | join(", "))"' <<< "$cuerpo"
  # "sin leche" se interpreta, se suma al perfil y ningún visible es no_apto
  # ni tiene lácteos.
  jq -e '(.interpretacion.restricciones | map(.codigo) | index("lacteos"))
         and (.perfil_aplicado.alergias | index("mani") and index("lacteos"))
         and .total > 0
         and all(.resultados[]; .veredicto.veredicto != "no_apto"
                 and ((.producto.alergenos | index("lacteos")) | not))' \
    <<< "$cuerpo" > /dev/null
}
veredicto_producto() {
  local cuerpo
  cuerpo=$(fastapi POST "/products/$PRODUCTO_PRUEBA/compatibility" \
    '{"perfil": {"alergias": ["lacteos"]}}') || return 1
  jq -r '"\(.veredicto) (confianza \(.confianza)): \(.explicacion)"' <<< "$cuerpo"
  jq -e '.veredicto == "no_apto"
         and (.alergenos_en_conflicto | index("lacteos"))
         and (.aviso | length > 0)' <<< "$cuerpo" > /dev/null
}
evaluacion_adaptativa() {
  local cuerpo
  cuerpo=$(fastapi GET /metrics/evaluation/adaptive) || return 1
  jq -r '"\(.etiquetado.productos_evaluados) de \(.etiquetado.productos_revisados) productos, \([.veredictos[].falsos_apto] | add) falsos apto, P@5 \(.busqueda.precision_base) → \(.busqueda.precision_personalizada)"' <<< "$cuerpo"
  # Sobre el corpus de staging (la semilla), el etiquetado completo está en
  # el índice, ningún perfil tiene falsos "apto" y la personalizada no
  # muestra no aptos.
  jq -e '.etiquetado.productos_revisados > 0
         and .etiquetado.productos_evaluados == .etiquetado.productos_revisados
         and ([.veredictos[] | .falsos_apto + .falsos_apto_por_traza] | add) == 0
         and .busqueda.no_aptos_top_personalizado == 0
         and .busqueda.precision_personalizada > .busqueda.precision_base' \
    <<< "$cuerpo" > /dev/null
}

DETALLE=""
# reintentar <prueba>: la repite hasta que pase o se cumpla el plazo.
reintentar() {
  local inicio=$SECONDS intento=0 salida
  while true; do
    intento=$(( intento + 1 ))
    if salida=$("$1" 2>&1); then
      DETALLE="$(tail -n 1 <<< "$salida") (intento $intento, $(( SECONDS - inicio )) s)"
      echo "$DETALLE"
      return 0
    fi
    echo "Intento $intento: $(tail -n 1 <<< "$salida")"
    if (( SECONDS - inicio >= PLAZO_SEGUNDOS )); then
      DETALLE="$(tail -n 1 <<< "$salida") ($intento intentos, $(( SECONDS - inicio )) s)"
      return 1
    fi
    sleep "$PAUSA_SEGUNDOS"
  done
}

pruebas=(
  "salud_python|python-service: GET /health"
  "commit_python|python-service: informa el commit desplegado"
  "salud_backend|backend: GET /api/health (PostgreSQL y FastAPI ok)"
  "busqueda|backend: búsqueda \"$CONSULTA\" a través de FastAPI"
  "metricas|backend: GET /api/metricas/calidad (válidos > 0)"
  "frontend|frontend: HTML de la aplicación"
  "busqueda_personalizada|FastAPI: búsqueda personalizada \"chocolate sin leche\" (alergia al maní)"
  "veredicto_producto|FastAPI: veredicto de $PRODUCTO_PRUEBA con alergia a lácteos"
  "evaluacion_adaptativa|FastAPI: evaluación adaptativa sin falsos apto"
)
{
  echo "### Pruebas de salud del staging (commit \`${COMMIT_ESPERADO:0:7}\`)"
  echo
  echo "| Prueba | Resultado | Detalle |"
  echo "|---|---|---|"
} >> "$RESUMEN"
fallidas=0
for prueba in "${pruebas[@]}"; do
  funcion=${prueba%%|*} titulo=${prueba#*|}
  echo "::group::$titulo"
  if reintentar "$funcion"; then
    resultado="Pasó"
  else
    resultado="Falló"
    fallidas=$(( fallidas + 1 ))
    echo "::error::$titulo: $DETALLE"
  fi
  echo "::endgroup::"
  # Un "|" en el detalle (p. ej. en un nombre) rompería la tabla.
  echo "| $titulo | $resultado | ${DETALLE//|//} |" >> "$RESUMEN"
done

# El backend informa su commit en /api/health desde la Entrega Final, y aquí
# se compara con el desplegado. Si alguna vez no lo trajera (por ejemplo, al
# volver con un rollback a una versión anterior a ese cambio), la fila queda
# como pendiente y no hace fallar las pruebas.
commit_backend=$(curl -sS --max-time 60 "$URL_BACKEND/api/health" | jq -r '.commit // ""' || true)
if [[ -z "$commit_backend" ]]; then
  echo "| backend: informa el commit desplegado | Pendiente | /api/health todavía no informa el commit |" >> "$RESUMEN"
elif [[ "$commit_backend" == "$COMMIT_ESPERADO" ]]; then
  echo "| backend: informa el commit desplegado | Pasó | informa ${commit_backend:0:7} |" >> "$RESUMEN"
else
  fallidas=$(( fallidas + 1 ))
  echo "::error::El backend informa ${commit_backend:0:7} y se desplegó ${COMMIT_ESPERADO:0:7}"
  echo "| backend: informa el commit desplegado | Falló | informa ${commit_backend:0:7}, se desplegó ${COMMIT_ESPERADO:0:7} |" >> "$RESUMEN"
fi

if (( fallidas )); then
  echo "::error::$fallidas pruebas fallaron"
  exit 1
fi
echo "Las pruebas pasaron."
