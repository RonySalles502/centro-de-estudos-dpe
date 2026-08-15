from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from server.database import Database
from server.jurisprudence import (
    JurisprudenceUpdater,
    parse_official_detail,
    parse_stf_latest,
    parse_stj_feed,
)


PROJECT_ROOT = Path(__file__).resolve().parents[1]


STJ_ATOM = b"""<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Informativos STJ</title>
  <entry>
    <id>stj-825</id>
    <title>Informativo de Jurisprudencia n. 825</title>
    <updated>2026-08-14T12:00:00Z</updated>
    <link rel="alternate" href="https://processo.stj.jus.br/informativo/825" />
    <summary><![CDATA[Direito processual penal. <strong>Tese relevante.</strong>]]></summary>
  </entry>
</feed>
"""

STJ_DETAIL = """
<html><body>
  <h2>Tema</h2><p>Prisão preventiva. Fundamentação concreta.</p>
  <h2>Destaque</h2><p>A gravidade abstrata do delito, isoladamente, não justifica a prisão preventiva.</p>
  <h2>Informações do Inteiro Teor</h2><p>Texto longo do julgamento.</p>
</body></html>
""".encode("utf-8")


class JurisprudenceParserTestCase(unittest.TestCase):
    def test_parse_stj_atom(self) -> None:
        items = parse_stj_feed(STJ_ATOM)
        self.assertEqual(len(items), 1)
        self.assertEqual(items[0]["external_id"], "stj-825")
        self.assertEqual(items[0]["issue_number"], "825")
        self.assertEqual(items[0]["published_at"], "2026-08-14T12:00:00+00:00")
        self.assertEqual(items[0]["summary"], "Direito processual penal. Tese relevante.")

    def test_parse_stf_latest(self) -> None:
        payload = """
        <html><head><title>Informativo STF</title></head>
        <body><h1>Informativo STF nº 1195</h1><p>Brasília, 12 de agosto de 2026.</p></body></html>
        """.encode("utf-8")
        items = parse_stf_latest(payload, "https://www.stf.jus.br/informativo")
        self.assertEqual(items[0]["external_id"], "stf-informativo-1195")
        self.assertEqual(items[0]["issue_number"], "1195")
        self.assertEqual(items[0]["published_at"], "2026-08-12T00:00:00+00:00")
        self.assertIn("informativo1195.htm", items[0]["source_url"])

    def test_parse_stf_latest_from_current_portal_heading(self) -> None:
        payload = """
        <html><head><title>Informativo STF</title></head>
        <body><span>Última atualização: 2026-08-03</span>
        <a href="Informativo_stf_1223.pdf">Última edição: 1223/2026 (pdf)</a>
        <h2>Apresentação</h2><p>O Informativo STF apresenta resumos dos principais julgamentos.</p>
        <p>Responsável: Coordenadoria de Difusão da Informação.</p></body></html>
        """.encode("utf-8")
        items = parse_stf_latest(payload, "https://portal.stf.jus.br/informativo")
        self.assertEqual(items[0]["external_id"], "stf-informativo-1223")
        self.assertEqual(items[0]["issue_number"], "1223")
        self.assertEqual(items[0]["published_at"], "2026-08-03T00:00:00+00:00")
        self.assertEqual(items[0]["summary"], "O Informativo STF apresenta resumos dos principais julgamentos")

    def test_stf_page_without_issue_number_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "número"):
            parse_stf_latest(b"<html><body>Pagina temporariamente indisponivel</body></html>", "x")

    def test_extracts_stj_theme_and_highlight_from_official_detail(self) -> None:
        summary = parse_official_detail(STJ_DETAIL, "STJ")
        self.assertIn("Prisão preventiva", summary)
        self.assertIn("gravidade abstrata", summary)
        self.assertNotIn("Texto longo", summary)

    def test_update_pipeline_is_idempotent(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dpern-juris-tests-") as temporary:
            database = Database(Path(temporary) / "test.sqlite3", PROJECT_ROOT)
            database.initialize()
            updater = JurisprudenceUpdater(database)
            updater._request = lambda source, force=False: (STJ_ATOM, {"etag": "fixture-v1"}, False)  # type: ignore[method-assign]
            updater._request_detail = lambda url, court: STJ_DETAIL  # type: ignore[method-assign]

            first = updater._update_source(database.source("stj-informativo"))
            second = updater._update_source(database.source("stj-informativo"))

            self.assertEqual(first["imported"], 1)
            self.assertEqual(second["imported"], 0)
            self.assertEqual(database.list_jurisprudence()["total"], 1)
            item = database.list_jurisprudence()["items"][0]
            self.assertIn("gravidade abstrata", item["summary"])

    def test_existing_generic_summary_is_forced_and_repaired(self) -> None:
        generic_atom = STJ_ATOM.replace(
            b"Direito processual penal. <strong>Tese relevante.</strong>",
            b"Informativo de Jurisprudencia n. 825 - Superior Tribunal de Justica",
        )
        with tempfile.TemporaryDirectory(prefix="dpern-juris-repair-") as temporary:
            database = Database(Path(temporary) / "test.sqlite3", PROJECT_ROOT)
            database.initialize()
            updater = JurisprudenceUpdater(database)
            updater._request = lambda source, force=False: (generic_atom, {}, False)  # type: ignore[method-assign]
            updater._request_detail = lambda url, court: b"<html><body>sem sintese</body></html>"  # type: ignore[method-assign]
            updater._update_source(database.source("stj-informativo"))
            self.assertEqual(database.count_missing_jurisprudence_summaries("stj-informativo"), 1)

            forced: list[bool] = []
            updater._request = lambda source, force=False: (forced.append(force) or generic_atom, {}, False)  # type: ignore[method-assign]
            updater._request_detail = lambda url, court: STJ_DETAIL  # type: ignore[method-assign]
            result = updater._update_source(database.source("stj-informativo"))

            self.assertEqual(forced, [True])
            self.assertEqual(result["summaries_updated"], 1)
            self.assertIn(
                "gravidade abstrata",
                database.list_jurisprudence()["items"][0]["summary"],
            )
            self.assertEqual(database.count_missing_jurisprudence_summaries("stj-informativo"), 0)


if __name__ == "__main__":
    unittest.main()
