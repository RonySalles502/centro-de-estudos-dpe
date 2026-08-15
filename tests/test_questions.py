from __future__ import annotations

import json
import tempfile
import unittest
from collections import Counter
from pathlib import Path

from server.backup import BackupManager
from server.database import Database
from server.questions import QuestionService


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def question_item(
    number: int,
    discipline: str = "CON",
    topic_id: str = "G1-CON-01",
) -> dict[str, object]:
    return {
        "id": f"Q-TEST-{discipline}-{number:03d}",
        "source_id": None,
        "discipline_code": discipline,
        "exam_reference": "Banco autoral de teste",
        "exam_year": 2026,
        "booklet": "TESTE",
        "question_number": number,
        "stem": f"Enunciado controlado da questão {number} de {discipline}.",
        "options": [
            {"key": key, "text": f"Alternativa {key} da questão {number}."}
            for key in "ABCDE"
        ],
        "correct_option": "A",
        "explanation": "A alternativa A é o gabarito da fixture.",
        "topic_ids": [topic_id],
        "rights_status": "AUTORAL",
        "editorial_status": "VALIDADO",
    }


def ai_question_item(number: int = 1) -> dict[str, object]:
    item = question_item(number)
    item.update(
        {
            "id": f"Q-TEST-IA-{number:03d}",
            "exam_reference": "Laboratório IA de teste",
            "authorship_type": "IA",
            "ai_model": "Modelo de teste",
            "ai_prompt_version": "fixture-v1",
            "validation_status": "PENDENTE_FONTE",
            "official_reference": "Constituição Federal, art. 5º, caput",
            "source_url": "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm",
            "editorial_status": "EM_REVISAO",
        }
    )
    return item


class QuestionServiceTestCase(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="dpern-question-tests-")
        self.root = Path(self.temporary.name)
        self.database = Database(self.root / "test.sqlite3", PROJECT_ROOT)
        self.database.initialize()
        self.service = QuestionService(self.database)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def seed(self, questions: list[dict[str, object]]) -> None:
        path = self.root / "catalog.json"
        path.write_text(
            json.dumps({"schema_version": 1, "sources": [], "questions": questions}),
            encoding="utf-8",
        )
        self.service.seed_catalog(path)

    def test_practice_answering_and_topic_progress(self) -> None:
        self.seed([question_item(index) for index in range(1, 5)])
        self.assertEqual(self.service.stats()["eligible"], 4)

        session = self.service.create_session({"kind": "PRATICA", "question_count": 2})
        self.assertEqual(session["question_count"], 2)
        self.assertNotIn("correct_option", session["items"][0])

        first, second = session["items"]
        session = self.service.answer_session(
            session["id"],
            {
                "question_id": first["question_id"],
                "selected_option": "A",
                "confidence": "CERTEZA",
                "elapsed_seconds": 35,
            },
        )
        answered_first = next(
            item for item in session["items"] if item["question_id"] == first["question_id"]
        )
        self.assertEqual(answered_first["correct_option"], "A")
        self.assertEqual(answered_first["is_correct"], 1)

        session = self.service.answer_session(
            session["id"],
            {
                "question_id": second["question_id"],
                "selected_option": "B",
                "confidence": "CHUTE",
            },
        )
        self.assertEqual(session["status"], "FINALIZADO")
        self.assertEqual(session["answered_count"], 2)
        self.assertEqual(session["correct_count"], 1)
        self.assertEqual(session["score_10"], 5.0)

        topic = self.database.list_program(discipline="CON", limit=1)["items"][0]
        self.assertEqual(topic["questions_done"], 2)
        self.assertEqual(topic["correct_answers"], 1)
        self.assertEqual(self.service.stats()["accuracy"], 0.5)

    def test_unavailable_catalog_blocks_simulation(self) -> None:
        with self.assertRaisesRegex(ValueError, "25 questões"):
            self.service.create_session({"kind": "SIMULADO_GRUPO", "group": "I"})

    def test_complete_simulation_has_twenty_five_questions_per_group(self) -> None:
        group_fixtures = [
            ("CON", "G1-CON-01"),
            ("PEN", "G2-PEN-01"),
            ("CIV", "G3-CIV-01"),
            ("DHU", "G4-DHU-01"),
        ]
        questions: list[dict[str, object]] = []
        number = 1
        for discipline, topic_id in group_fixtures:
            for _ in range(25):
                questions.append(question_item(number, discipline, topic_id))
                number += 1
        self.seed(questions)

        session = self.service.create_session({"kind": "SIMULADO_COMPLETO"})
        groups = Counter(item["objective_group"] for item in session["items"])
        self.assertEqual(session["question_count"], 100)
        self.assertEqual(groups, {"I": 25, "II": 25, "III": 25, "IV": 25})

    def test_catalog_change_returns_validated_question_to_review(self) -> None:
        item = question_item(1)
        self.seed([item])
        with self.database.connect() as connection:
            connection.execute(
                "UPDATE questions SET editorial_status = 'PUBLICADO' WHERE id = ?",
                (item["id"],),
            )
            connection.commit()
        item["stem"] = "Conteúdo alterado após validação."
        self.seed([item])
        question = self.service.list_questions()["items"][0]
        self.assertEqual(question["editorial_status"], "EM_REVISAO")

    def test_pending_ai_question_only_enters_experimental_lab(self) -> None:
        self.seed([ai_question_item()])
        stats = self.service.stats()
        self.assertEqual(stats["eligible"], 0)
        self.assertEqual(stats["ai_generated"], 1)
        self.assertEqual(stats["ai_pending"], 1)

        with self.assertRaisesRegex(ValueError, "liberada"):
            self.service.create_session({"kind": "PRATICA", "question_count": 1})

        before = self.database.list_program(discipline="CON", limit=1)["items"][0]
        session = self.service.create_session(
            {"kind": "LABORATORIO_IA", "question_count": 1}
        )
        self.assertEqual(session["is_experimental"], 1)
        self.assertEqual(session["items"][0]["authorship_type_snapshot"], "IA")
        session = self.service.answer_session(
            session["id"],
            {
                "question_id": session["items"][0]["question_id"],
                "selected_option": "A",
                "confidence": "DUVIDA",
            },
        )
        after = self.database.list_program(discipline="CON", limit=1)["items"][0]
        self.assertEqual(session["status"], "FINALIZADO")
        self.assertIsNone(session["score_10"])
        self.assertEqual(before["questions_done"], after["questions_done"])
        self.assertEqual(self.service.stats()["answered"], 0)
        self.assertEqual(self.service.stats()["ai_reviewed"], 1)

    def test_candidate_catalog_hides_items_not_ready_for_study(self) -> None:
        self.seed([question_item(1), ai_question_item(2)])

        catalog = self.service.list_questions(study_ready_only=True)

        self.assertEqual(catalog["total"], 1)
        self.assertEqual(catalog["items"][0]["id"], "Q-TEST-CON-001")

    def test_selection_prioritizes_unseen_questions_before_repeating(self) -> None:
        self.seed([question_item(index) for index in range(1, 4)])
        first_id = "Q-TEST-CON-001"
        self.service.create_session({"kind": "PRATICA", "question_ids": [first_id]})

        session = self.service.create_session({"kind": "PRATICA", "question_count": 2})
        selected = {item["question_id"] for item in session["items"]}

        self.assertNotIn(first_id, selected)
        self.assertEqual(self.service.stats()["unseen"], 0)

    def test_candidate_report_quarantines_question(self) -> None:
        self.seed([ai_question_item()])
        report = self.service.report_question(
            "Q-TEST-IA-001",
            {
                "category": "GABARITO",
                "description": "A alternativa indicada parece contrariar a fonte oficial.",
                "evidence_url": "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm",
            },
        )
        self.assertEqual(report["status"], "ABERTO")
        self.assertEqual(self.service.stats()["ai_pending"], 0)
        self.assertEqual(self.service.stats()["open_reports"], 1)
        question = self.service.list_questions()["items"][0]
        self.assertEqual(question["open_report_count"], 1)
        self.assertEqual(question["ai_review_eligible"], 0)

        with self.assertRaisesRegex(ValueError, "sinalização ativa"):
            self.service.report_question(
                "Q-TEST-IA-001",
                {
                    "category": "FONTE",
                    "description": "Segunda sinalização para a mesma questão pendente.",
                },
            )

    def test_ai_question_requires_official_source_metadata(self) -> None:
        item = ai_question_item()
        item["source_url"] = ""
        with self.assertRaisesRegex(ValueError, "fonte oficial"):
            self.seed([item])

    def test_backup_preserves_question_sessions(self) -> None:
        self.seed([question_item(1)])
        session = self.service.create_session({"kind": "PRATICA", "question_count": 1})
        self.service.answer_session(
            session["id"],
            {
                "question_id": session["items"][0]["question_id"],
                "selected_option": "A",
                "confidence": "CERTEZA",
            },
        )
        self.database.update_settings({"backup_dir": str(self.root / "backups")})
        manager = BackupManager(self.database)
        backup = manager.create()
        with self.database.connect() as connection:
            connection.execute("DELETE FROM quiz_sessions")
            connection.commit()
        self.assertEqual(self.service.list_sessions(), [])

        manager.restore(backup["file_name"])

        restored = self.service.list_sessions()
        self.assertEqual(len(restored), 1)
        self.assertEqual(restored[0]["correct_count"], 1)


if __name__ == "__main__":
    unittest.main()
