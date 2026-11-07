"""Backup consistente via sqlite3.Connection.backup; somente volumes Scale.

SQLite e copiado online; somente anexos imutaveis referenciados no snapshot
sao incluidos. Exclusao concorrente cancela o backup, sem publicar/prunar. Nao inclui .env, tokens ou arquivos de configuracao do host.
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import sqlite3
import sys
import tarfile
import time


def snapshot(database: Path, uploads: Path, destination: Path, stamp: str):
    started = time.monotonic()
    compression = int(os.environ.get("BACKUP_COMPRESSION_LEVEL", "1"))
    if not 1 <= compression <= 9:
        raise ValueError("BACKUP_COMPRESSION_LEVEL deve ser 1..9")
    if not database.is_file() or not uploads.is_dir():
        raise RuntimeError("Volumes incompletos: backup cancelado")
    database_copy = destination / "data.db"
    # mode=ro preserva WAL quando presente; nao usar immutable=1 (ignora WAL).
    with sqlite3.connect(database.as_uri() + "?mode=ro", uri=True) as source:
        with sqlite3.connect(database_copy) as target:
            source.backup(target, pages=256)
            if target.execute("PRAGMA quick_check").fetchall() != [("ok",)]:
                raise RuntimeError("SQLite quick_check falhou")
    archive = destination / f"backup-{stamp}.tar.gz"
    with sqlite3.connect(database_copy) as copied:
        references = copied.execute('SELECT path FROM ChatFile UNION SELECT avatarPath FROM User WHERE avatarPath IS NOT NULL ORDER BY 1')
        with tarfile.open(archive, "w:gz", compresslevel=compression) as output:
            output.add(database_copy, arcname="db_data/data.db")
            for (reference,) in references:
                relative = Path(reference)
                if relative.is_absolute() or relative.parts[0] != "uploads" or ".." in relative.parts:
                    raise RuntimeError("Caminho de anexo invalido no snapshot")
                source_file = uploads.joinpath(*relative.parts[1:])
                source_file.resolve().relative_to(uploads.resolve())
                if not source_file.is_file() or source_file.is_symlink():
                    raise RuntimeError("Anexo referenciado ausente; snapshot cancelado")
                # read/add e obrigatorio: missing durante purge/avatar cancela tar.
                output.add(source_file, arcname=str(Path("uploads_data", *relative.parts[1:])), recursive=False)
    # Abrir e percorrer headers detecta truncamento antes de publicar o snapshot.
    with tarfile.open(archive, "r:gz") as check:
        for member in check:
            if member.isfile():
                stream = check.extractfile(member)
                while stream.read(1024 * 1024):
                    pass
    with archive.open("rb") as handle:
        os.fsync(handle.fileno())
    print(json.dumps({"bytes": archive.stat().st_size, "durationSeconds": round(time.monotonic() - started, 3)}))


def prune(directory: Path, keep_days: int, max_backups: int, now=None):
    if keep_days < 1 or max_backups < keep_days + 1:
        raise ValueError("Retencao invalida")
    now = now or dt.datetime.now(dt.timezone.utc)
    cutoff = now - dt.timedelta(days=keep_days)
    backups = []
    for item in directory.iterdir():
        match = re.fullmatch(r"backup-(\d{8}-\d{6})-\d+\.tar\.gz", item.name)
        if item.is_file() and match:
            stamp = dt.datetime.strptime(match[1], "%Y%m%d-%H%M%S").replace(tzinfo=dt.timezone.utc)
            backups.append((stamp, item))
        legacy = re.fullmatch(r"(?:db_data|uploads_data)-(\d{8}-\d{6})\.tar\.gz", item.name)
        if item.is_file() and legacy:
            stamp = dt.datetime.strptime(legacy[1], "%Y%m%d-%H%M%S").replace(tzinfo=dt.timezone.utc)
            if stamp < cutoff:
                item.unlink()
    backups.sort(reverse=True)
    # Protege o mais recente de cada data dentro da janela de retencao.
    protected = set()
    dates = set()
    for stamp, item in backups:
        if stamp >= cutoff and stamp.date() not in dates:
            dates.add(stamp.date())
            protected.add(item)
    # Preserva SEMPRE o ultimo snapshot, mesmo se o relogio do host mudou.
    if backups:
        protected.add(backups[0][1])
    kept = len(backups)
    for stamp, item in reversed(backups):
        if item not in protected and (stamp < cutoff or kept > max_backups):
            item.unlink()
            kept -= 1


if __name__ == "__main__":
    if sys.argv[1] == "snapshot":
        snapshot(Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4]), sys.argv[5])
    elif sys.argv[1] == "prune":
        prune(Path(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4]))
    else:
        raise SystemExit("Comando invalido")
