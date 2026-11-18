# Configuración de GitHub del repositorio como código: la regla que
# protege main y el Environment staging que usan "CD Staging (Render)" y
# "Rollback staging". Los servicios de Render siguen en el Blueprint
# (render.yaml); ver
# docs/despliegue-staging.md ("Por qué Blueprint y no Terraform").
#
# El estado vive en HCP Terraform (workspace en modo de ejecución
# "Local"): HCP solo guarda el estado y lo bloquea; plan y apply corren
# donde se ejecutan, con el token de GitHub de ese lugar. La organización
# se indica con la variable de entorno TF_CLOUD_ORGANIZATION.
terraform {
  required_version = ">= 1.7.0"

  cloud {
    workspaces {
      name = "foodaware-github"
    }
  }

  required_providers {
    github = {
      source  = "integrations/github"
      version = "~> 6.13"
    }
  }
}

# El token sale de la variable de entorno GITHUB_TOKEN: en CI uno de solo
# lectura (plan) y en local uno con escritura (apply). Nunca va en un
# archivo.
provider "github" {
  owner = var.propietario
}
