#!/usr/bin/env python3
"""Atualiza o pacote estático de jurisprudência a partir de fontes oficiais.

O script é próprio para CI: preserva itens de fontes que falharam, só publica
quando ao menos uma coleta foi válida e grava o JSON atomicamente.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import pathlib
import re
import shutil
import ssl
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any


PWA_ROOT = pathlib.Path(__file__).resolve().parent
REPO_ROOT = PWA_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from server.jurisprudence import (  # noqa: E402
    USER_AGENT,
    parse_official_detail,
    parse_stf_latest,
    parse_stj_feed,
)
from pwa.build import load_json, seed_jurisprudence  # noqa: E402


CONTENT_PATH = PWA_ROOT / "content" / "jurisprudence.json"
EXTRAS_PATH = PWA_ROOT / "src" / "extras.json"
MAX_RESPONSE_BYTES = 5_000_000

SOURCES = (
    {
        "id": "stj-informativo",
        "court": "STJ",
        "name": "Informativo de Jurisprudência",
        "kind": "ATOM",
        "url": "https://processo.stj.jus.br/jurisprudencia/externo/InformativoFeed",
    },
    {
        "id": "stf-informativo",
        "court": "STF",
        "name": "Informativo STF",
        "kind": "HTML_LATEST",
        "url": "https://portal.stf.jus.br/textos/verTexto.asp?p=&servico=informativoSTF",
    },
    {
        "id": "stj-teses",
        "court": "STJ",
        "name": "Jurisprudência em Teses",
        "kind": "ATOM",
        "url": "https://scon.stj.jus.br/SCON/JurisprudenciaEmTesesFeed",
    },
)


def trusted_ssl_context() -> ssl.SSLContext:
    context = ssl.create_default_context()
    # O runtime Python portátil do Windows pode não herdar o repositório do SO.
    # Importar as raízes do Windows mantém a verificação TLS ativa, sem bypass.
    if hasattr(ssl, "enum_certificates"):
        roots = []
        for certificate, encoding, _trust in ssl.enum_certificates("ROOT"):
            if encoding == "x509_asn":
                roots.append(ssl.DER_cert_to_PEM_cert(certificate))
        if roots:
            context.load_verify_locations(cadata="".join(roots))
    return context


SSL_CONTEXT = trusted_ssl_context()


def fetch(url: str, timeout: int) -> bytes:
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/atom+xml, application/xml, text/html;q=0.9, */*;q=0.5",
            "Accept-Language": "pt-BR,pt;q=0.9",
            "Referer": "https://www.stj.jus.br/",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=SSL_CONTEXT) as response:
            return response.read(MAX_RESPONSE_BYTES)
    except urllib.error.URLError as error:
        # Fallback estrito para runtimes Python portáteis no Windows. O curl do
        # sistema usa o repositório TLS nativo; nunca é chamado com --insecure.
        curl = shutil.which("curl.exe") if sys.platform == "win32" else None
        if not curl or not isinstance(error.reason, ssl.SSLCertVerificationError):
            raise
        completed = subprocess.run(
            [curl, "--fail", "--silent", "--show-error", "--location", "--proto", "=https", "--max-time", str(timeout), url],
            capture_output=True,
            check=False,
            timeout=timeout + 5,
        )
        if completed.returncode or not completed.stdout or len(completed.stdout) > MAX_RESPONSE_BYTES:
            raise error
        return completed.stdout


def fetch_detail(url: str, court: str, timeout: int) -> str:
    parsed = urllib.parse.urlparse(url)
    allowed = "stj.jus.br" if court == "STJ" else "stf.jus.br"
    hostname = (parsed.hostname or "").lower()
    if parsed.scheme not in {"http", "https"} or not (
        hostname == allowed or hostname.endswith(f".{allowed}")
    ):
        return ""
    try:
        return parse_official_detail(fetch(url, timeout), court)
    except Exception:
        return ""


def classify_group(text: str) -> str | None:
    normalized = text.casefold()
    dictionaries = {
        "I": ("constitucional", "administrativ", "defensoria pública", "concurso público", "servidor público"),
        "II": ("penal", "crime", "prisão", "processo penal", "execução penal", "habeas corpus", "tráfico"),
        "III": ("civil", "processo civil", "consumidor", "família", "sucess", "contrato", "responsabilidade civil"),
        "IV": ("direitos humanos", "criança", "adolescente", "ambiental", "coletiv", "indígen", "ação civil pública"),
    }
    scores = {group: sum(term in normalized for term in terms) for group, terms in dictionaries.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] else None


def normalise_published(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    match = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})(?:\s+\d{2}:\d{2}:\d{2})?", text)
    if match:
        day, month, year = match.groups()
        return f"{year}-{month}-{day}T00:00:00+00:00"
    return text[:80] or None


def normalise(source: dict[str, str], item: dict[str, Any], timeout: int, enrich: bool) -> dict[str, Any]:
    title = str(item.get("title") or source["name"]).strip()
    summary = str(item.get("summary") or "").strip()
    source_url = str(item.get("source_url") or source["url"]).strip()
    if source["id"] == "stf-informativo":
        # O portal moderno é a página canônica; o parser legado também devolve
        # um endereço histórico cujo certificado não é confiável em todo runtime.
        source_url = source["url"]
    if enrich and len(summary) < 80 and source_url:
        summary = fetch_detail(source_url, source["court"], timeout) or summary
    if not summary:
        summary = title
    external_id = str(item.get("external_id") or source_url or title)
    stable = hashlib.sha256(f"{source['id']}|{external_id}".encode("utf-8")).hexdigest()[:24]
    combined = f"{title} {summary}"
    return {
        "id": f"oficial-{stable}",
        "external_id": external_id[:500],
        "source_id": source["id"],
        "kind": "PUBLICACAO_OFICIAL",
        "trib": source["court"],
        "ref": title[:1000],
        "tema": source["name"],
        "tese": summary[:5000],
        "url": source_url,
        "g": classify_group(combined),
        "published_at": normalise_published(item.get("published_at")),
        "issue_number": item.get("issue_number"),
        "content_hash": item.get("content_hash")
        or hashlib.sha256(f"{title}|{summary}|{source_url}".encode("utf-8")).hexdigest(),
        "editorial_status": "IMPORTADO_DE_FONTE_OFICIAL",
    }


def collect(source: dict[str, str], timeout: int, enrich_limit: int) -> list[dict[str, Any]]:
    payload = fetch(source["url"], timeout)
    if source["kind"] == "ATOM":
        try:
            parsed = parse_stj_feed(payload, source["url"])
        except ET.ParseError:
            # Há versões do feed oficial com ampersands não escapados em URLs.
            # Corrige somente entidades XML sintaticamente inválidas.
            decoded = payload.decode("utf-8", errors="replace")
            repaired = re.sub(r"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)", "&amp;", decoded)
            parsed = parse_stj_feed(repaired.encode("utf-8"), source["url"])
    else:
        parsed = parse_stf_latest(payload, source["url"])
    if not parsed:
        raise ValueError("nenhuma publicação foi identificada")
    return [
        normalise(source, item, timeout, index < enrich_limit)
        for index, item in enumerate(parsed[:80])
    ]


def canonical_hash(items: list[dict[str, Any]]) -> str:
    payload = json.dumps(items, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def update(timeout: int, enrich_limit: int) -> dict[str, Any]:
    previous = (
        load_json(CONTENT_PATH)
        if CONTENT_PATH.exists()
        else seed_jurisprudence(load_json(EXTRAS_PATH))
    )
    by_id = {item["id"]: item for item in previous.get("items", []) if item.get("id")}
    results: list[dict[str, Any]] = []
    succeeded = 0
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    for source in SOURCES:
        try:
            items = collect(source, timeout, enrich_limit)
            for item in items:
                by_id[item["id"]] = item
            succeeded += 1
            results.append(
                {"id": source["id"], "name": source["name"], "court": source["court"], "url": source["url"], "status": "SUCESSO", "detected": len(items), "checked_at": now}
            )
        except Exception as error:
            results.append(
                {"id": source["id"], "name": source["name"], "court": source["court"], "url": source["url"], "status": "ERRO", "message": f"{type(error).__name__}: {error}"[:500], "checked_at": now}
            )

    if not succeeded:
        details = "; ".join(f"{item['id']}: {item.get('message')}" for item in results)
        raise RuntimeError(f"todas as fontes oficiais falharam; a base anterior foi preservada. {details}")

    references = [item for item in by_id.values() if item.get("kind") == "REFERENCIA_EDITORIAL"]
    automatic = [item for item in by_id.values() if item.get("kind") == "PUBLICACAO_OFICIAL"]
    automatic.sort(key=lambda item: str(item.get("published_at") or ""), reverse=True)
    items = automatic + references
    digest = canonical_hash(items)
    document = {
        "schema_version": 1,
        "version": f"{now[:10].replace('-', '.')}-{digest[:12]}",
        "generated_at": now,
        "last_success_at": now,
        "status": "ATUALIZADO" if succeeded == len(SOURCES) else "ATUALIZADO_PARCIAL",
        "sources": results,
        "items": items,
    }
    CONTENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = CONTENT_PATH.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    temporary.replace(CONTENT_PATH)
    return document


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--enrich-limit", type=int, default=8)
    args = parser.parse_args()
    document = update(max(5, args.timeout), max(0, args.enrich_limit))
    successes = sum(source["status"] == "SUCESSO" for source in document["sources"])
    print(f"Jurisprudência {document['version']}: {len(document['items'])} itens; {successes}/{len(SOURCES)} fontes válidas.")


if __name__ == "__main__":
    main()
