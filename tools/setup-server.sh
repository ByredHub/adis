#!/usr/bin/env bash
# Adis — one-shot server setup for adis.byred.fun (Ubuntu/Debian, run as root or with sudo).
#
# What it does:
#   1. Installs Docker, nginx, certbot.
#   2. Clones/pulls https://github.com/ByredHub/adis into /opt/adis.
#   3. Expects the PWA in /opt/adis/app (it is NOT in git — upload it first, see below).
#   4. Creates server/.env if missing, enables the app volume + localhost port binding,
#      starts `docker compose` (Postgres + Adis API on 127.0.0.1:8000).
#   5. Writes the nginx site and issues a Let's Encrypt certificate for adis.byred.fun.
#
# Upload the app folder from the dev machine BEFORE or AFTER running this script:
#   tar czf app.tgz -C /path/to/Adis app
#   scp app.tgz root@<server>:/opt/adis/
#   ssh root@<server> 'tar xzf /opt/adis/app.tgz -C /opt/adis && rm /opt/adis/app.tgz'
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/ByredHub/adis/main/tools/setup-server.sh | bash
#   — or copy this file to the server and run: bash setup-server.sh
#
# Optional env overrides:
#   DOMAIN=adis.byred.fun APP_DIR=/opt/adis REPO=https://github.com/ByredHub/adis.git \
#   CERTBOT_EMAIL=you@example.com bash setup-server.sh

set -euo pipefail

DOMAIN="${DOMAIN:-adis.byred.fun}"
APP_DIR="${APP_DIR:-/opt/adis}"
REPO="${REPO:-https://github.com/ByredHub/adis.git}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

SUDO=""
[ "$(id -u)" -ne 0 ] && SUDO="sudo"

log() { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31mERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ---------- 1. Packages ----------
log "Installing Docker, nginx, certbot"
export DEBIAN_FRONTEND=noninteractive
$SUDO apt-get update -qq
$SUDO apt-get install -y -qq ca-certificates curl git nginx certbot python3-certbot-nginx

if ! command -v docker >/dev/null 2>&1; then
  curl -fsSL https://get.docker.com | $SUDO sh
fi
$SUDO systemctl enable --now docker
docker compose version >/dev/null 2>&1 || die "docker compose plugin missing"

# ---------- 2. Code ----------
if [ -d "$APP_DIR/.git" ]; then
  log "Updating $APP_DIR"
  git -C "$APP_DIR" pull --ff-only
else
  log "Cloning $REPO -> $APP_DIR"
  $SUDO git clone "$REPO" "$APP_DIR"
fi

if [ ! -f "$APP_DIR/app/index.html" ]; then
  cat >&2 <<EOF

ERROR: $APP_DIR/app not found — the PWA folder is not in git.
Upload it from the dev machine, then re-run this script:

  tar czf app.tgz -C /path/to/Adis app
  scp app.tgz root@<this-server>:$APP_DIR/
  ssh root@<this-server> 'tar xzf $APP_DIR/app.tgz -C $APP_DIR && rm $APP_DIR/app.tgz'

EOF
  exit 1
fi

# ---------- 3. .env ----------
if [ ! -f "$APP_DIR/server/.env" ]; then
  log "Creating server/.env from example — EDIT IT for the LLM key and SMTP"
  cp "$APP_DIR/server/.env.example" "$APP_DIR/server/.env"
  sed -i \
    -e 's/^ADIS_ENV=.*/ADIS_ENV=production/' \
    -e "s|^ADIS_PUBLIC_URL=.*|ADIS_PUBLIC_URL=https://$DOMAIN|" \
    "$APP_DIR/server/.env"
  chmod 600 "$APP_DIR/server/.env"
else
  grep -q '^ADIS_PUBLIC_URL=' "$APP_DIR/server/.env" || echo "ADIS_PUBLIC_URL=https://$DOMAIN" >> "$APP_DIR/server/.env"
fi

# ---------- 4. docker-compose: serve the PWA, bind localhost only ----------
cd "$APP_DIR"
if grep -q '^      # - ./app:/srv/app:ro' docker-compose.yml; then
  sed -i \
    -e 's|^      # ADIS_SERVE_APP: "true".*|      ADIS_SERVE_APP: "true"|' \
    -e 's|^      # - ./app:/srv/app:ro|      - ./app:/srv/app:ro|' \
    -e 's|^      - "8000:8000"|      - "127.0.0.1:8000:8000"|' \
    docker-compose.yml
fi

if ! grep -q '^POSTGRES_PASSWORD=' .env 2>/dev/null; then
  log "Generating POSTGRES_PASSWORD in $APP_DIR/.env"
  echo "POSTGRES_PASSWORD=$(head -c 32 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 32)" > .env
  chmod 600 .env
fi

log "Building and starting containers"
$SUDO docker compose up -d --build

log "Waiting for the API"
for i in $(seq 1 30); do
  curl -fsS http://127.0.0.1:8000/v1/health >/dev/null 2>&1 && break
  sleep 2
  [ "$i" = 30 ] && die "API did not come up — check: docker compose -f $APP_DIR/docker-compose.yml logs adis"
done
curl -fsS http://127.0.0.1:8000/v1/health && echo

# ---------- 5. nginx ----------
log "Configuring nginx for $DOMAIN"
$SUDO tee /etc/nginx/sites-available/"$DOMAIN" >/dev/null <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    client_max_body_size 30m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 300s;
    }
}
EOF
$SUDO ln -sf /etc/nginx/sites-available/"$DOMAIN" /etc/nginx/sites-enabled/"$DOMAIN"
$SUDO nginx -t
$SUDO systemctl reload nginx

# ---------- 6. TLS ----------
if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  log "Issuing certificate for $DOMAIN"
  EMAIL_ARGS="--register-unsafely-without-email"
  [ -n "$CERTBOT_EMAIL" ] && EMAIL_ARGS="-m $CERTBOT_EMAIL"
  $SUDO certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos $EMAIL_ARGS --redirect
else
  log "Certificate already exists — skipping certbot"
fi

log "Done. Verifying HTTPS"
curl -fsSI "https://$DOMAIN/" | head -1
curl -fsS "https://$DOMAIN/v1/health" && echo

cat <<EOF

All set: https://$DOMAIN

Next steps:
  - Put the OpenAI key into $APP_DIR/server/.env (ADIS_LLM_*), then:
      cd $APP_DIR && docker compose up -d --build
  - If the IPA/WebView still shows a white screen, check in Safari Web Inspector —
    most likely https://$DOMAIN was unreachable at install time.
EOF
