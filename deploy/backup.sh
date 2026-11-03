#!/usr/bin/env bash
# Backup do SQLite e dos anexos (volumes Docker) em ./backups, com retencao.
# Uso: ./deploy/backup.sh   (sugestao de cron diario: 0 3 * * * cd /opt/scale && ./deploy/backup.sh)
set -Eeuo pipefail
cd "$(dirname "$0")/.."
trap 'echo "ERRO no backup (linha $LINENO)." >&2' ERR

KEEP_DAYS="${KEEP_DAYS:-14}"
DEST="$(pwd)/backups"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"; chmod 700 "$DEST"

for vol in db_data uploads_data; do
  docker volume inspect "scale_$vol" >/dev/null 2>&1 || { echo "Volume scale_$vol nao existe, pulando."; continue; }
  docker run --rm -v "scale_$vol:/src:ro" -v "$DEST:/dst" alpine \
    tar -czf "/dst/${vol}-${STAMP}.tar.gz" -C /src .
  echo "Backup: backups/${vol}-${STAMP}.tar.gz"
done

find "$DEST" -name '*.tar.gz' -mtime +"$KEEP_DAYS" -delete
