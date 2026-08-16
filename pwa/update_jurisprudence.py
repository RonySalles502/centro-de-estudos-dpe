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
    parse_stj_feed,
)
from server.stf_exports import (  # noqa: E402
    STF_DATA_URL,
    STF_DATA_URLS,
    canonical_dataset_hash,
    classify_dpe_group,
    dataset_record_count,
    dataset_url_map,
    parse_stf_informativos_xlsx,
)
from pwa.build import load_json, seed_jurisprudence  # noqa: E402


CONTENT_PATH = PWA_ROOT / "content" / "jurisprudence.json"
EXTRAS_PATH = PWA_ROOT / "src" / "extras.json"
MAX_RESPONSE_BYTES = 20_000_000
STF_INTERMEDIATE_CA_PATH = PWA_ROOT / "certs" / "globalsign-gcc-r6-alphassl-ca-2025.pem"
STF_INTERMEDIATE_CA_SHA256 = "a883559231f8388daf35ce41c8101040ae8fd9b656434247b9475af592cc08ca"

SOURCES = (
    {
        "id": "stj-informativo",
        "court": "STJ",
        "name": "Informativo de Jurisprudência",
        "kind": "ATOM",
        "url": "https://processo.stj.jus.br/jurisprudencia/externo/InformativoFeed",
    },
    {
        "id": "stf-dados-informativos",
        "court": "STF",
        "name": "Dados estruturados do Informativo STF",
        "kind": "XLSX",
        "url": STF_DATA_URL,
    },
    {
        "id": "stj-teses",
        "court": "STJ",
        "name": "Jurisprudência em Teses",
        "kind": "ATOM",
        "url": "https://scon.stj.jus.br/SCON/JurisprudenciaEmTesesFeed",
    },
)


def verified_stf_intermediate_ca() -> pathlib.Path:
    """Return the pinned CA used to complete the chain omitted by the STF edge."""
    try:
        pem = STF_INTERMEDIATE_CA_PATH.read_text(encoding="ascii")
        der = ssl.PEM_cert_to_DER_cert(pem)
    except (OSError, ValueError) as error:
        raise RuntimeError("O certificado intermediário fixado do STF não pôde ser lido.") from error
    digest = hashlib.sha256(der).hexdigest()
    if digest != STF_INTERMEDIATE_CA_SHA256:
        raise RuntimeError("O certificado intermediário fixado do STF não passou na validação SHA-256.")
    return STF_INTERMEDIATE_CA_PATH


STF_INTERMEDIATE_CA = verified_stf_intermediate_ca()


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
    # O servidor do STF não envia o intermediário GlobalSign GCC R6 AlphaSSL
    # CA 2025. Ele é obtido do repositório oficial da GlobalSign, versionado e
    # conferido pelo SHA-256 acima. A verificação TLS permanece obrigatória.
    context.load_verify_locations(cafile=str(STF_INTERMEDIATE_CA))
    return context


SSL_CONTEXT = trusted_ssl_context()


def fetch(url: str, timeout: int) -> bytes:
    parsed = urllib.parse.urlparse(url)
    if parsed.scheme != "https":
        raise ValueError("A coleta automática aceita somente fontes HTTPS.")
    hostname = (parsed.hostname or "").lower()
    referer = "https://portal.stf.jus.br/" if hostname.endswith("stf.jus.br") else "https://www.stj.jus.br/"
    request = urllib.request.Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/atom+xml, application/xml, text/html;q=0.9, */*;q=0.5",
            "Accept-Language": "pt-BR,pt;q=0.9",
            "Referer": referer,
        },
    )
    primary_error: Exception | None = None
    try:
        with urllib.request.urlopen(request, timeout=timeout, context=SSL_CONTEXT) as response:
            payload = response.read(MAX_RESPONSE_BYTES + 1)
            if len(payload) > MAX_RESPONSE_BYTES:
                raise ValueError("A fonte oficial excedeu o limite de tamanho permitido.")
            if not payload:
                raise ValueError("A fonte oficial respondeu sem conteúdo.")
            return payload
    except (OSError, ValueError) as error:
        primary_error = error

    # O endpoint de arquivos do STF apresentou falhas intermitentes de cadeia
    # TLS no urllib dos runners. O curl usa a própria pilha TLS, mantém a
    # verificação do certificado e também contorna bloqueios por fingerprint
    # HTTP. Não há fallback inseguro nem aceitação de redirecionamento HTTP.
    curl = shutil.which("curl.exe") or shutil.which("curl")
    if not curl:
        raise primary_error
    curl_ca = ["--cacert", str(STF_INTERMEDIATE_CA)] if hostname.endswith("stf.jus.br") else []
    completed = subprocess.run(
        [
            curl,
            "--fail",
            "--silent",
            "--show-error",
            "--location",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--retry",
            "2",
            "--retry-all-errors",
            "--retry-delay",
            "1",
            "--max-time",
            str(timeout),
            "--max-filesize",
            str(MAX_RESPONSE_BYTES),
            "--user-agent",
            USER_AGENT,
            "--header",
            "Accept: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/atom+xml, application/xml, text/html;q=0.9, */*;q=0.5",
            "--header",
            "Accept-Language: pt-BR,pt;q=0.9",
            "--referer",
            referer,
            *curl_ca,
            url,
        ],
        capture_output=True,
        check=False,
        timeout=timeout + 5,
    )
    if completed.returncode or not completed.stdout or len(completed.stdout) > MAX_RESPONSE_BYTES:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()[:300]
        raise RuntimeError(
            f"urllib falhou ({type(primary_error).__name__}: {primary_error}); "
            f"curl falhou ({completed.returncode}: {detail or 'sem resposta'})"
        ) from primary_error
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
    return classify_dpe_group(text)


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
            # A correção ocorre nos bytes para preservar o encoding declarado
            # pelo XML (alguns feeds do STJ ainda usam ISO-8859-1).
            repaired = re.sub(
                rb"&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)",
                b"&amp;",
                payload,
            )
            parsed = parse_stj_feed(repaired, source["url"])
    else:
        raise ValueError(f"tipo de fonte não suportado como lista: {source['kind']}")
    if not parsed:
        raise ValueError("nenhuma publicação foi identificada")
    return [
        normalise(source, item, timeout, index < enrich_limit)
        for index, item in enumerate(parsed[:80])
    ]


def collect_stf_dataset(
    source: dict[str, str],
    timeout: int,
    previous_dataset: dict[str, Any] | None,
) -> dict[str, Any]:
    errors: list[str] = []
    official_urls = tuple(dict.fromkeys((source["url"], *STF_DATA_URLS)))
    for url in official_urls:
        try:
            payload = fetch(url, timeout)
            if not payload.startswith(b"PK\x03\x04"):
                raise ValueError("a resposta oficial não é uma planilha XLSX")
            dataset = parse_stf_informativos_xlsx(
                payload,
                existing_urls=dataset_url_map(previous_dataset),
            )
            dataset["source_url"] = url
            return dataset
        except Exception as error:
            errors.append(f"{urllib.parse.urlparse(url).hostname}: {type(error).__name__}: {error}")
    raise RuntimeError("; ".join(errors))


def _source_signature(sources: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    return [
        (
            source.get("id"),
            source.get("status"),
            source.get("detected"),
            source.get("message"),
        )
        for source in sources
    ]


def update(
    timeout: int,
    enrich_limit: int,
    required_sources: tuple[str, ...] = (),
) -> dict[str, Any]:
    previous = (
        load_json(CONTENT_PATH)
        if CONTENT_PATH.exists()
        else seed_jurisprudence(load_json(EXTRAS_PATH))
    )
    by_id = {item["id"]: item for item in previous.get("items", []) if item.get("id")}
    datasets = dict(previous.get("datasets", {}))
    results: list[dict[str, Any]] = []
    succeeded = 0
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()

    for source in SOURCES:
        try:
            if source["kind"] == "XLSX":
                dataset = collect_stf_dataset(source, timeout, datasets.get(source["id"]))
                datasets[source["id"]] = dataset
                detected = len(dataset["rows"])
            else:
                items = collect(source, timeout, enrich_limit)
                for item in items:
                    by_id[item["id"]] = item
                detected = len(items)
            succeeded += 1
            results.append(
                {"id": source["id"], "name": source["name"], "court": source["court"], "url": source["url"], "status": "SUCESSO", "detected": detected, "checked_at": now}
            )
        except Exception as error:
            results.append(
                {"id": source["id"], "name": source["name"], "court": source["court"], "url": source["url"], "status": "ERRO", "message": f"{type(error).__name__}: {error}"[:500], "checked_at": now}
            )

    if not succeeded:
        details = "; ".join(f"{item['id']}: {item.get('message')}" for item in results)
        raise RuntimeError(f"todas as fontes oficiais falharam; a base anterior foi preservada. {details}")
    failed_required = [
        item for item in results
        if item["id"] in required_sources and item["status"] != "SUCESSO"
    ]
    if failed_required:
        details = "; ".join(
            f"{item['id']}: {item.get('message', 'fonte indisponível')}"
            for item in failed_required
        )
        raise RuntimeError(
            "a fonte obrigatória não foi atualizada; a base anterior foi preservada. " + details
        )

    if "stf-dados-informativos" in datasets:
        by_id = {
            identifier: item
            for identifier, item in by_id.items()
            if item.get("source_id") != "stf-informativo"
        }
    references = [item for item in by_id.values() if item.get("kind") == "REFERENCIA_EDITORIAL"]
    automatic = [item for item in by_id.values() if item.get("kind") == "PUBLICACAO_OFICIAL"]
    automatic.sort(key=lambda item: str(item.get("published_at") or ""), reverse=True)
    items = automatic + references
    digest = canonical_dataset_hash(items, datasets)
    status = "ATUALIZADO" if succeeded == len(SOURCES) else "ATUALIZADO_PARCIAL"
    previous_digest = canonical_dataset_hash(previous.get("items", []), previous.get("datasets", {}))
    if (
        digest == previous_digest
        and status == previous.get("status")
        and _source_signature(results) == _source_signature(previous.get("sources", []))
    ):
        return previous
    document = {
        "schema_version": 2,
        "version": f"{now[:10].replace('-', '.')}-{digest[:12]}",
        "generated_at": now,
        "last_success_at": now,
        "status": status,
        "sources": results,
        "items": items,
        "datasets": datasets,
    }
    CONTENT_PATH.parent.mkdir(parents=True, exist_ok=True)
    temporary = CONTENT_PATH.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
    temporary.replace(CONTENT_PATH)
    return document


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=int, default=30)
    parser.add_argument("--enrich-limit", type=int, default=8)
    parser.add_argument(
        "--require-source",
        action="append",
        default=[],
        choices=[source["id"] for source in SOURCES],
        help="falha sem substituir a base quando a fonte indicada não puder ser atualizada",
    )
    args = parser.parse_args()
    document = update(
        max(5, args.timeout),
        max(0, args.enrich_limit),
        tuple(args.require_source),
    )
    successes = sum(source["status"] == "SUCESSO" for source in document["sources"])
    total = len(document["items"]) + dataset_record_count(document.get("datasets"))
    print(f"Jurisprudência {document['version']}: {total} itens; {successes}/{len(SOURCES)} fontes válidas.")


if __name__ == "__main__":
    main()
