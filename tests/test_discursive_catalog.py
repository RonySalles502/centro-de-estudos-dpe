from __future__ import annotations

import json
import unittest
from collections import Counter
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class DiscursiveCatalogTestCase(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.catalog = json.loads(
            (ROOT / "data" / "discursive_prompts.json").read_text(encoding="utf-8")
        )
        cls.prompts = cls.catalog["prompts"]

    def test_catalog_expands_the_previous_set_and_balances_discursive_groups(self) -> None:
        self.assertEqual(len(self.prompts), 24)
        self.assertEqual(len({item["id"] for item in self.prompts}), 24)
        self.assertEqual(Counter(item["gd"] for item in self.prompts), {"I": 12, "II": 12})
        self.assertGreaterEqual(
            sum(item["tipo"] == "PECA" for item in self.prompts),
            6,
        )

    def test_every_prompt_has_a_complete_scored_mirror(self) -> None:
        for prompt in self.prompts:
            expected = 5.0 if prompt["tipo"] == "PECA" else 2.5
            self.assertGreaterEqual(len(prompt["espelho"]), 4, prompt["id"])
            self.assertAlmostEqual(
                sum(float(item["pontos"]) for item in prompt["espelho"]),
                expected,
                msg=prompt["id"],
            )
            for item in prompt["espelho"]:
                self.assertTrue(item["criterio"].strip())
                self.assertGreaterEqual(len(item["esperado"].strip()), 20)

    def test_every_prompt_has_an_official_anchor_and_catalog_uses_informativos(self) -> None:
        anchored_to_issue = 0
        for prompt in self.prompts:
            self.assertTrue(prompt["ancoras"], prompt["id"])
            for anchor in prompt["ancoras"]:
                self.assertTrue(anchor["url"].startswith("https://"), prompt["id"])
                self.assertTrue(anchor["referencia"].strip())
                if anchor.get("informativo"):
                    anchored_to_issue += 1
        self.assertGreaterEqual(anchored_to_issue, 12)


if __name__ == "__main__":
    unittest.main()
