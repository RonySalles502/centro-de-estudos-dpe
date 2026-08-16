from __future__ import annotations

import json
import pathlib
import subprocess
import tempfile
import unittest
import urllib.error
import urllib.parse
from unittest import mock

from pwa import build as pwa_build
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
            ), mock.patch.object(
                updater, "collect_stf_dataset", side_effect=OSError("fonte indisponível")
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
            ), mock.patch.object(
                updater, "collect_stf_dataset", side_effect=OSError("fonte indisponível")
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

    def test_invalid_ampersand_repair_preserves_declared_feed_encoding(self) -> None:
        source = {
            "id": "stj-teses",
            "court": "STJ",
            "name": "Jurisprudência em Teses",
            "kind": "ATOM",
            "url": "https://scon.stj.jus.br/SCON/JurisprudenciaEmTesesFeed",
        }
        xml = """<?xml version="1.0" encoding="ISO-8859-1"?>
        <feed><entry><id>285</id><title>EDIÇÃO N. 285: SAÚDE & EDUCAÇÃO</title>
        <summary>Publicação oficial sobre saúde pública e direito à educação.</summary>
        <link href="https://www.stj.jus.br/teses/285" /></entry></feed>""".encode("iso-8859-1")

        with mock.patch.object(updater, "fetch", return_value=xml):
            result = updater.collect(source, timeout=5, enrich_limit=0)

        self.assertEqual(result[0]["ref"], "EDIÇÃO N. 285: SAÚDE & EDUCAÇÃO")
        self.assertNotIn("\ufffd", json.dumps(result, ensure_ascii=False))

    def test_build_quarantines_irrecoverably_corrupted_records(self) -> None:
        document = {
            "items": [{"id": "ok", "ref": "Edição"}, {"id": "bad", "ref": "EDI��O"}],
            "datasets": {
                "sample": {"rows": [["row-ok"], ["SA�DE"]], "columns": ["ref"]}
            },
        }

        omitted = pwa_build.quarantine_broken_jurisprudence(document)

        self.assertEqual(omitted, 2)
        self.assertEqual(document["items"], [{"id": "ok", "ref": "Edição"}])
        self.assertEqual(document["datasets"]["sample"]["rows"], [["row-ok"]])
        self.assertEqual(document["quality"]["omitted_corrupted_records"], 2)

    def test_fetch_uses_verified_curl_after_urllib_http_error(self) -> None:
        http_error = urllib.error.HTTPError(
            "https://www.stf.jus.br/arquivo.xlsx", 403, "Forbidden", {}, None
        )
        completed = subprocess.CompletedProcess(
            args=["curl"], returncode=0, stdout=b"PK\x03\x04dados", stderr=b""
        )
        with mock.patch.object(
            updater.urllib.request, "urlopen", side_effect=http_error
        ), mock.patch.object(
            updater.shutil, "which", return_value="curl"
        ), mock.patch.object(
            updater.subprocess, "run", return_value=completed
        ) as run:
            payload = updater.fetch("https://www.stf.jus.br/arquivo.xlsx", 5)

        self.assertEqual(payload, b"PK\x03\x04dados")
        command = run.call_args.args[0]
        self.assertIn("--proto-redir", command)
        self.assertNotIn("--insecure", command)

    def test_stf_dataset_tries_only_official_mirrors(self) -> None:
        dataset = {"rows": [["registro"]], "columns": ["id"]}
        source = next(item for item in updater.SOURCES if item["id"] == "stf-dados-informativos")
        with mock.patch.object(
            updater,
            "fetch",
            side_effect=[OSError("borda indisponível"), b"PK\x03\x04planilha"],
        ) as fetch, mock.patch.object(
            updater, "parse_stf_informativos_xlsx", return_value=dataset
        ):
            result = updater.collect_stf_dataset(source, 5, None)

        self.assertIs(result, dataset)
        called_urls = [call.args[0] for call in fetch.call_args_list]
        self.assertEqual(len(called_urls), 2)
        self.assertTrue(all(url.startswith("https://") for url in called_urls))
        self.assertTrue(
            all(urllib.parse.urlparse(url).hostname.endswith("stf.jus.br") for url in called_urls)
        )

    def test_required_stf_failure_does_not_replace_last_valid_file(self) -> None:
        with tempfile.TemporaryDirectory(prefix="dpern-pwa-juris-") as temporary:
            target = pathlib.Path(temporary) / "jurisprudence.json"
            original = json.dumps(self.previous_document(), ensure_ascii=False) + "\n"
            target.write_text(original, encoding="utf-8")

            def collect(source: dict, _timeout: int, _limit: int) -> list[dict]:
                return [] if source["court"] == "STJ" else []

            with mock.patch.object(updater, "CONTENT_PATH", target), mock.patch.object(
                updater, "collect", side_effect=collect
            ), mock.patch.object(
                updater, "collect_stf_dataset", side_effect=OSError("TLS indisponível")
            ):
                with self.assertRaisesRegex(RuntimeError, "fonte obrigatória"):
                    updater.update(
                        timeout=5,
                        enrich_limit=0,
                        required_sources=("stf-dados-informativos",),
                    )

            self.assertEqual(target.read_text(encoding="utf-8"), original)

    def test_global_jurisprudence_links_use_current_official_routes(self) -> None:
        extras = json.loads(updater.EXTRAS_PATH.read_text(encoding="utf-8"))
        links = {item["nome"]: item["url"] for item in extras["juris_links"]}
        self.assertEqual(
            links["Informativos STF"],
            "https://jurisprudencia.stf.jus.br/pages/search?base=informativos&"
            "pesquisa_inteiro_teor=false&sinonimo=true&plural=true&radicais=false&"
            "buscaExata=true&page=1&pageSize=100&queryString=INFORMATIVO&"
            "sort=date&sortBy=desc",
        )
        self.assertEqual(
            links["Jurisprudência em Teses (STJ)"],
            "https://processo.stj.jus.br/SCON/jt/jt.jsp",
        )
        self.assertNotIn("/informativos/", " ".join(links.values()))
        self.assertNotIn("menusumario.asp", " ".join(links.values()))


if __name__ == "__main__":
    unittest.main()
