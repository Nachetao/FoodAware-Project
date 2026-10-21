"""Evaluación de la búsqueda con Precision@K y Recall@K (Bloque 5).

- consultas.json: conjunto de evaluación versionado, con la relevancia
  definida por reglas sobre atributos del producto.
- conjunto.py: carga y valida el conjunto, y decide qué es relevante.
- metricas.py: Precision@K, Recall@K y promedio macro (funciones puras).
- evaluador.py: corre cada consulta contra el buscador y mide el tiempo.
"""
