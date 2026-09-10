variable "aws_region" {
  description = "Región de AWS para desplegar los recursos."
  type        = string
  default     = "us-east-1"
}

variable "environment" {
  description = "El ambiente de despliegue (ej. dev, staging, prod)."
  type        = string
  default     = "dev"
}
