# Каталог «Авто в наличии» — сервер

Сайт (`avtovoz/`) живёт на Timeweb App Platform. Машины и фото хранятся здесь,
на облачном сервере, потому что у App Platform нет гарантированно постоянного диска.

- Кабинет: `https://avtovoz312.ru/admin/` (вход по логину и паролю из `.env`)
- API: `https://api.avtovoz312.ru` — читать может кто угодно, менять только после входа
- Данные: `/opt/savva/backend/data/cars.json` и `data/photos/`

## Установка на сервер (Ubuntu, один раз)

1. DNS в Timeweb: запись **A** `api.avtovoz312.ru` → IP сервера.
2. Зайти на сервер: `ssh root@IP-сервера` и выполнить:

```bash
curl -fsSL https://get.docker.com | sh
git clone https://github.com/musicvibes243-commits/savva /opt/savva
cd /opt/savva/backend
cp .env.example .env && nano .env        # вписать логин и пароль
mkdir -p data && chown 1000:1000 data    # контейнер пишет данные от пользователя node
docker compose up -d --build
```

3. Проверить: `curl https://api.avtovoz312.ru/health` → `{"ok":true,...}`

Порты 80 и 443 на сервере должны быть свободны — их занимает Caddy, он сам выпускает
и продлевает https-сертификат.

## Обновление

```bash
cd /opt/savva && git pull && cd backend && docker compose up -d --build
```

## Резервная копия

```bash
tar czf ~/avtovoz-backup-$(date +%F).tgz -C /opt/savva/backend data
```

## Сменить пароль

`nano /opt/savva/backend/.env` → `docker compose up -d` (после смены все входы сбрасываются
только если удалить `data/sessions.json`).
