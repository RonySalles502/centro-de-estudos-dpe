PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS app_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS study_workspace (
    id TEXT PRIMARY KEY,
    installation_id TEXT NOT NULL,
    candidate_name TEXT NOT NULL DEFAULT '',
    target_exam_date TEXT,
    target_date_status TEXT NOT NULL DEFAULT 'ESTIMADA',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disciplines (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    objective_group TEXT NOT NULL,
    discursive_group TEXT NOT NULL,
    sort_order INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS program_topics (
    id TEXT PRIMARY KEY,
    objective_group TEXT NOT NULL,
    discursive_group TEXT NOT NULL,
    discipline_code TEXT NOT NULL REFERENCES disciplines(code),
    item_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    referenced_norms TEXT NOT NULL DEFAULT '',
    source_page INTEGER,
    source_url TEXT NOT NULL,
    source_version TEXT NOT NULL,
    evidence_status TEXT NOT NULL,
    canonical_hash TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    UNIQUE(discipline_code, item_number)
);

CREATE TABLE IF NOT EXISTS topic_progress (
    topic_id TEXT PRIMARY KEY REFERENCES program_topics(id) ON DELETE CASCADE,
    study_status TEXT NOT NULL DEFAULT 'NAO_INICIADO',
    priority TEXT NOT NULL DEFAULT 'MEDIA',
    mastery INTEGER,
    questions_done INTEGER NOT NULL DEFAULT 0,
    correct_answers INTEGER NOT NULL DEFAULT 0,
    last_review TEXT,
    next_review TEXT,
    notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    CHECK (mastery IS NULL OR mastery BETWEEN 0 AND 5),
    CHECK (questions_done >= 0),
    CHECK (correct_answers >= 0 AND correct_answers <= questions_done)
);

CREATE TABLE IF NOT EXISTS jurisprudence_sources (
    id TEXT PRIMARY KEY,
    court TEXT NOT NULL,
    name TEXT NOT NULL,
    source_kind TEXT NOT NULL,
    url TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    update_interval_minutes INTEGER NOT NULL DEFAULT 720,
    parser_version TEXT NOT NULL DEFAULT '1',
    last_checked_at TEXT,
    last_success_at TEXT,
    last_error TEXT,
    etag TEXT,
    last_modified TEXT
);

CREATE TABLE IF NOT EXISTS jurisprudence_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT NOT NULL REFERENCES jurisprudence_sources(id),
    external_id TEXT NOT NULL,
    issue_number TEXT,
    title TEXT NOT NULL,
    published_at TEXT,
    source_url TEXT NOT NULL,
    summary TEXT NOT NULL DEFAULT '',
    content_hash TEXT NOT NULL,
    source_status TEXT NOT NULL DEFAULT 'FONTE_INSTITUCIONAL',
    editorial_status TEXT NOT NULL DEFAULT 'IMPORTADO',
    detected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE(source_id, external_id)
);

CREATE TABLE IF NOT EXISTS jurisprudence_topic_links (
    jurisprudence_item_id INTEGER NOT NULL REFERENCES jurisprudence_items(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES program_topics(id) ON DELETE CASCADE,
    confidence REAL,
    method TEXT NOT NULL DEFAULT 'MANUAL',
    validated INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (jurisprudence_item_id, topic_id)
);

CREATE TABLE IF NOT EXISTS jurisprudence_progress (
    jurisprudence_item_id INTEGER PRIMARY KEY REFERENCES jurisprudence_items(id) ON DELETE CASCADE,
    study_status TEXT NOT NULL DEFAULT 'NAO_LIDO',
    priority TEXT NOT NULL DEFAULT 'MEDIA',
    notes TEXT NOT NULL DEFAULT '',
    last_review TEXT,
    next_review TEXT,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS update_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id TEXT REFERENCES jurisprudence_sources(id),
    started_at TEXT NOT NULL,
    finished_at TEXT,
    status TEXT NOT NULL,
    detected_count INTEGER NOT NULL DEFAULT 0,
    imported_count INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS study_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    event_type TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    occurred_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS backup_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    file_name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    file_hash TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    verified_at TEXT,
    message TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS question_sources (
    id TEXT PRIMARY KEY,
    institution TEXT NOT NULL,
    contest TEXT NOT NULL,
    year INTEGER,
    document_title TEXT NOT NULL,
    document_kind TEXT NOT NULL,
    source_url TEXT NOT NULL,
    evidence_status TEXT NOT NULL DEFAULT 'CONFIRMADO',
    curation_note TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    imported_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
    id TEXT PRIMARY KEY,
    source_id TEXT REFERENCES question_sources(id),
    discipline_code TEXT NOT NULL REFERENCES disciplines(code),
    exam_reference TEXT NOT NULL DEFAULT '',
    exam_year INTEGER,
    booklet TEXT NOT NULL DEFAULT '',
    question_number TEXT NOT NULL DEFAULT '',
    question_type TEXT NOT NULL DEFAULT 'MULTIPLA_ESCOLHA_AE',
    stem TEXT NOT NULL,
    correct_option TEXT,
    explanation TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    source_page INTEGER,
    authorship_type TEXT NOT NULL DEFAULT 'HUMANA',
    ai_model TEXT NOT NULL DEFAULT '',
    ai_prompt_version TEXT NOT NULL DEFAULT '',
    validation_status TEXT NOT NULL DEFAULT 'NAO_APLICAVEL',
    official_reference TEXT NOT NULL DEFAULT '',
    validated_at TEXT,
    validation_note TEXT NOT NULL DEFAULT '',
    rights_status TEXT NOT NULL DEFAULT 'PENDENTE',
    editorial_status TEXT NOT NULL DEFAULT 'EM_REVISAO',
    canonical_hash TEXT NOT NULL,
    imported_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (correct_option IS NULL OR correct_option IN ('A', 'B', 'C', 'D', 'E')),
    CHECK (authorship_type IN ('HUMANA', 'IA', 'OFICIAL_IMPORTADA')),
    CHECK (validation_status IN (
        'NAO_APLICAVEL', 'PENDENTE_FONTE', 'VALIDACAO_PARCIAL',
        'VALIDADA_FONTE', 'REJEITADA', 'DESATUALIZADA'
    ))
);

CREATE TABLE IF NOT EXISTS question_options (
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    option_key TEXT NOT NULL,
    option_text TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    PRIMARY KEY (question_id, option_key),
    CHECK (option_key IN ('A', 'B', 'C', 'D', 'E'))
);

CREATE TABLE IF NOT EXISTS question_topic_links (
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    topic_id TEXT NOT NULL REFERENCES program_topics(id) ON DELETE CASCADE,
    is_primary INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    PRIMARY KEY (question_id, topic_id)
);

CREATE TABLE IF NOT EXISTS quiz_sessions (
    id TEXT PRIMARY KEY,
    session_kind TEXT NOT NULL,
    title TEXT NOT NULL,
    objective_group TEXT,
    discipline_code TEXT REFERENCES disciplines(code),
    status TEXT NOT NULL DEFAULT 'EM_ANDAMENTO',
    question_count INTEGER NOT NULL,
    answered_count INTEGER NOT NULL DEFAULT 0,
    correct_count INTEGER NOT NULL DEFAULT 0,
    is_experimental INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    CHECK (session_kind IN ('PRATICA', 'SIMULADO_GRUPO', 'SIMULADO_COMPLETO')),
    CHECK (status IN ('EM_ANDAMENTO', 'FINALIZADO', 'ABANDONADO')),
    CHECK (question_count > 0),
    CHECK (answered_count BETWEEN 0 AND question_count),
    CHECK (correct_count BETWEEN 0 AND answered_count),
    CHECK (is_experimental IN (0, 1))
);

CREATE TABLE IF NOT EXISTS quiz_session_questions (
    session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
    question_id TEXT NOT NULL REFERENCES questions(id),
    position INTEGER NOT NULL,
    stem_snapshot TEXT NOT NULL,
    options_json TEXT NOT NULL,
    correct_option_snapshot TEXT NOT NULL,
    explanation_snapshot TEXT NOT NULL DEFAULT '',
    topic_ids_json TEXT NOT NULL DEFAULT '[]',
    authorship_type_snapshot TEXT NOT NULL DEFAULT 'HUMANA',
    validation_status_snapshot TEXT NOT NULL DEFAULT 'NAO_APLICAVEL',
    source_url_snapshot TEXT NOT NULL DEFAULT '',
    official_reference_snapshot TEXT NOT NULL DEFAULT '',
    selected_option TEXT,
    confidence TEXT,
    elapsed_seconds INTEGER,
    is_correct INTEGER,
    answered_at TEXT,
    PRIMARY KEY (session_id, question_id),
    UNIQUE (session_id, position),
    CHECK (selected_option IS NULL OR selected_option IN ('A', 'B', 'C', 'D', 'E')),
    CHECK (confidence IS NULL OR confidence IN ('CERTEZA', 'DUVIDA', 'CHUTE')),
    CHECK (elapsed_seconds IS NULL OR elapsed_seconds >= 0)
);

CREATE TABLE IF NOT EXISTS question_reports (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
    session_id TEXT REFERENCES quiz_sessions(id) ON DELETE SET NULL,
    category TEXT NOT NULL,
    description TEXT NOT NULL,
    evidence_url TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'ABERTO',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (category IN ('GABARITO', 'ENUNCIADO', 'ALTERNATIVA', 'FONTE', 'DESATUALIZACAO', 'OUTRO')),
    CHECK (status IN ('ABERTO', 'EM_ANALISE', 'CONFIRMADO', 'DESCARTADO', 'CORRIGIDO'))
);

CREATE TABLE IF NOT EXISTS study_diagnostic (
    id TEXT PRIMARY KEY,
    experience_level TEXT NOT NULL DEFAULT 'INTERMEDIARIO',
    preferred_shift TEXT NOT NULL DEFAULT 'FLEXIVEL',
    session_minutes INTEGER NOT NULL DEFAULT 50,
    horizon_days INTEGER NOT NULL DEFAULT 28,
    weekday_minutes_json TEXT NOT NULL,
    content_weights_json TEXT NOT NULL,
    group_weights_json TEXT NOT NULL,
    completed INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    CHECK (experience_level IN ('INICIANTE', 'INTERMEDIARIO', 'AVANCADO')),
    CHECK (preferred_shift IN ('MANHA', 'TARDE', 'NOITE', 'FLEXIVEL')),
    CHECK (session_minutes BETWEEN 20 AND 120),
    CHECK (horizon_days BETWEEN 7 AND 84),
    CHECK (completed IN (0, 1))
);

CREATE TABLE IF NOT EXISTS study_plan_runs (
    id TEXT PRIMARY KEY,
    start_date TEXT NOT NULL,
    end_date TEXT NOT NULL,
    horizon_days INTEGER NOT NULL,
    total_minutes INTEGER NOT NULL,
    diagnostic_hash TEXT NOT NULL,
    adjustments_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'ATIVO',
    generated_at TEXT NOT NULL,
    CHECK (horizon_days BETWEEN 1 AND 84),
    CHECK (total_minutes >= 0),
    CHECK (status IN ('ATIVO', 'SUBSTITUIDO'))
);

CREATE TABLE IF NOT EXISTS study_plan_entries (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES study_plan_runs(id) ON DELETE CASCADE,
    scheduled_date TEXT NOT NULL,
    position INTEGER NOT NULL,
    content_type TEXT NOT NULL,
    objective_group TEXT,
    discipline_code TEXT REFERENCES disciplines(code),
    topic_id TEXT REFERENCES program_topics(id),
    entity_id TEXT,
    title TEXT NOT NULL,
    duration_minutes INTEGER NOT NULL,
    completed_minutes INTEGER NOT NULL DEFAULT 0,
    rationale TEXT NOT NULL DEFAULT '',
    legislation_json TEXT NOT NULL DEFAULT '[]',
    legislation_status TEXT NOT NULL DEFAULT 'PENDENTE_MAPEAMENTO',
    legislation_note TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'PLANEJADO',
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (content_type IN ('LEITURA', 'QUESTOES', 'JURISPRUDENCIA', 'REVISAO', 'DISCURSIVA', 'SIMULADO')),
    CHECK (legislation_status IN ('MAPEADO_PENDENTE_VALIDACAO', 'VALIDADO', 'SEM_DISPOSITIVO_ESPECIFICO', 'PENDENTE_MAPEAMENTO', 'NAO_APLICAVEL')),
    CHECK (objective_group IS NULL OR objective_group IN ('I', 'II', 'III', 'IV')),
    CHECK (duration_minutes BETWEEN 10 AND 240),
    CHECK (completed_minutes BETWEEN 0 AND 1440),
    CHECK (status IN ('PLANEJADO', 'CONCLUIDO', 'PULADO')),
    UNIQUE(run_id, scheduled_date, position)
);

CREATE TABLE IF NOT EXISTS topic_legislation_readings (
    id TEXT PRIMARY KEY,
    topic_id TEXT NOT NULL REFERENCES program_topics(id) ON DELETE CASCADE,
    norm_code TEXT NOT NULL,
    norm_name TEXT NOT NULL,
    article_reference TEXT NOT NULL,
    source_url TEXT NOT NULL,
    map_version TEXT NOT NULL,
    mapping_method TEXT NOT NULL DEFAULT 'IA_ASSISTIDA',
    validation_status TEXT NOT NULL DEFAULT 'PENDENTE_VALIDACAO',
    sort_order INTEGER NOT NULL DEFAULT 1,
    canonical_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (mapping_method IN ('IA_ASSISTIDA', 'HUMANA', 'EXTRACAO_OFICIAL')),
    CHECK (validation_status IN ('PENDENTE_VALIDACAO', 'VALIDADA_FONTE', 'REJEITADA', 'DESATUALIZADA')),
    UNIQUE(topic_id, norm_code, article_reference)
);

CREATE TABLE IF NOT EXISTS review_state (
    topic_id TEXT PRIMARY KEY REFERENCES program_topics(id) ON DELETE CASCADE,
    interval_days INTEGER NOT NULL DEFAULT 0,
    ease_factor REAL NOT NULL DEFAULT 2.5,
    repetitions INTEGER NOT NULL DEFAULT 0,
    due_date TEXT NOT NULL,
    last_reviewed_at TEXT,
    last_rating TEXT,
    updated_at TEXT NOT NULL,
    CHECK (interval_days >= 0),
    CHECK (ease_factor BETWEEN 1.3 AND 3.5),
    CHECK (repetitions >= 0),
    CHECK (last_rating IS NULL OR last_rating IN ('REPETIR', 'DIFICIL', 'BOM', 'FACIL'))
);

CREATE TABLE IF NOT EXISTS discursive_prompts (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    prompt_text TEXT NOT NULL,
    objective_group TEXT,
    discipline_code TEXT REFERENCES disciplines(code),
    source_url TEXT NOT NULL DEFAULT '',
    official_reference TEXT NOT NULL DEFAULT '',
    authorship_type TEXT NOT NULL DEFAULT 'HUMANA',
    validation_status TEXT NOT NULL DEFAULT 'PENDENTE_FONTE',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (objective_group IS NULL OR objective_group IN ('I', 'II', 'III', 'IV')),
    CHECK (authorship_type IN ('HUMANA', 'IA')),
    CHECK (validation_status IN ('PENDENTE_FONTE', 'VALIDADA_FONTE', 'REJEITADA', 'DESATUALIZADA')),
    CHECK (active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS discursive_attempts (
    id TEXT PRIMARY KEY,
    prompt_id TEXT NOT NULL REFERENCES discursive_prompts(id) ON DELETE CASCADE,
    answer_text TEXT NOT NULL DEFAULT '',
    word_count INTEGER NOT NULL DEFAULT 0,
    elapsed_minutes INTEGER NOT NULL DEFAULT 0,
    self_score REAL,
    strengths TEXT NOT NULL DEFAULT '',
    improvements TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'RASCUNHO',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    completed_at TEXT,
    CHECK (word_count >= 0),
    CHECK (elapsed_minutes BETWEEN 0 AND 1440),
    CHECK (self_score IS NULL OR self_score BETWEEN 0 AND 10),
    CHECK (status IN ('RASCUNHO', 'CONCLUIDA'))
);

CREATE INDEX IF NOT EXISTS idx_topics_discipline ON program_topics(discipline_code, item_number);
CREATE INDEX IF NOT EXISTS idx_progress_status ON topic_progress(study_status, priority);
CREATE INDEX IF NOT EXISTS idx_juris_source_date ON jurisprudence_items(source_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_juris_editorial ON jurisprudence_items(editorial_status, detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_events_entity ON study_events(entity_type, entity_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_questions_discipline ON questions(discipline_code, editorial_status);
CREATE INDEX IF NOT EXISTS idx_questions_source ON questions(source_id, exam_year, question_number);
CREATE INDEX IF NOT EXISTS idx_question_topics ON question_topic_links(topic_id, question_id);
CREATE INDEX IF NOT EXISTS idx_quiz_sessions_status ON quiz_sessions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quiz_questions_answer ON quiz_session_questions(question_id, answered_at DESC);
CREATE INDEX IF NOT EXISTS idx_question_reports_status ON question_reports(question_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_plan_entries_date ON study_plan_entries(run_id, scheduled_date, position);
CREATE INDEX IF NOT EXISTS idx_plan_entries_status ON study_plan_entries(status, scheduled_date);
CREATE INDEX IF NOT EXISTS idx_legislation_topic ON topic_legislation_readings(topic_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_review_due ON review_state(due_date, topic_id);
CREATE INDEX IF NOT EXISTS idx_discursive_attempts_prompt ON discursive_attempts(prompt_id, updated_at DESC);
