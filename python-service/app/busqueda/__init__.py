"""Búsqueda de productos con ranking Okapi BM25 propio.

- bm25.py: índice invertido de un campo y la fórmula BM25 (solo matemática).
- indice.py: índice por campos con pesos (nombre, marca, ingredientes,
  categorías). Es el único lugar que tokeniza, al indexar y al consultar.
- documentos.py: convierte productos de la caché en documentos indexables.
"""
