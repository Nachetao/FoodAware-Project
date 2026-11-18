# Todo esto ya existía (se configuró a mano en GitHub): Terraform lo
# adopta en el primer apply sin recrearlo. Después del primer apply estos
# bloques no hacen nada; se dejan como registro de qué se adoptó.
#
# El único recurso nuevo es github_repository_ruleset.tags_verificados.

import {
  to = github_repository_ruleset.main
  id = "${var.repositorio}:27586111"
}

import {
  to = github_repository_environment.staging
  id = "${var.repositorio}:staging"
}

import {
  to = github_repository_environment_deployment_policy.staging_main
  id = "${var.repositorio}:staging:64326475"
}

import {
  for_each = local.variables_staging
  to       = github_actions_environment_variable.staging[each.key]
  id       = "${var.repositorio}:staging:${each.key}"
}
