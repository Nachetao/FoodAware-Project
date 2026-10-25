<#
.SYNOPSIS
    Despierta el staging de FoodAware en Render y muestra el estado de cada servicio.

.DESCRIPTION
    En el plan gratuito, Render apaga cada web service tras 15 minutos sin
    tráfico y tarda cerca de un minuto en despertarlo. Este script llama a los
    health checks del staging hasta que todo responde (o se cumple el plazo) y
    al final muestra una tabla con el estado. Conviene correrlo antes de una
    demo. Solo hace peticiones GET a las URL públicas.

    Termina con código 0 si todo quedó listo y 1 si algo no respondió.

.EXAMPLE
    .\scripts\despertar-staging.ps1

.EXAMPLE
    .\scripts\despertar-staging.ps1 -PlazoSegundos 600
#>
param(
    [string]$UrlPython = "https://foodaware-staging-python.onrender.com",
    [string]$UrlBackend = "https://foodaware-staging-backend.onrender.com",
    [string]$UrlFrontend = "https://foodaware-staging-frontend.onrender.com",
    # Tiempo máximo esperando a que todo responda.
    [int]$PlazoSegundos = 300,
    [int]$PausaSegundos = 10
)

$ErrorActionPreference = "Stop"
# Windows PowerShell 5.1 no siempre ofrece TLS 1.2 por defecto.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

function Get-Respuesta([string]$Url) {
    # Devuelve el código HTTP y el cuerpo, también cuando es 4xx o 5xx (el
    # backend responde 503 con su JSON si PostgreSQL está caído).
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 60
        return @{ Codigo = [int]$r.StatusCode; Cuerpo = $r.Content }
    } catch {
        $respuesta = $_.Exception.Response
        if ($null -eq $respuesta) {
            # Sin respuesta: DNS, timeout o conexión rechazada.
            return @{ Codigo = 0; Cuerpo = $_.Exception.Message }
        }
        # PowerShell 7 deja el cuerpo en ErrorDetails; 5.1, en el stream.
        $cuerpo = $_.ErrorDetails.Message
        if (-not $cuerpo -and $respuesta -is [System.Net.HttpWebResponse]) {
            $lector = New-Object System.IO.StreamReader($respuesta.GetResponseStream())
            $cuerpo = $lector.ReadToEnd()
        }
        return @{ Codigo = [int]$respuesta.StatusCode; Cuerpo = $cuerpo }
    }
}

# Cada verificación devuelve si el servicio está listo y una línea de detalle.
$verificaciones = @(
    @{
        Servicio = "python-service"
        Url = "$UrlPython/health"
        Probar = {
            param($r)
            if ($r.Codigo -ne 200) { return @{ Listo = $false; Detalle = "HTTP $($r.Codigo)" } }
            $salud = $r.Cuerpo | ConvertFrom-Json
            @{
                Listo = $salud.estado -in @("ok", "degradado")
                Detalle = "estado $($salud.estado), $($salud.detalle.cache.productos) productos"
            }
        }
    },
    @{
        Servicio = "backend"
        Url = "$UrlBackend/api/health"
        Probar = {
            param($r)
            if ($r.Codigo -notin @(200, 503)) { return @{ Listo = $false; Detalle = "HTTP $($r.Codigo)" } }
            $salud = $r.Cuerpo | ConvertFrom-Json
            $dep = $salud.dependencias
            @{
                Listo = ($dep.postgresql -eq "ok") -and ($dep.fastapi -eq "ok")
                Detalle = "postgresql $($dep.postgresql), fastapi $($dep.fastapi)"
            }
        }
    },
    @{
        Servicio = "frontend"
        Url = "$UrlFrontend/"
        Probar = {
            param($r)
            @{
                Listo = ($r.Codigo -eq 200) -and ($r.Cuerpo -match "<app-root")
                Detalle = "HTTP $($r.Codigo)"
            }
        }
    }
)

$estado = @{}
foreach ($v in $verificaciones) {
    $estado[$v.Servicio] = [pscustomobject]@{
        Servicio = $v.Servicio; Estado = "Esperando"; Detalle = "-"; Segundos = 0; Url = $v.Url
    }
}

$reloj = [System.Diagnostics.Stopwatch]::StartNew()
Write-Host "Despertando el staging (plazo de $PlazoSegundos s; la primera respuesta puede tardar un minuto)..."
while ($true) {
    foreach ($v in $verificaciones) {
        $fila = $estado[$v.Servicio]
        if ($fila.Estado -eq "Listo") { continue }
        try {
            $respuesta = Get-Respuesta $v.Url
            if ($respuesta.Codigo -eq 0) {
                $resultado = @{ Listo = $false; Detalle = "sin respuesta: $($respuesta.Cuerpo)" }
            } else {
                $resultado = & $v.Probar $respuesta
            }
        } catch {
            $resultado = @{ Listo = $false; Detalle = "respuesta no válida: $($_.Exception.Message)" }
        }
        $fila.Detalle = $resultado.Detalle
        $fila.Segundos = [int]$reloj.Elapsed.TotalSeconds
        if ($resultado.Listo) {
            $fila.Estado = "Listo"
            Write-Host ("  {0,-15} listo en {1} s ({2})" -f $v.Servicio, $fila.Segundos, $fila.Detalle)
        } else {
            $fila.Estado = "No responde"
            Write-Host ("  {0,-15} todavía no ({1})" -f $v.Servicio, $fila.Detalle)
        }
    }
    $pendientes = @($estado.Values | Where-Object { $_.Estado -ne "Listo" })
    if ($pendientes.Count -eq 0 -or $reloj.Elapsed.TotalSeconds -ge $PlazoSegundos) { break }
    Start-Sleep -Seconds $PausaSegundos
}

$verificaciones | ForEach-Object { $estado[$_.Servicio] } |
    Format-Table Servicio, Estado, Detalle, Segundos, Url -AutoSize | Out-String | Write-Host

if ($pendientes.Count -gt 0) {
    Write-Host "No respondieron a tiempo: $(($pendientes | ForEach-Object Servicio) -join ', '). Revisa los logs en el Dashboard de Render." -ForegroundColor Yellow
    exit 1
}
Write-Host "El staging está listo: $UrlFrontend" -ForegroundColor Green
exit 0
