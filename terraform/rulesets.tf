# ── Protección de main ────────────────────────────────────────────────
# Copia exacta del ruleset "Proteger main" que se creó a mano (id
# 27586111, se adopta en imports.tf). Cambiar algo aquí cambia la
# protección de main: revisar el plan antes de aplicar.

locals {
  # App "GitHub Actions": todos los checks requeridos vienen de ella.
  github_actions_app_id = 15368

  # El "name:" de cada job requerido, tal como lo muestra GitHub.
  checks_requeridos = [
    "Lint, pruebas y auditoría",
    "Lint, pruebas, auditoría y compilación",
    "Lint, pruebas y contrato",
    "Dependencias vulnerables (pip-audit)",
    "Aplicación completa con docker compose",
    "Detección de secretos (Gitleaks)",
    "SAST Python (bandit)",
    "SAST CodeQL (python)",
    "SAST CodeQL (javascript-typescript)",
    "Imagen Docker (Trivy, python-service)",
    "Imagen Docker (Trivy, backend)",
    "Imagen Docker (Trivy, frontend)",
    "render.yaml contra el JSON Schema oficial",
    "render.yaml con la API de Render (sin crear recursos)",
    "Terraform Validate & Plan",
  ]
}

resource "github_repository_ruleset" "main" {
  name        = "Proteger main"
  repository  = var.repositorio
  target      = "branch"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["~DEFAULT_BRANCH"]
      exclude = []
    }
  }

  rules {
    # No se puede borrar main ni reescribir su historia.
    deletion         = true
    non_fast_forward = true

    # Todo entra por pull request; el equipo es de dos y no exige
    # aprobación.
    pull_request {
      required_approving_review_count   = 0
      dismiss_stale_reviews_on_push     = false
      require_code_owner_review         = false
      require_last_push_approval        = false
      required_review_thread_resolution = false
      allowed_merge_methods             = ["merge", "squash", "rebase"]
    }

    # Los 15 checks deben pasar con la rama al día con main.
    required_status_checks {
      strict_required_status_checks_policy = true
      do_not_enforce_on_create             = false

      dynamic "required_check" {
        for_each = toset(local.checks_requeridos)
        content {
          context        = required_check.value
          integration_id = local.github_actions_app_id
        }
      }
    }
  }
}

# ── Tags de versiones verificadas ─────────────────────────────────────
# "CD Staging (Render)" crea staging-verificado-<commit> cuando el
# staging pasa todas sus pruebas, y "Rollback staging" vuelve solo a esos
# commits. Nadie puede crearlos, moverlos ni borrarlos, salvo los
# workflows (app GitHub Actions).
resource "github_repository_ruleset" "tags_verificados" {
  name        = "Proteger tags staging-verificado"
  repository  = var.repositorio
  target      = "tag"
  enforcement = "active"

  conditions {
    ref_name {
      include = ["refs/tags/staging-verificado-*"]
      exclude = []
    }
  }

  bypass_actors {
    actor_id    = local.github_actions_app_id
    actor_type  = "Integration"
    bypass_mode = "always"
  }

  rules {
    creation = true
    update   = true
    deletion = true
  }
}
