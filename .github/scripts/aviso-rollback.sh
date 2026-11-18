#!/usr/bin/env bash
# Deja en el resumen de la ejecución cómo volver a la última versión que
# pasó todas las pruebas de salud. Lo usan cd-staging.yml y
# rollback-staging.yml cuando falla el despliegue o las pruebas.
set -euo pipefail

RESUMEN=${GITHUB_STEP_SUMMARY:-/dev/null}
URL="${GITHUB_SERVER_URL:-https://github.com}/${GITHUB_REPOSITORY:-}/actions/workflows/rollback-staging.yml"

cat >> "$RESUMEN" <<EOF

### Si hay que volver atrás

Staging puede haber quedado con el commit nuevo en uno o más servicios. Antes
de volver atrás, revisa en la tabla si fue un arranque lento (entonces basta
con *Re-run failed jobs*) o un problema de la versión nueva.

Para volver a la última versión que pasó todas las pruebas de salud (tags
\`staging-verificado-*\`):

- En GitHub: [Actions → Rollback staging → Run workflow]($URL), en la rama
  \`main\`, con el motivo.
- Con la CLI de GitHub:

  \`\`\`
  gh workflow run rollback-staging.yml --ref main -f motivo="Falló el despliegue de ${SHA:-este commit}"
  \`\`\`

Detalles en docs/despliegue-staging.md ("Versión desplegada y rollback").
EOF
