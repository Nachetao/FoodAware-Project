"""Payloads de ejemplo con la forma real de la API de Open Food Facts.

Los campos coinciden con CAMPOS del cliente; marcas y códigos son ficticios.
"""

LECHE = {
    "code": "7802920000015",
    "product_name": "Leche entera",
    "product_name_es": "Leche entera",
    "brands": "Lácteos del Sur",
    "quantity": "1 L",
    "ingredients_text": "Whole milk, vitamin A, vitamin D3",
    "ingredients_text_es": "_Leche_ entera, vitamina A, vitamina D3.",
    "allergens_tags": ["en:milk"],
    "traces_tags": [],
    "labels_tags": ["en:vegetarian", "en:no-gluten", "en:green-dot"],
    "nutriscore_grade": "b",
    "image_front_url": "https://images.openfoodfacts.org/images/products/"
                       "780/292/000/0015/front_es.3.400.jpg",
    "image_url": "https://images.openfoodfacts.org/images/products/"
                 "780/292/000/0015/front_es.3.400.jpg",
    "last_modified_t": 1757000000,
    "lang": "es",
}

GALLETAS = {
    "code": "7802215000040",
    "product_name": "Galletas de vainilla rellenas",
    "brands": "Campo Austral, Austral Snacks",
    "quantity": "140 g",
    "ingredients_text": (
        "Harina de _trigo_ enriquecida (harina de trigo, hierro, tiamina), "
        "azúcar, aceite vegetal; suero de _leche_ en polvo, _huevo_, "
        "emulsionante (lecitina de _soya_), sal. Puede contener avellanas."
    ),
    "allergens_tags": ["en:gluten", "en:milk", "en:eggs", "en:soybeans"],
    "traces_tags": ["en:nuts", "es:avellanas"],
    "labels_tags": [],
    "nutriscore_grade": "unknown",
    "image_url": "https://images.openfoodfacts.org/images/products/"
                 "780/221/500/0040/front_es.5.400.jpg",
    "last_modified_t": 1759800000,
    "lang": "es",
}

INCOMPLETO = {
    "code": "7801111000011",
    "brands": "",
    "allergens_tags": [],
    "traces_tags": [],
    "labels_tags": [],
    "nutriscore_grade": "not-applicable",
    "lang": "es",
}
