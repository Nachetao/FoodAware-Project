#!/usr/bin/env bash
# Despliega un commit en Render: python-service, backend y frontend, en ese
# orden, esperando que cada uno quede "live" antes de seguir. Lo usan
# cd-staging.yml y rollback-staging.yml.
#
# Variables:
#   SHA                      commit a desplegar (completo)
#   RENDER_API_KEY           Secret con la API key de Render
#   ID_PYTHON, ID_BACKEND, ID_FRONTEND
#                            IDs de los servicios (Variables del Environment)
#   ESPERA_MAX_SEGUNDOS      tope por servicio (por defecto 1500)
#   PAUSA_SEGUNDOS           entre consultas del estado (por defecto 15)
#   TITULO                   título del resumen (por defecto "Despliegue")
#
# Termina con error si algún deploy queda en build_failed, update_failed,
# canceled, pre_deploy_failed o deactivated, o si pasa el tope. Escribe una
# tabla en el resumen de la ejecución (GITHUB_STEP_SUMMARY).
set -euo pipefail

ESPERA_MAX_SEGUNDOS=${ESPERA_MAX_SEGUNDOS:-1500}
PAUSA_SEGUNDOS=${PAUSA_SEGUNDOS:-15}
TITULO=${TITULO:-Despliegue}
RESUMEN=${GITHUB_STEP_SUMMARY:-/dev/null}

if [[ ! "${SHA:-}" =~ ^[0-9a-f]{40}$ ]]; then
  echo "::error::SHA debe ser un commit completo (40 caracteres hexadecimales)"
  exit 1
fi
if [[ -z "${RENDER_API_KEY:-}" ]]; then
  echo "::error::Falta el Secret RENDER_API_KEY"
  exit 1
fi
for variable in ID_PYTHON ID_BACKEND ID_FRONTEND; do
  if [[ -z "${!variable:-}" ]]; then
    echo "::error::Falta la Variable RENDER_SERVICE_$variable del Environment staging (docs/despliegue-staging.md, paso 8)"
    exit 1
  fi
done

api() {
  curl -sS --fail-with-body --max-time 60 \
    -H "Authorization: Bearer $RENDER_API_KEY" -H "Accept: application/json" "$@"
}
# Las consultas sí se reintentan; el POST no, para no crear dos deploys si
# se corta la conexión después de crearlo.
consultar() {
  api --retry 3 --retry-all-errors "$@"
}

{
  echo "### $TITULO de \`${SHA:0:7}\`"
  echo
  echo "| Servicio | Deploy | Estado | Duración |"
  echo "|---|---|---|---|"
} >> "$RESUMEN"

# El backend necesita a python-service vivo para su health check y el
# frontend apunta al backend: por eso este orden.
for servicio in "python-service:$ID_PYTHON" "backend:$ID_BACKEND" "frontend:$ID_FRONTEND"; do
  nombre=${servicio%%:*} id=${servicio#*:}
  echo "::group::$nombre ($id)"
  inicio=$SECONDS
  respuesta=$(api -X POST "https://api.render.com/v1/services/$id/deploys" \
    -H "Content-Type: application/json" \
    -d "{\"commitId\": \"$SHA\", \"clearCache\": \"do_not_clear\"}")
  deploy=$(jq -r '.id // empty' <<< "$respuesta")
  if [[ -z "$deploy" ]]; then
    echo "::error::Render no devolvió el deploy de $nombre"
    jq . <<< "$respuesta" || echo "$respuesta"
    exit 1
  fi
  echo "Deploy $deploy creado para el commit $(jq -r '.commit.id // "?"' <<< "$respuesta")"

  anterior=""
  while true; do
    estado=$(consultar "https://api.render.com/v1/services/$id/deploys/$deploy" | jq -r .status)
    if [[ "$estado" != "$anterior" ]]; then
      echo "$(( SECONDS - inicio )) s: $estado"
      anterior=$estado
    fi
    case "$estado" in
      live) break ;;
      build_failed | update_failed | canceled | pre_deploy_failed | deactivated)
        echo "| $nombre | \`$deploy\` | $estado | $(( (SECONDS - inicio) / 60 )) min |" >> "$RESUMEN"
        echo "::error::El deploy de $nombre terminó en $estado (revisa sus logs en el Dashboard de Render)"
        exit 1 ;;
    esac
    if (( SECONDS - inicio > ESPERA_MAX_SEGUNDOS )); then
      echo "::error::$nombre sigue en $estado tras $(( ESPERA_MAX_SEGUNDOS / 60 )) min"
      exit 1
    fi
    sleep "$PAUSA_SEGUNDOS"
  done
  echo "| $nombre | \`$deploy\` | live | $(( (SECONDS - inicio) / 60 )) min |" >> "$RESUMEN"
  echo "::endgroup::"
done
