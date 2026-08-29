terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

# Recurso simulado básico
resource "aws_ssm_parameter" "dummy" {
  name  = "/${var.environment}/dummy"
  type  = "String"
  value = "dummy-value"
}
