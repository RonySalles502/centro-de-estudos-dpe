from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from server.backup import BackupManager
from server.database import Database


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class DatabaseTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="dpern-tests-")
        self.root = Path(self.temporary.name)
        self.database = Database(self.root / "runtime" / "test.sqlite3", PROJECT_ROOT)
        self.database.initialize()
        self.database.update_settings({"backup_dir": str(self.root / "backups")})

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_program_seed_is_idempotent_and_preserves_progress(self) -> None:
        program = self.database.list_program(limit=500)
        self.assertEqual(program["total"], 296)
        topic_id = program["items"][0]["id"]
        installation_id = self.database.get_settings()["installation_id"]

        self.database.update_topic_progress(
            topic_id,
            {
                "study_status": "EM_ESTUDO",
                "priority": "ALTA",
                "mastery": 3,
                "questions_done": 10,
                "correct_answers": 7,
            },
        )
        self.database.initialize()

        updated = self.database.list_program(limit=1)["items"][0]
        self.assertEqual(updated["study_status"], "EM_ESTUDO")
        self.assertEqual(updated["questions_done"], 10)
        self.assertEqual(updated["correct_answers"], 7)
        self.assertEqual(self.database.get_settings()["installation_id"], installation_id)

    def test_invalid_question_totals_are_rejected(self) -> None:
        topic_id = self.database.list_program(limit=1)["items"][0]["id"]
        with self.assertRaisesRegex(ValueError, "Acertos"):
            self.database.update_topic_progress(
                topic_id,
                {"questions_done": 3, "correct_answers": 4},
            )

    def test_invalid_settings_are_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "pasta"):
            self.database.update_settings({"backup_dir": ""})
        with self.assertRaisesRegex(ValueError, "Data"):
            self.database.update_settings({"target_exam_date": "2026-99-99"})

    def test_schema_v5_is_migrated_without_losing_plan_table(self) -> None:
        with self.database.connect() as connection:
            connection.execute("ALTER TABLE study_plan_runs DROP COLUMN adjustments_json")
            connection.execute(
                "INSERT OR REPLACE INTO app_meta(key, value) VALUES('schema_version', '5')"
            )
            connection.commit()

        self.database.initialize()

        with self.database.connect() as connection:
            columns = {
                row["name"] for row in connection.execute("PRAGMA table_info(study_plan_runs)")
            }
            version = connection.execute(
                "SELECT value FROM app_meta WHERE key = 'schema_version'"
            ).fetchone()[0]
        self.assertIn("adjustments_json", columns)
        self.assertEqual(version, "7")

    def test_jurisprudence_reading_status_drives_candidate_pending_count(self) -> None:
        self.database.upsert_jurisprudence_item(
            "stj-informativo",
            {
                "external_id": "teste-1",
                "issue_number": "1",
                "title": "Síntese institucional de teste",
                "published_at": "2026-08-15",
                "source_url": "https://processo.stj.jus.br/",
                "summary": "Resumo oficial suficientemente completo para o fluxo de leitura do candidato.",
                "content_hash": "hash-teste-1",
            },
        )
        item = self.database.list_jurisprudence()["items"][0]
        self.assertEqual(item["study_status"], "NAO_LIDO")
        self.assertEqual(self.database.dashboard()["jurisprudence"]["pending"], 1)

        updated = self.database.update_jurisprudence_progress(
            item["id"], {"study_status": "LIDO"}
        )

        self.assertEqual(updated["study_status"], "LIDO")
        self.assertEqual(self.database.dashboard()["jurisprudence"]["pending"], 0)
        self.assertEqual(self.database.list_jurisprudence(study_status="LIDO")["total"], 1)

    def test_backup_roundtrip_restores_previous_progress(self) -> None:
        topic_id = self.database.list_program(limit=1)["items"][0]["id"]
        self.database.update_topic_progress(topic_id, {"study_status": "EM_ESTUDO"})
        manager = BackupManager(self.database)
        self.assertTrue(manager.auto_backup_due())
        created = manager.create()
        self.assertEqual(created["status"], "VERIFICADO")
        self.assertFalse(manager.auto_backup_due())

        self.database.update_topic_progress(topic_id, {"study_status": "CONSOLIDADO"})
        restored = manager.restore(created["file_name"])

        topic = self.database.list_program(limit=1)["items"][0]
        self.assertEqual(topic["study_status"], "EM_ESTUDO")
        recovery = manager.backup_directory() / restored["recovery_file"]
        self.assertTrue(recovery.exists())
        self.database.validate_database_file(recovery)


if __name__ == "__main__":
    unittest.main()
