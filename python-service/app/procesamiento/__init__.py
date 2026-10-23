"""Preparación de datos: limpieza, normalización y validación de productos.

Todas las funciones de este paquete son puras (sin red ni base de datos).
"""

# Súbela cada vez que cambien las reglas de procesamiento: al iniciar, el
# servicio reprocesa desde el payload crudo los productos de la caché que
# se procesaron con una versión anterior, sin consultar Open Food Facts.
VERSION_PROCESAMIENTO = 2
