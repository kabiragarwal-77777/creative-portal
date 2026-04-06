-- ============================================================================
-- Feedback Engine Schema — all tables prefixed fe_
-- Separate DB file: feedback-engine.db
-- ============================================================================

CREATE TABLE IF NOT EXISTS fe_prediction_accuracy (
    id INTEGER PRIMARY KEY ,
    source TEXT NOT NULL CHECK(source IN ('meta','google')),
    simulation_id TEXT,
    ad_id TEXT,
    ad_name TEXT,
    predicted_roas_d7 REAL,
    predicted_roas_d30 REAL,
    predicted_roas_d60 REAL,
    actual_roas_d7 REAL,
    actual_roas_d30 REAL,
    actual_roas_d60 REAL,
    error_d7 REAL,
    error_d30 REAL,
    error_d60 REAL,
    accuracy_tag TEXT CHECK(accuracy_tag IN ('overestimate','accurate','underestimate')),
    checked_at TEXT,
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS fe_recommendation_tracking (
    id INTEGER PRIMARY KEY ,
    source TEXT NOT NULL CHECK(source IN ('meta','google','competitor')),
    brief_id TEXT,
    brief_type TEXT,
    brief_theme TEXT,
    generated_at TEXT,
    adoption_status TEXT DEFAULT 'unknown' CHECK(adoption_status IN ('adopted','ignored','unknown')),
    evidence_ad_id TEXT,
    checked_at TEXT
);

CREATE TABLE IF NOT EXISTS fe_competitor_signal_accuracy (
    id INTEGER PRIMARY KEY ,
    insight_id TEXT,
    opportunity_type TEXT,
    predicted_at TEXT,
    verification_date TEXT,
    materialized TEXT DEFAULT 'unknown' CHECK(materialized IN ('true','false','unknown')),
    univest_ctr_before REAL,
    univest_ctr_after REAL,
    notes TEXT
);

CREATE TABLE IF NOT EXISTS fe_knowledge_items (
    id INTEGER PRIMARY KEY ,
    source_type TEXT,
    source_url TEXT,
    source_name TEXT,
    content_hash TEXT UNIQUE,
    raw_content_preview TEXT,
    signal_type TEXT,
    relevance_score REAL,
    key_insight TEXT,
    action_implication TEXT,
    urgency TEXT DEFAULT 'low' CHECK(urgency IN ('high','medium','low')),
    is_processed INTEGER DEFAULT 0,
    ingested_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS fe_knowledge_sources (
    id INTEGER PRIMARY KEY ,
    source_name TEXT NOT NULL,
    source_url TEXT NOT NULL,
    source_type TEXT,
    crawl_frequency_hours INTEGER DEFAULT 6,
    last_crawled_at TEXT,
    last_item_count INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    added_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS fe_audit_reports (
    id INTEGER PRIMARY KEY ,
    audit_date TEXT,
    meta_accuracy_pct REAL,
    google_accuracy_pct REAL,
    signal_analysis_json TEXT,
    current_weights_json TEXT,
    proposed_weights_json TEXT,
    backtest_improvement_pct REAL,
    proposals_generated INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS fe_hypotheses (
    id INTEGER PRIMARY KEY ,
    hypothesis_text TEXT NOT NULL,
    type TEXT CHECK(type IN ('creative','timing','competitor')),
    test_method TEXT,
    success_metric TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','testing','completed','rejected')),
    generated_at TEXT DEFAULT (CURRENT_TIMESTAMP),
    tested_at TEXT
);

CREATE TABLE IF NOT EXISTS fe_hypothesis_tests (
    id INTEGER PRIMARY KEY ,
    hypothesis_id INTEGER REFERENCES fe_hypotheses(id),
    test_method TEXT,
    data_used_json TEXT,
    result TEXT CHECK(result IN ('supported','rejected','inconclusive')),
    confidence_pct REAL,
    effect_size REAL,
    evidence_summary TEXT,
    completed_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS fe_proposals (
    id INTEGER PRIMARY KEY ,
    proposal_type TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    rationale TEXT,
    evidence_json TEXT,
    expected_impact_metric TEXT,
    expected_impact_delta REAL,
    risk_level TEXT DEFAULT 'low' CHECK(risk_level IN ('low','medium','high')),
    is_reversible INTEGER DEFAULT 1,
    dependencies_json TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','applied','expired')),
    generated_by_agent TEXT,
    generated_at TEXT DEFAULT (CURRENT_TIMESTAMP),
    reviewed_at TEXT,
    reviewed_by TEXT,
    applied_at TEXT,
    rollback_available INTEGER DEFAULT 0,
    expires_at TEXT
);

CREATE TABLE IF NOT EXISTS fe_rollback_snapshots (
    id INTEGER PRIMARY KEY ,
    proposal_id INTEGER REFERENCES fe_proposals(id),
    snapshot_type TEXT,
    snapshot_data_json TEXT,
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS fe_change_log (
    id INTEGER PRIMARY KEY ,
    proposal_id INTEGER REFERENCES fe_proposals(id),
    change_type TEXT,
    change_description TEXT,
    before_state_json TEXT,
    after_state_json TEXT,
    applied_at TEXT DEFAULT (CURRENT_TIMESTAMP),
    verification_scheduled_at TEXT,
    verification_result TEXT,
    was_rolled_back INTEGER DEFAULT 0,
    rolled_back_at TEXT
);

CREATE TABLE IF NOT EXISTS fe_memory_episodic (
    id INTEGER PRIMARY KEY ,
    event_date TEXT,
    context_type TEXT,
    market_condition TEXT,
    observation TEXT NOT NULL,
    confidence_pct REAL,
    supporting_evidence_json TEXT,
    supporting_ad_ids TEXT,
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP),
    last_validated TEXT
);

CREATE TABLE IF NOT EXISTS fe_memory_semantic (
    id INTEGER PRIMARY KEY ,
    rule_text TEXT NOT NULL,
    category TEXT,
    confidence_pct REAL DEFAULT 50,
    evidence_count INTEGER DEFAULT 1,
    evidence_summary TEXT,
    first_observed TEXT DEFAULT (CURRENT_TIMESTAMP),
    last_validated TEXT,
    is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS fe_memory_procedural (
    id INTEGER PRIMARY KEY ,
    change_type TEXT,
    description TEXT NOT NULL,
    outcome TEXT,
    metric_before REAL,
    metric_after REAL,
    improvement_pct REAL,
    applied_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS fe_anomalies (
    id INTEGER PRIMARY KEY ,
    anomaly_type TEXT NOT NULL,
    severity TEXT DEFAULT 'info' CHECK(severity IN ('critical','warning','info')),
    title TEXT NOT NULL,
    description TEXT,
    detected_value REAL,
    expected_value REAL,
    threshold_violated TEXT,
    is_resolved INTEGER DEFAULT 0,
    resolved_at TEXT,
    proposal_id_generated INTEGER,
    detected_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS fe_data_quality_runs (
    id INTEGER PRIMARY KEY ,
    run_scope TEXT DEFAULT 'all',
    overall_status TEXT DEFAULT 'OK',
    summary_json TEXT,
    checks_run INTEGER DEFAULT 0,
    findings_count INTEGER DEFAULT 0,
    critical_count INTEGER DEFAULT 0,
    warning_count INTEGER DEFAULT 0,
    info_count INTEGER DEFAULT 0,
    started_at TEXT DEFAULT (CURRENT_TIMESTAMP),
    completed_at TEXT,
    duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS fe_data_quality_findings (
    id INTEGER PRIMARY KEY ,
    run_id INTEGER REFERENCES fe_data_quality_runs(id),
    source TEXT NOT NULL,
    check_name TEXT NOT NULL,
    status TEXT DEFAULT 'OK',
    severity TEXT DEFAULT 'info' CHECK(severity IN ('critical','warning','info')),
    title TEXT NOT NULL,
    message TEXT,
    detected_value REAL,
    expected_value REAL,
    meta_json TEXT,
    created_at TEXT DEFAULT (CURRENT_TIMESTAMP)
);

CREATE TABLE IF NOT EXISTS fe_scheduler_log (
    id INTEGER PRIMARY KEY ,
    job_name TEXT NOT NULL,
    started_at TEXT DEFAULT (CURRENT_TIMESTAMP),
    completed_at TEXT,
    duration_ms INTEGER,
    records_processed INTEGER DEFAULT 0,
    errors TEXT,
    status TEXT DEFAULT 'running' CHECK(status IN ('running','completed','failed'))
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_fe_pa_source ON fe_prediction_accuracy(source);
CREATE INDEX IF NOT EXISTS idx_fe_pa_tag ON fe_prediction_accuracy(accuracy_tag);
CREATE INDEX IF NOT EXISTS idx_fe_ki_urgency ON fe_knowledge_items(urgency);
CREATE INDEX IF NOT EXISTS idx_fe_ki_hash ON fe_knowledge_items(content_hash);
CREATE INDEX IF NOT EXISTS idx_fe_proposals_status ON fe_proposals(status);
CREATE INDEX IF NOT EXISTS idx_fe_proposals_type ON fe_proposals(proposal_type);
CREATE INDEX IF NOT EXISTS idx_fe_anomalies_severity ON fe_anomalies(severity);
CREATE INDEX IF NOT EXISTS idx_fe_anomalies_resolved ON fe_anomalies(is_resolved);
CREATE INDEX IF NOT EXISTS idx_fe_dq_runs_started ON fe_data_quality_runs(started_at);
CREATE INDEX IF NOT EXISTS idx_fe_dq_findings_run ON fe_data_quality_findings(run_id);
CREATE INDEX IF NOT EXISTS idx_fe_dq_findings_source ON fe_data_quality_findings(source);
CREATE INDEX IF NOT EXISTS idx_fe_dq_findings_severity ON fe_data_quality_findings(severity);
CREATE INDEX IF NOT EXISTS idx_fe_sched_job ON fe_scheduler_log(job_name);
