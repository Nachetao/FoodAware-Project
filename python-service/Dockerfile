FROM python:3.11-slim

# Usuario sin privilegios con UID fijo (docker-compose.yml deja el volumen de
# la caché a nombre de este UID). /data se crea aquí para que un volumen
# nuevo montado ahí herede su dueño.
RUN groupadd --system --gid 10001 app \
    && useradd --system --uid 10001 --gid app --no-create-home \
        --shell /usr/sbin/nologin app \
    && mkdir /data \
    && chown app:app /data

ENV CACHE_DB_PATH=/data/foodaware-cache.sqlite3

WORKDIR /app

COPY requirements.txt .
# pip, setuptools y wheel solo sirven para instalar: se quitan de la imagen
# final. La base trae versiones con vulnerabilidades (pip 24.0, setuptools
# 79) y pip incluye sus propias copias de certifi, urllib3 y msgpack, que
# Trivy también reporta aunque se actualice pip.
RUN pip install --no-cache-dir -r requirements.txt \
    && pip uninstall --yes setuptools wheel pip

# El código queda de root y solo lectura para el usuario del servicio.
COPY . .

USER app

EXPOSE 8000

# 503 (caché caída) o sin respuesta = unhealthy; ok y degradado = healthy.
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=4)"]

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
