# Umbrel-like UI v6

Public-safe demo repository for a self-hosted control portal.

## Features

- login + sessions
- users management
- groups of servers with services inside
- global search
- widgets
- advanced theming with 3 glow points
- avatar upload
- docker autodiscovery
- import / export state

## Safe placeholders

All examples in this repository use safe placeholders:

- IP: `11.22.33.44`
- domain: `example.com`

Example server object:

```json
{
  "id": "srv-example",
  "name": "Example",
  "ip": "11.22.33.44",
  "baseUrl": "https://example.com"
}
```

## Quick start

1. Generate password hash:

```bash
docker run --rm -v "$PWD":/app -w /app node:20-alpine sh -lc 'npm install >/dev/null 2>&1 && npm run hash-password -- "CHANGE_ME"'
```

2. Put the hash into `docker-compose.yml` as `ADMIN_BOOTSTRAP_PASSWORD_HASH`.

3. Start:

```bash
docker compose up -d --build
```

4. Open:

- HTTP: `http://YOUR_HOST:8088`
- HTTPS: `https://YOUR_HOST:8088` when `SSL_ENABLED=true` and valid certs are mounted:
  - `certs/fullchain.pem`
  - `certs/privkey.pem`

## Notes

- `credentials` are masked in UI when marked as secret, but they are still stored in application state. This is not a vault.
- Avatar uploads support `jpg`, `jpeg`, `png`.
- Docker autodiscovery requires mounted `/var/run/docker.sock`.

## Update

```bash
git pull
docker compose up -d --build
```
