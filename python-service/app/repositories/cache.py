"""Caché local en SQLite de los productos obtenidos de Open Food Facts.

Las operaciones son síncronas; desde endpoints async se llaman en un hilo.
"""
import json
import sqlite3
from contextlib import contextmanager
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any, Dict, Iterator, List, Mapping, Optional, Tuple
from uuid import UUID

from app.procesamiento import VERSION_PROCESAMIENTO
from app.procesamiento.calidad import (
    clave_duplicado,
    con_duplicados,
    marcar_duplicados,
)
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
    modificado_en_fuente TEXT,
    version_procesamiento INTEGER NOT NULL DEFAULT 0,
    clave_duplicado TEXT
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

# Columnas agregadas después de la primera versión del esquema; las bases
# existentes las reciben con ALTER TABLE al inicializar.
_COLUMNAS_AGREGADAS = {
    "productos": {
        # 0 = procesado antes de que existiera VERSION_PROCESAMIENTO.
        "version_procesamiento": "INTEGER NOT NULL DEFAULT 0",
        "clave_duplicado": "TEXT",
    },
    # Detalle interno de cada ejecución (no es parte del contrato). NULL =
    # ejecución anterior a que se registrara.
    "ejecuciones_ingesta": {
        "repetidos_en_ejecucion": "INTEGER",
        "existentes_sin_cambios": "INTEGER",
        "con_ingredientes": "INTEGER",
        "peticiones": "INTEGER",
        "fallas_recuperadas": "INTEGER",
        "motivos_invalidez": "TEXT",  # JSON {problema: cantidad}
    },
}
_COLUMNAS_DETALLE = tuple(_COLUMNAS_AGREGADAS["ejecuciones_ingesta"])

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
class RegistroCrudo:
    """Lo necesario para reprocesar un producto sin consultar OFF."""

    producto: Producto
    payload_off: Dict[str, Any]
    version_procesamiento: int


@dataclass(frozen=True)
class DetalleIngesta:
    """Conteos internos de una ejecución, además de ResumenIngesta.

    `duplicados` del contrato = repetidos_en_ejecucion +
    existentes_sin_cambios.
    """

    # El mismo producto llegó más de una vez en la ejecución (p. ej. en
    # dos categorías); se procesó una sola vez.
    repetidos_en_ejecucion: int = 0
    # Ya estaba en la caché con el mismo hash de contenido.
    existentes_sin_cambios: int = 0
    # Recuperados que tenían al menos un ingrediente tras la limpieza.
    con_ingredientes: int = 0
    # Páginas pedidas a /api/v2/search (cada una con sus reintentos HTTP).
    peticiones: int = 0
    # Categorías que fallaron en la primera ronda y se recuperaron en el
    # reintento; las perdidas son `errores` del resumen.
    fallas_recuperadas: int = 0
    # Problema que invalidó -> cantidad (un producto puede tener varios).
    motivos_invalidez: Mapping[str, int] = field(default_factory=dict)


@dataclass(frozen=True)
class EjecucionRegistrada:
    resumen: ResumenIngesta
    # None si la ejecución es anterior a que se guardara el detalle.
    detalle: Optional[DetalleIngesta]
    # Filas de errores_fuente de la ejecución (recuperadas o no).
    fallas_registradas: int


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
            for tabla, columnas in _COLUMNAS_AGREGADAS.items():
                existentes = {
                    f["name"]
                    for f in con.execute(f"PRAGMA table_info({tabla})")
                }
                for columna, tipo in columnas.items():
                    if columna not in existentes:
                        con.execute(
                            f"ALTER TABLE {tabla} ADD COLUMN {columna} {tipo}"
                        )
            con.execute(
                "CREATE INDEX IF NOT EXISTS idx_productos_clave_duplicado "
                "ON productos (clave_duplicado)"
            )

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
        version: int = VERSION_PROCESAMIENTO,
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
                    url_fuente, modificado_en_fuente, version_procesamiento,
                    clave_duplicado
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (codigo_barras) DO UPDATE SET
                    producto_json = excluded.producto_json,
                    payload_off = excluded.payload_off,
                    hash_contenido = excluded.hash_contenido,
                    run_id = excluded.run_id,
                    recuperado_en = excluded.recuperado_en,
                    verificado_en = excluded.verificado_en,
                    url_fuente = excluded.url_fuente,
                    modificado_en_fuente = excluded.modificado_en_fuente,
                    version_procesamiento = excluded.version_procesamiento,
                    clave_duplicado = excluded.clave_duplicado
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
                    version,
                    clave_duplicado(producto),
                ),
            )
        if fila:
            return ResultadoUpsert.actualizado
        return ResultadoUpsert.insertado

    def obtener_producto(
        self, codigo_barras: str
    ) -> Optional[ProductoCacheado]:
        """Producto con sus posibles duplicados ya marcados."""
        with self._conexion() as con:
            fila = con.execute(
                "SELECT producto_json, verificado_en, clave_duplicado "
                "FROM productos WHERE codigo_barras = ?",
                (codigo_barras,),
            ).fetchone()
            if fila is None:
                return None
            otros = con.execute(
                "SELECT codigo_barras FROM productos "
                "WHERE clave_duplicado = ? AND codigo_barras != ?",
                (fila["clave_duplicado"], codigo_barras),
            ).fetchall() if fila["clave_duplicado"] else []
        producto = Producto.model_validate_json(fila["producto_json"])
        return ProductoCacheado(
            producto=con_duplicados(producto,
                                    (o["codigo_barras"] for o in otros)),
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
        """Todos los productos, con sus posibles duplicados marcados.

        Las marcas se calculan al leer para que siempre reflejen la caché
        actual, aunque después llegue o cambie el otro producto.
        """
        with self._conexion() as con:
            filas = con.execute(
                "SELECT producto_json FROM productos ORDER BY codigo_barras"
            ).fetchall()
        return marcar_duplicados([
            Producto.model_validate_json(fila["producto_json"])
            for fila in filas
        ])

    def listar_productos_con_payload(
        self,
    ) -> List[Tuple[Producto, Dict[str, Any]]]:
        """Productos (con duplicados marcados) y su payload crudo, para el
        índice de búsqueda, que toma las categorías del payload."""
        registros = self.listar_para_reprocesar()
        productos = marcar_duplicados([r.producto for r in registros])
        return [(p, r.payload_off) for p, r in zip(productos, registros)]

    def listar_para_reprocesar(
        self, version_menor_a: Optional[int] = None
    ) -> List[RegistroCrudo]:
        """Productos procesados con una versión anterior (todos si es
        None), junto con el payload crudo de OFF."""
        consulta = ("SELECT producto_json, payload_off, version_procesamiento "
                    "FROM productos")
        parametros: List[Any] = []
        if version_menor_a is not None:
            consulta += " WHERE version_procesamiento < ?"
            parametros.append(version_menor_a)
        with self._conexion() as con:
            filas = con.execute(
                consulta + " ORDER BY codigo_barras", parametros
            ).fetchall()
        return [
            RegistroCrudo(
                producto=Producto.model_validate_json(f["producto_json"]),
                payload_off=json.loads(f["payload_off"]),
                version_procesamiento=f["version_procesamiento"],
            )
            for f in filas
        ]

    def actualizar_procesamiento(
        self, producto: Producto, version: int = VERSION_PROCESAMIENTO
    ) -> None:
        """Guarda un producto reprocesado sin tocar payload, procedencia de
        la fila ni verificado_en."""
        with self._conexion() as con:
            con.execute(
                "UPDATE productos SET producto_json = ?, hash_contenido = ?, "
                "version_procesamiento = ?, clave_duplicado = ? "
                "WHERE codigo_barras = ?",
                (
                    producto.model_dump_json(),
                    producto.procedencia.hash_contenido,
                    version,
                    clave_duplicado(producto),
                    producto.codigo_barras,
                ),
            )

    def contar_productos(self) -> int:
        with self._conexion() as con:
            return con.execute("SELECT COUNT(*) FROM productos").fetchone()[0]

    def verificar(self) -> int:
        """Abre la base y cuenta los productos, para GET /health.

        Lanza sqlite3.Error si la base no responde. No la crea si falta
        (sqlite3.connect sí lo haría): una caché perdida es un error.
        """
        if not Path(self.ruta).is_file():
            raise sqlite3.OperationalError("la base de la caché no existe")
        return self.contar_productos()

    def estado_productos(self) -> List[Tuple[bool, datetime]]:
        """(es_valido, verificado_en) de cada producto, sin deserializar el
        producto completo; para las métricas de calidad."""
        with self._conexion() as con:
            filas = con.execute(
                "SELECT json_extract(producto_json, '$.calidad.es_valido') "
                "AS es_valido, verificado_en FROM productos"
            ).fetchall()
        return [(bool(f["es_valido"]), _desde_iso(f["verificado_en"]))
                for f in filas]

    def codigos_repetidos(self) -> List[Tuple[str, int]]:
        """Códigos de barras guardados más de una vez. Debe ser vacío: es la
        prueba de que la deduplicación por código funciona (la columna es
        PRIMARY KEY y cada guardado es un upsert)."""
        with self._conexion() as con:
            filas = con.execute(
                "SELECT codigo_barras, COUNT(*) AS veces FROM productos "
                "GROUP BY codigo_barras HAVING COUNT(*) > 1"
            ).fetchall()
        return [(f["codigo_barras"], f["veces"]) for f in filas]

    # --- ejecuciones de ingesta -------------------------------------------

    def guardar_ejecucion(
        self,
        resumen: ResumenIngesta,
        detalle: Optional[DetalleIngesta] = None,
    ) -> None:
        """Crea la ejecución o actualiza su resumen (y su detalle, si
        viene; si no, conserva el que tenía)."""
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
            if detalle is not None:
                valores = asdict(detalle)
                valores["motivos_invalidez"] = json.dumps(
                    dict(detalle.motivos_invalidez), sort_keys=True
                )
                asignaciones = ", ".join(f"{c} = ?" for c in _COLUMNAS_DETALLE)
                con.execute(
                    f"UPDATE ejecuciones_ingesta SET {asignaciones} "
                    "WHERE run_id = ?",
                    [*(valores[c] for c in _COLUMNAS_DETALLE),
                     str(resumen.run_id)],
                )

    def obtener_detalle(self, run_id: UUID) -> Optional[DetalleIngesta]:
        with self._conexion() as con:
            fila = con.execute(
                "SELECT * FROM ejecuciones_ingesta WHERE run_id = ?",
                (str(run_id),),
            ).fetchone()
        return _detalle(fila) if fila else None

    def listar_ejecuciones_terminadas(self) -> List[EjecucionRegistrada]:
        """Ejecuciones que no están en curso, de la más antigua a la más
        reciente, con su detalle y cuántas fallas registró la fuente."""
        with self._conexion() as con:
            filas = con.execute(
                "SELECT e.*, (SELECT COUNT(*) FROM errores_fuente f "
                "WHERE f.run_id = e.run_id) AS fallas_registradas "
                "FROM ejecuciones_ingesta e WHERE e.estado != 'en_curso' "
                "ORDER BY e.inicio"
            ).fetchall()
        return [
            EjecucionRegistrada(
                resumen=ResumenIngesta.model_validate(
                    {c: f[c] for c in _COLUMNAS_EJECUCION}
                ),
                detalle=_detalle(f),
                fallas_registradas=f["fallas_registradas"],
            )
            for f in filas
        ]

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


def _detalle(fila: sqlite3.Row) -> Optional[DetalleIngesta]:
    if fila["repetidos_en_ejecucion"] is None:
        return None
    valores = {c: fila[c] for c in _COLUMNAS_DETALLE}
    valores["motivos_invalidez"] = json.loads(
        fila["motivos_invalidez"] or "{}"
    )
    return DetalleIngesta(**valores)


def _a_iso(fecha: datetime) -> str:
    # Ancho fijo para que el orden de texto coincida con el cronológico.
    return fecha.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _desde_iso(texto: str) -> datetime:
    return datetime.strptime(texto, "%Y-%m-%dT%H:%M:%S.%fZ").replace(
        tzinfo=timezone.utc
    )
