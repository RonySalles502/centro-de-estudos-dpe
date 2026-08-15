"""Leitura e compactação das exportações públicas de jurisprudência do STF.

O parser de XLSX usa apenas a biblioteca padrão para também funcionar no
GitHub Actions, sem instalar dependências durante a atualização diária.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import re
import unicodedata
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from typing import Any


STF_DATA_URL = (
    "https://www.stf.jus.br/arquivo/cms/informativoSTF/anexo/"
    "Informativo_Dados/Dados_InformativosSTF.xlsx"
)

DATASET_COLUMNS = (
    "id",
    "ref",
    "tema",
    "tese",
    "url",
    "g",
    "published_at",
    "record_type",
    "informativo",
    "processo",
    "ramo",
    "materia",
    "relator",
    "redator",
    "orgao",
    "repercussao",
    "tema_rg",
    "legislacao",
    "ods",
    "uf",
    "observacao",
    "decisao",
    "data_publicacao",
)


def clean_text(value: Any, limit: int | None = None) -> str:
    if value is None:
        return ""
    text = re.sub(r"\s+", " ", str(value)).strip()
    if text.casefold() in {"nan", "nat", "none"}:
        return ""
    if limit and len(text) > limit:
        shortened = text[:limit].rsplit(" ", 1)[0].rstrip(" ,;:-")
        return f"{shortened}…"
    return text


def number_text(value: Any) -> str:
    text = clean_text(value)
    if re.fullmatch(r"-?\d+(?:\.0+)?", text):
        return str(int(float(text)))
    return text


def _ascii_key(value: Any) -> str:
    text = unicodedata.normalize("NFKD", clean_text(value).casefold())
    return "".join(character for character in text if not unicodedata.combining(character))


def classify_dpe_group(*values: Any) -> str | None:
    text = " ".join(_ascii_key(value) for value in values if clean_text(value))
    dictionaries = {
        "I": (
            "constitucional",
            "administrativ",
            "defensoria publica",
            "concurso publico",
            "servidor publico",
            "organizacao do estado",
        ),
        "II": (
            "processual penal",
            "direito penal",
            "penal",
            "execucao penal",
            "habeas corpus",
            "prisao",
            "crime",
            "trafico",
        ),
        "III": (
            "processual civil",
            "direito civil",
            "consumidor",
            "familia",
            "sucess",
            "contrato",
            "responsabilidade civil",
        ),
        "IV": (
            "direitos humanos",
            "crianca",
            "adolescente",
            "ambiental",
            "coletiv",
            "indigena",
            "acao civil publica",
        ),
    }
    scores = {group: sum(term in text for term in terms) for group, terms in dictionaries.items()}
    best = max(scores, key=scores.get)
    return best if scores[best] else None


def _hash(value: str, length: int = 24) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()[:length]


def _normalise_date(value: Any) -> str:
    text = clean_text(value)
    if not text:
        return ""
    if re.fullmatch(r"\d+(?:\.\d+)?", text):
        serial = float(text)
        if 10_000 < serial < 100_000:
            parsed = datetime(1899, 12, 30, tzinfo=timezone.utc) + timedelta(days=serial)
            return parsed.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
    for pattern, ordering in (
        (r"(\d{4})-(\d{2})-(\d{2})", "ymd"),
        (r"(\d{2})/(\d{2})/(\d{4})", "dmy"),
    ):
        match = re.match(pattern, text)
        if not match:
            continue
        values = [int(part) for part in match.groups()]
        year, month, day = values if ordering == "ymd" else (values[2], values[1], values[0])
        try:
            return datetime(year, month, day, tzinfo=timezone.utc).isoformat()
        except ValueError:
            return ""
    return ""


def _natural_key(informativo: Any, classe: Any, numero: Any, incidente: Any) -> str:
    return "|".join(
        (
            number_text(informativo),
            clean_text(classe).casefold(),
            number_text(numero),
            clean_text(incidente).casefold(),
        )
    )


def _cell_column(reference: str) -> int:
    letters = re.match(r"[A-Z]+", reference.upper())
    if not letters:
        return 0
    result = 0
    for character in letters.group(0):
        result = result * 26 + ord(character) - 64
    return result - 1


def _shared_strings(archive: zipfile.ZipFile) -> list[str]:
    try:
        payload = archive.read("xl/sharedStrings.xml")
    except KeyError:
        return []
    root = ET.fromstring(payload)
    return ["".join(node.text or "" for node in item.iter() if node.tag.rsplit("}", 1)[-1] == "t") for item in root]


def _worksheet_rows(payload: bytes) -> list[dict[str, str]]:
    with zipfile.ZipFile(io.BytesIO(payload)) as archive:
        shared = _shared_strings(archive)
        sheets = sorted(
            name
            for name in archive.namelist()
            if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name)
        )
        if not sheets:
            raise ValueError("A planilha do STF não contém uma aba de dados legível.")
        root = ET.fromstring(archive.read(sheets[0]))

    matrix: list[list[str]] = []
    for row in (node for node in root.iter() if node.tag.rsplit("}", 1)[-1] == "row"):
        values: dict[int, str] = {}
        for cell in (node for node in row if node.tag.rsplit("}", 1)[-1] == "c"):
            column = _cell_column(cell.attrib.get("r", "A1"))
            cell_type = cell.attrib.get("t", "")
            raw = next(
                (node.text or "" for node in cell.iter() if node.tag.rsplit("}", 1)[-1] == "v"),
                "",
            )
            if cell_type == "s" and raw:
                try:
                    value = shared[int(raw)]
                except (IndexError, ValueError):
                    value = ""
            elif cell_type == "inlineStr":
                value = "".join(
                    node.text or "" for node in cell.iter() if node.tag.rsplit("}", 1)[-1] == "t"
                )
            else:
                value = raw
            values[column] = value
        if values:
            matrix.append([values.get(index, "") for index in range(max(values) + 1)])

    if not matrix:
        raise ValueError("A planilha do STF está vazia.")
    headers = [clean_text(value) for value in matrix[0]]
    return [
        {header: row[index] if index < len(row) else "" for index, header in enumerate(headers) if header}
        for row in matrix[1:]
    ]


def informativo_url_overrides(payload: bytes) -> dict[str, str]:
    reader = csv.DictReader(io.StringIO(payload.decode("utf-8-sig")), delimiter=";")
    overrides: dict[str, str] = {}
    for row in reader:
        informativo = number_text(row.get("Informativo"))
        classe = clean_text(row.get("Classe"))
        numero = number_text(row.get("Número"))
        url = clean_text(row.get("Título URL"))
        if not (informativo.isdigit() and classe and numero and url.startswith("https://")):
            continue
        overrides[
            _natural_key(informativo, classe, numero, row.get("Incidente processo"))
        ] = url
    return overrides


def dataset_url_map(dataset: Mapping[str, Any] | None) -> dict[str, str]:
    if not dataset:
        return {}
    columns = list(dataset.get("columns", []))
    if "id" not in columns or "url" not in columns:
        return {}
    id_index, url_index = columns.index("id"), columns.index("url")
    return {
        str(row[id_index]): str(row[url_index])
        for row in dataset.get("rows", [])
        if len(row) > max(id_index, url_index) and row[id_index] and row[url_index]
    }


def _process_url(classe: str, numero: str) -> str:
    if not (classe and numero):
        return "https://jurisprudencia.stf.jus.br/"
    query = urllib.parse.urlencode({"classe": classe, "numeroProcesso": numero})
    return f"https://portal.stf.jus.br/processos/listarProcessos.asp?{query}"


def parse_stf_informativos_xlsx(
    payload: bytes,
    *,
    url_overrides: Mapping[str, str] | None = None,
    existing_urls: Mapping[str, str] | None = None,
) -> dict[str, Any]:
    overrides = dict(url_overrides or {})
    preserved = dict(existing_urls or {})
    records: dict[str, list[Any]] = {}
    issue_numbers: set[int] = set()

    for row in _worksheet_rows(payload):
        informativo = number_text(row.get("Informativo"))
        classe = clean_text(row.get("Classe Processo"))
        numero = number_text(row.get("Número Processo"))
        title = clean_text(row.get("Título"), 1000)
        if not (informativo.isdigit() and classe and numero and title):
            continue
        incident = clean_text(row.get("Incidente Julgamento"))
        uf = clean_text(row.get("UF"))
        judgment_date = _normalise_date(row.get("Data Julgamento"))
        process = f"{classe} {numero}{f' {incident}' if incident else ''}{f'/{uf}' if uf else ''}"
        stable_basis = "|".join((informativo, classe, numero, incident, judgment_date, title))
        identifier = f"stf-inf-{_hash(stable_basis)}"
        natural = _natural_key(informativo, classe, numero, incident)
        url = overrides.get(natural) or preserved.get(identifier) or _process_url(classe, numero)
        tese = clean_text(row.get("Tese Julgado"), 4000)
        summary = clean_text(row.get("Resumo"), 3000)
        news = clean_text(row.get("Notícia"), 1800)
        synthesis = tese or summary or news or title
        branch = clean_text(row.get("Ramo Direito"), 300)
        matter = clean_text(row.get("Matéria"), 1000)
        group = classify_dpe_group(branch, matter, title, synthesis)
        ref = f"Informativo STF {informativo} · {process}"
        values = {
            "id": identifier,
            "ref": ref,
            "tema": title,
            "tese": synthesis,
            "url": url,
            "g": group or "",
            "published_at": judgment_date,
            "record_type": "Informativo STF",
            "informativo": informativo,
            "processo": process,
            "ramo": branch,
            "materia": matter,
            "relator": clean_text(row.get("Relator"), 300),
            "redator": clean_text(row.get("Redator Acórdão"), 300),
            "orgao": clean_text(row.get("Órgão Julgador"), 300),
            "repercussao": clean_text(row.get("Repercussão Geral"), 80),
            "tema_rg": number_text(row.get("Tema RG")),
            "legislacao": clean_text(row.get("Legislação"), 4000),
            "ods": clean_text(row.get("ODS ONU 2030"), 800),
            "uf": uf,
            "observacao": clean_text(row.get("Observação"), 1600),
            "decisao": "",
            "data_publicacao": "",
        }
        records[identifier] = [values[column] for column in DATASET_COLUMNS]
        issue_numbers.add(int(informativo))

    rows = sorted(
        records.values(),
        key=lambda item: (str(item[6]), int(item[8]), str(item[1])),
        reverse=True,
    )
    if not rows:
        raise ValueError("Nenhum registro válido foi encontrado na planilha oficial do STF.")
    return {
        "schema_version": 1,
        "source_id": "stf-dados-informativos",
        "name": "Dados estruturados do Informativo STF",
        "court": "STF",
        "record_kind": "STF_INFORMATIVO",
        "source_url": STF_DATA_URL,
        "source_sha256": hashlib.sha256(payload).hexdigest(),
        "columns": list(DATASET_COLUMNS),
        "rows": rows,
        "stats": {
            "records": len(rows),
            "informativos": len(issue_numbers),
            "first_issue": min(issue_numbers),
            "last_issue": max(issue_numbers),
        },
    }


def parse_stf_acordaos_csv(payload: bytes) -> dict[str, Any]:
    reader = csv.DictReader(io.StringIO(payload.decode("utf-8-sig")), delimiter=";")
    records: dict[str, list[Any]] = {}
    for row in reader:
        classe = clean_text(row.get("Classe"))
        numero = number_text(row.get("Número"))
        title = clean_text(row.get("Título"), 1000)
        url = clean_text(row.get("Título URL"))
        if not (classe and numero and title and url.startswith("https://")):
            continue
        incident = clean_text(row.get("Incidente"))
        judgment_date = _normalise_date(row.get("Data de julgamento"))
        process = f"{classe} {numero}{f' {incident}' if incident else ''}"
        stable_basis = "|".join((classe, numero, incident, judgment_date, title))
        identifier = f"stf-ac-{_hash(stable_basis)}"
        fixed_thesis = clean_text(row.get("Tese"), 8000)
        syllabus = clean_text(row.get("Ementa"), 8000)
        synthesis = fixed_thesis or syllabus or title
        matter = clean_text(row.get("Tema"), 1000)
        group = classify_dpe_group(matter, title, synthesis)
        values = {
            "id": identifier,
            "ref": process,
            "tema": matter or title,
            "tese": synthesis,
            "url": url,
            "g": group or "",
            "published_at": judgment_date,
            "record_type": "Acórdão STF",
            "informativo": "",
            "processo": process,
            "ramo": "",
            "materia": matter,
            "relator": clean_text(row.get("Relator(a)"), 300),
            "redator": clean_text(row.get("Redator(a) acórdão"), 300),
            "orgao": clean_text(row.get("Órgão julgador"), 300),
            "repercussao": clean_text(row.get("Repercussão geral"), 80),
            "tema_rg": matter if clean_text(row.get("Repercussão geral")) else "",
            "legislacao": "",
            "ods": "",
            "uf": "",
            "observacao": clean_text(row.get("Mesmo sentido"), 1600),
            "decisao": clean_text(row.get("Decisão"), 5000),
            "data_publicacao": _normalise_date(row.get("Data de publicação")),
        }
        records[identifier] = [values[column] for column in DATASET_COLUMNS]

    rows = sorted(records.values(), key=lambda item: (str(item[6]), str(item[1])), reverse=True)
    if not rows:
        raise ValueError("Nenhum acórdão válido foi encontrado na exportação do STF.")
    return {
        "schema_version": 1,
        "source_id": "stf-acordaos-pesquisa",
        "name": "Acórdãos da Pesquisa de Jurisprudência do STF",
        "court": "STF",
        "record_kind": "STF_ACORDAO",
        "source_url": "https://jurisprudencia.stf.jus.br/",
        "source_sha256": hashlib.sha256(payload).hexdigest(),
        "automatic": False,
        "columns": list(DATASET_COLUMNS),
        "rows": rows,
        "stats": {"records": len(rows), "snapshot": True},
    }


def canonical_dataset_hash(items: list[dict[str, Any]], datasets: Mapping[str, Any]) -> str:
    payload = json.dumps(
        {"items": items, "datasets": datasets},
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def dataset_record_count(datasets: Mapping[str, Any] | None) -> int:
    return sum(len(dataset.get("rows", [])) for dataset in (datasets or {}).values())
