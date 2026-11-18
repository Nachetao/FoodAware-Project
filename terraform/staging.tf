# ── Environment staging ───────────────────────────────────────────────
# Lo usan los jobs que despliegan en Render ("CD Staging (Render)" y
# "Rollback staging"). Los Secrets (RENDER_API_KEY y
# CLAVE_SERVICIO_STAGING) se administran a mano en GitHub y no pasan por
# Terraform, para que nunca queden en el estado.
#
# Los Environments "main - foodaware-staging-*" los crea la integración
# de Render y no se administran aquí.

resource "github_repository_environment" "staging" {
  repository          = var.repositorio
  environment         = "staging"
  can_admins_bypass   = true
  prevent_self_review = false
  wait_timer          = 0

  # Solo las ramas de la lista (main, abajo) pueden desplegar.
  deployment_branch_policy {
    protected_branches     = false
    custom_branch_policies = true
  }
}

resource "github_repository_environment_deployment_policy" "staging_main" {
  repository     = var.repositorio
  environment    = github_repository_environment.staging.environment
  branch_pattern = "main"
}

locals {
  variables_staging = {
    STAGING_URL_PYTHON         = var.urls_staging.python
    STAGING_URL_BACKEND        = var.urls_staging.backend
    STAGING_URL_FRONTEND       = var.urls_staging.frontend
    RENDER_SERVICE_ID_PYTHON   = var.ids_servicios_render.python
    RENDER_SERVICE_ID_BACKEND  = var.ids_servicios_render.backend
    RENDER_SERVICE_ID_FRONTEND = var.ids_servicios_render.frontend
  }
}

resource "github_actions_environment_variable" "staging" {
  for_each = local.variables_staging

  repository    = var.repositorio
  environment   = github_repository_environment.staging.environment
  variable_name = each.key
  value         = each.value
}
