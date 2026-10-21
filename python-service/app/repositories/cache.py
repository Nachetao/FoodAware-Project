"""Caché local en SQLite de los productos obtenidos de Open Food Facts.

Las operaciones son síncronas; desde endpoints async se llaman en un hilo.
"""
import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional
from uuid import UUID

from app.schemas.ingesta import ResumenIngesta
from app.schemas.producto import Producto

_ESQUEMA = """
CREATE TABLE IF NOT EXISTS productos (
    codigo_barras TEXT PRIMARY KEY,
    producto_json TEXT NOT NULL,
    payload_off TEXT NOT NULL,
    hash_contenido TEXT NOT NULL,
    run_id TEXT NOT NULL,
    recuperado_en TEXT NOT NULL,
    verificado_en TEXT NOT NULL,
    url_fuente TEXT NOT NULL,
    modificado_en_fuente TEXT
);
CREATE INDEX IF NOT EXISTS idx_productos_verificado_en
    ON productos (verificado_en);

CREATE TABLE IF NOT EXISTS ejecuciones_ingesta (
    run_id TEXT PRIMARY KEY,
    inicio TEXT NOT NULL,
    fin TEXT,
    duracion_ms INTEGER,
    recuperados INTEGER NOT NULL,
    validos INTEGER NOT NULL,
    invalidos INTEGER NOT NULL,
    duplicados INTEGER NOT NULL,
    errores INTEGER NOT NULL,
    estado TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ejecuciones_inicio
    ON ejecuciones_ingesta (inicio);

CREATE TABLE IF NOT EXISTS errores_fuente (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fecha TEXT NOT NULL,
    run_id TEXT,
    tipo TEXT NOT NULL,
    mensaje TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_errores_fuente_fecha
    ON errores_fuente (fecha);
"""

_COLUMNAS_EJECUCION = (
    "run_id", "inicio", "fin", "duracion_ms", "recuperados", "validos",
    "invalidos", "duplicados", "errores", "estado",
)


class ResultadoUpsert(str, Enum):
    insertado = "insertado"
    actualizado = "actualizado"
    duplicado = "duplicado"


@dataclass(frozen=True)
class ProductoCacheado:
    producto: Producto
    # Última vez que se confirmó contra OFF (aunque el contenido no cambiara)
    verificado_en: datetime


@dataclass(frozen=True)
class ErrorFuente:
    fecha: datetime
    run_id: Optional[UUID]
    tipo: str
    mensaje: str


class RepositorioCache:
    def __init__(self, ruta: str) -> None:
        self.ruta = ruta

    def inicializar(self) -> None:
        Path(self.ruta).parent.mkdir(parents=True, exist_ok=True)
        with self._conexion() as con:
            con.execute("PRAGMA journal_mode=WAL")
            con.executescript(_ESQUEMA)

    @contextmanager
    def _conexion(self) -> Iterator[sqlite3.Connection]:
        con = sqlite3.connect(self.ruta, timeout=10)
        con.row_factory = sqlite3.Row
        try:
            with con:  # commit al salir sin errores, rollback si fallan
                yield con
        finally:
            con.close()

    # --- productos -------------------------------------------------------

    def guardar_producto(
        self,
        producto: Producto,
        payload_off: Dict[str, Any],
        verificado_en: Optional[datetime] = None,
    ) -> ResultadoUpsert:
        """Upsert por código de barras.

        Si el hash de contenido no cambió, el producto no se reescribe y
        solo se actualiza verificado_en.
        """
        procedencia = producto.procedencia
        verificado = _a_iso(verificado_en or datetime.now(timezone.utc))
        with self._conexion() as con:
            con.execute("BEGIN IMMEDIATE")
            fila = con.execute(
                "SELECT hash_contenido FROM productos WHERE codigo_barras = ?",
                (producto.codigo_barras,),
            ).fetchone()
            if fila and fila["hash_contenido"] == procedencia.hash_contenido:
                con.execute(
                    "UPDATE productos SET verificado_en = ? "
                    "WHERE codigo_barras = ?",
                    (verificado, producto.codigo_barras),
                )
                return ResultadoUpsert.duplicado
            con.execute(
                """
                INSERT INTO productos (
                    codigo_barras, producto_json, payload_off,
                    hash_contenido, run_id, recuperado_en, verificado_en,
                    url_fuente, modificado_en_fuente
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (codigo_barras) DO UPDATE SET
                    producto_json = excluded.producto_json,
                    payload_off = excluded.payload_off,
                    hash_contenido = excluded.hash_contenido,
                    run_id = excluded.run_id,
                    recuperado_en = excluded.recuperado_en,
                    verificado_en = excluded.verificado_en,
                    url_fuente = excluded.url_fuente,
                    modificado_en_fuente = excluded.modificado_en_fuente
                """,
                (
                    producto.codigo_barras,
                    producto.model_dump_json(),
                    json.dumps(payload_off, ensure_ascii=False),
                    procedencia.hash_contenido,
                    str(procedencia.run_id),
                    _a_iso(procedencia.recuperado_en),
                    verificado,
                    str(procedencia.url_fuente),
                    _a_iso(procedencia.modificado_en_fuente)
                    if procedencia.modificado_en_fuente else None,
                ),
            )
        if fila:
            return ResultadoUpsert.actualizado
        return ResultadoUpsert.insertado

    def obtener_producto(
        self, codigo_barras: str
    ) -> Optional[ProductoCacheado]:
        with self._conexion() as con:
            fila = con.execute(
                "SELECT producto_json, verificado_en FROM productos "
                "WHERE codigo_barras = ?",
                (codigo_barras,),
            ).fetchone()
        if fila is None:
            return None
        return ProductoCacheado(
            producto=Producto.model_validate_json(fila["producto_json"]),
            verificado_en=_desde_iso(fila["verificado_en"]),
        )

    def obtener_payload_off(
        self, codigo_barras: str
    ) -> Optional[Dict[str, Any]]:
        with self._conexion() as con:
            fila = con.execute(
                "SELECT payload_off FROM productos WHERE codigo_barras = ?",
                (codigo_barras,),
            ).fetchone()
        return json.loads(fila["payload_off"]) if fila else None

    def listar_productos(self) -> List[Producto]:
        with self._conexion() as con:
            filas = con.execute(
                "SELECT producto_json FROM productos ORDER BY codigo_barras"
            ).fetchall()
        return [
            Producto.model_validate_json(fila["producto_json"])
            for fila in filas
        ]

    def contar_productos(self) -> int:
        with self._conexion() as con:
            return con.execute("SELECT COUNT(*) FROM productos").fetchone()[0]

    # --- ejecuciones de ingesta -------------------------------------------

    def guardar_ejecucion(self, resumen: ResumenIngesta) -> None:
        """Crea la ejecución o actualiza su resumen."""
        datos = resumen.model_dump(mode="json")
        datos["inicio"] = _a_iso(resumen.inicio)
        datos["fin"] = _a_iso(resumen.fin) if resumen.fin else None
        columnas = ", ".join(_COLUMNAS_EJECUCION)
        marcas = ", ".join("?" for _ in _COLUMNAS_EJECUCION)
        actualizacion = ", ".join(
            f"{c} = excluded.{c}" for c in _COLUMNAS_EJECUCION[1:]
        )
        with self._conexion() as con:
            con.execute(
                f"INSERT INTO ejecuciones_ingesta ({columnas}) "
                f"VALUES ({marcas}) "
                f"ON CONFLICT (run_id) DO UPDATE SET {actualizacion}",
                [datos[c] for c in _COLUMNAS_EJECUCION],
            )

    def obtener_ejecucion(self, run_id: UUID) -> Optional[ResumenIngesta]:
        with self._conexion() as con:
            fila = con.execute(
                "SELECT * FROM ejecuciones_ingesta WHERE run_id = ?",
                (str(run_id),),
            ).fetchone()
        return ResumenIngesta.model_validate(dict(fila)) if fila else None

    def ultima_ejecucion(self) -> Optional[ResumenIngesta]:
        with self._conexion() as con:
            fila = con.execute(
                "SELECT * FROM ejecuciones_ingesta "
                "ORDER BY inicio DESC LIMIT 1"
            ).fetchone()
        return ResumenIngesta.model_validate(dict(fila)) if fila else None

    def ultima_ejecucion_terminada(self) -> Optional[ResumenIngesta]:
        with self._conexion() as con:
            fila = con.execute(
                "SELECT * FROM ejecuciones_ingesta WHERE estado != 'en_curso' "
                "ORDER BY inicio DESC LIMIT 1"
            ).fetchone()
        return ResumenIngesta.model_validate(dict(fila)) if fila else None

    def marcar_ejecuciones_interrumpidas(
        self, fin: Optional[datetime] = None
    ) -> int:
        """Marca como fallidas las ejecuciones que quedaron en curso.

        Ocurre si el servicio se reinició a mitad de una ingesta.
        """
        with self._conexion() as con:
            cursor = con.execute(
                "UPDATE ejecuciones_ingesta SET estado = 'fallido', fin = ? "
                "WHERE estado = 'en_curso'",
                (_a_iso(fin or datetime.now(timezone.utc)),),
            )
            return cursor.rowcount

    # --- errores de la fuente ---------------------------------------------

    def registrar_error_fuente(
        self,
        tipo: str,
        mensaje: str,
        run_id: Optional[UUID] = None,
        fecha: Optional[datetime] = None,
    ) -> None:
        with self._conexion() as con:
            con.execute(
                "INSERT INTO errores_fuente (fecha, run_id, tipo, mensaje) "
                "VALUES (?, ?, ?, ?)",
                (
                    _a_iso(fecha or datetime.now(timezone.utc)),
                    str(run_id) if run_id else None,
                    tipo,
                    mensaje,
                ),
            )

    def listar_errores_fuente(
        self, run_id: Optional[UUID] = None, limite: int = 100
    ) -> List[ErrorFuente]:
        consulta = "SELECT fecha, run_id, tipo, mensaje FROM errores_fuente"
        parametros: List[Any] = []
        if run_id is not None:
            consulta += " WHERE run_id = ?"
            parametros.append(str(run_id))
        consulta += " ORDER BY fecha DESC, id DESC LIMIT ?"
        parametros.append(limite)
        with self._conexion() as con:
            filas = con.execute(consulta, parametros).fetchall()
        return [
            ErrorFuente(
                fecha=_desde_iso(f["fecha"]),
                run_id=UUID(f["run_id"]) if f["run_id"] else None,
                tipo=f["tipo"],
                mensaje=f["mensaje"],
            )
            for f in filas
        ]


def _a_iso(fecha: datetime) -> str:
    # Ancho fijo para que el orden de texto coincida con el cronológico.
    return fecha.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _desde_iso(texto: str) -> datetime:
    return datetime.strptime(texto, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
        tzinfo=timezone.utc
    )
