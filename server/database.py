from __future__ import annotations

import hashlib
import json
import os
import shutil
import sqlite3
import tempfile
import threading
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from . import SCHEMA_VERSION


WORKSPACE_ID = "local-workspace"
VALID_STUDY_STATUSES = {"NAO_INICIADO", "EM_ESTUDO", "REVISAO", "CONSOLIDADO"}
VALID_JURISPRUDENCE_STUDY_STATUSES = {"NAO_LIDO", "LIDO", "REVISAO"}
VALID_PRIORITIES = {"ALTA", "MEDIA", "BAIXA"}


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def canonical_hash(value: Any) -> str:
    payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


class Database:
    def __init__(self, path: Path, project_root: Path):
        self.path = path
        self.project_root = project_root
        self._write_lock = threading.RLock()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        # Uma instalação não tem concorrência de usuários, mas o servidor local
        # e os agendadores usam threads. Serializar os acessos impede que uma
        # restauração substitua o arquivo enquanto outra conexão ainda o utiliza.
        with self._write_lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            connection = sqlite3.connect(self.path, timeout=15)
            connection.row_factory = sqlite3.Row
            connection.execute("PRAGMA foreign_keys = ON")
            connection.execute("PRAGMA busy_timeout = 15000")
            try:
                yield connection
            finally:
                connection.close()

    def initialize(self) -> None:
        schema = (self.project_root / "server" / "schema.sql").read_text(encoding="utf-8")
        now = utc_now()
        with self._write_lock, self.connect() as connection:
            connection.executescript(schema)
            self._migrate_schema(connection)
            connection.execute(
                "INSERT OR REPLACE INTO app_meta(key, value) VALUES('schema_version', ?)",
                (str(SCHEMA_VERSION),),
            )
            existing = connection.execute(
                "SELECT installation_id FROM study_workspace WHERE id = ?", (WORKSPACE_ID,)
            ).fetchone()
            if not existing:
                connection.execute(
                    """
                    INSERT INTO study_workspace(
                        id, installation_id, candidate_name, target_exam_date,
                        target_date_status, created_at, updated_at
                    ) VALUES (?, ?, '', '2026-12-13', 'ESTIMADA', ?, ?)
                    """,
                    (WORKSPACE_ID, str(uuid.uuid4()), now, now),
                )
            defaults = {
                "backup_dir": str(self.path.parent / "backups"),
                "auto_backup": "true",
                "jurisprudence_auto_update": "true",
                "jurisprudence_update_interval_hours": "12",
            }
            for key, value in defaults.items():
                connection.execute(
                    "INSERT OR IGNORE INTO settings(key, value, updated_at) VALUES (?, ?, ?)",
                    (key, value, now),
                )
            self._seed_sources(connection)
            connection.commit()
        self.seed_program(self.project_root / "data" / "program.json")
        with self._write_lock, self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")

    @staticmethod
    def _migrate_schema(connection: sqlite3.Connection) -> None:
        """Adiciona campos novos sem apagar bancos pessoais das versoes anteriores."""
        migrations = {
            "questions": {
                "authorship_type": "TEXT NOT NULL DEFAULT 'HUMANA'",
                "ai_model": "TEXT NOT NULL DEFAULT ''",
                "ai_prompt_version": "TEXT NOT NULL DEFAULT ''",
                "validation_status": "TEXT NOT NULL DEFAULT 'NAO_APLICAVEL'",
                "official_reference": "TEXT NOT NULL DEFAULT ''",
                "validated_at": "TEXT",
                "validation_note": "TEXT NOT NULL DEFAULT ''",
            },
            "quiz_sessions": {
                "is_experimental": "INTEGER NOT NULL DEFAULT 0",
            },
            "quiz_session_questions": {
                "authorship_type_snapshot": "TEXT NOT NULL DEFAULT 'HUMANA'",
                "validation_status_snapshot": "TEXT NOT NULL DEFAULT 'NAO_APLICAVEL'",
                "source_url_snapshot": "TEXT NOT NULL DEFAULT ''",
                "official_reference_snapshot": "TEXT NOT NULL DEFAULT ''",
            },
            "study_plan_entries": {
                "legislation_json": "TEXT NOT NULL DEFAULT '[]'",
                "legislation_status": "TEXT NOT NULL DEFAULT 'PENDENTE_MAPEAMENTO'",
                "legislation_note": "TEXT NOT NULL DEFAULT ''",
            },
            "study_plan_runs": {
                "adjustments_json": "TEXT NOT NULL DEFAULT '[]'",
            },
            "discursive_prompts": {
                "prompt_type": "TEXT NOT NULL DEFAULT 'QUESTAO'",
                "discursive_group": "TEXT",
                "line_limit": "INTEGER NOT NULL DEFAULT 30",
                "max_score": "REAL NOT NULL DEFAULT 2.5",
                "answer_key_json": "TEXT NOT NULL DEFAULT '[]'",
                "jurisprudence_anchors_json": "TEXT NOT NULL DEFAULT '[]'",
                "catalog_version": "TEXT NOT NULL DEFAULT ''",
            },
        }
        for table, columns in migrations.items():
            existing = {
                row["name"] for row in connection.execute(f"PRAGMA table_info({table})")
            }
            for name, definition in columns.items():
                if name not in existing:
                    connection.execute(f"ALTER TABLE {table} ADD COLUMN {name} {definition}")
        connection.execute(
            """
            CREATE INDEX IF NOT EXISTS idx_questions_authorship
            ON questions(authorship_type, validation_status)
            """
        )

    def _seed_sources(self, connection: sqlite3.Connection) -> None:
        sources = [
            (
                "stj-informativo",
                "STJ",
                "Informativo de Jurisprudência",
                "ATOM",
                "https://processo.stj.jus.br/jurisprudencia/externo/InformativoFeed",
                1,
                720,
                "1",
            ),
            (
                "stf-informativo",
                "STF",
                "Informativo STF",
                "HTML_LATEST",
                "https://www.stf.jus.br/arquivo/informativo/documento/informativo.htm",
                1,
                720,
                "1",
            ),
            (
                "stj-teses",
                "STJ",
                "Jurisprudência em Teses",
                "ATOM",
                "https://scon.stj.jus.br/SCON/JurisprudenciaEmTesesFeed",
                0,
                1440,
                "1",
            ),
        ]
        connection.executemany(
            """
            INSERT INTO jurisprudence_sources(
                id, court, name, source_kind, url, enabled,
                update_interval_minutes, parser_version
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                court = excluded.court,
                name = excluded.name,
                source_kind = excluded.source_kind,
                url = excluded.url,
                update_interval_minutes = excluded.update_interval_minutes,
                parser_version = excluded.parser_version
            """,
            sources,
        )

    def seed_program(self, source: Path) -> None:
        payload = json.loads(source.read_text(encoding="utf-8"))
        topics = payload["program"]
        now = utc_now()
        discipline_order: dict[str, int] = {}
        with self._write_lock, self.connect() as connection:
            for item in topics:
                code = item["discipline_code"]
                if code not in discipline_order:
                    discipline_order[code] = len(discipline_order) + 1
                connection.execute(
                    """
                    INSERT INTO disciplines(code, name, objective_group, discursive_group, sort_order)
                    VALUES (?, ?, ?, ?, ?)
                    ON CONFLICT(code) DO UPDATE SET
                        name = excluded.name,
                        objective_group = excluded.objective_group,
                        discursive_group = excluded.discursive_group,
                        sort_order = excluded.sort_order
                    """,
                    (
                        code,
                        item["discipline"],
                        item["objective_group"],
                        item["discursive_group"],
                        discipline_order[code],
                    ),
                )
                canonical = {
                    "title": item["topic"],
                    "norms": item.get("norms", []),
                    "source_page": item.get("source_page"),
                    "source_url": item["source_url"],
                    "version": item["version"],
                }
                connection.execute(
                    """
                    INSERT INTO program_topics(
                        id, objective_group, discursive_group, discipline_code,
                        item_number, title, referenced_norms, source_page,
                        source_url, source_version, evidence_status,
                        canonical_hash, imported_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        objective_group = excluded.objective_group,
                        discursive_group = excluded.discursive_group,
                        discipline_code = excluded.discipline_code,
                        item_number = excluded.item_number,
                        title = excluded.title,
                        referenced_norms = excluded.referenced_norms,
                        source_page = excluded.source_page,
                        source_url = excluded.source_url,
                        source_version = excluded.source_version,
                        evidence_status = excluded.evidence_status,
                        canonical_hash = excluded.canonical_hash
                    """,
                    (
                        item["id"],
                        item["objective_group"],
                        item["discursive_group"],
                        code,
                        item["item"],
                        item["topic"],
                        "; ".join(item.get("norms", [])),
                        item.get("source_page"),
                        item["source_url"],
                        item["version"],
                        item["evidence"],
                        canonical_hash(canonical),
                        now,
                    ),
                )
                connection.execute(
                    """
                    INSERT OR IGNORE INTO topic_progress(topic_id, updated_at)
                    VALUES (?, ?)
                    """,
                    (item["id"], now),
                )
            connection.commit()

    def get_settings(self) -> dict[str, Any]:
        with self.connect() as connection:
            workspace = dict(
                connection.execute(
                    "SELECT * FROM study_workspace WHERE id = ?", (WORKSPACE_ID,)
                ).fetchone()
            )
            settings = {
                row["key"]: row["value"]
                for row in connection.execute("SELECT key, value FROM settings")
            }
        settings.update(
            {
                "candidate_name": workspace["candidate_name"],
                "target_exam_date": workspace["target_exam_date"],
                "target_date_status": workspace["target_date_status"],
                "installation_id": workspace["installation_id"],
            }
        )
        return settings

    def update_settings(self, payload: dict[str, Any]) -> dict[str, Any]:
        allowed_settings = {
            "backup_dir",
            "auto_backup",
            "jurisprudence_auto_update",
            "jurisprudence_update_interval_hours",
        }
        if "backup_dir" in payload and not str(payload["backup_dir"]).strip():
            raise ValueError("A pasta de backups não pode ficar vazia.")
        for key in ("auto_backup", "jurisprudence_auto_update"):
            if key in payload and str(payload[key]).lower() not in {"true", "false"}:
                raise ValueError(f"Valor inválido para {key}.")
        if "jurisprudence_update_interval_hours" in payload:
            interval = float(payload["jurisprudence_update_interval_hours"])
            if not 0.25 <= interval <= 168:
                raise ValueError("O intervalo de atualização deve ficar entre 15 minutos e 7 dias.")
        if payload.get("target_exam_date"):
            try:
                date.fromisoformat(str(payload["target_exam_date"]))
            except ValueError as error:
                raise ValueError("Data provável da prova inválida.") from error
        now = utc_now()
        with self._write_lock, self.connect() as connection:
            if "candidate_name" in payload or "target_exam_date" in payload:
                current = connection.execute(
                    "SELECT candidate_name, target_exam_date FROM study_workspace WHERE id = ?",
                    (WORKSPACE_ID,),
                ).fetchone()
                connection.execute(
                    """
                    UPDATE study_workspace
                    SET candidate_name = ?, target_exam_date = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        str(payload.get("candidate_name", current["candidate_name"]))[:120],
                        payload.get("target_exam_date", current["target_exam_date"]),
                        now,
                        WORKSPACE_ID,
                    ),
                )
            for key in allowed_settings.intersection(payload):
                value = str(payload[key]).lower() if isinstance(payload[key], bool) else str(payload[key])
                connection.execute(
                    """
                    INSERT INTO settings(key, value, updated_at) VALUES (?, ?, ?)
                    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
                    """,
                    (key, value, now),
                )
            connection.commit()
        return self.get_settings()

    def dashboard(self) -> dict[str, Any]:
        with self.connect() as connection:
            metrics = dict(
                connection.execute(
                    """
                    SELECT
                        COUNT(*) AS total_topics,
                        SUM(CASE WHEN p.study_status <> 'NAO_INICIADO' THEN 1 ELSE 0 END) AS started_topics,
                        SUM(CASE WHEN p.study_status = 'CONSOLIDADO' THEN 1 ELSE 0 END) AS consolidated_topics,
                        SUM(p.questions_done) AS questions_done,
                        SUM(p.correct_answers) AS correct_answers
                    FROM program_topics t
                    JOIN topic_progress p ON p.topic_id = t.id
                    """
                ).fetchone()
            )
            juris = dict(
                connection.execute(
                    """
                    SELECT
                        COUNT(*) AS total,
                        SUM(CASE WHEN COALESCE(p.study_status, 'NAO_LIDO') <> 'LIDO' THEN 1 ELSE 0 END) AS pending
                    FROM jurisprudence_items i
                    LEFT JOIN jurisprudence_progress p ON p.jurisprudence_item_id = i.id
                    """
                ).fetchone()
            )
            by_group = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT t.objective_group AS group_name, COUNT(*) AS total,
                           SUM(CASE WHEN p.study_status = 'CONSOLIDADO' THEN 1 ELSE 0 END) AS consolidated
                    FROM program_topics t
                    JOIN topic_progress p ON p.topic_id = t.id
                    GROUP BY t.objective_group
                    ORDER BY CASE t.objective_group
                        WHEN 'I' THEN 1 WHEN 'II' THEN 2 WHEN 'III' THEN 3 ELSE 4 END
                    """
                )
            ]
            recent_updates = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT s.court, s.name, s.last_checked_at, s.last_success_at, s.last_error
                    FROM jurisprudence_sources s
                    ORDER BY s.court, s.name
                    """
                )
            ]
        metrics = {key: (value or 0) for key, value in metrics.items()}
        accuracy = (
            metrics["correct_answers"] / metrics["questions_done"]
            if metrics["questions_done"]
            else None
        )
        return {
            "metrics": {**metrics, "accuracy": accuracy},
            "jurisprudence": {key: (value or 0) for key, value in juris.items()},
            "groups": by_group,
            "sources": recent_updates,
            "settings": self.get_settings(),
        }

    def list_disciplines(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    "SELECT * FROM disciplines ORDER BY sort_order"
                )
            ]

    def list_program(
        self,
        discipline: str | None = None,
        study_status: str | None = None,
        query: str | None = None,
        limit: int = 500,
        offset: int = 0,
    ) -> dict[str, Any]:
        filters: list[str] = []
        params: list[Any] = []
        if discipline:
            filters.append("t.discipline_code = ?")
            params.append(discipline)
        if study_status:
            filters.append("p.study_status = ?")
            params.append(study_status)
        if query:
            filters.append("(t.title LIKE ? OR t.id LIKE ? OR t.referenced_norms LIKE ?)")
            token = f"%{query}%"
            params.extend([token, token, token])
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        limit = max(1, min(limit, 500))
        offset = max(0, offset)
        with self.connect() as connection:
            total = connection.execute(
                f"""
                SELECT COUNT(*)
                FROM program_topics t
                JOIN topic_progress p ON p.topic_id = t.id
                {where}
                """,
                params,
            ).fetchone()[0]
            rows = [
                dict(row)
                for row in connection.execute(
                    f"""
                    SELECT
                        t.*, d.name AS discipline_name, d.sort_order,
                        p.study_status, p.priority, p.mastery,
                        p.questions_done, p.correct_answers,
                        p.last_review, p.next_review, p.notes, p.updated_at AS progress_updated_at
                    FROM program_topics t
                    JOIN disciplines d ON d.code = t.discipline_code
                    JOIN topic_progress p ON p.topic_id = t.id
                    {where}
                    ORDER BY d.sort_order, t.item_number
                    LIMIT ? OFFSET ?
                    """,
                    [*params, limit, offset],
                )
            ]
        return {"total": total, "items": rows, "limit": limit, "offset": offset}

    def update_topic_progress(self, topic_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        allowed = {
            "study_status",
            "priority",
            "mastery",
            "questions_done",
            "correct_answers",
            "last_review",
            "next_review",
            "notes",
        }
        updates = {key: payload[key] for key in allowed.intersection(payload)}
        if not updates:
            raise ValueError("Nenhum campo de progresso reconhecido.")
        if "study_status" in updates and updates["study_status"] not in VALID_STUDY_STATUSES:
            raise ValueError("Status de estudo inválido.")
        if "priority" in updates and updates["priority"] not in VALID_PRIORITIES:
            raise ValueError("Prioridade inválida.")
        if "mastery" in updates and updates["mastery"] is not None:
            updates["mastery"] = int(updates["mastery"])
            if not 0 <= updates["mastery"] <= 5:
                raise ValueError("Domínio deve estar entre 0 e 5.")
        for key in ("questions_done", "correct_answers"):
            if key in updates:
                updates[key] = max(0, int(updates[key]))
        now = utc_now()
        with self._write_lock, self.connect() as connection:
            current = connection.execute(
                "SELECT * FROM topic_progress WHERE topic_id = ?", (topic_id,)
            ).fetchone()
            if not current:
                raise KeyError("Tópico não localizado.")
            merged = dict(current)
            merged.update(updates)
            if merged["correct_answers"] > merged["questions_done"]:
                raise ValueError("Acertos não podem superar o número de questões realizadas.")
            set_clause = ", ".join(f"{key} = ?" for key in updates)
            connection.execute(
                f"UPDATE topic_progress SET {set_clause}, updated_at = ? WHERE topic_id = ?",
                [*updates.values(), now, topic_id],
            )
            connection.execute(
                """
                INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                VALUES ('PROGRESS_UPDATED', 'PROGRAM_TOPIC', ?, ?, ?)
                """,
                (topic_id, json.dumps(updates, ensure_ascii=False), now),
            )
            connection.commit()
            row = connection.execute(
                """
                SELECT t.id, t.title, p.*
                FROM program_topics t JOIN topic_progress p ON p.topic_id = t.id
                WHERE t.id = ?
                """,
                (topic_id,),
            ).fetchone()
        return dict(row)

    def list_sources(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            return [dict(row) for row in connection.execute("SELECT * FROM jurisprudence_sources ORDER BY court, name")]

    def source(self, source_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM jurisprudence_sources WHERE id = ?", (source_id,)
            ).fetchone()
        if not row:
            raise KeyError(source_id)
        return dict(row)

    def start_update_run(self, source_id: str) -> int:
        with self._write_lock, self.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO update_runs(source_id, started_at, status) VALUES (?, ?, 'EXECUTANDO')",
                (source_id, utc_now()),
            )
            connection.commit()
            return int(cursor.lastrowid)

    def finish_update_run(
        self,
        run_id: int,
        source_id: str,
        status: str,
        detected: int,
        imported: int,
        message: str,
        etag: str | None = None,
        last_modified: str | None = None,
    ) -> None:
        now = utc_now()
        with self._write_lock, self.connect() as connection:
            connection.execute(
                """
                UPDATE update_runs
                SET finished_at = ?, status = ?, detected_count = ?, imported_count = ?, message = ?
                WHERE id = ?
                """,
                (now, status, detected, imported, message[:2000], run_id),
            )
            if status in {"SUCESSO", "SEM_ALTERACAO"}:
                connection.execute(
                    """
                    UPDATE jurisprudence_sources
                    SET last_checked_at = ?, last_success_at = ?, last_error = NULL,
                        etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified)
                    WHERE id = ?
                    """,
                    (now, now, etag, last_modified, source_id),
                )
            else:
                connection.execute(
                    "UPDATE jurisprudence_sources SET last_checked_at = ?, last_error = ? WHERE id = ?",
                    (now, message[:2000], source_id),
                )
            connection.commit()

    def upsert_jurisprudence_item(self, source_id: str, item: dict[str, Any]) -> bool:
        now = utc_now()
        with self._write_lock, self.connect() as connection:
            existing = connection.execute(
                """
                SELECT id, content_hash FROM jurisprudence_items
                WHERE source_id = ? AND external_id = ?
                """,
                (source_id, item["external_id"]),
            ).fetchone()
            connection.execute(
                """
                INSERT INTO jurisprudence_items(
                    source_id, external_id, issue_number, title, published_at,
                    source_url, summary, content_hash, source_status,
                    editorial_status, detected_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'FONTE_INSTITUCIONAL', 'IMPORTADO', ?, ?)
                ON CONFLICT(source_id, external_id) DO UPDATE SET
                    issue_number = excluded.issue_number,
                    title = excluded.title,
                    published_at = excluded.published_at,
                    source_url = excluded.source_url,
                    summary = excluded.summary,
                    content_hash = excluded.content_hash,
                    updated_at = excluded.updated_at,
                    editorial_status = CASE
                        WHEN jurisprudence_items.content_hash <> excluded.content_hash THEN 'EM_REVISAO'
                        ELSE jurisprudence_items.editorial_status
                    END
                """,
                (
                    source_id,
                    item["external_id"],
                    item.get("issue_number"),
                    item["title"],
                    item.get("published_at"),
                    item["source_url"],
                    item.get("summary", "")[:12000],
                    item["content_hash"],
                    now,
                    now,
                ),
            )
            connection.commit()
        return existing is None

    def count_missing_jurisprudence_summaries(self, source_id: str) -> int:
        with self.connect() as connection:
            return int(
                connection.execute(
                    """
                    SELECT COUNT(*) FROM jurisprudence_items
                    WHERE source_id = ?
                      AND (
                          LENGTH(TRIM(summary)) < 80
                          OR LOWER(TRIM(summary)) LIKE 'informativo de jurisprudência n%'
                          OR LOWER(TRIM(summary)) LIKE 'informativo stf n%'
                      )
                    """,
                    (source_id,),
                ).fetchone()[0]
            )

    def jurisprudence_summaries(self, source_id: str) -> dict[str, str]:
        """Retorna sínteses já enriquecidas para evitar refazer requisições oficiais."""
        with self.connect() as connection:
            return {
                str(row["external_id"]): str(row["summary"] or "")
                for row in connection.execute(
                    """
                    SELECT external_id, summary FROM jurisprudence_items
                    WHERE source_id = ? AND LENGTH(TRIM(summary)) >= 80
                    """,
                    (source_id,),
                )
            }

    def list_jurisprudence(
        self,
        court: str | None = None,
        editorial_status: str | None = None,
        study_status: str | None = None,
        query: str | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        filters: list[str] = []
        params: list[Any] = []
        if court:
            filters.append("s.court = ?")
            params.append(court)
        if editorial_status:
            filters.append("i.editorial_status = ?")
            params.append(editorial_status)
        if study_status:
            if study_status not in VALID_JURISPRUDENCE_STUDY_STATUSES:
                raise ValueError("Status de leitura da jurisprudência inválido.")
            filters.append("COALESCE(p.study_status, 'NAO_LIDO') = ?")
            params.append(study_status)
        if query:
            filters.append("(i.title LIKE ? OR i.summary LIKE ? OR i.issue_number LIKE ?)")
            token = f"%{query}%"
            params.extend([token, token, token])
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        limit = max(1, min(limit, 300))
        with self.connect() as connection:
            total = connection.execute(
                f"""
                SELECT COUNT(*) FROM jurisprudence_items i
                JOIN jurisprudence_sources s ON s.id = i.source_id
                LEFT JOIN jurisprudence_progress p ON p.jurisprudence_item_id = i.id
                {where}
                """,
                params,
            ).fetchone()[0]
            rows = [
                dict(row)
                for row in connection.execute(
                    f"""
                    SELECT i.*, s.court, s.name AS source_name,
                           COALESCE(p.study_status, 'NAO_LIDO') AS study_status,
                           COALESCE(p.priority, 'MEDIA') AS priority,
                           COALESCE(p.notes, '') AS notes
                    FROM jurisprudence_items i
                    JOIN jurisprudence_sources s ON s.id = i.source_id
                    LEFT JOIN jurisprudence_progress p ON p.jurisprudence_item_id = i.id
                    {where}
                    ORDER BY COALESCE(i.published_at, i.detected_at) DESC
                    LIMIT ?
                    """,
                    [*params, limit],
                )
            ]
        return {"total": total, "items": rows}

    def update_jurisprudence_progress(
        self, item_id: int, payload: dict[str, Any]
    ) -> dict[str, Any]:
        study_status = str(payload.get("study_status", "")).upper()
        if study_status not in VALID_JURISPRUDENCE_STUDY_STATUSES:
            raise ValueError("Status de leitura da jurisprudência inválido.")
        now = utc_now()
        last_review = now if study_status in {"LIDO", "REVISAO"} else None
        with self._write_lock, self.connect() as connection:
            if not connection.execute(
                "SELECT 1 FROM jurisprudence_items WHERE id = ?", (item_id,)
            ).fetchone():
                raise KeyError("Informativo não localizado.")
            connection.execute(
                """
                INSERT INTO jurisprudence_progress(
                    jurisprudence_item_id, study_status, last_review, updated_at
                ) VALUES (?, ?, ?, ?)
                ON CONFLICT(jurisprudence_item_id) DO UPDATE SET
                    study_status = excluded.study_status,
                    last_review = excluded.last_review,
                    updated_at = excluded.updated_at
                """,
                (item_id, study_status, last_review, now),
            )
            connection.execute(
                """
                INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                VALUES ('JURISPRUDENCE_PROGRESS_UPDATED', 'JURISPRUDENCE_ITEM', ?, ?, ?)
                """,
                (str(item_id), json.dumps({"study_status": study_status}), now),
            )
            connection.commit()
            row = connection.execute(
                """
                SELECT i.*, s.court, s.name AS source_name,
                       p.study_status, p.priority, p.notes, p.last_review
                FROM jurisprudence_items i
                JOIN jurisprudence_sources s ON s.id = i.source_id
                JOIN jurisprudence_progress p ON p.jurisprudence_item_id = i.id
                WHERE i.id = ?
                """,
                (item_id,),
            ).fetchone()
        return dict(row)

    def record_backup(
        self, file_name: str, file_path: str, file_hash: str, status: str, message: str = ""
    ) -> None:
        with self._write_lock, self.connect() as connection:
            connection.execute(
                """
                INSERT INTO backup_runs(file_name, file_path, file_hash, status, created_at, message)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (file_name, file_path, file_hash, status, utc_now(), message),
            )
            connection.commit()

    def mark_backup_verified(self, file_name: str) -> None:
        with self._write_lock, self.connect() as connection:
            connection.execute(
                "UPDATE backup_runs SET verified_at = ?, status = 'VERIFICADO' WHERE file_name = ?",
                (utc_now(), file_name),
            )
            connection.commit()

    def online_backup(self, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        with self._write_lock, self.connect() as source:
            source.execute("PRAGMA wal_checkpoint(FULL)")
            target = sqlite3.connect(destination)
            try:
                source.backup(target)
            finally:
                target.close()

    def validate_database_file(self, path: Path) -> None:
        connection = sqlite3.connect(path)
        try:
            result = connection.execute("PRAGMA integrity_check").fetchone()[0]
            if result != "ok":
                raise ValueError(f"Banco inválido: {result}")
            version = connection.execute(
                "SELECT value FROM app_meta WHERE key = 'schema_version'"
            ).fetchone()
            if not version or int(version[0]) > SCHEMA_VERSION:
                raise ValueError("Versão do banco incompatível com esta aplicação.")
        finally:
            connection.close()

    def replace_database(self, replacement: Path, recovery_copy: Path) -> None:
        self.validate_database_file(replacement)
        with self._write_lock:
            if self.path.exists():
                recovery_copy.parent.mkdir(parents=True, exist_ok=True)
                self.online_backup(recovery_copy)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, temporary_name = tempfile.mkstemp(
                prefix="centro-dpern-restauracao-",
                suffix=".sqlite3",
                dir=self.path.parent,
            )
            os.close(descriptor)
            temporary = Path(temporary_name)
            try:
                shutil.copy2(replacement, temporary)
                self.validate_database_file(temporary)
                os.replace(temporary, self.path)
                Path(f"{self.path}-wal").unlink(missing_ok=True)
                Path(f"{self.path}-shm").unlink(missing_ok=True)
            finally:
                temporary.unlink(missing_ok=True)
