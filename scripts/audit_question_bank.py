from __future__ import annotations

import argparse
import hashlib
import json
import re
import unicodedata
from collections import Counter, defaultdict
from copy import deepcopy
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import urlparse


LETTERS = "ABCDE"
QUESTION_FILES = tuple(f"pwa/src/questoes_g{number}.json" for number in range(1, 5))
REQUIRED_FIELDS = ("id", "g", "d", "t", "n", "e", "o", "gab", "exp", "f", "u")
GROUP_BY_FILE = {f"pwa/src/questoes_g{number}.json": roman for number, roman in enumerate(("I", "II", "III", "IV"), 1)}


def normalize_text(value: str) -> str:
    """Return a stable representation for duplicate and length checks."""
    value = unicodedata.normalize("NFKC", str(value)).casefold()
    value = re.sub(r"[^\w\s]", " ", value, flags=re.UNICODE)
    return " ".join(value.split())


def visible_length(value: str) -> int:
    return len(" ".join(str(value).split()))


def _is_http_url(value: str) -> bool:
    parsed = urlparse(str(value))
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def load_program(root: Path) -> dict[str, dict[str, Any]]:
    payload = json.loads((root / "pwa/src/program.json").read_text(encoding="utf-8"))
    rows = payload.get("program", payload)
    return {str(item["id"]): item for item in rows}


def load_bank(root: Path) -> tuple[list[dict[str, Any]], dict[str, list[dict[str, Any]]]]:
    by_file: dict[str, list[dict[str, Any]]] = {}
    questions: list[dict[str, Any]] = []
    for relative_path in QUESTION_FILES:
        payload = json.loads((root / relative_path).read_text(encoding="utf-8"))
        if not isinstance(payload, list):
            raise ValueError(f"{relative_path}: a raiz deve ser uma lista")
        for item in payload:
            item["_audit_file"] = relative_path
        by_file[relative_path] = payload
        questions.extend(payload)
    return questions, by_file


def _without_internal_fields(question: dict[str, Any]) -> dict[str, Any]:
    return {key: value for key, value in question.items() if not key.startswith("_audit_")}


def correct_text(question: dict[str, Any]) -> str:
    options = question.get("o", [])
    answer = str(question.get("gab", ""))
    if answer not in LETTERS or len(options) != 5:
        return ""
    return str(options[LETTERS.index(answer)])


def _answer_distribution(questions: Iterable[dict[str, Any]]) -> dict[str, int]:
    counter = Counter(str(question.get("gab", "")) for question in questions)
    return {letter: counter.get(letter, 0) for letter in LETTERS}


def audit_bank(
    questions: list[dict[str, Any]],
    program: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    issues: list[dict[str, str]] = []
    ids: defaultdict[str, list[str]] = defaultdict(list)
    stems: defaultdict[str, list[str]] = defaultdict(list)
    content: defaultdict[str, list[str]] = defaultdict(list)
    by_group: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    by_discipline: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    correct_among_longest = 0
    correct_unique_longest = 0
    unique_longest_total = 0
    answer_lengths: list[int] = []
    distractor_lengths: list[int] = []

    for question in questions:
        question_id = str(question.get("id", ""))
        source_file = str(question.get("_audit_file", ""))
        ids[question_id].append(source_file)
        group = str(question.get("g", ""))
        discipline = str(question.get("d", ""))
        by_group[group].append(question)
        by_discipline[discipline].append(question)

        for field in REQUIRED_FIELDS:
            if field not in question:
                issues.append({"severity": "error", "id": question_id, "code": "missing_field", "detail": field})
        for field in ("id", "g", "d", "t", "n", "e", "exp", "f", "u"):
            if not str(question.get(field, "")).strip():
                issues.append({"severity": "error", "id": question_id, "code": "empty_field", "detail": field})

        expected_group = GROUP_BY_FILE.get(source_file)
        if expected_group and group != expected_group:
            issues.append({"severity": "error", "id": question_id, "code": "group_file_mismatch", "detail": f"{group} != {expected_group}"})

        topic_id = str(question.get("t", ""))
        topic = program.get(topic_id)
        if topic is None:
            issues.append({"severity": "error", "id": question_id, "code": "unknown_topic", "detail": topic_id})
        else:
            if str(topic.get("objective_group", "")) != group:
                issues.append({"severity": "error", "id": question_id, "code": "topic_group_mismatch", "detail": topic_id})
            if str(topic.get("discipline_code", "")) != discipline:
                issues.append({"severity": "error", "id": question_id, "code": "topic_discipline_mismatch", "detail": topic_id})

        options = question.get("o")
        if not isinstance(options, list) or len(options) != 5:
            issues.append({"severity": "error", "id": question_id, "code": "option_count", "detail": str(len(options) if isinstance(options, list) else "not_list")})
            continue
        if any(not isinstance(option, str) or not option.strip() for option in options):
            issues.append({"severity": "error", "id": question_id, "code": "empty_option", "detail": "alternativa vazia ou não textual"})
        normalized_options = [normalize_text(option) for option in options]
        if len(set(normalized_options)) != len(normalized_options):
            issues.append({"severity": "error", "id": question_id, "code": "duplicate_option", "detail": "alternativas repetidas"})
        stem_key = normalize_text(str(question.get("e", "")))
        stems[stem_key].append(question_id)
        canonical_content = json.dumps(
            {"stem": stem_key, "options": sorted(normalized_options)},
            ensure_ascii=False,
            sort_keys=True,
        )
        content[canonical_content].append(question_id)

        answer = str(question.get("gab", ""))
        if answer not in LETTERS:
            issues.append({"severity": "error", "id": question_id, "code": "invalid_answer", "detail": answer})
            continue
        if not _is_http_url(str(question.get("u", ""))):
            issues.append({"severity": "error", "id": question_id, "code": "invalid_url", "detail": str(question.get("u", ""))})

        lengths = [visible_length(option) for option in options]
        answer_index = LETTERS.index(answer)
        max_length = max(lengths)
        longest_indexes = [index for index, length in enumerate(lengths) if length == max_length]
        if answer_index in longest_indexes:
            correct_among_longest += 1
        if len(longest_indexes) == 1:
            unique_longest_total += 1
            if answer_index == longest_indexes[0]:
                correct_unique_longest += 1
        answer_lengths.append(lengths[answer_index])
        distractor_lengths.extend(length for index, length in enumerate(lengths) if index != answer_index)

    for question_id, files in ids.items():
        if not question_id:
            continue
        if len(files) > 1:
            issues.append({"severity": "error", "id": question_id, "code": "duplicate_id", "detail": ", ".join(files)})

    duplicate_stems = [question_ids for key, question_ids in stems.items() if key and len(question_ids) > 1]
    duplicate_content = [question_ids for question_ids in content.values() if len(question_ids) > 1]
    for question_ids in duplicate_stems:
        issues.append({"severity": "warning", "id": question_ids[0], "code": "duplicate_stem", "detail": ", ".join(question_ids)})

    total = len(questions)
    distribution = _answer_distribution(questions)
    most_common = max(distribution.values(), default=0)
    return {
        "total": total,
        "answer_distribution": distribution,
        "answer_distribution_percent": {
            letter: round(count * 100 / total, 2) if total else 0.0
            for letter, count in distribution.items()
        },
        "most_common_answer_success_percent": round(most_common * 100 / total, 2) if total else 0.0,
        "longest_answer": {
            "correct_among_longest": correct_among_longest,
            "correct_among_longest_percent": round(correct_among_longest * 100 / total, 2) if total else 0.0,
            "unique_longest_questions": unique_longest_total,
            "correct_unique_longest": correct_unique_longest,
            "correct_unique_longest_percent_all": round(correct_unique_longest * 100 / total, 2) if total else 0.0,
            "correct_unique_longest_percent_eligible": round(correct_unique_longest * 100 / unique_longest_total, 2) if unique_longest_total else 0.0,
            "mean_correct_length": round(sum(answer_lengths) / len(answer_lengths), 2) if answer_lengths else 0.0,
            "mean_distractor_length": round(sum(distractor_lengths) / len(distractor_lengths), 2) if distractor_lengths else 0.0,
        },
        "by_group": {
            key: {"total": len(rows), "answers": _answer_distribution(rows)}
            for key, rows in sorted(by_group.items())
        },
        "by_discipline": {
            key: {
                "total": len(rows),
                "group": str(rows[0].get("g", "")) if rows else "",
                "answers": _answer_distribution(rows),
            }
            for key, rows in sorted(by_discipline.items())
        },
        "duplicates": {
            "duplicate_ids": sum(1 for files in ids.values() if len(files) > 1),
            "duplicate_stem_sets": len(duplicate_stems),
            "duplicate_content_sets": len(duplicate_content),
            "stem_sets": duplicate_stems,
            "content_sets": duplicate_content,
        },
        "quality": {
            "errors": sum(issue["severity"] == "error" for issue in issues),
            "warnings": sum(issue["severity"] == "warning" for issue in issues),
            "issues": issues,
        },
    }


def _stable_question_order(question: dict[str, Any]) -> tuple[str, str]:
    question_id = str(question.get("id", ""))
    return hashlib.sha256(f"question-bank-v1:{question_id}".encode("utf-8")).hexdigest(), question_id


def rebalance_bank(questions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Balance answer positions while preserving every question's correct text."""
    result = deepcopy(questions)
    by_group: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for question in result:
        by_group[str(question.get("g", ""))].append(question)

    for group in sorted(by_group):
        ordered: list[dict[str, Any]] = []
        disciplines = sorted({str(question.get("d", "")) for question in by_group[group]})
        for discipline in disciplines:
            discipline_questions = [
                question for question in by_group[group] if str(question.get("d", "")) == discipline
            ]
            ordered.extend(sorted(discipline_questions, key=_stable_question_order))

        offset = int(hashlib.sha256(f"answer-offset-v1:{group}".encode("utf-8")).hexdigest(), 16) % len(LETTERS)
        for index, question in enumerate(ordered):
            options = question.get("o", [])
            current_answer = str(question.get("gab", ""))
            if not isinstance(options, list) or len(options) != 5 or current_answer not in LETTERS:
                continue
            target_answer = LETTERS[(index + offset) % len(LETTERS)]
            current_index = LETTERS.index(current_answer)
            answer_text = options[current_index]
            distractors = [option for option_index, option in enumerate(options) if option_index != current_index]
            target_index = LETTERS.index(target_answer)
            question["o"] = distractors[:target_index] + [answer_text] + distractors[target_index:]
            question["gab"] = target_answer
    return result


def assert_semantic_invariants(before: list[dict[str, Any]], after: list[dict[str, Any]]) -> None:
    if [question.get("id") for question in before] != [question.get("id") for question in after]:
        raise ValueError("a ordem ou o conjunto de IDs foi alterado")
    for original, changed in zip(before, after):
        question_id = str(original.get("id", ""))
        if correct_text(original) != correct_text(changed):
            raise ValueError(f"{question_id}: o texto da alternativa correta foi alterado")
        if Counter(original.get("o", [])) != Counter(changed.get("o", [])):
            raise ValueError(f"{question_id}: o conteúdo das alternativas foi alterado")
        original_fixed = _without_internal_fields(original)
        changed_fixed = _without_internal_fields(changed)
        original_fixed.pop("o", None)
        original_fixed.pop("gab", None)
        changed_fixed.pop("o", None)
        changed_fixed.pop("gab", None)
        if original_fixed != changed_fixed:
            raise ValueError(f"{question_id}: campos além da ordem e do gabarito foram alterados")


def _write_question_file(path: Path, questions: list[dict[str, Any]]) -> None:
    lines = ["["]
    for index, question in enumerate(questions):
        suffix = "," if index < len(questions) - 1 else ""
        serialized = json.dumps(_without_internal_fields(question), ensure_ascii=False, separators=(",", ":"))
        lines.append(f"{serialized}{suffix}")
    lines.append("]")
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def write_rebalanced_bank(
    root: Path,
    before: list[dict[str, Any]],
    after: list[dict[str, Any]],
) -> None:
    assert_semantic_invariants(before, after)
    by_file: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for question in after:
        by_file[str(question.get("_audit_file", ""))].append(question)
    for relative_path in QUESTION_FILES:
        _write_question_file(root / relative_path, by_file[relative_path])


def _comparison_distribution_row(
    label: str,
    before: dict[str, Any],
    after: dict[str, Any],
) -> str:
    return (
        f"| {label} | {before['total']} | "
        + " | ".join(f"{before['answers'][letter]} → {after['answers'][letter]}" for letter in LETTERS)
        + " |"
    )


def render_report(before: dict[str, Any], after: dict[str, Any]) -> str:
    lines = [
        "# Auditoria do banco de questões objetivas",
        "",
        "## Escopo e critérios",
        "",
        "A auditoria cobre as 260 questões autorais de `pwa/src/questoes_g1.json` a `questoes_g4.json`. Foram verificados: estrutura mínima, cinco alternativas não vazias e distintas, gabarito A–E, vínculos com grupo/disciplina/tópico, URL de fonte, IDs e enunciados duplicados, distribuição do gabarito e a pista de comprimento.",
        "",
        "A alternativa mais longa é medida pelo número de caracteres visíveis após normalização de espaços. Em empates, a métrica `entre as mais longas` considera todas as alternativas de comprimento máximo; a métrica `única mais longa` exclui empates.",
        "",
        "O rebalanceamento é determinístico por ID e grupo. Ele somente reposiciona as cinco alternativas e atualiza a letra do gabarito. Enunciado, explicação, fonte, vínculo temático, conjunto de alternativas e texto da resposta correta permanecem idênticos.",
        "",
        "## Resultado executivo",
        "",
        f"- Questões auditadas: **{before['total']}**.",
        f"- Acerto ao escolher sempre a letra mais frequente: **{before['most_common_answer_success_percent']:.2f}% antes** e **{after['most_common_answer_success_percent']:.2f}% depois**.",
        f"- Gabarito entre as alternativas mais longas: **{before['longest_answer']['correct_among_longest_percent']:.2f}% antes** e **{after['longest_answer']['correct_among_longest_percent']:.2f}% depois**.",
        f"- Gabarito como única alternativa mais longa: **{before['longest_answer']['correct_unique_longest_percent_all']:.2f}% do banco**.",
        f"- Problemas estruturais: **{after['quality']['errors']} erro(s)** e **{after['quality']['warnings']} aviso(s)** após o rebalanceamento.",
        f"- Duplicidades: **{after['duplicates']['duplicate_ids']} ID(s)**, **{after['duplicates']['duplicate_stem_sets']} conjunto(s) de enunciados** e **{after['duplicates']['duplicate_content_sets']} conjunto(s) de conteúdo integral**.",
        "",
        "A pista de comprimento não muda com a reordenação: reduzir esse indicador requer reescrever ou ampliar distratores após revisão jurídica. Alterá-los automaticamente seria incompatível com a exigência de preservar o conteúdo e a correção semântica.",
        "",
        "## Distribuição geral do gabarito",
        "",
        "| Momento | A | B | C | D | E |",
        "|---|---:|---:|---:|---:|---:|",
        "| Antes | " + " | ".join(str(before["answer_distribution"][letter]) for letter in LETTERS) + " |",
        "| Depois | " + " | ".join(str(after["answer_distribution"][letter]) for letter in LETTERS) + " |",
        "",
        "## Distribuição antes e depois, por grupo",
        "",
        "| Grupo | Total | A | B | C | D | E |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ]
    lines.extend(
        _comparison_distribution_row(group, before["by_group"][group], payload)
        for group, payload in after["by_group"].items()
    )
    lines.extend([
        "",
        "## Distribuição antes e depois, por disciplina",
        "",
        "| Disciplina | Total | A | B | C | D | E |",
        "|---|---:|---:|---:|---:|---:|---:|",
    ])
    lines.extend(
        _comparison_distribution_row(discipline, before["by_discipline"][discipline], payload)
        for discipline, payload in after["by_discipline"].items()
    )
    duplicate_stem_sets = after["duplicates"]["stem_sets"]
    duplicate_detail = (
        ", ".join(" / ".join(question_ids) for question_ids in duplicate_stem_sets)
        if duplicate_stem_sets
        else "nenhum"
    )
    lines.extend([
        "",
        "## Qualidade estrutural",
        "",
        f"- Comprimento médio da alternativa correta: {after['longest_answer']['mean_correct_length']:.2f} caracteres.",
        f"- Comprimento médio dos distratores: {after['longest_answer']['mean_distractor_length']:.2f} caracteres.",
        f"- Questões com uma única alternativa mais longa: {after['longest_answer']['unique_longest_questions']}.",
        f"- Acerto pela única mais longa, quando aplicável: {after['longest_answer']['correct_unique_longest_percent_eligible']:.2f}%.",
        f"- Enunciados idênticos candidatos a revisão: {duplicate_detail}.",
        "- O par de enunciados repetidos identificado pertence a tópicos e conteúdos distintos; foi sinalizado para revisão editorial, mas não alterado porque o escopo exige preservar o enunciado.",
        "",
        "## Critérios de aceite contínuo",
        "",
        "- Cada grupo deve ter diferença zero entre as contagens de A–E quando seu total for múltiplo de cinco.",
        "- Em cada disciplina, a diferença entre a letra mais e menos frequente deve ser no máximo uma questão.",
        "- Nenhum erro estrutural, ID duplicado ou conteúdo integral duplicado; enunciados repetidos devem ser explicitamente revisados ou justificados.",
        "- O algoritmo deve ser idempotente e preservar o texto correto e o multiconjunto de alternativas.",
        "- A pista de comprimento deve ser tratada em uma etapa editorial com validação jurídica; a auditoria deve continuar medindo-a.",
        "",
    ])
    return "\n".join(lines)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Audita e rebalanceia o banco objetivo da PWA.")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--fix", action="store_true", help="Reordena alternativas e grava os quatro arquivos.")
    parser.add_argument("--json-out", type=Path, help="Grava as métricas completas em JSON.")
    parser.add_argument("--report-out", type=Path, help="Grava o relatório comparativo em Markdown.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root = args.root.resolve()
    program = load_program(root)
    before_questions, _ = load_bank(root)
    before = audit_bank(before_questions, program)
    after_questions = rebalance_bank(before_questions)
    assert_semantic_invariants(before_questions, after_questions)
    after = audit_bank(after_questions, program)

    if args.fix:
        write_rebalanced_bank(root, before_questions, after_questions)

    result = {"before": before, "after": after, "fix_applied": bool(args.fix)}
    if args.json_out:
        output_path = args.json_out if args.json_out.is_absolute() else root / args.json_out
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    if args.report_out:
        output_path = args.report_out if args.report_out.is_absolute() else root / args.report_out
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(render_report(before, after), encoding="utf-8")

    print(json.dumps({
        "total": before["total"],
        "before": before["answer_distribution"],
        "after": after["answer_distribution"],
        "structural_errors": after["quality"]["errors"],
        "duplicate_stem_sets": after["duplicates"]["duplicate_stem_sets"],
        "correct_among_longest_percent": after["longest_answer"]["correct_among_longest_percent"],
        "fix_applied": bool(args.fix),
    }, ensure_ascii=False))
    return 1 if after["quality"]["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
