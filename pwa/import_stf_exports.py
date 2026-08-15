#!/usr/bin/env python3
"""Consolida exportações oficiais do STF no pacote estático da PWA."""

from __future__ import annotations

import argparse
import json
import pathlib
import re
import sys
from datetime import datetime, timezone


PWA_ROOT = pathlib.Path(__file__).resolve().parent
REPO_ROOT = PWA_ROOT.parent
sys.path.insert(0, str(REPO_ROOT))

from server.stf_exports import (  # noqa: E402
    STF_DATA_URL,
    canonical_dataset_hash,
    dataset_record_count,
    dataset_url_map,
    informativo_url_overrides,
    parse_stf_acordaos_csv,
    parse_stf_informativos_xlsx,
)


CONTENT_PATH = PWA_ROOT / "content" / "jurisprudence.json"


def import_exports(
    xlsx_path: pathlib.Path,
    informativos_csv_path: pathlib.Path,
    acordaos_csv_path: pathlib.Path,
    *,
    content_path: pathlib.Path = CONTENT_PATH,
) -> dict:
    previous = json.loads(content_path.read_text(encoding="utf-8"))
    datasets = dict(previous.get("datasets", {}))
    overrides = informativo_url_overrides(informativos_csv_path.read_bytes())
    informativos = parse_stf_informativos_xlsx(
        xlsx_path.read_bytes(),
        url_overrides=overrides,
        existing_urls=dataset_url_map(datasets.get("stf-dados-informativos")),
    )
    acordaos = parse_stf_acordaos_csv(acordaos_csv_path.read_bytes())
    snapshot_match = re.search(r"(\d{4}-\d{2}-\d{2})", acordaos_csv_path.name)
    if snapshot_match:
        acordaos["snapshot_date"] = snapshot_match.group(1)

    if len(informativos["rows"]) < 10_000:
        raise ValueError("A planilha histórica do STF contém menos de 10.000 registros válidos.")
    if len(acordaos["rows"]) < 1_000:
        raise ValueError("A exportação de acórdãos contém menos de 1.000 registros válidos.")

    datasets[informativos["source_id"]] = informativos
    datasets[acordaos["source_id"]] = acordaos
    items = [
        item
        for item in previous.get("items", [])
        if item.get("source_id") != "stf-informativo"
    ]
    now = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    sources = [
        source
        for source in previous.get("sources", [])
        if source.get("id") not in {"stf-informativo", "stf-dados-informativos"}
    ]
    stf_source = {
        "id": "stf-dados-informativos",
        "name": "Dados estruturados do Informativo STF",
        "court": "STF",
        "url": STF_DATA_URL,
        "status": "SUCESSO",
        "detected": len(informativos["rows"]),
        "checked_at": now,
    }
    sources.insert(1 if sources else 0, stf_source)
    digest = canonical_dataset_hash(items, datasets)
    document = {
        "schema_version": 2,
        "version": f"{now[:10].replace('-', '.')}-{digest[:12]}",
        "generated_at": now,
        "last_success_at": now,
        "status": "ATUALIZADO",
        "sources": sources,
        "items": items,
        "datasets": datasets,
    }
    temporary = content_path.with_suffix(".json.tmp")
    temporary.write_text(
        json.dumps(
            document,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        )
        + "\n",
        encoding="utf-8",
    )
    temporary.replace(content_path)
    return document


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xlsx", required=True, type=pathlib.Path)
    parser.add_argument("--informativos-csv", required=True, type=pathlib.Path)
    parser.add_argument("--acordaos-csv", required=True, type=pathlib.Path)
    args = parser.parse_args()
    document = import_exports(args.xlsx, args.informativos_csv, args.acordaos_csv)
    datasets = document["datasets"]
    print(
        "Base STF incorporada: "
        f"{len(datasets['stf-dados-informativos']['rows'])} informativos estruturados, "
        f"{len(datasets['stf-acordaos-pesquisa']['rows'])} acórdãos e "
        f"{dataset_record_count(datasets) + len(document['items'])} registros totais."
    )


if __name__ == "__main__":
    main()
