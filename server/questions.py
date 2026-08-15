from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from .database import Database, canonical_hash, utc_now


ELIGIBLE_EDITORIAL_STATUSES = ("VALIDADO", "PUBLICADO")
ELIGIBLE_RIGHTS_STATUSES = ("AUTORAL", "LICENCIADO", "USO_AUTORIZADO")
VALID_SESSION_KINDS = {"PRATICA", "SIMULADO_GRUPO", "SIMULADO_COMPLETO"}
VALID_CONFIDENCE = {"CERTEZA", "DUVIDA", "CHUTE"}
VALID_OPTIONS = {"A", "B", "C", "D", "E"}
VALID_AUTHORSHIP_TYPES = {"HUMANA", "IA", "OFICIAL_IMPORTADA"}
VALID_VALIDATION_STATUSES = {
    "NAO_APLICAVEL",
    "PENDENTE_FONTE",
    "VALIDACAO_PARCIAL",
    "VALIDADA_FONTE",
    "REJEITADA",
    "DESATUALIZADA",
}
VALID_REPORT_CATEGORIES = {
    "GABARITO",
    "ENUNCIADO",
    "ALTERNATIVA",
    "FONTE",
    "DESATUALIZACAO",
    "OUTRO",
}
ACTIVE_REPORT_STATUSES = ("ABERTO", "EM_ANALISE", "CONFIRMADO")


class QuestionService:
    def __init__(self, database: Database):
        self.database = database

    def seed_catalog(self, source: Path) -> None:
        payload = json.loads(source.read_text(encoding="utf-8"))
        now = utc_now()
        with self.database.connect() as connection:
            for item in payload.get("sources", []):
                connection.execute(
                    """
                    INSERT INTO question_sources(
                        id, institution, contest, year, document_title,
                        document_kind, source_url, evidence_status,
                        curation_note, enabled, imported_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        institution = excluded.institution,
                        contest = excluded.contest,
                        year = excluded.year,
                        document_title = excluded.document_title,
                        document_kind = excluded.document_kind,
                        source_url = excluded.source_url,
                        evidence_status = excluded.evidence_status,
                        curation_note = excluded.curation_note,
                        updated_at = excluded.updated_at
                    """,
                    (
                        item["id"],
                        item["institution"],
                        item["contest"],
                        item.get("year"),
                        item["document_title"],
                        item["document_kind"],
                        item["source_url"],
                        item.get("evidence_status", "CONFIRMADO"),
                        item.get("curation_note", ""),
                        now,
                        now,
                    ),
                )

            for item in payload.get("questions", []):
                options = item.get("options", [])
                option_keys = [str(option.get("key", "")).upper() for option in options]
                if option_keys != ["A", "B", "C", "D", "E"]:
                    raise ValueError(
                        f"{item.get('id', 'Questão sem ID')}: alternativas devem ser A–E em ordem."
                    )
                correct_option = item.get("correct_option")
                if correct_option is not None:
                    correct_option = str(correct_option).upper()
                    if correct_option not in VALID_OPTIONS:
                        raise ValueError(f"{item['id']}: gabarito inválido.")
                topic_ids = item.get("topic_ids", [])
                if not topic_ids:
                    raise ValueError(f"{item['id']}: ao menos um Tópico_ID é obrigatório.")
                authorship_type = str(item.get("authorship_type", "HUMANA")).upper()
                if authorship_type not in VALID_AUTHORSHIP_TYPES:
                    raise ValueError(f"{item['id']}: tipo de autoria inválido.")
                validation_status = str(
                    item.get(
                        "validation_status",
                        "PENDENTE_FONTE" if authorship_type == "IA" else "NAO_APLICAVEL",
                    )
                ).upper()
                if validation_status not in VALID_VALIDATION_STATUSES:
                    raise ValueError(f"{item['id']}: situação de validação inválida.")
                source_url = str(item.get("source_url", "")).strip()
                official_reference = str(item.get("official_reference", "")).strip()
                ai_model = str(item.get("ai_model", "")).strip()
                if authorship_type == "IA":
                    if not self._is_http_url(source_url):
                        raise ValueError(
                            f"{item['id']}: questão de IA exige URL de fonte oficial válida."
                        )
                    if not official_reference:
                        raise ValueError(
                            f"{item['id']}: questão de IA exige referência oficial precisa."
                        )
                    if not ai_model:
                        raise ValueError(
                            f"{item['id']}: questão de IA exige identificação do modelo gerador."
                        )
                canonical = {
                    "stem": item["stem"],
                    "options": options,
                    "correct_option": correct_option,
                    "explanation": item.get("explanation", ""),
                    "topic_ids": topic_ids,
                    "authorship_type": authorship_type,
                    "validation_status": validation_status,
                    "official_reference": official_reference,
                    "source_url": source_url,
                }
                digest = canonical_hash(canonical)
                connection.execute(
                    """
                    INSERT INTO questions(
                        id, source_id, discipline_code, exam_reference, exam_year,
                        booklet, question_number, question_type, stem,
                        correct_option, explanation, source_url, source_page,
                        authorship_type, ai_model, ai_prompt_version,
                        validation_status, official_reference, validated_at,
                        validation_note,
                        rights_status, editorial_status, canonical_hash,
                        imported_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'MULTIPLA_ESCOLHA_AE', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        source_id = excluded.source_id,
                        discipline_code = excluded.discipline_code,
                        exam_reference = excluded.exam_reference,
                        exam_year = excluded.exam_year,
                        booklet = excluded.booklet,
                        question_number = excluded.question_number,
                        stem = excluded.stem,
                        correct_option = excluded.correct_option,
                        explanation = excluded.explanation,
                        source_url = excluded.source_url,
                        source_page = excluded.source_page,
                        authorship_type = excluded.authorship_type,
                        ai_model = excluded.ai_model,
                        ai_prompt_version = excluded.ai_prompt_version,
                        validation_status = CASE
                            WHEN questions.canonical_hash <> excluded.canonical_hash
                                 AND excluded.authorship_type = 'IA'
                            THEN 'PENDENTE_FONTE'
                            ELSE excluded.validation_status
                        END,
                        official_reference = excluded.official_reference,
                        validated_at = CASE
                            WHEN questions.canonical_hash <> excluded.canonical_hash THEN NULL
                            ELSE excluded.validated_at
                        END,
                        validation_note = excluded.validation_note,
                        rights_status = excluded.rights_status,
                        editorial_status = CASE
                            WHEN questions.canonical_hash <> excluded.canonical_hash
                                 AND questions.editorial_status IN ('VALIDADO', 'PUBLICADO')
                            THEN 'EM_REVISAO'
                            ELSE excluded.editorial_status
                        END,
                        canonical_hash = excluded.canonical_hash,
                        updated_at = excluded.updated_at
                    """,
                    (
                        item["id"],
                        item.get("source_id"),
                        item["discipline_code"],
                        item.get("exam_reference", ""),
                        item.get("exam_year"),
                        item.get("booklet", ""),
                        str(item.get("question_number", "")),
                        item["stem"],
                        correct_option,
                        item.get("explanation", ""),
                        source_url,
                        item.get("source_page"),
                        authorship_type,
                        ai_model,
                        str(item.get("ai_prompt_version", "")),
                        validation_status,
                        official_reference,
                        item.get("validated_at"),
                        str(item.get("validation_note", "")),
                        item.get("rights_status", "PENDENTE"),
                        item.get("editorial_status", "EM_REVISAO"),
                        digest,
                        now,
                        now,
                    ),
                )
                connection.execute("DELETE FROM question_options WHERE question_id = ?", (item["id"],))
                connection.executemany(
                    """
                    INSERT INTO question_options(question_id, option_key, option_text, sort_order)
                    VALUES (?, ?, ?, ?)
                    """,
                    [
                        (item["id"], option["key"].upper(), option["text"], index)
                        for index, option in enumerate(options, start=1)
                    ],
                )
                connection.execute(
                    "DELETE FROM question_topic_links WHERE question_id = ?", (item["id"],)
                )
                connection.executemany(
                    """
                    INSERT INTO question_topic_links(question_id, topic_id, is_primary, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    [
                        (item["id"], topic_id, 1 if index == 0 else 0, now)
                        for index, topic_id in enumerate(topic_ids)
                    ],
                )
            connection.commit()

    @staticmethod
    def _is_http_url(value: str) -> bool:
        parsed = urlparse(value)
        return parsed.scheme in {"http", "https"} and bool(parsed.netloc)

    @staticmethod
    def _eligibility_sql(alias: str = "q") -> str:
        return f"""
            {alias}.question_type = 'MULTIPLA_ESCOLHA_AE'
            AND {alias}.editorial_status IN ('VALIDADO', 'PUBLICADO')
            AND {alias}.rights_status IN ('AUTORAL', 'LICENCIADO', 'USO_AUTORIZADO')
            AND ({alias}.authorship_type <> 'IA' OR {alias}.validation_status = 'VALIDADA_FONTE')
            AND {alias}.correct_option IN ('A', 'B', 'C', 'D', 'E')
            AND (SELECT COUNT(*) FROM question_options qo WHERE qo.question_id = {alias}.id) = 5
            AND NOT EXISTS (
                SELECT 1 FROM question_reports qr
                WHERE qr.question_id = {alias}.id
                  AND qr.status IN ('ABERTO', 'EM_ANALISE', 'CONFIRMADO')
            )
        """

    @staticmethod
    def _ai_review_eligibility_sql(alias: str = "q") -> str:
        return f"""
            {alias}.question_type = 'MULTIPLA_ESCOLHA_AE'
            AND {alias}.authorship_type = 'IA'
            AND {alias}.validation_status IN ('PENDENTE_FONTE', 'VALIDACAO_PARCIAL')
            AND {alias}.editorial_status IN ('IMPORTADO', 'EM_REVISAO')
            AND {alias}.rights_status = 'AUTORAL'
            AND {alias}.correct_option IN ('A', 'B', 'C', 'D', 'E')
            AND {alias}.source_url <> ''
            AND {alias}.official_reference <> ''
            AND (SELECT COUNT(*) FROM question_options qo WHERE qo.question_id = {alias}.id) = 5
            AND NOT EXISTS (
                SELECT 1 FROM question_reports qr
                WHERE qr.question_id = {alias}.id
                  AND qr.status IN ('ABERTO', 'EM_ANALISE', 'CONFIRMADO')
            )
        """

    def stats(self) -> dict[str, Any]:
        eligibility = self._eligibility_sql()
        ai_review_eligibility = self._ai_review_eligibility_sql()
        with self.database.connect() as connection:
            catalog = dict(
                connection.execute(
                    f"""
                    SELECT
                        COUNT(*) AS total,
                        SUM(CASE WHEN {eligibility} THEN 1 ELSE 0 END) AS eligible,
                        SUM(CASE WHEN {eligibility} AND NOT EXISTS (
                            SELECT 1
                            FROM quiz_session_questions sq
                            JOIN quiz_sessions qs ON qs.id = sq.session_id
                            WHERE sq.question_id = q.id AND qs.is_experimental = 0
                        ) THEN 1 ELSE 0 END) AS unseen,
                        SUM(CASE WHEN editorial_status IN ('EM_REVISAO', 'IMPORTADO') THEN 1 ELSE 0 END) AS pending,
                        SUM(CASE WHEN authorship_type = 'IA' THEN 1 ELSE 0 END) AS ai_generated,
                        SUM(CASE WHEN {ai_review_eligibility} THEN 1 ELSE 0 END) AS ai_pending
                    FROM questions q
                    """
                ).fetchone()
            )
            attempts = dict(
                connection.execute(
                    """
                    SELECT COUNT(*) AS answered,
                           SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct
                    FROM quiz_session_questions sq
                    JOIN quiz_sessions qs ON qs.id = sq.session_id
                    WHERE sq.answered_at IS NOT NULL AND qs.is_experimental = 0
                    """
                ).fetchone()
            )
            ai_reviewed = connection.execute(
                """
                SELECT COUNT(*) FROM quiz_session_questions sq
                JOIN quiz_sessions qs ON qs.id = sq.session_id
                WHERE sq.answered_at IS NOT NULL AND qs.is_experimental = 1
                """
            ).fetchone()[0]
            open_reports = connection.execute(
                """
                SELECT COUNT(*) FROM question_reports
                WHERE status IN ('ABERTO', 'EM_ANALISE', 'CONFIRMADO')
                """
            ).fetchone()[0]
            session_count = connection.execute(
                """
                SELECT COUNT(*) FROM quiz_sessions
                WHERE status = 'FINALIZADO' AND is_experimental = 0
                """
            ).fetchone()[0]
            source_count = connection.execute(
                "SELECT COUNT(*) FROM question_sources WHERE enabled = 1"
            ).fetchone()[0]
            groups = [
                dict(row)
                for row in connection.execute(
                    f"""
                    SELECT d.objective_group AS group_name,
                           SUM(CASE WHEN {eligibility} THEN 1 ELSE 0 END) AS eligible
                    FROM disciplines d
                    LEFT JOIN questions q ON q.discipline_code = d.code
                    GROUP BY d.objective_group
                    ORDER BY CASE d.objective_group
                        WHEN 'I' THEN 1 WHEN 'II' THEN 2 WHEN 'III' THEN 3 ELSE 4 END
                    """
                )
            ]
        answered = attempts["answered"] or 0
        correct = attempts["correct"] or 0
        return {
            "catalog_total": catalog["total"] or 0,
            "eligible": catalog["eligible"] or 0,
            "unseen": catalog["unseen"] or 0,
            "pending": catalog["pending"] or 0,
            "ai_generated": catalog["ai_generated"] or 0,
            "ai_pending": catalog["ai_pending"] or 0,
            "ai_reviewed": ai_reviewed,
            "open_reports": open_reports,
            "sources": source_count,
            "answered": answered,
            "correct": correct,
            "accuracy": correct / answered if answered else None,
            "completed_sessions": session_count,
            "groups": [
                {"group_name": row["group_name"], "eligible": row["eligible"] or 0}
                for row in groups
            ],
        }

    def list_sources(self) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT s.*, COUNT(q.id) AS question_count
                    FROM question_sources s
                    LEFT JOIN questions q ON q.source_id = s.id
                    GROUP BY s.id
                    ORDER BY s.year DESC, s.contest, s.document_title
                    """
                )
            ]

    def list_questions(
        self,
        discipline: str | None = None,
        editorial_status: str | None = None,
        study_ready_only: bool = False,
        query: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        filters: list[str] = []
        params: list[Any] = []
        if discipline:
            filters.append("q.discipline_code = ?")
            params.append(discipline)
        if editorial_status:
            filters.append("q.editorial_status = ?")
            params.append(editorial_status)
        if study_ready_only:
            filters.append(self._eligibility_sql())
        if query:
            filters.append("(q.stem LIKE ? OR q.id LIKE ? OR q.exam_reference LIKE ?)")
            token = f"%{query}%"
            params.extend([token, token, token])
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        limit = max(1, min(int(limit), 300))
        offset = max(0, int(offset))
        with self.database.connect() as connection:
            total = connection.execute(
                f"SELECT COUNT(*) FROM questions q {where}", params
            ).fetchone()[0]
            rows = connection.execute(
                f"""
                SELECT q.*, d.name AS discipline_name, d.objective_group,
                       s.contest AS source_contest, s.document_title AS source_document,
                       CASE WHEN {self._eligibility_sql()} THEN 1 ELSE 0 END AS eligible,
                       CASE WHEN {self._ai_review_eligibility_sql()} THEN 1 ELSE 0 END AS ai_review_eligible,
                       (SELECT COUNT(*) FROM question_reports qr
                        WHERE qr.question_id = q.id) AS report_count,
                       (SELECT COUNT(*) FROM question_reports qr
                        WHERE qr.question_id = q.id
                          AND qr.status IN ('ABERTO', 'EM_ANALISE', 'CONFIRMADO')) AS open_report_count
                FROM questions q
                JOIN disciplines d ON d.code = q.discipline_code
                LEFT JOIN question_sources s ON s.id = q.source_id
                {where}
                ORDER BY q.exam_year DESC, d.sort_order, q.question_number, q.id
                LIMIT ? OFFSET ?
                """,
                [*params, limit, offset],
            ).fetchall()
            items = self._hydrate_questions(connection, rows, reveal_answers=False)
        return {"total": total, "items": items, "limit": limit, "offset": offset}

    def _hydrate_questions(
        self, connection: Any, rows: list[Any], reveal_answers: bool
    ) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            item["options"] = [
                {"key": option["option_key"], "text": option["option_text"]}
                for option in connection.execute(
                    """
                    SELECT option_key, option_text FROM question_options
                    WHERE question_id = ? ORDER BY sort_order
                    """,
                    (item["id"],),
                )
            ]
            item["topic_ids"] = [
                topic["topic_id"]
                for topic in connection.execute(
                    """
                    SELECT topic_id FROM question_topic_links
                    WHERE question_id = ? ORDER BY is_primary DESC, topic_id
                    """,
                    (item["id"],),
                )
            ]
            if not reveal_answers:
                item.pop("correct_option", None)
                item.pop("explanation", None)
            result.append(item)
        return result

    def list_reports(self, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        filters: list[str] = []
        params: list[Any] = []
        if status:
            normalized = status.upper()
            valid_statuses = {"ABERTO", "EM_ANALISE", "CONFIRMADO", "DESCARTADO", "CORRIGIDO"}
            if normalized not in valid_statuses:
                raise ValueError("Situação de sinalização inválida.")
            filters.append("qr.status = ?")
            params.append(normalized)
        where = f"WHERE {' AND '.join(filters)}" if filters else ""
        limit = max(1, min(int(limit), 300))
        with self.database.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    f"""
                    SELECT qr.*, q.stem, q.authorship_type, q.validation_status,
                           d.name AS discipline_name
                    FROM question_reports qr
                    JOIN questions q ON q.id = qr.question_id
                    JOIN disciplines d ON d.code = q.discipline_code
                    {where}
                    ORDER BY qr.created_at DESC LIMIT ?
                    """,
                    [*params, limit],
                )
            ]

    def report_question(
        self, question_id: str, payload: dict[str, Any]
    ) -> dict[str, Any]:
        category = str(payload.get("category", "OUTRO")).upper()
        if category not in VALID_REPORT_CATEGORIES:
            raise ValueError("Tipo de possível erro inválido.")
        description = str(payload.get("description", "")).strip()
        if len(description) < 10:
            raise ValueError("Descreva o possível erro com pelo menos 10 caracteres.")
        if len(description) > 2_000:
            raise ValueError("A descrição do possível erro excede 2.000 caracteres.")
        evidence_url = str(payload.get("evidence_url", "")).strip()
        if evidence_url and not self._is_http_url(evidence_url):
            raise ValueError("O endereço de evidência deve ser uma URL HTTP ou HTTPS válida.")
        session_id = str(payload.get("session_id", "")).strip() or None
        report_id = str(uuid.uuid4())
        now = utc_now()
        with self.database.connect() as connection:
            question = connection.execute(
                "SELECT id FROM questions WHERE id = ?", (question_id,)
            ).fetchone()
            if not question:
                raise KeyError("Questão não localizada.")
            if session_id:
                session_question = connection.execute(
                    """
                    SELECT 1 FROM quiz_session_questions
                    WHERE session_id = ? AND question_id = ?
                    """,
                    (session_id, question_id),
                ).fetchone()
                if not session_question:
                    raise ValueError("A questão não pertence à sessão informada.")
            duplicate = connection.execute(
                """
                SELECT id FROM question_reports
                WHERE question_id = ? AND status IN ('ABERTO', 'EM_ANALISE', 'CONFIRMADO')
                """,
                (question_id,),
            ).fetchone()
            if duplicate:
                raise ValueError("Esta questão já possui uma sinalização ativa nesta instalação.")
            connection.execute(
                """
                INSERT INTO question_reports(
                    id, question_id, session_id, category, description,
                    evidence_url, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'ABERTO', ?, ?)
                """,
                (
                    report_id,
                    question_id,
                    session_id,
                    category,
                    description,
                    evidence_url,
                    now,
                    now,
                ),
            )
            connection.execute(
                """
                INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                VALUES ('QUESTION_REPORTED', 'QUESTION', ?, ?, ?)
                """,
                (
                    question_id,
                    json.dumps(
                        {"report_id": report_id, "category": category, "session_id": session_id},
                        ensure_ascii=False,
                    ),
                    now,
                ),
            )
            connection.commit()
            return dict(
                connection.execute(
                    "SELECT * FROM question_reports WHERE id = ?", (report_id,)
                ).fetchone()
            )

    def _eligible_rows(
        self,
        connection: Any,
        limit: int,
        discipline: str | None = None,
        group_name: str | None = None,
    ) -> list[Any]:
        filters = [self._eligibility_sql()]
        params: list[Any] = []
        if discipline:
            filters.append("q.discipline_code = ?")
            params.append(discipline)
        if group_name:
            filters.append("d.objective_group = ?")
            params.append(group_name)
        return connection.execute(
            f"""
            SELECT q.*, d.name AS discipline_name, d.objective_group
            FROM questions q JOIN disciplines d ON d.code = q.discipline_code
            WHERE {' AND '.join(filters)}
            ORDER BY
                (SELECT COUNT(*)
                 FROM quiz_session_questions sq
                 JOIN quiz_sessions qs ON qs.id = sq.session_id
                 WHERE sq.question_id = q.id AND qs.is_experimental = 0) ASC,
                COALESCE((SELECT MAX(qs.created_at)
                          FROM quiz_session_questions sq
                          JOIN quiz_sessions qs ON qs.id = sq.session_id
                          WHERE sq.question_id = q.id AND qs.is_experimental = 0), '') ASC,
                RANDOM()
            LIMIT ?
            """,
            [*params, limit],
        ).fetchall()

    def _ai_review_rows(
        self,
        connection: Any,
        limit: int,
        discipline: str | None = None,
        group_name: str | None = None,
    ) -> list[Any]:
        filters = [self._ai_review_eligibility_sql()]
        params: list[Any] = []
        if discipline:
            filters.append("q.discipline_code = ?")
            params.append(discipline)
        if group_name:
            filters.append("d.objective_group = ?")
            params.append(group_name)
        return connection.execute(
            f"""
            SELECT q.*, d.name AS discipline_name, d.objective_group
            FROM questions q JOIN disciplines d ON d.code = q.discipline_code
            WHERE {' AND '.join(filters)}
            ORDER BY RANDOM() LIMIT ?
            """,
            [*params, limit],
        ).fetchall()

    def create_session(self, payload: dict[str, Any]) -> dict[str, Any]:
        kind = str(payload.get("kind", "PRATICA")).upper()
        is_experimental = kind == "LABORATORIO_IA" or bool(payload.get("ai_experimental", False))
        if kind == "LABORATORIO_IA":
            kind = "PRATICA"
        if is_experimental and kind != "PRATICA":
            raise ValueError("O Laboratório IA somente admite prática experimental.")
        if kind not in VALID_SESSION_KINDS:
            raise ValueError("Tipo de sessão inválido.")
        discipline = payload.get("discipline") or None
        group_name = payload.get("group") or None
        if group_name and group_name not in {"I", "II", "III", "IV"}:
            raise ValueError("Grupo objetivo inválido.")
        explicit_ids = payload.get("question_ids")
        now = utc_now()
        with self.database.connect() as connection:
            selected: list[Any] = []
            if explicit_ids is not None:
                if kind != "PRATICA" or not isinstance(explicit_ids, list) or not explicit_ids:
                    raise ValueError("Seleção explícita de questões inválida.")
                clean_ids = [str(value) for value in explicit_ids]
                if len(clean_ids) > 100 or len(set(clean_ids)) != len(clean_ids):
                    raise ValueError("A seleção contém duplicidade ou excede 100 questões.")
                placeholders = ",".join("?" for _ in clean_ids)
                rows = connection.execute(
                    f"""
                    SELECT q.*, d.name AS discipline_name, d.objective_group
                    FROM questions q JOIN disciplines d ON d.code = q.discipline_code
                    WHERE q.id IN ({placeholders}) AND {
                        self._ai_review_eligibility_sql() if is_experimental else self._eligibility_sql()
                    }
                    """,
                    clean_ids,
                ).fetchall()
                by_id = {row["id"]: row for row in rows}
                selected = [by_id[value] for value in clean_ids if value in by_id]
                if len(selected) != len(clean_ids):
                    raise ValueError(
                        "Uma ou mais questões não estão liberadas para esta modalidade."
                    )
            elif kind == "SIMULADO_COMPLETO":
                for current_group in ("I", "II", "III", "IV"):
                    group_rows = self._eligible_rows(connection, 25, group_name=current_group)
                    if len(group_rows) < 25:
                        raise ValueError(
                            f"Grupo {current_group}: são necessárias 25 questões liberadas; "
                            f"há {len(group_rows)} disponível(is)."
                        )
                    selected.extend(group_rows)
            elif kind == "SIMULADO_GRUPO":
                if group_name not in {"I", "II", "III", "IV"}:
                    raise ValueError("Selecione o grupo objetivo do simulado.")
                selected = self._eligible_rows(connection, 25, group_name=group_name)
                if len(selected) < 25:
                    raise ValueError(
                        f"Grupo {group_name}: são necessárias 25 questões liberadas; "
                        f"há {len(selected)} disponível(is)."
                    )
            else:
                count = max(1, min(int(payload.get("question_count", 10)), 100))
                selection = self._ai_review_rows if is_experimental else self._eligible_rows
                selected = selection(connection, count, discipline=discipline, group_name=group_name)
                if len(selected) < count:
                    qualifier = "pendente(s) no laboratório técnico" if is_experimental else "liberada(s) para estudo"
                    raise ValueError(
                        f"A prática solicitou {count} questão(ões), mas somente "
                        f"{len(selected)} está(ão) {qualifier} para esse filtro."
                    )

            session_id = str(uuid.uuid4())
            if kind == "SIMULADO_COMPLETO":
                title = "Simulado objetivo completo — 100 questões"
            elif kind == "SIMULADO_GRUPO":
                title = f"Simulado do Grupo {group_name} — 25 questões"
            elif is_experimental:
                title = f"Laboratório IA — {len(selected)} questão(ões) em validação"
            else:
                title = f"Prática dirigida — {len(selected)} questão(ões)"
            connection.execute(
                """
                INSERT INTO quiz_sessions(
                    id, session_kind, title, objective_group, discipline_code,
                    status, question_count, is_experimental, created_at, started_at
                ) VALUES (?, ?, ?, ?, ?, 'EM_ANDAMENTO', ?, ?, ?, ?)
                """,
                (
                    session_id,
                    kind,
                    title,
                    group_name,
                    discipline,
                    len(selected),
                    int(is_experimental),
                    now,
                    now,
                ),
            )
            for position, question in enumerate(selected, start=1):
                options = [
                    {"key": row["option_key"], "text": row["option_text"]}
                    for row in connection.execute(
                        """
                        SELECT option_key, option_text FROM question_options
                        WHERE question_id = ? ORDER BY sort_order
                        """,
                        (question["id"],),
                    )
                ]
                topic_ids = [
                    row["topic_id"]
                    for row in connection.execute(
                        """
                        SELECT topic_id FROM question_topic_links
                        WHERE question_id = ? AND is_primary = 1 ORDER BY topic_id
                        """,
                        (question["id"],),
                    )
                ]
                connection.execute(
                    """
                    INSERT INTO quiz_session_questions(
                        session_id, question_id, position, stem_snapshot,
                        options_json, correct_option_snapshot,
                        explanation_snapshot, topic_ids_json,
                        authorship_type_snapshot, validation_status_snapshot,
                        source_url_snapshot, official_reference_snapshot
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session_id,
                        question["id"],
                        position,
                        question["stem"],
                        json.dumps(options, ensure_ascii=False),
                        question["correct_option"],
                        question["explanation"],
                        json.dumps(topic_ids, ensure_ascii=False),
                        question["authorship_type"],
                        question["validation_status"],
                        question["source_url"],
                        question["official_reference"],
                    ),
                )
            connection.execute(
                """
                INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                VALUES ('QUIZ_STARTED', 'QUIZ_SESSION', ?, ?, ?)
                """,
                (
                    session_id,
                    json.dumps(
                        {"kind": kind, "count": len(selected), "experimental_ai": is_experimental}
                    ),
                    now,
                ),
            )
            connection.commit()
        return self.get_session(session_id)

    def get_session(self, session_id: str) -> dict[str, Any]:
        with self.database.connect() as connection:
            session_row = connection.execute(
                "SELECT * FROM quiz_sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if not session_row:
                raise KeyError("Sessão não localizada.")
            session = dict(session_row)
            items: list[dict[str, Any]] = []
            for row in connection.execute(
                """
                SELECT sq.*, q.discipline_code, d.name AS discipline_name,
                       d.objective_group,
                       (SELECT COUNT(*) FROM question_reports qr
                        WHERE qr.question_id = sq.question_id
                          AND qr.status IN ('ABERTO', 'EM_ANALISE', 'CONFIRMADO')) AS open_report_count
                FROM quiz_session_questions sq
                JOIN questions q ON q.id = sq.question_id
                JOIN disciplines d ON d.code = q.discipline_code
                WHERE sq.session_id = ? ORDER BY sq.position
                """,
                (session_id,),
            ):
                item = dict(row)
                item["options"] = json.loads(item.pop("options_json"))
                item["topic_ids"] = json.loads(item.pop("topic_ids_json"))
                reveal = item["answered_at"] is not None or session["status"] != "EM_ANDAMENTO"
                if reveal:
                    item["correct_option"] = item.pop("correct_option_snapshot")
                    item["explanation"] = item.pop("explanation_snapshot")
                else:
                    item.pop("correct_option_snapshot")
                    item.pop("explanation_snapshot")
                items.append(item)
        session["items"] = items
        session["accuracy"] = (
            session["correct_count"] / session["answered_count"]
            if session["answered_count"]
            else None
        )
        session["score_10"] = (
            session["correct_count"] / session["question_count"] * 10
            if session["status"] == "FINALIZADO" and not session["is_experimental"]
            else None
        )
        return session

    def answer_session(self, session_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        question_id = str(payload.get("question_id", ""))
        selected_option = str(payload.get("selected_option", "")).upper()
        confidence = str(payload.get("confidence", "DUVIDA")).upper()
        if selected_option not in VALID_OPTIONS:
            raise ValueError("Selecione uma alternativa entre A e E.")
        if confidence not in VALID_CONFIDENCE:
            raise ValueError("Grau de confiança inválido.")
        elapsed_seconds = max(0, min(int(payload.get("elapsed_seconds", 0)), 18_000))
        now = utc_now()
        with self.database.connect() as connection:
            session = connection.execute(
                "SELECT * FROM quiz_sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if not session:
                raise KeyError("Sessão não localizada.")
            if session["status"] != "EM_ANDAMENTO":
                raise ValueError("Esta sessão já foi encerrada.")
            item = connection.execute(
                """
                SELECT * FROM quiz_session_questions
                WHERE session_id = ? AND question_id = ?
                """,
                (session_id, question_id),
            ).fetchone()
            if not item:
                raise KeyError("Questão não pertence à sessão.")
            if item["answered_at"] is not None:
                raise ValueError("Esta questão já foi respondida.")
            options = {option["key"] for option in json.loads(item["options_json"])}
            if selected_option not in options:
                raise ValueError("Alternativa não pertence à questão.")
            is_correct = int(selected_option == item["correct_option_snapshot"])
            connection.execute(
                """
                UPDATE quiz_session_questions
                SET selected_option = ?, confidence = ?, elapsed_seconds = ?,
                    is_correct = ?, answered_at = ?
                WHERE session_id = ? AND question_id = ?
                """,
                (
                    selected_option,
                    confidence,
                    elapsed_seconds,
                    is_correct,
                    now,
                    session_id,
                    question_id,
                ),
            )
            counts = connection.execute(
                """
                SELECT COUNT(answered_at) AS answered,
                       SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END) AS correct
                FROM quiz_session_questions WHERE session_id = ?
                """,
                (session_id,),
            ).fetchone()
            finished = counts["answered"] == session["question_count"]
            connection.execute(
                """
                UPDATE quiz_sessions
                SET answered_count = ?, correct_count = ?,
                    status = CASE WHEN ? THEN 'FINALIZADO' ELSE status END,
                    finished_at = CASE WHEN ? THEN ? ELSE finished_at END
                WHERE id = ?
                """,
                (
                    counts["answered"],
                    counts["correct"] or 0,
                    finished,
                    finished,
                    now,
                    session_id,
                ),
            )
            if not session["is_experimental"]:
                for topic_id in json.loads(item["topic_ids_json"]):
                    connection.execute(
                        """
                        UPDATE topic_progress
                        SET questions_done = questions_done + 1,
                            correct_answers = correct_answers + ?,
                            updated_at = ?
                        WHERE topic_id = ?
                        """,
                        (is_correct, now, topic_id),
                    )
            connection.execute(
                """
                INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                VALUES ('QUESTION_ANSWERED', 'QUESTION', ?, ?, ?)
                """,
                (
                    question_id,
                    json.dumps(
                        {
                            "session_id": session_id,
                            "selected_option": selected_option,
                            "correct": bool(is_correct),
                            "confidence": confidence,
                            "experimental_ai": bool(session["is_experimental"]),
                        },
                        ensure_ascii=False,
                    ),
                    now,
                ),
            )
            connection.commit()
        return self.get_session(session_id)

    def finish_session(self, session_id: str) -> dict[str, Any]:
        now = utc_now()
        with self.database.connect() as connection:
            session = connection.execute(
                "SELECT status FROM quiz_sessions WHERE id = ?", (session_id,)
            ).fetchone()
            if not session:
                raise KeyError("Sessão não localizada.")
            if session["status"] == "EM_ANDAMENTO":
                connection.execute(
                    """
                    UPDATE quiz_sessions SET status = 'FINALIZADO', finished_at = ?
                    WHERE id = ?
                    """,
                    (now, session_id),
                )
                connection.execute(
                    """
                    INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                    VALUES ('QUIZ_FINISHED', 'QUIZ_SESSION', ?, '{}', ?)
                    """,
                    (session_id, now),
                )
                connection.commit()
        return self.get_session(session_id)

    def list_sessions(self, limit: int = 30) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 100))
        with self.database.connect() as connection:
            rows = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT * FROM quiz_sessions
                    ORDER BY CASE status WHEN 'EM_ANDAMENTO' THEN 0 ELSE 1 END,
                             created_at DESC LIMIT ?
                    """,
                    (limit,),
                )
            ]
        for item in rows:
            item["accuracy"] = (
                item["correct_count"] / item["answered_count"]
                if item["answered_count"]
                else None
            )
            item["score_10"] = (
                item["correct_count"] / item["question_count"] * 10
                if item["status"] == "FINALIZADO" and not item["is_experimental"]
                else None
            )
        return rows
