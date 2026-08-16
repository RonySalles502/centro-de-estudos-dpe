from __future__ import annotations

import tempfile
import unittest
from datetime import date
from pathlib import Path

from server.backup import BackupManager
from server.database import Database
from server.study_planning import StudyPlanningService


PROJECT_ROOT = Path(__file__).resolve().parents[1]


class StudyPlanningServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="dpern-planning-tests-")
        self.root = Path(self.temporary.name)
        self.database = Database(self.root / "test.sqlite3", PROJECT_ROOT)
        self.database.initialize()
        self.service = StudyPlanningService(self.database)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    @staticmethod
    def diagnostic_payload() -> dict[str, object]:
        return {
            "experience_level": "INTERMEDIARIO",
            "preferred_shift": "NOITE",
            "session_minutes": 30,
            "horizon_days": 7,
            "weekday_minutes": {
                "SEG": 60,
                "TER": 60,
                "QUA": 60,
                "QUI": 60,
                "SEX": 60,
                "SAB": 60,
                "DOM": 60,
            },
            "content_weights": {
                "LEITURA": 100,
                "QUESTOES": 0,
                "JURISPRUDENCIA": 0,
                "REVISAO": 0,
                "DISCURSIVA": 0,
                "SIMULADO": 0,
            },
            "group_weights": {"I": 25, "II": 25, "III": 25, "IV": 25},
        }

    def test_diagnostic_rejects_invalid_weight_total(self) -> None:
        payload = self.diagnostic_payload()
        payload["group_weights"] = {"I": 20, "II": 20, "III": 20, "IV": 20}
        with self.assertRaisesRegex(ValueError, "100%"):
            self.service.save_diagnostic(payload)

    def test_generates_plan_and_records_completion(self) -> None:
        diagnostic = self.service.save_diagnostic(self.diagnostic_payload())
        self.assertEqual(diagnostic["weekly_minutes"], 420)
        plan = self.service.generate_plan({"start_date": "2026-08-17"})
        self.assertEqual(plan["run"]["total_minutes"], 420)
        self.assertEqual(len(plan["items"]), 14)
        self.assertEqual(set(plan["summary"]["content_minutes"]), {"LEITURA"})

        first = plan["items"][0]
        updated = self.service.update_plan_entry(first["id"], {"status": "CONCLUIDO"})
        self.assertEqual(updated["completed_minutes"], 30)
        refreshed = self.service.get_plan()
        self.assertEqual(refreshed["summary"]["completed_minutes"], 30)

    def test_unavailable_question_blocks_are_redistributed_automatically(self) -> None:
        payload = self.diagnostic_payload()
        payload["content_weights"] = {
            "LEITURA": 0,
            "QUESTOES": 100,
            "JURISPRUDENCIA": 0,
            "REVISAO": 0,
            "DISCURSIVA": 0,
            "SIMULADO": 0,
        }
        self.service.save_diagnostic(payload)

        plan = self.service.generate_plan({"start_date": "2026-08-17"})

        self.assertEqual(set(plan["summary"]["content_minutes"]), {"LEITURA"})
        self.assertTrue(plan["summary"]["adjustments"])
        self.assertIn("redistribuída", " ".join(plan["summary"]["adjustments"]))

    def test_completing_jurisprudence_block_marks_publication_as_read(self) -> None:
        self.database.upsert_jurisprudence_item(
            "stj-informativo",
            {
                "external_id": "planejamento-juris-1",
                "issue_number": "1",
                "title": "Informativo para o cronograma",
                "published_at": "2026-08-15",
                "source_url": "https://processo.stj.jus.br/",
                "summary": "Síntese institucional disponível para leitura no cronograma adaptado.",
                "content_hash": "planejamento-juris-hash-1",
            },
        )
        payload = self.diagnostic_payload()
        payload["content_weights"] = {
            "LEITURA": 0,
            "QUESTOES": 0,
            "JURISPRUDENCIA": 100,
            "REVISAO": 0,
            "DISCURSIVA": 0,
            "SIMULADO": 0,
        }
        self.service.save_diagnostic(payload)
        plan = self.service.generate_plan({"start_date": "2026-08-17"})
        jurisprudence_entries = [
            item for item in plan["items"] if item["content_type"] == "JURISPRUDENCIA"
        ]

        self.assertEqual(len(jurisprudence_entries), 1)
        self.assertIn("excedente de jurisprudência", " ".join(plan["summary"]["adjustments"]))
        self.service.update_plan_entry(
            jurisprudence_entries[0]["id"], {"status": "CONCLUIDO"}
        )

        self.assertEqual(self.database.dashboard()["jurisprudence"]["pending"], 0)

    def test_plan_snapshots_law_and_articles_for_mapped_topic(self) -> None:
        payload = self.diagnostic_payload()
        payload["group_weights"] = {"I": 100, "II": 0, "III": 0, "IV": 0}
        self.database.update_topic_progress("G1-CON-05", {"priority": "ALTA"})
        self.service.save_diagnostic(payload)

        plan = self.service.generate_plan({"start_date": "2026-08-17"})
        first = plan["items"][0]

        self.assertEqual(first["topic_id"], "G1-CON-05")
        self.assertEqual(first["legislation_status"], "MAPEADO_PENDENTE_VALIDACAO")
        self.assertEqual(first["legislation"][0]["norm_code"], "CF")
        self.assertIn("art", first["legislation"][0]["article_reference"].lower())
        self.assertTrue(first["legislation"][0]["source_url"].startswith("https://www.planalto.gov.br/"))

    def test_pre_edit_focus_refines_topics_without_overriding_personal_priority(self) -> None:
        payload = self.diagnostic_payload()
        payload["group_weights"] = {"I": 100, "II": 0, "III": 0, "IV": 0}
        self.database.update_topic_progress("G1-CON-01", {"priority": "ALTA"})
        self.service.save_diagnostic(payload)

        plan = self.service.generate_plan({"start_date": "2026-08-17"})
        first = plan["items"][0]

        self.assertEqual(first["topic_id"], "G1-CON-01")
        self.assertIn("foco pré-edital médio", first["rationale"])

    def test_doctrinal_topic_does_not_receive_invented_articles(self) -> None:
        payload = self.diagnostic_payload()
        payload["group_weights"] = {"I": 100, "II": 0, "III": 0, "IV": 0}
        self.database.update_topic_progress("G1-CON-01", {"priority": "ALTA"})
        self.service.save_diagnostic(payload)

        first = self.service.generate_plan({"start_date": "2026-08-17"})["items"][0]

        self.assertEqual(first["topic_id"], "G1-CON-01")
        self.assertEqual(first["legislation_status"], "SEM_DISPOSITIVO_ESPECIFICO")
        self.assertEqual(first["legislation"], [])

    def test_review_rating_recalculates_due_date(self) -> None:
        self.database.update_topic_progress("G1-CON-01", {"study_status": "EM_ESTUDO"})
        queue = self.service.list_reviews()
        self.assertEqual(queue["due"], 1)
        result = self.service.rate_review("G1-CON-01", {"rating": "BOM"})
        reviewed = next(item for item in result["items"] if item["topic_id"] == "G1-CON-01")
        self.assertEqual(reviewed["interval_days"], 3)
        self.assertGreater(reviewed["due_date"], date.today().isoformat())

    def test_discursive_draft_and_completion(self) -> None:
        prompt = self.service.list_discursive_prompts()[0]
        draft = self.service.save_discursive_attempt(
            {
                "prompt_id": prompt["id"],
                "answer_text": "Rascunho inicial sobre o tema constitucional.",
                "status": "RASCUNHO",
            }
        )
        self.assertEqual(draft["status"], "RASCUNHO")
        answer = " ".join(["fundamento"] * 30)
        completed = self.service.save_discursive_attempt(
            {
                "id": draft["id"],
                "prompt_id": prompt["id"],
                "answer_text": answer,
                "elapsed_minutes": 45,
                "self_score": 7.5,
                "status": "CONCLUIDA",
            }
        )
        self.assertEqual(completed["status"], "CONCLUIDA")
        self.assertEqual(completed["word_count"], 30)

    def test_backup_preserves_diagnostic_plan_reviews_and_discursive_history(self) -> None:
        self.service.save_diagnostic(self.diagnostic_payload())
        plan = self.service.generate_plan({"start_date": "2026-08-17"})
        self.database.update_topic_progress("G1-CON-01", {"study_status": "EM_ESTUDO"})
        self.service.rate_review("G1-CON-01", {"rating": "DIFICIL"})
        prompt = self.service.list_discursive_prompts()[0]
        attempt = self.service.save_discursive_attempt(
            {
                "prompt_id": prompt["id"],
                "answer_text": "Rascunho preservado pelo pacote de backup.",
                "status": "RASCUNHO",
            }
        )
        backup = BackupManager(self.database)
        created = backup.create()

        self.service.update_plan_entry(plan["items"][0]["id"], {"status": "CONCLUIDO"})
        self.service.save_discursive_attempt(
            {
                "id": attempt["id"],
                "prompt_id": prompt["id"],
                "answer_text": "Texto alterado após o backup.",
                "status": "RASCUNHO",
            }
        )
        backup.restore(created["file_name"])
        restored = StudyPlanningService(self.database)

        self.assertTrue(restored.get_diagnostic()["completed"])
        self.assertEqual(restored.get_plan()["summary"]["completed_minutes"], 0)
        self.assertEqual(restored.list_reviews(due_only=False)["items"][0]["last_rating"], "DIFICIL")
        self.assertEqual(
            restored.list_discursive_attempts()[0]["answer_text"],
            "Rascunho preservado pelo pacote de backup.",
        )


if __name__ == "__main__":
    unittest.main()
