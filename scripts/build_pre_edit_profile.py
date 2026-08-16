#!/usr/bin/env python3
"""Gera o perfil pré-edital Cebraspe usado pelas duas arquiteturas do projeto."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[1]
PROGRAM_PATH = ROOT / "data" / "program.json"
OUTPUTS = (
    ROOT / "data" / "pre_edit_priority.json",
    ROOT / "pwa" / "src" / "pre_edit_priority.json",
)


def ids(code: str, numbers: Iterable[int]) -> set[str]:
    group = {
        "CON": 1,
        "ADM": 1,
        "PID": 1,
        "PEN": 2,
        "DPP": 2,
        "DEP": 2,
        "CIV": 3,
        "DPC": 3,
        "CDC": 3,
        "DHU": 4,
        "DCO": 4,
        "DCA": 4,
    }[code]
    return {f"G{group}-{code}-{number:02d}" for number in numbers}


VERY_HIGH = set().union(
    ids("CON", (5, 8, 9, 11, 12, 17, 18, 25, 27, 34, 35, 36, 37, 38)),
    ids("ADM", range(3, 11)),
    ids("ADM", (13, 14)),
    ids("PID", (3, 4, 6, 7, 9, 10)),
    ids("PEN", (2, 6, 7, 8, 9, 10, 12, 15, 16)),
    ids("DPP", (1, 6, 9, 10, 11, 12, 14, 16, 20, 21, 23, 24, 25, 27)),
    ids("DEP", (2, 3, 4, 5, 6, 7, 8, 13)),
    ids("CIV", (8, 9, 12, 15, 17, 18, 21, 24, 25, 30, 31, 32, 33, 34, 35, 36, 42)),
    ids("DPC", (1, 2, 4, 7, 8, 9, 10, 11, 14, 15, 16, 20, 24, 25, 27, 28, 29, 30, 32, 33)),
    ids("CDC", (1, 3, 6)),
    ids("DHU", (2, 3, 4, 5, 9, 10, 12, 15)),
    ids("DCO", (1, 2, 3, 4, 5, 9, 12, 13, 15, 20, 21, 22, 24, 28, 31, 35)),
    ids("DCA", (1, 2, 4, 6, 7, 8, 9, 13, 14, 15, 20, 21, 22)),
)

MEDIUM = set().union(
    ids("CON", (1, 2, 24, 31, 32, 39, 40, 42)),
    ids("ADM", (15,)),
    ids("PID", (1, 2, 5, 11, 12)),
    ids("PEN", (3, 4, 11, 17)),
    ids("DPP", (2, 3, 4, 5, 15, 29, 30)),
    ids("DEP", (1, 12, 14)),
    ids("CIV", range(1, 8)),
    ids("CIV", (22, 47)),
    ids("DPC", (35,)),
    ids("CDC", (5, 8)),
    ids("DHU", (1, 6, 7, 8, 13, 14, 16)),
    ids("DCO", (16, 17, 18, 19, 30, 32, 33, 34, 36, 37)),
    ids("DCA", (16, 18, 19, 23)),
)


NOTICES = [
    {
        "id": "DPE-RN-2015",
        "state": "RN",
        "year": 2015,
        "file": "dpe_rn_2015_ed_abertura.pdf",
        "structure_page": 10,
        "syllabus_page": 25,
        "objective_format": "100 questões A–E, quatro grupos de 25, cinco horas",
        "use": "precedente estrutural principal",
    },
    {
        "id": "DPE-PE-2017",
        "state": "PE",
        "year": 2017,
        "file": "Ed_2_2017_DPE_PE_DEFENSOR_17_Abertura_Republicacao.pdf",
        "structure_page": 9,
        "syllabus_page": 25,
        "objective_format": "100 questões A–E, cinco horas",
        "use": "recorrência e prova aplicada",
    },
    {
        "id": "DPE-SE-2021",
        "state": "SE",
        "year": 2021,
        "file": "ED_1_2020_DPE_SE_DEFENSOR_ABERTURA.pdf",
        "structure_page": 12,
        "syllabus_page": 29,
        "objective_format": "100 questões A–E, cinco horas",
        "use": "recorrência e prova aplicada",
    },
    {
        "id": "DPE-TO-2021",
        "state": "TO",
        "year": 2021,
        "file": "ED_1_DPE_TO_ABERTURA.pdf",
        "structure_page": 14,
        "syllabus_page": 35,
        "objective_format": "100 questões A–E, quatro grupos de 25, cinco horas",
        "use": "precedente estrutural principal",
    },
    {
        "id": "DPE-RS-2021",
        "state": "RS",
        "year": 2021,
        "file": "ED_2_DPRS_2021_ABERTURA.pdf",
        "structure_page": 14,
        "syllabus_page": 36,
        "objective_format": "200 itens certo/errado, cinco blocos de 40, cinco horas",
        "use": "somente recorrência temática; formato objetivo atípico",
    },
    {
        "id": "DPE-AC-2024",
        "state": "AC",
        "year": 2024,
        "file": "ED_1_2023_DPE_AC_DEFENSOR_ABERTURA_ATUALIZADO_RET_2.pdf",
        "structure_page": 16,
        "syllabus_page": 34,
        "objective_format": "100 questões A–E, cinco horas, desconto parcial por erro",
        "use": "precedente recente de cobrança e prova aplicada",
    },
]


DISCIPLINES = {
    "CON": (6, True, True),
    "ADM": (6, True, False),
    "PID": (6, False, False),
    "PEN": (6, True, True),
    "DPP": (6, True, True),
    "DEP": (5, True, False),
    "CIV": (6, True, True),
    "DPC": (6, True, True),
    "CDC": (6, True, True),
    "DHU": (6, True, False),
    "DCO": (4, True, False),
    "DCA": (6, True, True),
}


def build() -> dict[str, object]:
    program = json.loads(PROGRAM_PATH.read_text(encoding="utf-8"))["program"]
    program_ids = {item["id"] for item in program}
    unknown = (VERY_HIGH | MEDIUM) - program_ids
    if unknown:
        raise ValueError(f"IDs inexistentes no perfil: {sorted(unknown)}")
    overlap = VERY_HIGH & MEDIUM
    if overlap:
        raise ValueError(f"IDs em faixas conflitantes: {sorted(overlap)}")

    profiles = {}
    for item in program:
        topic_id = item["id"]
        code = item["discipline_code"]
        if topic_id in VERY_HIGH:
            tier = "MUITO_ALTA"
            basis = (
                "RECORRENCIA_INSTITUCIONAL"
                if code == "PID"
                else "NUCLEO_RECORRENTE_E_FASE_APLICADA"
            )
        elif topic_id in MEDIUM:
            tier = "MEDIA"
            basis = "COMPLEMENTO_OU_AMPLIACAO_ESPECIFICA"
        else:
            tier = "ALTA"
            basis = "RECORRENCIA_PROGRAMATICA"
        profiles[topic_id] = [tier, basis]

    discipline_profiles = {}
    names = {item["discipline_code"]: item["discipline"] for item in program}
    for code, (presence, discursive, oral) in DISCIPLINES.items():
        discipline_profiles[code] = {
            "name": names[code],
            "presence_in_notices": presence,
            "notices_analyzed": len(NOTICES),
            "objective": True,
            "discursive": discursive,
            "oral": oral,
        }

    payload = {
        "schema_version": 1,
        "profile_version": "2026.08-cebraspe-defensor-1",
        "status": "PRE_EDITAL_INDICATIVO",
        "generated_at": "2026-08-16",
        "resolution": {
            "file": "Resolução_344_NOVA_REDAÇÃO_Dispõe_sobre_a_realização_e_organização_do_III_Concurso_para_Defensor_Público_-_Publicada_em_15.03.2025_-_DOE_15.871_vKZDFdF_1.pdf",
            "structure_page": 9,
            "syllabus_page": 16,
            "objective": "100 questões A–E, quatro grupos iguais de 25 e cinco horas (arts. 40 a 42)",
            "discursive": "duas provas; em cada uma, duas questões e uma peça prática (arts. 45 e 46)",
            "oral": "CON, CDC, DCA, PEN, DPP, CIV e DPC (art. 56)",
            "weights": "objetiva 2, discursiva 4, oral 2 e títulos 1 (art. 60)",
        },
        "methodology": {
            "rule": "Mantém 25% para cada grupo objetivo e ordena apenas os tópicos dentro do grupo.",
            "signals": [
                "recorrência da disciplina e de seu núcleo temático nos seis editais Cebraspe",
                "presença na prova discursiva e na prova oral definidas pela Resolução nº 344/2025",
                "aptidão do tema para questão prática, peça e leitura de legislação seca",
            ],
            "precedence": "A prioridade pessoal, o desempenho e as revisões vencidas continuam prevalecendo sobre o foco pré-edital.",
            "caveat": "Perfil indicativo até a publicação do edital; nenhum tópico do Anexo I é excluído.",
        },
        "comparative_findings": [
            "Cinco dos seis editais usam questões de múltipla escolha A–E; o RS/2021 é a exceção certo/errado.",
            "Todos os seis editais reservam cinco horas à prova objetiva.",
            "RN/2015 e TO/2021 repetem a estrutura de quatro grupos iguais de 25 questões adotada pela Resolução nº 344/2025.",
            "As etapas escritas anteriores combinam questões discursivas e peça prática, reforçando núcleos materiais-processuais.",
        ],
        "notices": NOTICES,
        "disciplines": discipline_profiles,
        "tiers": {
            "MUITO_ALTA": "núcleo recorrente com incidência aplicada ou institucional direta",
            "ALTA": "conteúdo recorrente e relevante para o programa integral",
            "MEDIA": "complemento teórico, expansão específica ou jurisprudência tratada em bloco próprio",
        },
        "topics": profiles,
    }
    if len(profiles) != len(program):
        raise ValueError("O perfil não cobre todo o programa.")
    return payload


def main() -> None:
    payload = build()
    serialized = json.dumps(payload, ensure_ascii=False, indent=2) + "\n"
    for output in OUTPUTS:
        output.write_text(serialized, encoding="utf-8", newline="\n")
    counts: dict[str, int] = {}
    for tier, _basis in payload["topics"].values():
        counts[tier] = counts.get(tier, 0) + 1
    print(f"OK perfil pré-edital: {len(payload['topics'])} tópicos — {counts}")


if __name__ == "__main__":
    main()
