#!/usr/bin/env bash
# Sobe/atualiza o Scale na VPS (dominio proprio + HTTPS).
# Uso (na raiz do projeto): ./deploy/deploy.sh
set -Eeuo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f docker-compose.yml -f docker-compose.prod.yml)
trap 'echo "ERRO na linha $LINENO. Veja: ${COMPOSE[*]} logs --tail 100" >&2' ERR

[[ -f .env ]] || { echo "Falta .env (copie deploy/.env.production.example)." >&2; exit 1; }

# Carrega so para validar (nao imprime valores).
set -a; source .env; set +a
for v in SCALE_DOMAIN ACMEDNS_USERNAME ACMEDNS_PASSWORD ACMEDNS_SUBDOMAIN JWT_SECRET GUEST_COOKIE_SECRET ALLOWED_ORIGINS; do
  [[ -n "${!v:-}" ]] || { echo "Variavel $v vazia no .env." >&2; exit 1; }
done
(( ${#JWT_SECRET} >= 32 && ${#GUEST_COOKIE_SECRET} >= 32 )) \
  || { echo "JWT_SECRET e GUEST_COOKIE_SECRET precisam de >= 32 caracteres." >&2; exit 1; }
[[ "$JWT_SECRET" != "change-me-in-production" ]] || { echo "Troque o JWT_SECRET." >&2; exit 1; }
# TURN ligado com credencial temporaria: sobe o coturn (profile turn) junto.
if [[ "${ENABLE_TURN:-false}" == "true" && -n "${TURN_SECRET:-}" ]]; then
  (( ${#TURN_SECRET} >= 32 )) || { echo "TURN_SECRET precisa de >= 32 caracteres." >&2; exit 1; }
  [[ -n "${TURN_EXTERNAL_IP:-}" ]] || { echo "Defina TURN_EXTERNAL_IP (IP publico da VPS)." >&2; exit 1; }
  COMPOSE+=(--profile turn)
fi
EDGE_PORT="${EDGE_PORT:-8443}"
ORIGIN="https://$SCALE_DOMAIN"; [[ "$EDGE_PORT" == 443 ]] || ORIGIN="$ORIGIN:$EDGE_PORT"
[[ ",$ALLOWED_ORIGINS," == *",$ORIGIN,"* ]] \
  || { echo "ALLOWED_ORIGINS precisa conter $ORIGIN." >&2; exit 1; }

# Backup antes de atualizar (se ja houver instalacao).
if docker volume inspect scale_db_data >/dev/null 2>&1; then
  ./deploy/backup.sh
fi

"${COMPOSE[@]}" config --quiet
"${COMPOSE[@]}" up --build -d --remove-orphans

echo "Aguardando servicos ficarem healthy..."
for _ in $(seq 1 30); do
  unhealthy=$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | grep -v ' healthy$' || true)
  [[ -z "$unhealthy" ]] && break
  sleep 5
done
"${COMPOSE[@]}" ps
[[ -z "${unhealthy:-}" ]] || { echo "Servicos sem healthy: $unhealthy" >&2; exit 1; }
echo "OK: $ORIGIN"
