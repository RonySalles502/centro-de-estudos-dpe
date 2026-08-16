from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


class PreEditProfileTestCase(unittest.TestCase):
    @staticmethod
    def load(path: str) -> dict:
        return json.loads((ROOT / path).read_text(encoding="utf-8"))

    def test_profile_covers_the_full_resolution_program(self) -> None:
        program = self.load("data/program.json")["program"]
        profile = self.load("data/pre_edit_priority.json")

        self.assertEqual(set(profile["topics"]), {item["id"] for item in program})
        self.assertEqual(len(profile["notices"]), 6)
        self.assertEqual(set(profile["disciplines"]), {item["discipline_code"] for item in program})
        self.assertEqual(
            {item[0] for item in profile["topics"].values()},
            {"MUITO_ALTA", "ALTA", "MEDIA"},
        )

    def test_profile_and_legislation_are_mirrored_in_pwa(self) -> None:
        self.assertEqual(
            self.load("data/pre_edit_priority.json"),
            self.load("pwa/src/pre_edit_priority.json"),
        )
        self.assertEqual(
            self.load("data/legislation_reading_map.json"),
            self.load("pwa/src/legislation_reading_map.json"),
        )

    def test_every_topic_has_a_legislative_classification(self) -> None:
        program_ids = {item["id"] for item in self.load("data/program.json")["program"]}
        legislation = self.load("data/legislation_reading_map.json")
        mapped = set(legislation["topics"])
        no_specific = set(legislation["no_specific_articles"])

        self.assertFalse(mapped & no_specific)
        self.assertEqual(mapped | no_specific, program_ids)
        self.assertIn("G2-DPP-26", mapped)
        self.assertIn("G2-DPP-27", mapped)
        self.assertIn("G2-DPP-28", mapped)
        for assignments in legislation["topics"].values():
            for source_code, article_reference in assignments:
                self.assertIn(source_code, legislation["sources"])
                self.assertTrue(article_reference.strip())

    def test_external_audit_corrections_do_not_reintroduce_shifted_dpc_ranges(self) -> None:
        legislation = self.load("data/legislation_reading_map.json")

        expected_primary_sources = {
            "G3-DPC-17": "CPC",
            "G3-DPC-18": "CPC",
            "G3-DPC-19": "CPC",
            "G3-DPC-20": "L7347",
            "G3-DPC-21": "L9868",
            "G3-DPC-22": "CPP",
            "G3-DPC-23": "CPC",
            "G3-DPC-24": "L4717",
            "G3-DPC-25": "L12016",
            "G3-DPC-26": "L8245",
        }
        for topic_id, source_code in expected_primary_sources.items():
            self.assertEqual(legislation["topics"][topic_id][0][0], source_code)

        self.assertIn("arts. 988 a 993", legislation["topics"]["G3-DPC-23"][0][1])
        self.assertNotEqual(legislation["topics"]["G3-DPC-21"], [["CPC", "art. 927"]])

    def test_external_audit_keeps_resolution_items_and_expands_express_laws(self) -> None:
        legislation = self.load("data/legislation_reading_map.json")
        program_ids = {item["id"] for item in self.load("data/program.json")["program"]}

        self.assertIn("G4-DCO-36", program_ids)
        self.assertIn("G4-DCO-37", program_ids)
        self.assertIn("G4-DCO-36", legislation["topics"])
        self.assertIn("G4-DCO-37", legislation["no_specific_articles"])
        self.assertIn("LC251", {item[0] for item in legislation["topics"]["G1-PID-10"]})
        self.assertIn("L9868", {item[0] for item in legislation["topics"]["G1-CON-05"]})
        self.assertIn("D11615", {item[0] for item in legislation["topics"]["G2-PEN-16"]})
        self.assertIn("D10088", {item[0] for item in legislation["topics"]["G4-DCA-21"]})


if __name__ == "__main__":
    unittest.main()
