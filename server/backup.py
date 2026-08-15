from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import threading
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from . import APP_VERSION, SCHEMA_VERSION
from .database import Database


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")


class BackupManager:
    def __init__(self, database: Database):
        self.database = database
        self._create_lock = threading.Lock()

    def backup_directory(self) -> Path:
        settings = self.database.get_settings()
        configured = Path(settings["backup_dir"]).expanduser()
        if not configured.is_absolute():
            configured = self.database.project_root / configured
        configured.mkdir(parents=True, exist_ok=True)
        return configured.resolve()

    def create(self) -> dict[str, Any]:
        if not self._create_lock.acquire(blocking=False):
            raise RuntimeError("Já existe um backup em execução.")
        try:
            backup_dir = self.backup_directory()
            file_name = f"centro-dpern-backup-{_timestamp()}.zip"
            destination = backup_dir / file_name
            with tempfile.TemporaryDirectory(prefix="dpern-backup-") as temporary:
                temp_dir = Path(temporary)
                database_copy = temp_dir / "centro-dpern.sqlite3"
                self.database.online_backup(database_copy)
                database_hash = _sha256(database_copy)
                manifest = {
                    "format": "centro-estudos-dpern-backup",
                    "format_version": 1,
                    "app_version": APP_VERSION,
                    "schema_version": SCHEMA_VERSION,
                    "created_at": datetime.now(timezone.utc).replace(microsecond=0).isoformat(),
                    "database_file": database_copy.name,
                    "database_sha256": database_hash,
                }
                manifest_path = temp_dir / "manifest.json"
                manifest_path.write_text(
                    json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8"
                )
                temp_zip = temp_dir / file_name
                with zipfile.ZipFile(temp_zip, "w", compression=zipfile.ZIP_DEFLATED) as archive:
                    archive.write(database_copy, database_copy.name)
                    archive.write(manifest_path, manifest_path.name)
                shutil.copy2(temp_zip, destination)
            package_hash = _sha256(destination)
            self.database.record_backup(file_name, str(destination), package_hash, "CRIADO")
            verification = self.verify(file_name)
            return {**verification, "file_hash": package_hash}
        finally:
            self._create_lock.release()

    def auto_backup_due(self, max_age_hours: int = 24) -> bool:
        backups = self.list()
        if not backups:
            return True
        newest = self._safe_file(backups[0]["file_name"])
        age_seconds = time.time() - newest.stat().st_mtime
        return age_seconds >= max(1, max_age_hours) * 3600

    def _safe_file(self, file_name: str) -> Path:
        candidate = Path(file_name)
        if candidate.name != file_name or not file_name.endswith(".zip"):
            raise ValueError("Nome de backup inválido.")
        resolved = (self.backup_directory() / file_name).resolve()
        if resolved.parent != self.backup_directory():
            raise ValueError("Caminho de backup inválido.")
        if not resolved.exists():
            raise FileNotFoundError(file_name)
        return resolved

    def list(self) -> list[dict[str, Any]]:
        result = []
        for path in sorted(self.backup_directory().glob("centro-dpern-backup-*.zip"), reverse=True):
            stat = path.stat()
            result.append(
                {
                    "file_name": path.name,
                    "size_bytes": stat.st_size,
                    "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc)
                    .replace(microsecond=0)
                    .isoformat(),
                }
            )
        return result

    def verify(self, file_name: str) -> dict[str, Any]:
        path = self._safe_file(file_name)
        with zipfile.ZipFile(path) as archive:
            names = archive.namelist()
            if sorted(names) != ["centro-dpern.sqlite3", "manifest.json"]:
                raise ValueError("Estrutura do pacote de backup inválida.")
            manifest = json.loads(archive.read("manifest.json").decode("utf-8"))
            if manifest.get("format") != "centro-estudos-dpern-backup":
                raise ValueError("Formato de backup não reconhecido.")
            if manifest.get("format_version") != 1:
                raise ValueError("Versão do pacote de backup incompatível.")
            database_info = archive.getinfo("centro-dpern.sqlite3")
            if database_info.file_size > 500 * 1024 * 1024:
                raise ValueError("O banco contido no backup excede o limite de segurança.")
            database_bytes = archive.read("centro-dpern.sqlite3")
        actual_hash = hashlib.sha256(database_bytes).hexdigest()
        if actual_hash != manifest.get("database_sha256"):
            raise ValueError("O conteúdo do backup não corresponde ao manifesto.")
        with tempfile.NamedTemporaryFile(suffix=".sqlite3", delete=False) as temporary:
            temporary.write(database_bytes)
            temp_path = Path(temporary.name)
        try:
            self.database.validate_database_file(temp_path)
        finally:
            temp_path.unlink(missing_ok=True)
        self.database.mark_backup_verified(file_name)
        return {"file_name": file_name, "status": "VERIFICADO", "manifest": manifest}

    def restore(self, file_name: str) -> dict[str, Any]:
        verification = self.verify(file_name)
        path = self._safe_file(file_name)
        with tempfile.TemporaryDirectory(prefix="dpern-restore-") as temporary:
            temp_dir = Path(temporary)
            with zipfile.ZipFile(path) as archive:
                archive.extract("centro-dpern.sqlite3", temp_dir)
            replacement = temp_dir / "centro-dpern.sqlite3"
            recovery = self.backup_directory() / f"pre-restauracao-{_timestamp()}.sqlite3"
            self.database.replace_database(replacement, recovery)
        self.database.initialize()
        return {
            "file_name": file_name,
            "status": "RESTAURADO",
            "recovery_file": recovery.name,
            "manifest": verification["manifest"],
        }


class AutoBackupScheduler(threading.Thread):
    def __init__(self, manager: BackupManager):
        super().__init__(name="automatic-backup", daemon=True)
        self.manager = manager
        self._stop_event = threading.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def run(self) -> None:
        # A interface abre primeiro; a proteção de dados começa em seguida.
        if self._stop_event.wait(8):
            return
        while not self._stop_event.is_set():
            try:
                settings = self.manager.database.get_settings()
                enabled = str(settings.get("auto_backup", "true")).lower() == "true"
                if enabled and self.manager.auto_backup_due():
                    self.manager.create()
            except Exception as error:
                # A falha fica visível no terminal e não derruba o estudo local.
                print(f"[backup] Falha no backup automático: {type(error).__name__}: {error}")
            self._stop_event.wait(300)
