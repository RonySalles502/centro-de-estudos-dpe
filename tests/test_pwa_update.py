from __future__ import annotations

import json
import pathlib
import tempfile
import unittest
from unittest import mock

from pwa import update_jurisprudence as updater


class StaticJurisprudenceUpdaterTestCase(unittest.TestCase):
    def previous_document(self) -> dict:
        return {
            "schema_version": 1,
            "version": "anterior",
            "status": "ATUALIZADO",
            "items": [
                {
                    "id": "stf-anterior",
                    "source_id": "stf-informativo",
                    "kind": "PUBLICACAO_OFICIAL",
                    "trib": "STF",
                    "ref": "Informativo anterior",
                    "tese": "Conteúdo preservado",
                    "url": "https://portal.stf.jus.br/",
                },
                {
                    "id": "referencia-inicial",
                    "source_id": "referencias-iniciais",
                    "kind": "REFERENCIA_EDITORIAL",
                    "trib": "STJ",
                    "ref": "Referência",
                    "tese": "Tese",
                    "url": "https://www.stj.jus.br/",
                },
            ],
        }

    def test_all_sources_failing_does_not_replace_last_valid_file(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dpern-pwa-juris-") as temporary:
            target = pathlib.Path(temporary) / "jurisprudence.json"
            original = json.dumps(self.previous_document(), ensure_ascii=False, indent=2) + "\n"
            target.write_text(original, encoding="utf-8")
            with mock.patch.object(updater, "CONTENT_PATH", target), mock.patch.object(
                updater, "collect", side_effect=OSError("fonte indisponível")
            ):
                with self.assertRaises(RuntimeError):
                    updater.update(timeout=5, enrich_limit=0)
            self.assertEqual(target.read_text(encoding="utf-8"), original)

    def test_partial_update_keeps_items_from_failed_source(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dpern-pwa-juris-") as temporary:
            target = pathlib.Path(temporary) / "jurisprudence.json"
            target.write_text(
                json.dumps(self.previous_document(), ensure_ascii=False), encoding="utf-8"
            )

            def collect(source: dict, _timeout: int, _limit: int) -> list[dict]:
                if source["id"] != "stj-informativo":
                    raise OSError("fonte indisponível")
                return [
                    {
                        "id": "stj-novo",
                        "source_id": source["id"],
                        "kind": "PUBLICACAO_OFICIAL",
                        "trib": "STJ",
                        "ref": "Informativo novo",
                        "tese": "Conteúdo oficial novo",
                        "url": "https://www.stj.jus.br/",
                        "published_at": "2026-08-15T00:00:00+00:00",
                    }
                ]

            with mock.patch.object(updater, "CONTENT_PATH", target), mock.patch.object(
                updater, "collect", side_effect=collect
            ):
                result = updater.update(timeout=5, enrich_limit=0)

            ids = {item["id"] for item in result["items"]}
            self.assertEqual(result["status"], "ATUALIZADO_PARCIAL")
            self.assertIn("stj-novo", ids)
            self.assertIn("stf-anterior", ids)
            self.assertIn("referencia-inicial", ids)

    def test_brazilian_feed_date_is_normalised(self) -> None:
        self.assertEqual(
            updater.normalise_published("15/08/2026 00:00:00"),
            "2026-08-15T00:00:00+00:00",
        )


if __name__ == "__main__":
    unittest.main()
