# Развёртывание на adis.byred.fun

Сервер Ubuntu с nginx. Adis работает в Docker на `127.0.0.1:8000`, nginx принимает HTTPS и проксирует запросы.

## 1. Код и приложение

```bash
cd /opt && git clone https://github.com/ByredHub/adis.git && cd adis   # или git pull, если уже клонирован
# Папки app/ нет в git: скопируйте её с рабочего компьютера, например:
#   scp -r app root@79.137.192.235:/opt/adis/
cp server/.env.example server/.env && nano server/.env                # ADIS_LLM_*, ADIS_PUBLIC_URL=https://adis.byred.fun, ADIS_SMTP_*
```

В `docker-compose.yml` раскомментируйте строку `- ./app:/srv/app:ro`. Порт отдавайте только локально: `"127.0.0.1:8000:8000"`.

```bash
docker compose up -d --build
curl -s http://127.0.0.1:8000/v1/health      # должен ответить JSON
```

## 2. nginx и сертификат

`/etc/nginx/sites-available/adis.byred.fun`:

```nginx
server {
    listen 80;
    server_name adis.byred.fun;

    client_max_body_size 30m;            # файлы и голосовые записи

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;             # потоковые ответы чата (SSE)
        proxy_read_timeout 300s;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/adis.byred.fun /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d adis.byred.fun        # выпустит сертификат и включит HTTPS
```

## 3. Проверка

```bash
curl -sI https://adis.byred.fun/ | head -1          # HTTP/2 200 без -k
curl -s https://adis.byred.fun/v1/health
```

Затем откройте адрес на iPhone и пройдите демо-сценарий из README.
