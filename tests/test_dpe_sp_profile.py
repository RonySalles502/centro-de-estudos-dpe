import json
import pathlib
import unittest
from urllib.parse import urlparse


ROOT = pathlib.Path(__file__).resolve().parents[1]


class DpeSpProfileTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.profile = json.loads(
            (ROOT / "data" / "dpe_sp_profile.json").read_text(encoding="utf-8")
        )

    def test_profile_uses_official_last_notice_and_current_rules(self) -> None:
        sources = self.profile["sources"]
        self.assertIn("edital_ix_concurso", sources["last_notice"])
        self.assertIn("6889253", sources["current_rules"])
        for url in sources.values():
            parsed = urlparse(url)
            self.assertEqual(parsed.scheme, "https")
            self.assertEqual(parsed.netloc, "www.defensoria.sp.def.br")

    def test_profile_preserves_ix_fcc_objective_reference(self) -> None:
        meta = self.profile["meta"]
        self.assertEqual(meta["banca"], "FCC")
        self.assertEqual(meta["simulado_total"], 88)
        self.assertEqual(meta["simulado_duracao"], "4h30")
        self.assertEqual(len(meta["fases"]), 4)
        self.assertEqual(meta["data_prova_estimada"], "")

    def test_supplements_and_legislation_are_complete(self) -> None:
        topics = self.profile["supplement_topics"]
        ids = {item["id"] for item in topics}
        self.assertEqual(len(topics), 20)
        self.assertEqual(len(ids), 20)
        self.assertEqual({item["dc"] for item in topics}, {"TRI", "EMP", "PID", "FDS"})
        legislation = self.profile["legislation"]
        mapped = set(legislation["topics"])
        no_specific = set(legislation["no_specific_articles"])
        self.assertFalse(mapped & no_specific)
        self.assertEqual(mapped | no_specific, ids)


if __name__ == "__main__":
    unittest.main()
