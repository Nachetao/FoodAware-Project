"""Contrato de la capacidad adaptativa: veredicto por producto y búsqueda
personalizada según un perfil de restricciones.

NestJS envía solo el perfil (alergias, dietas y modo estricto), nunca la
identidad del usuario: los modelos de entrada rechazan campos extra.
"""
from typing import List, Literal, Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.schemas.enums import AllergenCode, DietLabel
from app.schemas.producto import Producto
from app.schemas.tipos import CodigoBarras

# Aviso que acompaña siempre a un veredicto: es una clasificación, no una
# garantía de seguridad.
AVISO_VEREDICTO = (
    "Clasificación orientativa según tu perfil y los datos de Open Food "
    "Facts. No es una garantía de que el producto sea seguro para ti: revisa "
    "siempre la etiqueta del envase."
)

ValorVeredicto = Literal["apto", "apto_con_advertencia", "no_apto"]
Confianza = Literal["alta", "media", "baja"]
TipoConflicto = Literal["alergeno", "traza", "posible", "dieta"]
OrigenConflicto = Literal["fuente", "texto", "indicio"]
TipoMotivoNoApto = Literal[
    "alergeno", "traza", "posible", "dieta", "datos_insuficientes"
]
MotivoConfianza = Literal[
    "completitud_media",
    "completitud_baja",
    "sin_ingredientes",
    "alergenos_no_reconocidos",
    "conflicto_solo_en_texto",
    "indicio_sin_confirmar",
]
ModoBusqueda = Literal["filtrar", "reordenar"]


class PerfilRestricciones(BaseModel):
    """Restricciones de una persona, sin datos que la identifiquen."""

    model_config = ConfigDict(extra="forbid")

    alergias: List[AllergenCode] = Field(
        default_factory=list,
        max_length=len(AllergenCode),
        description="Alérgenos que la persona no puede consumir. Los "
        "repetidos se ignoran.",
        examples=[["lacteos", "mani"]],
    )
    dietas: List[DietLabel] = Field(
        default_factory=list,
        max_length=len(DietLabel),
        description="Dietas que sigue. Los repetidos se ignoran.",
        examples=[["vegetariano"]],
    )
    modo_estricto: bool = Field(
        False,
        description="Si es true, las trazas, los indicios y los datos "
        "insuficientes hacen el producto no_apto en vez de "
        "apto_con_advertencia.",
        examples=[False],
    )

    @model_validator(mode="after")
    def _sin_repetidos(self):
        self.alergias = list(dict.fromkeys(self.alergias))
        self.dietas = list(dict.fromkeys(self.dietas))
        return self


class Conflicto(BaseModel):
    codigo: Union[AllergenCode, DietLabel] = Field(
        description="Alérgeno en conflicto, o dieta contradicha si tipo es "
        "'dieta'.",
        examples=["lacteos"],
    )
    tipo: TipoConflicto = Field(
        description="alergeno: es ingrediente; traza: 'puede contener'; "
        "posible: indicio sin confirmar (p. ej. lecitina E322 sin origen); "
        "dieta: el producto contradice una dieta del perfil.",
        examples=["alergeno"],
    )
    origen: OrigenConflicto = Field(
        description="fuente: lo declara Open Food Facts; texto: solo lo "
        "detectamos en el texto de ingredientes; indicio: alérgeno posible.",
        examples=["fuente"],
    )


class MotivoNoApto(BaseModel):
    tipo: TipoMotivoNoApto = Field(examples=["alergeno"])
    codigo: Optional[Union[AllergenCode, DietLabel]] = Field(
        None,
        description="Nulo solo si tipo es 'datos_insuficientes'.",
        examples=["lacteos"],
    )


class Veredicto(BaseModel):
    codigo_barras: CodigoBarras
    veredicto: ValorVeredicto = Field(
        description="Ante la duda nunca es 'apto': el error más grave es "
        "un falso apto.",
        examples=["apto_con_advertencia"],
    )
    alergenos_en_conflicto: List[AllergenCode] = Field(
        default_factory=list, examples=[[]]
    )
    trazas_en_conflicto: List[AllergenCode] = Field(
        default_factory=list, examples=[["mani"]]
    )
    dietas_no_confirmadas: List[DietLabel] = Field(
        default_factory=list,
        description="Dietas del perfil que el producto no declara cumplir.",
        examples=[[]],
    )
    conflictos: List[Conflicto] = Field(default_factory=list)
    motivos_no_apto: List[MotivoNoApto] = Field(
        default_factory=list,
        description="Qué lo hizo no_apto; vacío en los demás veredictos.",
    )
    datos_suficientes: bool = Field(
        description="false si no tiene ingredientes, trae alérgenos que no "
        "reconocimos o su completitud es menor que 0,5.",
        examples=[True],
    )
    explicacion: str = Field(
        min_length=1,
        description="Explicación legible del veredicto, en español.",
        examples=["No contiene leche ni maní como ingrediente, pero puede "
                  "contener trazas de maní."],
    )
    confianza: Confianza = Field(examples=["alta"])
    motivos_confianza: List[MotivoConfianza] = Field(
        default_factory=list,
        description="Por qué la confianza no es alta; vacío si lo es.",
        examples=[[]],
    )
    aviso: str = Field(AVISO_VEREDICTO, examples=[AVISO_VEREDICTO])

    @model_validator(mode="after")
    def _consistente(self):
        if (self.veredicto == "no_apto") != bool(self.motivos_no_apto):
            raise ValueError("motivos_no_apto debe tener elementos si y "
                             "solo si el veredicto es no_apto")
        if self.veredicto == "apto" and (
            self.alergenos_en_conflicto or self.trazas_en_conflicto
            or self.conflictos or self.dietas_no_confirmadas
        ):
            raise ValueError("un producto apto no puede tener conflictos")
        if (self.confianza == "alta") != (not self.motivos_confianza):
            raise ValueError("motivos_confianza debe estar vacío si y solo "
                             "si la confianza es alta")
        return self


class SolicitudCompatibilidad(BaseModel):
    model_config = ConfigDict(extra="forbid")

    perfil: PerfilRestricciones


class SolicitudBusquedaPersonalizada(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)

    consulta: str = Field(
        min_length=2,
        max_length=100,
        description="Texto a buscar; puede traer restricciones como "
        "'sin leche'.",
        examples=["chocolate sin leche"],
    )
    perfil: PerfilRestricciones
    modo: ModoBusqueda = Field(
        "filtrar",
        description="filtrar: oculta los no_apto; reordenar: los deja al "
        "final. En los dos casos se informa cuántos hay y por qué.",
        examples=["filtrar"],
    )
    limit: int = Field(10, ge=1, le=50, examples=[10])
    offset: int = Field(0, ge=0, examples=[0])


class RestriccionConsulta(BaseModel):
    texto: str = Field(description="Frase de la consulta.",
                       examples=["sin leche"])
    tipo: Literal["alergeno", "dieta"] = Field(examples=["alergeno"])
    codigo: Union[AllergenCode, DietLabel] = Field(examples=["lacteos"])


class InterpretacionConsulta(BaseModel):
    terminos: List[str] = Field(
        description="Términos que se buscaron con BM25.",
        examples=[["chocolate"]],
    )
    restricciones: List[RestriccionConsulta] = Field(default_factory=list)
    no_reconocidas: List[str] = Field(
        default_factory=list,
        description="Restricciones que no son un alérgeno ni una dieta "
        "conocida; quedan como texto de la búsqueda.",
        examples=[["sin azúcar"]],
    )


class ResultadoPersonalizado(BaseModel):
    producto: Producto
    score: float = Field(ge=0, description="Score BM25.", examples=[7.8421])
    posicion: int = Field(ge=1, description="Posición en el ranking "
                          "personalizado, desde 1.", examples=[1])
    posicion_base: Optional[int] = Field(
        None,
        ge=1,
        description="Posición en el ranking base (GET /search con la "
        "consulta original); nulo si no aparece en él.",
        examples=[9],
    )
    veredicto: Veredicto


class ConteoMotivo(BaseModel):
    tipo: TipoMotivoNoApto = Field(examples=["alergeno"])
    codigo: Optional[Union[AllergenCode, DietLabel]] = Field(
        None, examples=["lacteos"]
    )
    cantidad: int = Field(ge=1, examples=[25])


class ResumenNoAptos(BaseModel):
    total: int = Field(
        ge=0,
        description="Productos no_apto entre las coincidencias.",
        examples=[25],
    )
    ocultos: bool = Field(
        description="true en modo filtrar (no aparecen en resultados); "
        "false en reordenar (van al final).",
        examples=[True],
    )
    motivos: List[ConteoMotivo] = Field(
        default_factory=list,
        description="Cuántos no_apto hay por cada motivo. Un producto con "
        "dos motivos cuenta en los dos.",
    )
    texto: str = Field(examples=["25 ocultos por contener lácteos."])


class SalidaTop(BaseModel):
    codigo_barras: CodigoBarras
    posicion_base: int = Field(ge=1, examples=[1])
    posicion: Optional[int] = Field(
        None, ge=1,
        description="Posición en el ranking personalizado; nulo si quedó "
        "oculto o si no coincide con la consulta sin sus restricciones.",
        examples=[None],
    )
    veredicto: ValorVeredicto = Field(examples=["no_apto"])


class ComparacionRanking(BaseModel):
    k: int = Field(ge=1, examples=[5])
    top_base: List[CodigoBarras] = Field(
        description="Los k primeros del ranking base."
    )
    top_personalizado: List[CodigoBarras] = Field(
        description="Los k primeros del ranking personalizado."
    )
    salieron_del_top: List[SalidaTop] = Field(default_factory=list)
    entraron_al_top: List[CodigoBarras] = Field(default_factory=list)


class RespuestaBusquedaPersonalizada(BaseModel):
    consulta: str = Field(min_length=2, max_length=100,
                          examples=["chocolate sin leche"])
    interpretacion: InterpretacionConsulta
    perfil_aplicado: PerfilRestricciones = Field(
        description="El perfil recibido más las restricciones de la "
        "consulta."
    )
    modo: ModoBusqueda = Field(examples=["filtrar"])
    total: int = Field(
        ge=0,
        description="Coincidencias del ranking personalizado antes de "
        "paginar (sin los ocultos).",
        examples=[6],
    )
    total_base: int = Field(
        ge=0,
        description="Coincidencias del ranking base.",
        examples=[31],
    )
    tiempo_ms: float = Field(ge=0, examples=[3.2])
    estado_fuente: Literal["online", "cache"] = Field(examples=["cache"])
    resultados: List[ResultadoPersonalizado] = Field(default_factory=list)
    no_aptos: ResumenNoAptos
    comparacion: ComparacionRanking
    aviso: str = Field(AVISO_VEREDICTO, examples=[AVISO_VEREDICTO])

    @model_validator(mode="after")
    def _consistente(self):
        if len(self.resultados) > self.total:
            raise ValueError("resultados no puede superar total")
        if self.modo == "filtrar" and any(
            r.veredicto.veredicto == "no_apto" for r in self.resultados
        ):
            raise ValueError("en modo filtrar no puede haber resultados "
                             "no_apto")
        return self
