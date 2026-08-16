from __future__ import annotations

import unittest
from collections import Counter
from copy import deepcopy
from pathlib import Path

from scripts.audit_question_bank import (
    LETTERS,
    assert_semantic_invariants,
    audit_bank,
    correct_text,
    load_bank,
    load_program,
    rebalance_bank,
)


def question_item(number: int, group: str = "I", discipline: str = "CON") -> dict[str, object]:
    answer = "B"
    return {
        "id": f"Q-{number:03d}",
        "g": group,
        "d": discipline,
        "t": f"T-{group}-{discipline}",
        "n": "medio",
        "e": f"Enunciado específico número {number}",
        "o": [f"Distrator A {number}", f"Resposta correta e mais extensa {number}", f"Distrator C {number}", f"Distrator D {number}", f"Distrator E {number}"],
        "gab": answer,
        "exp": "Explicação suficiente.",
        "f": "Fonte oficial, art. 1º",
        "u": "https://example.org/fonte",
        "_audit_file": "pwa/src/questoes_g1.json",
    }


class QuestionBankAuditTests(unittest.TestCase):
    def setUp(self) -> None:
        self.program = {
            "T-I-CON": {
                "id": "T-I-CON",
                "objective_group": "I",
                "discipline_code": "CON",
            }
        }

    def test_rebalance_is_balanced_idempotent_and_semantically_safe(self) -> None:
        before = [question_item(number) for number in range(10)]
        after = rebalance_bank(before)
        assert_semantic_invariants(before, after)
        self.assertEqual(Counter(question["gab"] for question in after), Counter({letter: 2 for letter in LETTERS}))
        self.assertEqual(after, rebalance_bank(after))
        for original, changed in zip(before, after):
            self.assertEqual(correct_text(original), correct_text(changed))
            self.assertEqual(Counter(original["o"]), Counter(changed["o"]))

    def test_audit_detects_structural_and_duplicate_problems(self) -> None:
        first = question_item(1)
        second = deepcopy(first)
        second["id"] = "Q-002"
        second["o"] = ["igual", "igual", "terceira", "quarta", "quinta"]
        second["gab"] = "Z"
        result = audit_bank([first, second], self.program)
        codes = {issue["code"] for issue in result["quality"]["issues"]}
        self.assertIn("duplicate_option", codes)
        self.assertIn("invalid_answer", codes)
        self.assertEqual(result["duplicates"]["duplicate_stem_sets"], 1)

    def test_length_signal_does_not_change_when_only_options_move(self) -> None:
        before = [question_item(number) for number in range(5)]
        after = rebalance_bank(before)
        before_audit = audit_bank(before, self.program)
        after_audit = audit_bank(after, self.program)
        self.assertEqual(
            before_audit["longest_answer"]["correct_among_longest"],
            after_audit["longest_answer"]["correct_among_longest"],
        )

    def test_semantic_guard_rejects_changed_correct_text(self) -> None:
        before = [question_item(1)]
        after = deepcopy(before)
        after[0]["o"][1] = "Resposta modificada"
        with self.assertRaisesRegex(ValueError, "texto da alternativa correta"):
            assert_semantic_invariants(before, after)

    def test_repository_bank_meets_balance_and_structure_thresholds(self) -> None:
        root = Path(__file__).resolve().parents[1]
        questions, _ = load_bank(root)
        audit = audit_bank(questions, load_program(root))
        self.assertEqual(audit["total"], 260)
        self.assertEqual(audit["quality"]["errors"], 0)
        self.assertEqual(audit["duplicates"]["duplicate_ids"], 0)
        self.assertEqual(audit["duplicates"]["duplicate_content_sets"], 0)
        for payload in audit["by_group"].values():
            counts = list(payload["answers"].values())
            self.assertEqual(max(counts), min(counts))
        for payload in audit["by_discipline"].values():
            counts = list(payload["answers"].values())
            self.assertLessEqual(max(counts) - min(counts), 1)


if __name__ == "__main__":
    unittest.main()
