output "ruleset_main_id" {
  description = "ID del ruleset que protege main."
  value       = github_repository_ruleset.main.ruleset_id
}

output "variables_staging" {
  description = "Variables del Environment staging que administra Terraform."
  value       = sort(keys(local.variables_staging))
}
