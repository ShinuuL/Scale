#!/usr/bin/env bash
# Snapshot SQLite online + somente anexos imutaveis referenciados no snapshot.
# KEEP_DAYS preserva pelo menos o ultimo backup de cada dia da janela.
# MAX_BACKUPS limita copias extras sem encurtar essa janela (>= KEEP_DAYS+1).
set -Eeuo pipefail
cd "$(dirname "$0")/.."
umask 077
KEEP_DAYS="${KEEP_DAYS:-14}"
MAX_BACKUPS="${MAX_BACKUPS:-30}"
BACKUP_IMAGE="${BACKUP_IMAGE:-python:3.12-alpine}"
BACKUP_COMPRESSION_LEVEL="${BACKUP_COMPRESSION_LEVEL:-1}"
[[ "$BACKUP_COMPRESSION_LEVEL" =~ ^[1-9]$ ]] || { echo 'BACKUP_COMPRESSION_LEVEL deve ser 1..9.' >&2; exit 1; }
DEST="$(pwd)/backups"
[[ "$KEEP_DAYS" =~ ^[0-9]+$ && "$MAX_BACKUPS" =~ ^[0-9]+$ ]] || { echo 'Retencao invalida.' >&2; exit 1; }
(( KEEP_DAYS >= 1 && MAX_BACKUPS >= KEEP_DAYS + 1 )) || { echo 'MAX_BACKUPS deve ser >= KEEP_DAYS+1.' >&2; exit 1; }
mkdir -p "$DEST"
chmod 700 "$DEST"
# Nao permita crons/deploys simultaneos. Lock fica no volume de backups.
exec 9>"$DEST/.backup.lock"
flock -n 9 || { echo 'Outro backup esta em andamento.' >&2; exit 1; }
STAMP="$(date -u +%Y%m%d-%H%M%S)-$$"
PARTIAL=".partial-$STAMP"
cleanup() {
  local status=$?
  trap - EXIT
  # Arquivos parciais sao removidos; nenhuma retencao roda em falha.
  rm -rf -- "$DEST/$PARTIAL"
  (( status == 0 )) || echo 'ERRO no backup; backups anteriores preservados.' >&2
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
for vol in db_data uploads_data; do
  docker volume inspect "scale_$vol" >/dev/null
done
# Preparar helper sem interromper a API.
docker image inspect "$BACKUP_IMAGE" >/dev/null 2>&1 || docker pull "$BACKUP_IMAGE" >/dev/null
mkdir "$DEST/$PARTIAL"
docker run --rm -e BACKUP_COMPRESSION_LEVEL="$BACKUP_COMPRESSION_LEVEL" \
  -v scale_db_data:/src/db:ro -v scale_uploads_data:/src/uploads:ro \
  -v "$DEST:/dst" -v "$(pwd)/deploy/backup_snapshot.py:/backup_snapshot.py:ro" \
  "$BACKUP_IMAGE" python /backup_snapshot.py snapshot /src/db/data.db /src/uploads "/dst/$PARTIAL" "$STAMP"
mv -- "$DEST/$PARTIAL/backup-$STAMP.tar.gz" "$DEST/backup-$STAMP.tar.gz"
docker run --rm -v "$DEST:/dst" -v "$(pwd)/deploy/backup_snapshot.py:/backup_snapshot.py:ro" \
  "$BACKUP_IMAGE" python /backup_snapshot.py prune /dst "$KEEP_DAYS" "$MAX_BACKUPS"
echo "Backup: backups/backup-$STAMP.tar.gz"
