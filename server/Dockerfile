# Adis AI Backend. Build context is the server/ folder:
#   docker build -t adis-server server
# To also serve the PWA from the same origin, mount it at /srv/app (see docker-compose.yml) and set ADIS_SERVE_APP=true.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 \
    ADIS_ENV=production ADIS_APP_DIR=/srv/app ADIS_SERVE_APP=false

WORKDIR /srv/server
COPY requirements.txt .
RUN pip install -r requirements.txt && useradd --system --uid 10001 adis && mkdir -p /srv/server/data && chown adis /srv/server/data

COPY . /srv/server/
RUN rm -rf /srv/server/.venv /srv/server/data/* /srv/server/.env /srv/server/tests

USER adis
EXPOSE 8000
# Migrations run on startup (adis.db.init_db). One worker process: the delivery worker lives inside it.
CMD ["uvicorn", "adis.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
