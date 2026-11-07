"""Regressoes sem Docker/volumes reais; fixtures SQLite WAL e fake docker."""
import datetime as dt
import importlib.util
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('backup_snapshot', HERE / 'backup_snapshot.py')
backup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(backup)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='scale-backup-test-')
        self.root = Path(self.temp.name)
        self.db = self.root / 'db'
        self.uploads = self.root / 'uploads'
        self.destination = self.root / 'out'
        for item in (self.db, self.uploads, self.destination):
            item.mkdir()
        self.connection = sqlite3.connect(self.db / 'data.db')
        self.connection.execute('PRAGMA journal_mode=WAL')
        self.connection.execute('CREATE TABLE ChatFile(path TEXT)')
        self.connection.execute('CREATE TABLE User(avatarPath TEXT)')
        self.connection.execute("INSERT INTO ChatFile VALUES ('uploads/room/file.txt')")
        self.connection.execute("INSERT INTO User VALUES ('uploads/avatars/avatar.png')")
        self.connection.commit()
        (self.uploads / 'room').mkdir()
        (self.uploads / 'avatars').mkdir()
        (self.uploads / 'room/file.txt').write_bytes(b'attachment')
        (self.uploads / 'avatars/avatar.png').write_bytes(b'avatar')
        (self.uploads / 'unreferenced').write_bytes(b'not in snapshot')

    def tearDown(self):
        self.connection.close()
        self.temp.cleanup()

    def test_online_wal_snapshot_restores_db_and_exact_references(self):
        backup.snapshot(self.db / 'data.db', self.uploads, self.destination, '20261106-120000-1')
        archive = self.destination / 'backup-20261106-120000-1.tar.gz'
        with tarfile.open(archive) as saved:
            self.assertEqual(set(saved.getnames()), {'db_data/data.db', 'uploads_data/room/file.txt', 'uploads_data/avatars/avatar.png'})
            self.assertEqual(saved.extractfile('uploads_data/room/file.txt').read(), b'attachment')
            restored = self.root / 'restored.db'
            restored.write_bytes(saved.extractfile('db_data/data.db').read())
        with sqlite3.connect(restored) as restored_db:
            self.assertEqual(restored_db.execute('PRAGMA integrity_check').fetchone(), ('ok',))
            self.assertEqual(restored_db.execute('SELECT path FROM ChatFile').fetchone(), ('uploads/room/file.txt',))

    def test_missing_reference_aborts_snapshot(self):
        (self.uploads / 'room/file.txt').unlink()
        with self.assertRaisesRegex(RuntimeError, 'ausente'):
            backup.snapshot(self.db / 'data.db', self.uploads, self.destination, '20261106-120000-2')

    def test_traversal_and_symlink_are_rejected(self):
        self.connection.execute("UPDATE ChatFile SET path='uploads/../outside'")
        self.connection.commit()
        with self.assertRaisesRegex(RuntimeError, 'invalido'):
            backup.snapshot(self.db / 'data.db', self.uploads, self.destination, '20261106-120000-3')
        self.connection.execute("UPDATE ChatFile SET path='uploads/room/link'")
        self.connection.commit()
        (self.uploads / 'room/link').symlink_to(self.db / 'data.db')
        with self.assertRaises(ValueError):
            backup.snapshot(self.db / 'data.db', self.uploads, self.destination, '20261106-120000-4')

    def test_retention_caps_extras_preserving_daily_window(self):
        now = dt.datetime(2026, 11, 6, 12, tzinfo=dt.timezone.utc)
        for day in range(20):
            for hour in range(4):
                stamp = now - dt.timedelta(days=day, hours=hour)
                (self.destination / f'backup-{stamp:%Y%m%d-%H%M%S}-{hour}.tar.gz').touch()
        legacy = self.destination / 'db_data-old.tar.gz'
        legacy.touch()
        backup.prune(self.destination, 14, 30, now=now)
        kept = list(self.destination.glob('backup-*.tar.gz'))
        self.assertEqual(len(kept), 30)
        for day in range(14):
            prefix = f'backup-{now-dt.timedelta(days=day):%Y%m%d}'
            self.assertTrue(any(item.name.startswith(prefix) for item in kept))
        self.assertTrue(legacy.exists())

    def test_script_failure_preserves_old_backups_and_never_stops_backend(self):
        project = self.root / 'project'
        (project / 'deploy').mkdir(parents=True)
        for name in ('backup.sh', 'backup_snapshot.py'):
            shutil.copy(HERE / name, project / 'deploy' / name)
        bindir = self.root / 'bin'
        bindir.mkdir()
        fake = bindir / 'docker'
        fake.write_text('''#!/usr/bin/env python3
import os, subprocess, sys
args = sys.argv[1:]
if args[:2] in [['volume','inspect'], ['image','inspect']]:
    sys.exit(0)
if args[0] != 'run':
    raise SystemExit('Unexpected Docker command: ' + args[0])
mounts = {}
for index, value in enumerate(args):
    if value == '-v':
        source, destination, *_ = args[index+1].split(':')
        mounts[destination] = source
if os.getenv('FAIL_BACKUP') == '1' and 'snapshot' in args:
    sys.exit(2)
start = args.index('python')
command = args[start+1:]
for index, value in enumerate(command):
    for mount, source in sorted(mounts.items(), key=lambda item: -len(item[0])):
        if value == mount or value.startswith(mount + '/'):
            if source == 'scale_db_data': source = os.environ['FAKE_DB']
            if source == 'scale_uploads_data': source = os.environ['FAKE_UPLOADS']
            command[index] = source + value[len(mount):]
            break
raise SystemExit(subprocess.call([sys.executable, *command]))
''')
        fake.chmod(0o755)
        backups = project / 'backups'
        backups.mkdir()
        old = backups / 'backup-20000101-120000-1.tar.gz'
        old.write_text('old recovery point')
        env = {**os.environ, 'PATH': f'{bindir}:{os.environ["PATH"]}', 'FAKE_DB': str(self.db), 'FAKE_UPLOADS': str(self.uploads), 'FAIL_BACKUP': '1'}
        failed = subprocess.run(['bash', str(project / 'deploy/backup.sh')], env=env, capture_output=True)
        self.assertNotEqual(failed.returncode, 0)
        self.assertEqual(old.read_text(), 'old recovery point')
        self.assertEqual(list(backups.glob('.partial-*')), [])
        self.assertEqual(len(list(backups.glob('*.tar.gz'))), 1)
        env['FAIL_BACKUP'] = '0'
        success = subprocess.run(['bash', str(project / 'deploy/backup.sh')], env=env, capture_output=True)
        self.assertEqual(success.returncode, 0, success.stderr.decode())
        self.assertFalse(old.exists())
        self.assertEqual(len(list(backups.glob('backup-*.tar.gz'))), 1)
        self.assertEqual(list(backups.glob('.partial-*')), [])


if __name__ == '__main__':
    unittest.main()
