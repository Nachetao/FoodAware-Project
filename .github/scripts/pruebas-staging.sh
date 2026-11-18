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
#
# Escribe una tabla en el resumen de la ejecución y termina con error si
# alguna prueba falla.
set -euo pipefail

PLAZO_SEGUNDOS=${PLAZO_SEGUNDOS:-300}
PAUSA_SEGUNDOS=${PAUSA_SEGUNDOS:-15}
CONSULTA=${CONSULTA:-galletas}
RESUMEN=${GITHUB_STEP_SUMMARY:-/dev/null}

for variable in URL_PYTHON URL_BACKEND URL_FRONTEND; do
  if [[ -z "${!variable:-}" ]]; then
    echo "::error::Falta la Variable STAGING_${variable} del Environment staging"
    exit 1
  fi
done
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

# El commit del backend solo se compara si /api/health lo informa: hasta que
# el backend lo agregue, queda como pendiente y no hace fallar las pruebas.
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
