variable "propietario" {
  description = "Dueño (usuario u organización) del repositorio en GitHub."
  type        = string
  default     = "Nachetao"
}

variable "repositorio" {
  description = "Nombre del repositorio en GitHub."
  type        = string
  default     = "FoodAware-Project"
}

# Las URL públicas y los ID de los servicios de Render no son secretos:
# el ID solo identifica el servicio; para desplegar hace falta además
# RENDER_API_KEY, que es un Secret y queda fuera de Terraform.
variable "urls_staging" {
  description = "URL públicas del staging en Render, por servicio."
  type = object({
    python   = string
    backend  = string
    frontend = string
  })
  default = {
    python   = "https://foodaware-staging-python.onrender.com"
    backend  = "https://foodaware-staging-backend.onrender.com"
    frontend = "https://foodaware-staging-frontend.onrender.com"
  }

  validation {
    condition     = alltrue([for url in values(var.urls_staging) : can(regex("^https://[a-z0-9-]+\\.onrender\\.com$", url))])
    error_message = "Cada URL debe ser https://<servicio>.onrender.com, sin / al final."
  }
}

# Copiar los valores actuales desde GitHub (Settings → Environments →
# staging → Environment variables) o desde el panel de Render (el srv-…
# de la URL de cada servicio).
variable "ids_servicios_render" {
  description = "ID de cada servicio de Render (srv-…), tal como están en el Environment staging."
  type = object({
    python   = string
    backend  = string
    frontend = string
  })
  default = {
    python   = "srv-dbf4jje7bikc73c5o4t0"
    backend  = "srv-dbf4k967bikc73c5q550"
    frontend = "srv-dbf4jje7bikc73c5o4r0"
  }

  validation {
    condition     = alltrue([for id in values(var.ids_servicios_render) : can(regex("^srv-[a-z0-9]+$", id))])
    error_message = "Cada ID debe ser srv- seguido de minúsculas y dígitos."
  }
}
