"""Precision@K, Recall@K y promedio macro.

Para una consulta con resultados ordenados R y conjunto de relevantes Rel:

    Precision@K = |Rel ∩ R[:K]| / K
    Recall@K    = |Rel ∩ R[:K]| / |Rel|

- Precision@K responde "de lo que ve el usuario en la primera pantalla,
  ¿qué parte le sirve?". Se divide por K aunque el buscador devuelva menos
  resultados: no mostrar nada no es más preciso. Por eso, si una consulta
  tiene menos de K relevantes en el corpus, su Precision@K máxima es
  |Rel| / K.
- Recall@K responde "de todo lo que le serviría, ¿qué parte alcanzó a
  ver?". Si hay más de K relevantes, su máximo es K / |Rel|.

Por qué estas dos: en una app de alergias el usuario mira pocos resultados
(K = 5 por defecto, lo que cabe en una pantalla de celular), así que
importa qué tan buenos son los primeros (precisión) y si los productos que
le sirven aparecen ahí (recall). Se informan juntas porque cada una por
separado se puede "ganar" fácil: devolver un solo resultado seguro da buena
precisión y pésimo recall, y devolver mucho, lo contrario.

Promedio macro: el promedio simple entre consultas, así cada consulta pesa
lo mismo sin importar cuántos relevantes tenga. Una consulta sin
relevantes en el corpus se excluye (su Recall@K no está definido y su
Precision@K sería 0 por falta de datos, no por culpa del buscador) y se
informa aparte.

Ejemplo con K = 5: resultados [a, b, c, d, e], relevantes {a, c, x, y}
    Precision@5 = 2 / 5 = 0.4      Recall@5 = 2 / 4 = 0.5
"""
from typing import Collection, Optional, Sequence


def aciertos(resultados: Sequence[str], relevantes: Collection[str],
             k: int) -> int:
    """Relevantes entre los primeros k resultados."""
    relevantes = set(relevantes)
    return sum(1 for r in resultados[:k] if r in relevantes)


def precision_at_k(resultados: Sequence[str], relevantes: Collection[str],
                   k: int) -> float:
    _validar_k(k)
    return aciertos(resultados, relevantes, k) / k


def recall_at_k(resultados: Sequence[str], relevantes: Collection[str],
                k: int) -> Optional[float]:
    """None si no hay relevantes: el recall no está definido."""
    _validar_k(k)
    if not relevantes:
        return None
    return aciertos(resultados, relevantes, k) / len(set(relevantes))


def promedio_macro(valores: Sequence[float]) -> float:
    """Promedio simple; 0 si no hay valores."""
    return sum(valores) / len(valores) if valores else 0.0


def _validar_k(k: int) -> None:
    if k < 1:
        raise ValueError("k debe ser al menos 1")
