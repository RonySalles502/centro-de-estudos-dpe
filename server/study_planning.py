from __future__ import annotations

import json
import math
import re
import urllib.parse
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .database import Database, canonical_hash, utc_now
from .questions import QuestionService


DIAGNOSTIC_ID = "local-diagnostic"
WEEKDAYS = ("SEG", "TER", "QUA", "QUI", "SEX", "SAB", "DOM")
CONTENT_TYPES = (
    "LEITURA",
    "QUESTOES",
    "JURISPRUDENCIA",
    "REVISAO",
    "DISCURSIVA",
    "SIMULADO",
)
GROUPS = ("I", "II", "III", "IV")
RATINGS = {"REPETIR", "DIFICIL", "BOM", "FACIL"}

DEFAULT_WEEKDAY_MINUTES = {
    "SEG": 120,
    "TER": 120,
    "QUA": 120,
    "QUI": 120,
    "SEX": 120,
    "SAB": 180,
    "DOM": 60,
}
DEFAULT_CONTENT_WEIGHTS = {
    "LEITURA": 25,
    "QUESTOES": 25,
    "JURISPRUDENCIA": 15,
    "REVISAO": 15,
    "DISCURSIVA": 10,
    "SIMULADO": 10,
}
DEFAULT_GROUP_WEIGHTS = {group: 25 for group in GROUPS}


def _word_count(value: str) -> int:
    return len(re.findall(r"\b[\wÀ-ÿ]+(?:[-'][\wÀ-ÿ]+)*\b", value, flags=re.UNICODE))


def _local_today() -> date:
    # A aplicação é destinada ao uso local no Brasil; a data do sistema é a
    # referência operacional e evita dependência de serviço externo de horário.
    return date.today()


class StudyPlanningService:
    def __init__(self, database: Database):
        self.database = database
        self._legislation_catalog = self._load_legislation_catalog()
        self._pre_edit_profile = self._load_pre_edit_profile()
        self._no_specific_articles = set(
            self._legislation_catalog.get("no_specific_articles", [])
        )
        self.initialize()

    def _load_legislation_catalog(self) -> dict[str, Any]:
        path = self.database.project_root / "data" / "legislation_reading_map.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(payload.get("sources"), dict) or not isinstance(payload.get("topics"), dict):
            raise ValueError("O mapa de leitura legislativa está inválido.")
        for topic_id, assignments in payload["topics"].items():
            if not isinstance(assignments, list) or not assignments:
                raise ValueError(f"Mapeamento legislativo vazio: {topic_id}.")
            for assignment in assignments:
                if not isinstance(assignment, list) or len(assignment) != 2:
                    raise ValueError(f"Mapeamento legislativo inválido: {topic_id}.")
                if assignment[0] not in payload["sources"]:
                    raise ValueError(f"Fonte legislativa não cadastrada: {assignment[0]}.")
        return payload

    def _load_pre_edit_profile(self) -> dict[str, Any]:
        path = self.database.project_root / "data" / "pre_edit_priority.json"
        payload = json.loads(path.read_text(encoding="utf-8"))
        topics = payload.get("topics")
        if not isinstance(topics, dict) or not topics:
            raise ValueError("O perfil pré-edital está inválido.")
        allowed = {"MUITO_ALTA", "ALTA", "MEDIA"}
        for topic_id, profile in topics.items():
            if not isinstance(profile, list) or len(profile) != 2 or profile[0] not in allowed:
                raise ValueError(f"Prioridade pré-edital inválida: {topic_id}.")
        return payload

    def initialize(self) -> None:
        now = utc_now()
        with self.database.connect() as connection:
            connection.execute(
                """
                INSERT OR IGNORE INTO study_diagnostic(
                    id, weekday_minutes_json, content_weights_json,
                    group_weights_json, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (
                    DIAGNOSTIC_ID,
                    json.dumps(DEFAULT_WEEKDAY_MINUTES, ensure_ascii=False),
                    json.dumps(DEFAULT_CONTENT_WEIGHTS, ensure_ascii=False),
                    json.dumps(DEFAULT_GROUP_WEIGHTS, ensure_ascii=False),
                    now,
                ),
            )
            self._seed_legislation_readings(connection, now)
            self._backfill_plan_legislation(connection, now)
            self._seed_discursive_prompts(connection, now)
            connection.commit()

    def _seed_legislation_readings(self, connection: Any, now: str) -> None:
        catalog = self._legislation_catalog
        sources = catalog["sources"]
        expected_ids: list[str] = []
        for topic_id, assignments in catalog["topics"].items():
            if not connection.execute(
                "SELECT 1 FROM program_topics WHERE id = ?", (topic_id,)
            ).fetchone():
                raise ValueError(f"Tópico do mapa legislativo não existe: {topic_id}.")
            for position, (norm_code, article_reference) in enumerate(assignments, start=1):
                norm_name, source_url = sources[norm_code]
                digest = canonical_hash(
                    {
                        "topic_id": topic_id,
                        "norm_code": norm_code,
                        "article_reference": article_reference,
                        "source_url": source_url,
                        "map_version": catalog["map_version"],
                    }
                )
                reading_id = f"LR-{digest[:24]}"
                expected_ids.append(reading_id)
                connection.execute(
                    """
                    INSERT INTO topic_legislation_readings(
                        id, topic_id, norm_code, norm_name, article_reference,
                        source_url, map_version, mapping_method,
                        validation_status, sort_order, canonical_hash,
                        created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        norm_name = excluded.norm_name,
                        source_url = excluded.source_url,
                        map_version = excluded.map_version,
                        mapping_method = excluded.mapping_method,
                        validation_status = CASE
                            WHEN topic_legislation_readings.canonical_hash <> excluded.canonical_hash
                            THEN 'PENDENTE_VALIDACAO'
                            ELSE topic_legislation_readings.validation_status
                        END,
                        sort_order = excluded.sort_order,
                        canonical_hash = excluded.canonical_hash,
                        updated_at = excluded.updated_at
                    """,
                    (
                        reading_id,
                        topic_id,
                        norm_code,
                        norm_name,
                        article_reference,
                        source_url,
                        catalog["map_version"],
                        catalog.get("mapping_method", "IA_ASSISTIDA"),
                        catalog.get("validation_status", "PENDENTE_VALIDACAO"),
                        position,
                        digest,
                        now,
                        now,
                    ),
                )
        if expected_ids:
            placeholders = ",".join("?" for _ in expected_ids)
            connection.execute(
                f"""
                DELETE FROM topic_legislation_readings
            WHERE mapping_method = 'IA_ASSISTIDA'
                  AND id NOT IN ({placeholders})
                """,
                expected_ids,
            )

    def _backfill_plan_legislation(self, connection: Any, now: str) -> None:
        readings: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for row in connection.execute(
            """
            SELECT topic_id, norm_code, norm_name, article_reference, source_url,
                   map_version, mapping_method, validation_status
            FROM topic_legislation_readings
            WHERE validation_status <> 'REJEITADA'
            ORDER BY topic_id, sort_order
            """
        ):
            readings[row["topic_id"]].append(dict(row))
        updated = 0
        for entry in connection.execute(
            """
            SELECT id, topic_id FROM study_plan_entries
            WHERE topic_id IS NOT NULL
              AND legislation_status = 'PENDENTE_MAPEAMENTO'
              AND legislation_json = '[]'
            """
        ):
            topic_readings = readings.get(entry["topic_id"], [])
            if topic_readings:
                validated = all(
                    item["validation_status"] == "VALIDADA_FONTE" for item in topic_readings
                )
                status = "VALIDADO" if validated else "MAPEADO_PENDENTE_VALIDACAO"
                note = (
                    "Referência conferida no pacote de conteúdo."
                    if validated
                    else "Roteiro pré-edital vinculado ao programa; abra o texto vigente durante o estudo."
                )
            elif entry["topic_id"] in self._no_specific_articles:
                status = "SEM_DISPOSITIVO_ESPECIFICO"
                note = (
                    "Tema predominantemente doutrinário, jurisprudencial ou internacional, "
                    "sem faixa legislativa autônoma definida."
                )
            else:
                continue
            connection.execute(
                """
                UPDATE study_plan_entries
                SET legislation_json = ?, legislation_status = ?,
                    legislation_note = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    json.dumps(topic_readings, ensure_ascii=False),
                    status,
                    note,
                    now,
                    entry["id"],
                ),
            )
            updated += 1
        if updated:
            connection.execute(
                """
                INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                VALUES ('PLAN_LEGISLATION_BACKFILLED', 'STUDY_PLAN', 'MIGRATION_V5', ?, ?)
                """,
                (json.dumps({"entries": updated}), now),
            )

    @staticmethod
    def _seed_discursive_prompts(connection: Any, now: str) -> None:
        prompts = [
            (
                "D-IA-G1-001",
                "Autonomia da Defensoria Pública e acesso à justiça",
                "Examine a posição constitucional da Defensoria Pública, sua autonomia e a relação entre assistência jurídica integral, acesso à justiça e promoção dos direitos humanos.",
                "I",
                "CON",
                "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm",
                "Constituição Federal, arts. 5º, LXXIV, e 134",
            ),
            (
                "D-IA-G2-001",
                "Garantias constitucionais da pessoa presa",
                "Analise as garantias constitucionais incidentes desde a prisão, com ênfase em comunicação, direito ao silêncio, assistência jurídica e controle jurisdicional da legalidade.",
                "II",
                "DPP",
                "https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm",
                "Constituição Federal, art. 5º, incisos LXI a LXVIII",
            ),
            (
                "D-IA-G3-001",
                "Capacidade civil e proteção da pessoa com deficiência",
                "Discorra sobre o regime contemporâneo da capacidade civil, distinguindo incapacidade absoluta, incapacidade relativa e mecanismos de apoio à pessoa com deficiência.",
                "III",
                "CIV",
                "https://www.planalto.gov.br/ccivil_03/leis/2002/l10406compilada.htm",
                "Código Civil, arts. 3º e 4º; Lei nº 13.146/2015",
            ),
            (
                "D-IA-G4-001",
                "Prioridade absoluta de crianças e adolescentes",
                "Explique o conteúdo jurídico da prioridade absoluta, seus destinatários obrigados e seus efeitos sobre atendimento público, políticas sociais e alocação de recursos.",
                "IV",
                "DCA",
                "https://www.planalto.gov.br/ccivil_03/leis/l8069.htm",
                "Constituição Federal, art. 227; ECA, art. 4º",
            ),
        ]
        connection.executemany(
            """
            INSERT OR IGNORE INTO discursive_prompts(
                id, title, prompt_text, objective_group, discipline_code,
                source_url, official_reference, authorship_type,
                validation_status, active, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 'IA', 'PENDENTE_FONTE', 1, ?, ?)
            """,
            [(*prompt, now, now) for prompt in prompts],
        )

    @staticmethod
    def _validate_weights(value: Any, keys: tuple[str, ...], label: str) -> dict[str, int]:
        if not isinstance(value, dict):
            raise ValueError(f"{label} deve ser informado por categoria.")
        normalized: dict[str, int] = {}
        for key in keys:
            try:
                number = int(value.get(key, 0))
            except (TypeError, ValueError) as error:
                raise ValueError(f"Percentual inválido em {label}: {key}.") from error
            if not 0 <= number <= 100:
                raise ValueError(f"Percentual inválido em {label}: {key}.")
            normalized[key] = number
        if sum(normalized.values()) != 100:
            raise ValueError(f"A soma de {label} deve ser exatamente 100%.")
        return normalized

    @staticmethod
    def _validate_weekdays(value: Any) -> dict[str, int]:
        if not isinstance(value, dict):
            raise ValueError("Informe o tempo disponível em cada dia da semana.")
        result: dict[str, int] = {}
        for key in WEEKDAYS:
            try:
                minutes = int(value.get(key, 0))
            except (TypeError, ValueError) as error:
                raise ValueError(f"Tempo inválido para {key}.") from error
            if not 0 <= minutes <= 720:
                raise ValueError("O tempo diário deve ficar entre 0 e 720 minutos.")
            result[key] = minutes
        if sum(result.values()) < 60:
            raise ValueError("A disponibilidade semanal deve totalizar ao menos 60 minutos.")
        return result

    def get_diagnostic(self) -> dict[str, Any]:
        with self.database.connect() as connection:
            row = connection.execute(
                "SELECT * FROM study_diagnostic WHERE id = ?", (DIAGNOSTIC_ID,)
            ).fetchone()
        if not row:
            raise RuntimeError("Diagnóstico local não inicializado.")
        result = dict(row)
        result["weekday_minutes"] = json.loads(result.pop("weekday_minutes_json"))
        result["content_weights"] = json.loads(result.pop("content_weights_json"))
        result["group_weights"] = json.loads(result.pop("group_weights_json"))
        result["weekly_minutes"] = sum(result["weekday_minutes"].values())
        return result

    def save_diagnostic(self, payload: dict[str, Any]) -> dict[str, Any]:
        weekdays = self._validate_weekdays(payload.get("weekday_minutes"))
        content = self._validate_weights(
            payload.get("content_weights"), CONTENT_TYPES, "preferências de conteúdo"
        )
        groups = self._validate_weights(
            payload.get("group_weights"), GROUPS, "divisão de foco entre grupos"
        )
        experience = str(payload.get("experience_level", "INTERMEDIARIO")).upper()
        shift = str(payload.get("preferred_shift", "FLEXIVEL")).upper()
        if experience not in {"INICIANTE", "INTERMEDIARIO", "AVANCADO"}:
            raise ValueError("Nível de experiência inválido.")
        if shift not in {"MANHA", "TARDE", "NOITE", "FLEXIVEL"}:
            raise ValueError("Turno preferencial inválido.")
        session_minutes = int(payload.get("session_minutes", 50))
        horizon_days = int(payload.get("horizon_days", 28))
        if not 20 <= session_minutes <= 120:
            raise ValueError("O bloco de estudo deve ficar entre 20 e 120 minutos.")
        if not 7 <= horizon_days <= 84:
            raise ValueError("O horizonte deve ficar entre 7 e 84 dias.")
        now = utc_now()
        with self.database.connect() as connection:
            connection.execute(
                """
                UPDATE study_diagnostic
                SET experience_level = ?, preferred_shift = ?, session_minutes = ?,
                    horizon_days = ?, weekday_minutes_json = ?,
                    content_weights_json = ?, group_weights_json = ?,
                    completed = 1, updated_at = ?
                WHERE id = ?
                """,
                (
                    experience,
                    shift,
                    session_minutes,
                    horizon_days,
                    json.dumps(weekdays, ensure_ascii=False),
                    json.dumps(content, ensure_ascii=False),
                    json.dumps(groups, ensure_ascii=False),
                    now,
                    DIAGNOSTIC_ID,
                ),
            )
            connection.execute(
                """
                INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                VALUES ('DIAGNOSTIC_UPDATED', 'STUDY_DIAGNOSTIC', ?, ?, ?)
                """,
                (
                    DIAGNOSTIC_ID,
                    json.dumps(
                        {
                            "weekly_minutes": sum(weekdays.values()),
                            "content_weights": content,
                            "group_weights": groups,
                        },
                        ensure_ascii=False,
                    ),
                    now,
                ),
            )
            connection.commit()
        return self.get_diagnostic()

    @staticmethod
    def _weighted_pick(weights: dict[str, int], allocated: dict[str, int]) -> str:
        eligible = [key for key, weight in weights.items() if weight > 0]
        if not eligible:
            raise ValueError("Ao menos uma categoria precisa receber foco.")
        return min(
            eligible,
            key=lambda key: (allocated[key] / weights[key], allocated[key], eligible.index(key)),
        )

    @staticmethod
    def _topic_score(item: dict[str, Any], experience_level: str) -> tuple[Any, ...]:
        priority = {"ALTA": 0, "MEDIA": 1, "BAIXA": 2}.get(item["priority"], 1)
        pre_edit = {"MUITO_ALTA": 0, "ALTA": 1, "MEDIA": 2}.get(
            item.get("pre_edit_priority"), 1
        )
        status = {"NAO_INICIADO": 0, "EM_ESTUDO": 1, "REVISAO": 2, "CONSOLIDADO": 3}.get(
            item["study_status"], 1
        )
        mastery = item["mastery"] if item["mastery"] is not None else 0
        accuracy = (
            item["correct_answers"] / item["questions_done"]
            if item["questions_done"]
            else 0
        )
        if experience_level == "INICIANTE":
            # Preserva progressão programática antes de perseguir microgaps de desempenho.
            return priority, status, pre_edit, item["item_number"], mastery, accuracy
        if experience_level == "AVANCADO":
            # No perfil avançado, lacunas já aferidas pesam antes da ordem do programa.
            measured_gap = accuracy if item["questions_done"] else 1.0
            return priority, measured_gap, mastery, pre_edit, status, item["item_number"]
        return priority, status, mastery, pre_edit, accuracy, item["item_number"]

    def _planning_corpus(self, end_date: date, experience_level: str) -> dict[str, Any]:
        with self.database.connect() as connection:
            self._ensure_review_queue(connection)
            connection.commit()
            topics = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT t.*, d.name AS discipline_name, p.study_status, p.priority,
                           p.mastery, p.questions_done, p.correct_answers,
                           p.last_review, p.next_review
                    FROM program_topics t
                    JOIN disciplines d ON d.code = t.discipline_code
                    JOIN topic_progress p ON p.topic_id = t.id
                    """
                )
            ]
            jurisprudence = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT i.id, i.title, i.issue_number, s.court,
                           COALESCE(p.study_status, 'NAO_LIDO') AS study_status
                    FROM jurisprudence_items i
                    JOIN jurisprudence_sources s ON s.id = i.source_id
                    LEFT JOIN jurisprudence_progress p ON p.jurisprudence_item_id = i.id
                    WHERE COALESCE(p.study_status, 'NAO_LIDO') <> 'LIDO'
                    ORDER BY COALESCE(i.published_at, i.detected_at) DESC
                    LIMIT 200
                    """
                )
            ]
            prompts = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT p.*, d.name AS discipline_name
                    FROM discursive_prompts p
                    LEFT JOIN disciplines d ON d.code = p.discipline_code
                    WHERE p.active = 1 AND p.validation_status <> 'REJEITADA'
                    ORDER BY p.updated_at DESC
                    """
                )
            ]
            reviews = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT r.*, t.objective_group, t.discipline_code, t.title,
                           d.name AS discipline_name
                    FROM review_state r
                    JOIN program_topics t ON t.id = r.topic_id
                    JOIN disciplines d ON d.code = t.discipline_code
                    WHERE r.due_date <= ?
                    ORDER BY r.due_date, r.interval_days
                    """,
                    (end_date.isoformat(),),
                )
            ]
            legislation_rows = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT topic_id, norm_code, norm_name, article_reference,
                           source_url, map_version, mapping_method, validation_status
                    FROM topic_legislation_readings
                    WHERE validation_status <> 'REJEITADA'
                    ORDER BY topic_id, sort_order
                    """
                )
            ]
            question_rows = [
                dict(row)
                for row in connection.execute(
                    f"""
                    SELECT d.objective_group AS group_name, COUNT(*) AS eligible
                    FROM questions q
                    JOIN disciplines d ON d.code = q.discipline_code
                    WHERE {QuestionService._eligibility_sql()}
                    GROUP BY d.objective_group
                    """
                )
            ]
        legislation: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for item in legislation_rows:
            legislation[item["topic_id"]].append(item)
        for item in topics:
            profile = self._pre_edit_profile["topics"].get(
                item["id"], ["ALTA", "RECORRENCIA_PROGRAMATICA"]
            )
            item["pre_edit_priority"] = profile[0]
            item["pre_edit_basis"] = profile[1]
        topics.sort(key=lambda item: self._topic_score(item, experience_level))
        grouped_topics = {group: [item for item in topics if item["objective_group"] == group] for group in GROUPS}
        grouped_reviews = {group: [item for item in reviews if item["objective_group"] == group] for group in GROUPS}
        grouped_prompts = {group: [item for item in prompts if item["objective_group"] == group] for group in GROUPS}
        question_counts = {group: 0 for group in GROUPS}
        question_counts.update(
            {str(item["group_name"]): int(item["eligible"] or 0) for item in question_rows}
        )
        return {
            "topics": grouped_topics,
            "reviews": grouped_reviews,
            "prompts": grouped_prompts,
            "jurisprudence": jurisprudence,
            "legislation": legislation,
            "availability": {
                "questions": sum(question_counts.values()),
                "questions_by_group": question_counts,
                "jurisprudence": len(jurisprudence),
                "discursive_by_group": {
                    group: len(grouped_prompts[group]) for group in GROUPS
                },
                "reviews_by_group": {
                    group: len(grouped_reviews[group]) for group in GROUPS
                },
            },
        }

    @staticmethod
    def _effective_content_weights(
        configured: dict[str, int], group_weights: dict[str, int], corpus: dict[str, Any]
    ) -> tuple[dict[str, int], list[str]]:
        weights = dict(configured)
        adjustments: list[str] = []
        active_groups = [group for group, weight in group_weights.items() if weight > 0]
        availability = corpus["availability"]
        question_counts = availability["questions_by_group"]

        if weights.get("QUESTOES", 0) and (
            not availability["questions"]
            or any(question_counts.get(group, 0) == 0 for group in active_groups)
        ):
            weights["QUESTOES"] = 0
            adjustments.append(
                "A carga de questões foi redistribuída porque ainda não há itens liberados em todos os grupos selecionados."
            )
        if weights.get("SIMULADO", 0) and any(
            question_counts.get(group, 0) < 25 for group in active_groups
        ):
            weights["SIMULADO"] = 0
            adjustments.append(
                "A carga de simulados foi redistribuída até que cada grupo selecionado tenha ao menos 25 itens liberados."
            )
        if weights.get("JURISPRUDENCIA", 0) and not availability["jurisprudence"]:
            weights["JURISPRUDENCIA"] = 0
            adjustments.append(
                "A carga de jurisprudência foi redistribuída porque ainda não há informativos importados."
            )
        if weights.get("REVISAO", 0) and any(
            availability["reviews_by_group"].get(group, 0) == 0
            for group in active_groups
        ):
            weights["REVISAO"] = 0
            adjustments.append(
                "A carga de revisão foi redistribuída porque a fila espaçada ainda não possui tópicos de todos os grupos selecionados."
            )
        if weights.get("DISCURSIVA", 0) and any(
            availability["discursive_by_group"].get(group, 0) == 0
            for group in active_groups
        ):
            weights["DISCURSIVA"] = 0
            adjustments.append(
                "A carga discursiva foi redistribuída porque nem todos os grupos selecionados possuem tema disponível."
            )
        if not any(weights.values()):
            weights["LEITURA"] = 100
            adjustments.append(
                "A leitura programática foi usada como rota segura enquanto os demais pacotes de conteúdo são ampliados."
            )
        return weights, adjustments

    def _legislation_payload(
        self, topic_id: str | None, corpus: dict[str, Any]
    ) -> dict[str, Any]:
        if not topic_id:
            return {
                "legislation": [],
                "legislation_status": "NAO_APLICAVEL",
                "legislation_note": "Este bloco não corresponde à leitura de um tópico legislativo.",
            }
        readings = corpus["legislation"].get(topic_id, [])
        if readings:
            validated = all(item["validation_status"] == "VALIDADA_FONTE" for item in readings)
            return {
                "legislation": readings,
                "legislation_status": "VALIDADO" if validated else "MAPEADO_PENDENTE_VALIDACAO",
                "legislation_note": (
                    "Referência conferida no pacote de conteúdo."
                    if validated
                    else "Roteiro pré-edital vinculado ao programa; abra o texto vigente durante o estudo."
                ),
            }
        if topic_id in self._no_specific_articles:
            return {
                "legislation": [],
                "legislation_status": "SEM_DISPOSITIVO_ESPECIFICO",
                "legislation_note": (
                    "Tema predominantemente doutrinário, jurisprudencial ou internacional, "
                    "sem faixa legislativa autônoma definida."
                ),
            }
        return {
            "legislation": [],
            "legislation_status": "PENDENTE_MAPEAMENTO",
            "legislation_note": (
                "Estude o tópico neste bloco; a faixa normativa será incluída em uma atualização do pacote."
            ),
        }

    @staticmethod
    def _cycle_pick(items: list[dict[str, Any]], counters: dict[str, int], key: str) -> dict[str, Any] | None:
        if not items:
            return None
        index = counters[key] % len(items)
        counters[key] += 1
        return items[index]

    def _entry_content(
        self,
        content_type: str,
        group: str,
        corpus: dict[str, Any],
        counters: dict[str, int],
    ) -> dict[str, Any]:
        topic = (
            self._cycle_pick(corpus["topics"][group], counters, f"topic-{group}")
            if content_type in {"LEITURA", "QUESTOES"}
            else None
        )
        base = {
            "content_type": content_type,
            "objective_group": group,
            "discipline_code": topic["discipline_code"] if topic else None,
            "topic_id": topic["id"] if topic else None,
            "entity_id": topic["id"] if topic else None,
            **self._legislation_payload(topic["id"] if topic else None, corpus),
        }
        if content_type == "JURISPRUDENCIA" and corpus["jurisprudence"]:
            index = counters["jurisprudence"]
            if index >= len(corpus["jurisprudence"]):
                fallback = self._entry_content("LEITURA", group, corpus, counters)
                fallback["rationale"] = (
                    "Leitura programática usada após esgotar os informativos não lidos deste ciclo."
                )
                fallback["fallback_reason"] = (
                    "A carga excedente de jurisprudência foi convertida em leitura após todos os informativos não lidos serem agendados uma vez."
                )
                return fallback
            item = corpus["jurisprudence"][index]
            counters["jurisprudence"] += 1
            return {
                **base,
                "discipline_code": None,
                "topic_id": None,
                "entity_id": str(item["id"]),
                "title": f"Ler {item['court']} — {item['title']}",
                "rationale": "Publicação ainda não consolidada no histórico pessoal.",
                "legislation": [],
                "legislation_status": "NAO_APLICAVEL",
                "legislation_note": "A fonte deste bloco é o próprio informativo oficial.",
            }
        if content_type == "REVISAO":
            review_index = counters[f"review-{group}"]
            if review_index < len(corpus["reviews"][group]):
                review = corpus["reviews"][group][review_index]
                counters[f"review-{group}"] += 1
                return {
                    **base,
                    "discipline_code": review["discipline_code"],
                    "topic_id": review["topic_id"],
                    "entity_id": review["topic_id"],
                    "title": f"Revisar: {review['title']}",
                    "rationale": f"Revisão programada para {review['due_date']}.",
                    **self._legislation_payload(review["topic_id"], corpus),
                }
            fallback = self._entry_content("LEITURA", group, corpus, counters)
            fallback["rationale"] = "Leitura programática usada após esgotar as revisões devidas deste ciclo."
            fallback["fallback_reason"] = (
                "A carga excedente de revisão foi convertida em leitura depois que cada tópico devido foi agendado uma vez."
            )
            return fallback
        if content_type == "DISCURSIVA":
            prompt_index = counters[f"prompt-{group}"]
            if prompt_index < len(corpus["prompts"][group]):
                prompt = corpus["prompts"][group][prompt_index]
                counters[f"prompt-{group}"] += 1
                return {
                    **base,
                    "discipline_code": prompt["discipline_code"],
                    "topic_id": None,
                    "entity_id": prompt["id"],
                    "title": f"Discursiva: {prompt['title']}",
                    "rationale": "Treino discursivo conforme a preferência informada.",
                    "legislation": (
                        [
                            {
                                "norm_code": "REFERENCIA_TEMA",
                                "norm_name": "Referência oficial do tema discursivo",
                                "article_reference": prompt["official_reference"],
                                "source_url": prompt["source_url"],
                                "map_version": "tema-discursivo",
                                "mapping_method": prompt["authorship_type"],
                                "validation_status": prompt["validation_status"],
                            }
                        ]
                        if prompt["source_url"] and prompt["official_reference"]
                        else []
                    ),
                    "legislation_status": (
                        "VALIDADO"
                        if prompt["validation_status"] == "VALIDADA_FONTE"
                        else "MAPEADO_PENDENTE_VALIDACAO"
                    ),
                    "legislation_note": "Referência oficial vinculada ao repertório do tema.",
                }
            fallback = self._entry_content("LEITURA", group, corpus, counters)
            fallback["rationale"] = "Leitura programática usada após agendar todos os temas discursivos disponíveis."
            fallback["fallback_reason"] = (
                "A carga discursiva excedente foi convertida em leitura para não repetir o mesmo tema no ciclo."
            )
            return fallback
        if content_type == "SIMULADO":
            simulation_key = f"simulation-{group}"
            simulation_limit = corpus["availability"]["questions_by_group"].get(group, 0) // 25
            if counters[simulation_key] >= simulation_limit:
                fallback = self._entry_content("LEITURA", group, corpus, counters)
                fallback["rationale"] = "Leitura programática usada para evitar repetir o mesmo conjunto de simulado."
                fallback["fallback_reason"] = (
                    "A carga excedente de simulados foi convertida em leitura após esgotar lotes inéditos de 25 questões."
                )
                return fallback
            counters[simulation_key] += 1
            return {
                **base,
                "topic_id": None,
                "entity_id": None,
                "title": f"Simulado preparatório — Grupo {group}",
                "rationale": "Sessão de aferição montada somente com itens liberados para estudo.",
                "legislation": [],
                "legislation_status": "NAO_APLICAVEL",
                "legislation_note": "As referências aparecem em cada questão da sessão.",
            }
        if not topic:
            return {
                **base,
                "title": f"Estudo geral do Grupo {group}",
                "rationale": "Bloco provisório sem tópico elegível.",
                "legislation": [],
                "legislation_status": "PENDENTE_MAPEAMENTO",
                "legislation_note": "Bloco sem tópico e sem dispositivos definidos.",
            }
        if content_type == "QUESTOES":
            question_key = f"questions-{group}"
            question_limit = math.ceil(
                corpus["availability"]["questions_by_group"].get(group, 0) / 10
            )
            if counters[question_key] >= question_limit:
                fallback = self._entry_content("LEITURA", group, corpus, counters)
                fallback["rationale"] = "Leitura programática usada para preservar variedade no banco de questões."
                fallback["fallback_reason"] = (
                    "A carga excedente de questões foi convertida em leitura após reservar todos os itens inéditos em blocos de até 10."
                )
                return fallback
            counters[question_key] += 1
        action = "Resolver questões de" if content_type == "QUESTOES" else "Estudar"
        pre_edit_label = {
            "MEDIA": "médio",
            "ALTA": "alto",
            "MUITO_ALTA": "muito alto",
        }[topic["pre_edit_priority"]]
        return {
            **base,
            "title": f"{action}: {topic['title']}",
            "rationale": (
                f"Prioridade {topic['priority'].lower()}, domínio "
                f"{topic['mastery'] if topic['mastery'] is not None else 'não aferido'}; "
                f"foco pré-edital {pre_edit_label}."
            ),
        }

    def generate_plan(self, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        payload = payload or {}
        diagnostic = self.get_diagnostic()
        if not diagnostic["completed"]:
            raise ValueError("Conclua o diagnóstico antes de gerar o cronograma.")
        try:
            start = date.fromisoformat(str(payload.get("start_date") or _local_today().isoformat()))
        except ValueError as error:
            raise ValueError("Data inicial inválida.") from error
        horizon = int(payload.get("horizon_days") or diagnostic["horizon_days"])
        if not 7 <= horizon <= 84:
            raise ValueError("O horizonte deve ficar entre 7 e 84 dias.")
        end = start + timedelta(days=horizon - 1)
        corpus = self._planning_corpus(end, diagnostic["experience_level"])
        content_weights, adjustments = self._effective_content_weights(
            diagnostic["content_weights"], diagnostic["group_weights"], corpus
        )
        content_allocated: dict[str, int] = defaultdict(int)
        group_allocated: dict[str, int] = defaultdict(int)
        counters: dict[str, int] = defaultdict(int)
        entries: list[dict[str, Any]] = []
        weekday_map = dict(zip(range(7), WEEKDAYS))
        for offset in range(horizon):
            current = start + timedelta(days=offset)
            available = diagnostic["weekday_minutes"][weekday_map[current.weekday()]]
            position = 1
            while available >= 10:
                duration = min(diagnostic["session_minutes"], available)
                content_type = self._weighted_pick(
                    content_weights, content_allocated
                )
                group = self._weighted_pick(diagnostic["group_weights"], group_allocated)
                generated = self._entry_content(content_type, group, corpus, counters)
                fallback_reason = generated.pop("fallback_reason", None)
                if fallback_reason and fallback_reason not in adjustments:
                    adjustments.append(fallback_reason)
                entries.append(
                    {
                        **generated,
                        "scheduled_date": current.isoformat(),
                        "position": position,
                        "duration_minutes": duration,
                    }
                )
                content_allocated[generated["content_type"]] += duration
                group_allocated[group] += duration
                available -= duration
                position += 1
        if not entries:
            raise ValueError("O diagnóstico não reservou tempo no período selecionado.")
        run_id = str(uuid.uuid4())
        now = utc_now()
        digest = canonical_hash(
            {
                "diagnostic": diagnostic,
                "start": start.isoformat(),
                "horizon": horizon,
            }
        )
        with self.database.connect() as connection:
            connection.execute(
                "UPDATE study_plan_runs SET status = 'SUBSTITUIDO' WHERE status = 'ATIVO'"
            )
            connection.execute(
                """
                INSERT INTO study_plan_runs(
                    id, start_date, end_date, horizon_days, total_minutes,
                    diagnostic_hash, adjustments_json, status, generated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'ATIVO', ?)
                """,
                (
                    run_id,
                    start.isoformat(),
                    end.isoformat(),
                    horizon,
                    sum(item["duration_minutes"] for item in entries),
                    digest,
                    json.dumps(adjustments, ensure_ascii=False),
                    now,
                ),
            )
            connection.executemany(
                """
                INSERT INTO study_plan_entries(
                    id, run_id, scheduled_date, position, content_type,
                    objective_group, discipline_code, topic_id, entity_id,
                    title, duration_minutes, rationale, legislation_json,
                    legislation_status, legislation_note, status,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PLANEJADO', ?, ?)
                """,
                [
                    (
                        str(uuid.uuid4()),
                        run_id,
                        item["scheduled_date"],
                        item["position"],
                        item["content_type"],
                        item["objective_group"],
                        item["discipline_code"],
                        item["topic_id"],
                        item["entity_id"],
                        item["title"],
                        item["duration_minutes"],
                        item["rationale"],
                        json.dumps(item["legislation"], ensure_ascii=False),
                        item["legislation_status"],
                        item["legislation_note"],
                        now,
                        now,
                    )
                    for item in entries
                ],
            )
            connection.execute(
                """
                INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                VALUES ('PLAN_GENERATED', 'STUDY_PLAN', ?, ?, ?)
                """,
                (
                    run_id,
                    json.dumps(
                        {"entries": len(entries), "minutes": sum(content_allocated.values())}
                    ),
                    now,
                ),
            )
            connection.commit()
        return self.get_plan()

    def get_plan(self) -> dict[str, Any]:
        diagnostic = self.get_diagnostic()
        with self.database.connect() as connection:
            run = connection.execute(
                """
                SELECT * FROM study_plan_runs
                WHERE status = 'ATIVO' ORDER BY generated_at DESC LIMIT 1
                """
            ).fetchone()
            if not run:
                return {
                    "run": None,
                    "items": [],
                    "summary": {"completed_minutes": 0, "adjustments": []},
                }
            items = [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT e.*, d.name AS discipline_name
                    FROM study_plan_entries e
                    LEFT JOIN disciplines d ON d.code = e.discipline_code
                    WHERE e.run_id = ?
                    ORDER BY e.scheduled_date, e.position
                    """,
                    (run["id"],),
                )
            ]
        content_minutes: dict[str, int] = defaultdict(int)
        group_minutes: dict[str, int] = defaultdict(int)
        completed_minutes = 0
        for item in items:
            try:
                item["legislation"] = json.loads(item.pop("legislation_json", "[]"))
            except (TypeError, json.JSONDecodeError):
                item["legislation"] = []
            content_minutes[item["content_type"]] += item["duration_minutes"]
            if item["objective_group"]:
                group_minutes[item["objective_group"]] += item["duration_minutes"]
            if item["status"] == "CONCLUIDO":
                completed_minutes += item["completed_minutes"]
        run_payload = dict(run)
        try:
            adjustments = json.loads(run_payload.pop("adjustments_json", "[]"))
        except (TypeError, json.JSONDecodeError):
            adjustments = []
        return {
            "run": run_payload,
            "items": items,
            "summary": {
                "content_minutes": dict(content_minutes),
                "group_minutes": dict(group_minutes),
                "completed_minutes": completed_minutes,
                "completion": completed_minutes / run["total_minutes"] if run["total_minutes"] else 0,
                "experience_level": diagnostic["experience_level"],
                "preferred_shift": diagnostic["preferred_shift"],
                "adjustments": adjustments,
            },
        }

    def update_plan_entry(self, entry_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        status = str(payload.get("status", "")).upper()
        if status not in {"PLANEJADO", "CONCLUIDO", "PULADO"}:
            raise ValueError("Situação do bloco inválida.")
        now = utc_now()
        with self.database.connect() as connection:
            current = connection.execute(
                "SELECT * FROM study_plan_entries WHERE id = ?", (entry_id,)
            ).fetchone()
            if not current:
                raise KeyError("Bloco do cronograma não localizado.")
            completed_minutes = int(
                payload.get(
                    "completed_minutes",
                    current["duration_minutes"] if status == "CONCLUIDO" else 0,
                )
            )
            if not 0 <= completed_minutes <= 1440:
                raise ValueError("Tempo realizado inválido.")
            connection.execute(
                """
                UPDATE study_plan_entries
                SET status = ?, completed_minutes = ?,
                    completed_at = CASE WHEN ? = 'CONCLUIDO' THEN ? ELSE NULL END,
                    updated_at = ?
                WHERE id = ?
                """,
                (status, completed_minutes, status, now, now, entry_id),
            )
            if status == "CONCLUIDO" and current["topic_id"]:
                connection.execute(
                    """
                    UPDATE topic_progress
                    SET study_status = CASE
                            WHEN study_status = 'NAO_INICIADO' THEN 'EM_ESTUDO'
                            ELSE study_status
                        END,
                        updated_at = ?
                    WHERE topic_id = ?
                    """,
                    (now, current["topic_id"]),
                )
            if (
                status == "CONCLUIDO"
                and current["content_type"] == "JURISPRUDENCIA"
                and str(current["entity_id"] or "").isdigit()
            ):
                connection.execute(
                    """
                    INSERT INTO jurisprudence_progress(
                        jurisprudence_item_id, study_status, last_review, updated_at
                    ) VALUES (?, 'LIDO', ?, ?)
                    ON CONFLICT(jurisprudence_item_id) DO UPDATE SET
                        study_status = 'LIDO', last_review = excluded.last_review,
                        updated_at = excluded.updated_at
                    """,
                    (int(current["entity_id"]), now, now),
                )
            connection.execute(
                """
                INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                VALUES ('PLAN_ENTRY_UPDATED', 'STUDY_PLAN_ENTRY', ?, ?, ?)
                """,
                (
                    entry_id,
                    json.dumps({"status": status, "completed_minutes": completed_minutes}),
                    now,
                ),
            )
            connection.commit()
            row = connection.execute(
                "SELECT * FROM study_plan_entries WHERE id = ?", (entry_id,)
            ).fetchone()
        return dict(row)

    def _ensure_review_queue(self, connection: Any) -> None:
        today = _local_today().isoformat()
        now = utc_now()
        connection.execute(
            """
            INSERT OR IGNORE INTO review_state(topic_id, due_date, updated_at)
            SELECT p.topic_id, COALESCE(p.next_review, ?), ?
            FROM topic_progress p
            WHERE p.study_status <> 'NAO_INICIADO'
            """,
            (today, now),
        )

    def list_reviews(self, due_only: bool = True, limit: int = 200) -> dict[str, Any]:
        limit = max(1, min(int(limit), 500))
        today = _local_today().isoformat()
        with self.database.connect() as connection:
            self._ensure_review_queue(connection)
            connection.commit()
            where = "WHERE r.due_date <= ?" if due_only else ""
            params: list[Any] = [today] if due_only else []
            total_due = connection.execute(
                "SELECT COUNT(*) FROM review_state WHERE due_date <= ?", (today,)
            ).fetchone()[0]
            rows = [
                dict(row)
                for row in connection.execute(
                    f"""
                    SELECT r.*, t.title, t.objective_group, t.discipline_code,
                           d.name AS discipline_name, p.mastery, p.study_status
                    FROM review_state r
                    JOIN program_topics t ON t.id = r.topic_id
                    JOIN disciplines d ON d.code = t.discipline_code
                    JOIN topic_progress p ON p.topic_id = r.topic_id
                    {where}
                    ORDER BY r.due_date, d.sort_order, t.item_number LIMIT ?
                    """,
                    [*params, limit],
                )
            ]
        return {"due": total_due, "items": rows}

    def rate_review(self, topic_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        rating = str(payload.get("rating", "")).upper()
        if rating not in RATINGS:
            raise ValueError("Avaliação de revisão inválida.")
        today = _local_today()
        now = utc_now()
        with self.database.connect() as connection:
            topic = connection.execute(
                "SELECT id FROM program_topics WHERE id = ?", (topic_id,)
            ).fetchone()
            if not topic:
                raise KeyError("Tópico não localizado.")
            self._ensure_review_queue(connection)
            current = connection.execute(
                "SELECT * FROM review_state WHERE topic_id = ?", (topic_id,)
            ).fetchone()
            interval = int(current["interval_days"])
            ease = float(current["ease_factor"])
            repetitions = int(current["repetitions"])
            if rating == "REPETIR":
                interval, repetitions, ease = 1, 0, max(1.3, ease - 0.2)
            elif rating == "DIFICIL":
                interval = 2 if repetitions == 0 else max(2, math.ceil(max(interval, 1) * 1.2))
                repetitions += 1
                ease = max(1.3, ease - 0.15)
            elif rating == "BOM":
                interval = 3 if repetitions == 0 else max(3, round(max(interval, 1) * ease))
                repetitions += 1
            else:
                interval = 7 if repetitions == 0 else max(7, round(max(interval, 1) * ease * 1.3))
                repetitions += 1
                ease = min(3.5, ease + 0.15)
            due_date = (today + timedelta(days=interval)).isoformat()
            connection.execute(
                """
                UPDATE review_state
                SET interval_days = ?, ease_factor = ?, repetitions = ?,
                    due_date = ?, last_reviewed_at = ?, last_rating = ?, updated_at = ?
                WHERE topic_id = ?
                """,
                (interval, ease, repetitions, due_date, now, rating, now, topic_id),
            )
            mastery_delta = {"REPETIR": -2, "DIFICIL": -1, "BOM": 0, "FACIL": 1}[rating]
            connection.execute(
                """
                UPDATE topic_progress
                SET last_review = ?, next_review = ?,
                    mastery = CASE
                        WHEN mastery IS NULL THEN CASE WHEN ? = 'FACIL' THEN 1 ELSE 0 END
                        ELSE MIN(5, MAX(0, mastery + ?))
                    END,
                    study_status = CASE
                        WHEN study_status = 'NAO_INICIADO' THEN 'REVISAO'
                        ELSE study_status
                    END,
                    updated_at = ?
                WHERE topic_id = ?
                """,
                (today.isoformat(), due_date, rating, mastery_delta, now, topic_id),
            )
            connection.execute(
                """
                INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                VALUES ('REVIEW_RATED', 'PROGRAM_TOPIC', ?, ?, ?)
                """,
                (
                    topic_id,
                    json.dumps({"rating": rating, "interval_days": interval, "due_date": due_date}),
                    now,
                ),
            )
            connection.commit()
        return self.list_reviews(due_only=False, limit=500)

    def list_discursive_prompts(self) -> list[dict[str, Any]]:
        with self.database.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT p.*, d.name AS discipline_name,
                           COUNT(a.id) AS attempt_count,
                           MAX(a.updated_at) AS last_attempt_at
                    FROM discursive_prompts p
                    LEFT JOIN disciplines d ON d.code = p.discipline_code
                    LEFT JOIN discursive_attempts a ON a.prompt_id = p.id
                    WHERE p.active = 1
                    GROUP BY p.id
                    ORDER BY p.objective_group, p.updated_at DESC
                    """
                )
            ]

    def create_discursive_prompt(self, payload: dict[str, Any]) -> dict[str, Any]:
        title = str(payload.get("title", "")).strip()
        prompt_text = str(payload.get("prompt_text", "")).strip()
        if len(title) < 5 or len(title) > 240:
            raise ValueError("O título deve ter entre 5 e 240 caracteres.")
        if len(prompt_text) < 20 or len(prompt_text) > 10_000:
            raise ValueError("O enunciado deve ter entre 20 e 10.000 caracteres.")
        group = str(payload.get("objective_group", "")).upper() or None
        if group and group not in GROUPS:
            raise ValueError("Grupo objetivo inválido.")
        discipline = str(payload.get("discipline_code", "")).upper() or None
        source_url = str(payload.get("source_url", "")).strip()
        if source_url:
            parsed_url = urllib.parse.urlparse(source_url)
            if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
                raise ValueError("A fonte deve usar um endereço HTTP ou HTTPS válido.")
        now = utc_now()
        prompt_id = str(uuid.uuid4())
        with self.database.connect() as connection:
            if discipline and not connection.execute(
                "SELECT 1 FROM disciplines WHERE code = ?", (discipline,)
            ).fetchone():
                raise ValueError("Disciplina inválida.")
            connection.execute(
                """
                INSERT INTO discursive_prompts(
                    id, title, prompt_text, objective_group, discipline_code,
                    source_url, official_reference, authorship_type,
                    validation_status, active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, 'HUMANA', 'PENDENTE_FONTE', 1, ?, ?)
                """,
                (
                    prompt_id,
                    title,
                    prompt_text,
                    group,
                    discipline,
                    source_url,
                    str(payload.get("official_reference", "")).strip(),
                    now,
                    now,
                ),
            )
            connection.commit()
            row = connection.execute(
                "SELECT * FROM discursive_prompts WHERE id = ?", (prompt_id,)
            ).fetchone()
        return dict(row)

    def list_discursive_attempts(self, limit: int = 100) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), 300))
        with self.database.connect() as connection:
            return [
                dict(row)
                for row in connection.execute(
                    """
                    SELECT a.*, p.title AS prompt_title, p.objective_group,
                           p.discipline_code
                    FROM discursive_attempts a
                    JOIN discursive_prompts p ON p.id = a.prompt_id
                    ORDER BY a.updated_at DESC LIMIT ?
                    """,
                    (limit,),
                )
            ]

    def save_discursive_attempt(self, payload: dict[str, Any]) -> dict[str, Any]:
        prompt_id = str(payload.get("prompt_id", ""))
        attempt_id = str(payload.get("id", "")).strip() or str(uuid.uuid4())
        answer = str(payload.get("answer_text", ""))
        if len(answer) > 100_000:
            raise ValueError("A resposta excede o limite de 100.000 caracteres.")
        status = str(payload.get("status", "RASCUNHO")).upper()
        if status not in {"RASCUNHO", "CONCLUIDA"}:
            raise ValueError("Situação da resposta inválida.")
        if status == "CONCLUIDA" and len(answer.strip()) < 100:
            raise ValueError("Uma resposta concluída deve conter ao menos 100 caracteres.")
        elapsed = max(0, min(int(payload.get("elapsed_minutes", 0)), 1440))
        score_value = payload.get("self_score")
        score = None if score_value in {None, ""} else float(score_value)
        if score is not None and not 0 <= score <= 10:
            raise ValueError("A autoavaliação deve ficar entre 0 e 10.")
        now = utc_now()
        with self.database.connect() as connection:
            if not connection.execute(
                "SELECT 1 FROM discursive_prompts WHERE id = ? AND active = 1", (prompt_id,)
            ).fetchone():
                raise KeyError("Tema discursivo não localizado.")
            existing = connection.execute(
                "SELECT id, prompt_id, created_at FROM discursive_attempts WHERE id = ?",
                (attempt_id,),
            ).fetchone()
            if existing and existing["prompt_id"] != prompt_id:
                raise ValueError("A resposta não pertence ao tema informado.")
            connection.execute(
                """
                INSERT INTO discursive_attempts(
                    id, prompt_id, answer_text, word_count, elapsed_minutes,
                    self_score, strengths, improvements, status,
                    created_at, updated_at, completed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    answer_text = excluded.answer_text,
                    word_count = excluded.word_count,
                    elapsed_minutes = excluded.elapsed_minutes,
                    self_score = excluded.self_score,
                    strengths = excluded.strengths,
                    improvements = excluded.improvements,
                    status = excluded.status,
                    updated_at = excluded.updated_at,
                    completed_at = excluded.completed_at
                """,
                (
                    attempt_id,
                    prompt_id,
                    answer,
                    _word_count(answer),
                    elapsed,
                    score,
                    str(payload.get("strengths", ""))[:10_000],
                    str(payload.get("improvements", ""))[:10_000],
                    status,
                    existing["created_at"] if existing else now,
                    now,
                    now if status == "CONCLUIDA" else None,
                ),
            )
            connection.execute(
                """
                INSERT INTO study_events(event_type, entity_type, entity_id, payload_json, occurred_at)
                VALUES ('DISCURSIVE_SAVED', 'DISCURSIVE_ATTEMPT', ?, ?, ?)
                """,
                (
                    attempt_id,
                    json.dumps({"status": status, "word_count": _word_count(answer)}),
                    now,
                ),
            )
            connection.commit()
            row = connection.execute(
                """
                SELECT a.*, p.title AS prompt_title
                FROM discursive_attempts a
                JOIN discursive_prompts p ON p.id = a.prompt_id
                WHERE a.id = ?
                """,
                (attempt_id,),
            ).fetchone()
        return dict(row)
