#!/usr/bin/env python3
"""Build determinístico da PWA local-first do Centro de Estudos DPE/RN."""

from __future__ import annotations

import hashlib
import json
import pathlib
import shutil
import sys
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse


ROOT = pathlib.Path(__file__).resolve().parent
PROJECT = ROOT.parent
SRC = ROOT / "src"
CONTENT = ROOT / "content"
DIST = ROOT / "dist"

APP_VERSION = "0.11.0"
STATE_SCHEMA_VERSION = 8
CONTENT_SCHEMA_VERSION = 4
QUESTION_BANK_VERSION = "2026.08-auditoria-1"


def load_json(path: pathlib.Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(
        value,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")


def sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def is_http_url(value: str) -> bool:
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def quarantine_broken_jurisprudence(document: dict[str, Any]) -> int:
    """Omit records whose source text was irreversibly decoded with U+FFFD."""
    omitted = 0
    valid_items = []
    for item in document.get("items", []):
        if "\ufffd" in json.dumps(item, ensure_ascii=False):
            omitted += 1
        else:
            valid_items.append(item)
    document["items"] = valid_items

    for dataset in document.get("datasets", {}).values():
        valid_rows = []
        for row in dataset.get("rows", []):
            if "\ufffd" in json.dumps(row, ensure_ascii=False):
                omitted += 1
            else:
                valid_rows.append(row)
        dataset["rows"] = valid_rows

    if omitted:
        document["quality"] = {"omitted_corrupted_records": omitted}
    return omitted


def seed_jurisprudence(extras: dict[str, Any]) -> dict[str, Any]:
    items = []
    for item in extras["precedentes"]:
        stable = sha256(f"{item['trib']}|{item['ref']}".encode("utf-8"))[:20]
        items.append(
            {
                "id": f"referencia-{stable}",
                **item,
                "kind": "REFERENCIA_EDITORIAL",
                "published_at": None,
                "source_id": "referencias-iniciais",
            }
        )
    return {
        "schema_version": 1,
        "version": "referencias-iniciais-1",
        "generated_at": None,
        "last_success_at": None,
        "status": "REFERENCIAS_INICIAIS",
        "sources": [],
        "items": items,
    }


def build() -> dict[str, Any]:
    program_raw = load_json(SRC / "program.json")
    legislation_raw = load_json(SRC / "legislation_reading_map.json")
    pre_edit_raw = load_json(SRC / "pre_edit_priority.json")
    extras = load_json(SRC / "extras.json")
    discursive_catalog = load_json(PROJECT / "data" / "discursive_prompts.json")
    question_catalog = load_json(SRC / "question_catalog.json")

    questions: list[dict[str, Any]] = []
    for group in "1234":
        questions.extend(load_json(SRC / f"questoes_g{group}.json"))

    program = [
        {
            "id": item["id"],
            "g": item["objective_group"],
            "gd": item["discursive_group"],
            "dc": item["discipline_code"],
            "di": item["discipline"],
            "it": item["item"],
            "to": item["topic"],
            "pg": item.get("source_page"),
            "url": item.get("source_url"),
            "source_version": item.get("source_version", "resolucao-344-2025"),
        }
        for item in program_raw["program"]
    ]

    legislation = {
        "version": legislation_raw["map_version"],
        "status": legislation_raw["validation_status"],
        "topicos": legislation_raw["topics"],
        "fontes": legislation_raw["sources"],
        "sem_dispositivo": legislation_raw["no_specific_articles"],
    }

    pre_edit = {
        "version": pre_edit_raw["profile_version"],
        "status": pre_edit_raw["status"],
        "resolucao": pre_edit_raw["resolution"],
        "metodologia": pre_edit_raw["methodology"],
        "achados": pre_edit_raw["comparative_findings"],
        "editais": pre_edit_raw["notices"],
        "disciplinas": pre_edit_raw["disciplines"],
        "faixas": pre_edit_raw["tiers"],
        "topicos": pre_edit_raw["topics"],
    }

    for question in questions:
        question.setdefault("src", "official-pack")
        question.setdefault("authorship_type", "AUTORAL_ASSISTIDA")
        question.setdefault("validation_status", "REFERENCIADA")
        question.setdefault("rights_status", "AUTORAL")
        question.setdefault("editorial_status", "PUBLICADA_PRELIMINAR")
        question["content_version"] = QUESTION_BANK_VERSION
        question["canonical_hash"] = sha256(canonical_bytes(question))

    jurisprudence_path = CONTENT / "jurisprudence.json"
    jurisprudence = (
        load_json(jurisprudence_path)
        if jurisprudence_path.exists()
        else seed_jurisprudence(extras)
    )
    quarantine_broken_jurisprudence(jurisprudence)

    meta = {
        "versao": APP_VERSION,
        "schema_estado": STATE_SCHEMA_VERSION,
        "versao_banco_questoes": QUESTION_BANK_VERSION,
        "concurso": "III Concurso para Defensor(a) Público(a) Substituto(a) — DPE/RN",
        "banca": "CEBRASPE",
        "banca_fonte": "Termo de Dispensa de Licitação nº 03/2026 — DPE/RN, DOE nº 16.216 de 15/08/2026",
        "resolucao": "Resolução nº 344/2025 — CSDP/DPE-RN (redação consolidada)",
        "resolucao_url": "https://www.defensoria.rn.def.br/",
        "data_prova_estimada": "2026-12-13",
        "estrutura_objetiva": "100 questões, cinco alternativas (A–E), 0,10 ponto por acerto, 5 horas (arts. 40 e 41)",
        "priorizacao_pre_edital": "Perfil comparativo de seis editais Cebraspe, sem excluir itens do Anexo I",
        "grupos": {
            "I": ["Direito Constitucional", "Direito Administrativo", "Princípios Institucionais da Defensoria Pública"],
            "II": ["Direito Penal", "Direito Processual Penal", "Direito da Execução Penal"],
            "III": ["Direito Civil", "Direito Processual Civil", "Direito do Consumidor"],
            "IV": ["Direitos Humanos", "Direitos Difusos e Coletivos", "Direito da Criança e do Adolescente"],
        },
    }

    core = {
        "schema_version": CONTENT_SCHEMA_VERSION,
        "meta": meta,
        "programa": program,
        "legislacao": legislation,
        "priorizacao": pre_edit,
        "questoes": questions,
        "questao_fontes": question_catalog["sources"],
        "direitos_policy": question_catalog["rights_policy"],
        "temas_discursivos": discursive_catalog["prompts"],
        "discursivas_meta": {
            "version": discursive_catalog["catalog_version"],
            "methodology": discursive_catalog["methodology"],
        },
        "juris_links": extras["juris_links"],
    }

    errors: list[str] = []
    topic_ids = {item["id"] for item in program}
    if len(program) != 296:
        errors.append(f"programa com {len(program)} tópicos; esperado: 296")
    if len(topic_ids) != len(program):
        errors.append("IDs duplicados no programa")
    priority_ids = set(pre_edit["topicos"])
    if priority_ids != topic_ids:
        missing = sorted(topic_ids - priority_ids)
        extra = sorted(priority_ids - topic_ids)
        errors.append(f"perfil pré-edital incompleto; ausentes={missing}, extras={extra}")
    allowed_tiers = {"MUITO_ALTA", "ALTA", "MEDIA"}
    for topic_id, profile in pre_edit["topicos"].items():
        if not isinstance(profile, list) or len(profile) != 2 or profile[0] not in allowed_tiers:
            errors.append(f"perfil pré-edital inválido: {topic_id}")
    if len(questions) < 260:
        errors.append(f"banco perdeu questões: {len(questions)}; mínimo: 260")
    question_ids = [item["id"] for item in questions]
    if len(set(question_ids)) != len(question_ids):
        errors.append("IDs duplicados no banco de questões")

    by_group = {group: 0 for group in ("I", "II", "III", "IV")}
    covered_topics: set[str] = set()
    for question in questions:
        by_group[question.get("g", "")] = by_group.get(question.get("g", ""), 0) + 1
        if len(question.get("o", [])) != 5:
            errors.append(f"{question.get('id')}: deve possuir cinco alternativas")
        if question.get("gab") not in "ABCDE":
            errors.append(f"{question.get('id')}: gabarito inválido")
        topic_id = question.get("t")
        if topic_id:
            covered_topics.add(topic_id)
            if topic_id not in topic_ids:
                errors.append(f"{question.get('id')}: tópico inexistente {topic_id}")
        if question.get("u") and not is_http_url(question["u"]):
            errors.append(f"{question.get('id')}: URL de fonte inválida")
    for group, count in by_group.items():
        if count < 25:
            errors.append(f"grupo {group} possui somente {count} questões")
    discursive_prompts = discursive_catalog.get("prompts", [])
    discursive_ids = [item.get("id") for item in discursive_prompts]
    if len(discursive_prompts) < 24:
        errors.append(f"catálogo discursivo possui somente {len(discursive_prompts)} temas")
    if len(set(discursive_ids)) != len(discursive_ids) or not all(discursive_ids):
        errors.append("IDs ausentes ou duplicados no catálogo discursivo")
    for prompt in discursive_prompts:
        prompt_id = prompt.get("id", "sem-id")
        expected_score = 5.0 if prompt.get("tipo") == "PECA" else 2.5
        if prompt.get("tipo") not in {"QUESTAO", "PECA"}:
            errors.append(f"{prompt_id}: tipo discursivo inválido")
        if prompt.get("gd") not in {"I", "II"} or prompt.get("g") not in {"I", "II", "III", "IV"}:
            errors.append(f"{prompt_id}: grupo discursivo ou objetivo inválido")
        mirror = prompt.get("espelho", [])
        if len(mirror) < 4:
            errors.append(f"{prompt_id}: espelho insuficiente")
        score = sum(float(item.get("pontos", 0)) for item in mirror)
        if abs(score - expected_score) > 0.001:
            errors.append(f"{prompt_id}: espelho soma {score}; esperado {expected_score}")
        anchors = prompt.get("ancoras", [])
        if not anchors or any(not is_http_url(str(item.get("url", ""))) for item in anchors):
            errors.append(f"{prompt_id}: âncora jurisprudencial inválida")
    for topic_id in legislation["topicos"]:
        if topic_id not in topic_ids:
            errors.append(f"mapa legislativo aponta tópico inexistente: {topic_id}")
        for source_code, article_reference in legislation["topicos"][topic_id]:
            if source_code not in legislation["fontes"]:
                errors.append(f"mapa legislativo usa fonte inexistente: {topic_id}/{source_code}")
            if not str(article_reference).strip():
                errors.append(f"mapa legislativo sem faixa: {topic_id}/{source_code}")
    no_specific = set(legislation["sem_dispositivo"])
    mapped = set(legislation["topicos"])
    if mapped & no_specific:
        errors.append(f"tópicos legislativos em classificações conflitantes: {sorted(mapped & no_specific)}")
    if mapped | no_specific != topic_ids:
        errors.append(f"classificação legislativa não cobre os {len(topic_ids)} tópicos")
    for source_code, source in legislation["fontes"].items():
        if not isinstance(source, list) or len(source) != 2 or not is_http_url(source[1]):
            errors.append(f"fonte legislativa inválida: {source_code}")
    if not jurisprudence.get("items"):
        errors.append("pacote de jurisprudência vazio")
    jurisprudence_ids: set[str] = set()
    for item in jurisprudence.get("items", []):
        identifier = str(item.get("id") or "")
        if not identifier or identifier in jurisprudence_ids:
            errors.append(f"jurisprudência com ID ausente ou duplicado: {identifier}")
        jurisprudence_ids.add(identifier)
        if item.get("url") and not is_http_url(item["url"]):
            errors.append(f"jurisprudência {item.get('id')}: URL inválida")
    dataset_count = 0
    for dataset_id, dataset in jurisprudence.get("datasets", {}).items():
        columns = dataset.get("columns", [])
        rows = dataset.get("rows", [])
        if not columns or "id" not in columns or "url" not in columns:
            errors.append(f"base {dataset_id}: colunas id/url ausentes")
            continue
        id_index, url_index = columns.index("id"), columns.index("url")
        for position, row in enumerate(rows):
            if len(row) != len(columns):
                errors.append(f"base {dataset_id}: linha {position + 1} incompatível com o esquema")
                continue
            identifier = str(row[id_index] or "")
            if not identifier or identifier in jurisprudence_ids:
                errors.append(f"base {dataset_id}: ID ausente ou duplicado {identifier}")
            jurisprudence_ids.add(identifier)
            if row[url_index] and not is_http_url(str(row[url_index])):
                errors.append(f"base {dataset_id}: URL inválida em {identifier}")
        dataset_count += len(rows)

    if errors:
        print("FALHAS DE INTEGRIDADE:", file=sys.stderr)
        for error in errors:
            print(f"  - {error}", file=sys.stderr)
        raise SystemExit(1)

    if DIST.exists():
        shutil.rmtree(DIST)
    content_dir = DIST / "content"
    content_dir.mkdir(parents=True)

    core_payload = canonical_bytes(core)
    jurisprudence_payload = canonical_bytes(jurisprudence)
    core_hash = sha256(core_payload)
    jurisprudence_hash = sha256(jurisprudence_payload)
    core_name = f"core-{core_hash[:12]}.json"
    jurisprudence_name = f"jurisprudence-{jurisprudence_hash[:12]}.json"
    (content_dir / core_name).write_bytes(core_payload)
    (content_dir / jurisprudence_name).write_bytes(jurisprudence_payload)

    static_sources = ("shell.html", "styles.css", "app.js", "manifest.webmanifest", "icon.svg", "sw.js")
    static_fingerprint = sha256(
        b"".join(name.encode("utf-8") + b"\0" + (SRC / name).read_bytes() for name in static_sources)
    )[:12]
    build_version = f"{APP_VERSION}-{static_fingerprint}"
    generated_at = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    manifest = {
        "format": "centro-estudos-dpern-content",
        "formatVersion": 1,
        "appVersion": APP_VERSION,
        "buildVersion": build_version,
        "stateSchemaVersion": STATE_SCHEMA_VERSION,
        "contentSchemaVersion": CONTENT_SCHEMA_VERSION,
        "contentVersion": f"{QUESTION_BANK_VERSION}+{core_hash[:8]}",
        "questionBankVersion": QUESTION_BANK_VERSION,
        "preEditProfileVersion": pre_edit["version"],
        "jurisprudenceVersion": jurisprudence.get("version", jurisprudence_hash[:12]),
        "generatedAt": generated_at,
        "assets": {
            "core": {"url": f"./{core_name}", "sha256": core_hash, "bytes": len(core_payload)},
            "jurisprudence": {"url": f"./{jurisprudence_name}", "sha256": jurisprudence_hash, "bytes": len(jurisprudence_payload)},
        },
        "stats": {
            "topics": len(program),
            "questions": len(questions),
            "questionTopicsCovered": len(covered_topics),
            "jurisprudenceItems": len(jurisprudence["items"]) + dataset_count,
            "discursivePrompts": len(discursive_prompts),
            "questionsByGroup": by_group,
        },
    }
    (content_dir / "manifest.json").write_bytes(canonical_bytes(manifest))

    copies = {
        "shell.html": "index.html",
        "styles.css": "styles.css",
        "app.js": "app.js",
        "manifest.webmanifest": "manifest.webmanifest",
        "icon.svg": "icon.svg",
        "_headers": "_headers",
    }
    for source_name, destination_name in copies.items():
        shutil.copy2(SRC / source_name, DIST / destination_name)
    shutil.copy2(DIST / "index.html", DIST / "404.html")
    (DIST / ".nojekyll").write_text("", encoding="utf-8")
    service_worker = (SRC / "sw.js").read_text(encoding="utf-8").replace("__APP_VERSION__", build_version)
    (DIST / "sw.js").write_text(service_worker, encoding="utf-8", newline="\n")

    print(
        f"OK  PWA {APP_VERSION}: {len(program)} tópicos, {len(questions)} questões, "
        f"{len(covered_topics)} tópicos cobertos, "
        f"{len(jurisprudence['items']) + dataset_count} itens de jurisprudência"
    )
    print(f"    questões por grupo: {by_group}")
    print(f"    saída: {DIST}")
    return manifest


if __name__ == "__main__":
    build()
