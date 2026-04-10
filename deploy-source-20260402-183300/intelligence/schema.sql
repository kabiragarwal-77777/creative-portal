-- Intelligence Module Schema
-- All tables use CREATE TABLE IF NOT EXISTS for idempotent initialization

-- ============================================================
-- Raw data tables (populated by dataAgent)
-- ============================================================

CREATE TABLE IF NOT EXISTS raw_creatives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creative_name TEXT,
    ad_id TEXT,
    campaign_name TEXT,
    adset_name TEXT,
    spend REAL,
    impressions INTEGER,
    clicks INTEGER,
    installs INTEGER,
    signups INTEGER,
    d0_trial INTEGER,
    d6 INTEGER,
    d6_cac REAL,
    d6_roas REAL,
    cpi REAL,
    cpc REAL,
    ctr REAL,
    live_status TEXT,
    creative_type TEXT,
    platform TEXT,
    date_from TEXT,
    date_to TEXT,
    raw_json TEXT,
    fetched_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS raw_meta_dump (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_name TEXT,
    adset_name TEXT,
    ad_name TEXT,
    ad_id TEXT,
    campaign_id TEXT,
    adset_id TEXT,
    spend REAL,
    impressions INTEGER,
    clicks INTEGER,
    installs INTEGER,
    date TEXT,
    raw_json TEXT,
    fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS raw_metabase (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_name TEXT,
    adset_name TEXT,
    ad_name TEXT,
    signups INTEGER,
    d0_trial INTEGER,
    d6 INTEGER,
    revenue REAL,
    ltv_estimate REAL,
    date TEXT,
    raw_json TEXT,
    fetched_at TEXT
);

CREATE TABLE IF NOT EXISTS data_fetch_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    fetch_type TEXT,
    rows_fetched INTEGER,
    rows_changed INTEGER,
    status TEXT,
    error_message TEXT,
    fetched_at TEXT DEFAULT (datetime('now'))
);

-- ============================================================
-- AI analysis tables
-- ============================================================

CREATE TABLE IF NOT EXISTS ai_insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    insight_type TEXT,
    category TEXT,
    finding TEXT,
    evidence TEXT,
    confidence REAL,
    action TEXT,
    impact TEXT,
    is_read INTEGER DEFAULT 0,
    generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS creative_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creative_name TEXT,
    ad_id TEXT,
    cps_score REAL,
    roas_component REAL,
    d6_component REAL,
    signup_component REAL,
    cpi_component REAL,
    percentile_rank REAL,
    calculated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS creative_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creative_name TEXT,
    ad_id TEXT,
    format TEXT,
    color_temperature TEXT,
    dominant_colors TEXT,
    has_human_face INTEGER,
    face_is_relatable INTEGER,
    has_chart INTEGER,
    text_density REAL,
    hook_type TEXT,
    tone TEXT,
    primary_emotion TEXT,
    has_specific_number INTEGER,
    number_mentioned TEXT,
    has_sebi_mention INTEGER,
    social_proof_type TEXT,
    cta_clarity REAL,
    message_clarity REAL,
    promise_made TEXT,
    why_it_works TEXT,
    why_it_fails TEXT,
    strongest_element TEXT,
    weakest_element TEXT,
    improvement_priority TEXT,
    analyzed_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS pattern_library (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_name TEXT,
    signal_combination TEXT,
    avg_cps REAL,
    avg_d6_roas REAL,
    sample_count INTEGER,
    confidence REAL,
    best_example_ad_id TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ltv_predictions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creative_name TEXT,
    ad_id TEXT,
    days_live_at_prediction INTEGER,
    predicted_roas_30d REAL,
    predicted_roas_60d REAL,
    predicted_roas_90d REAL,
    predicted_roas_365d REAL,
    predicted_ltv_per_user REAL,
    confidence_30d REAL,
    confidence_60d REAL,
    confidence_90d REAL,
    actual_roas_30d REAL,
    actual_roas_60d REAL,
    actual_roas_90d REAL,
    recommended_action TEXT,
    recommended_budget REAL,
    reasoning_30d TEXT,
    reasoning_60d TEXT,
    reasoning_90d TEXT,
    archetype_used TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS ltv_cohorts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_name TEXT,
    adset_name TEXT,
    period_start TEXT,
    period_end TEXT,
    total_spend REAL,
    installs INTEGER,
    signups INTEGER,
    d0_trial INTEGER,
    d6_conversions INTEGER,
    d6_rate REAL,
    d6_roas REAL,
    implied_ltv_30d REAL,
    implied_ltv_90d REAL,
    calculated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS creative_briefs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT,
    format TEXT,
    archetype TEXT,
    hypothesis TEXT,
    hook_json TEXT,
    script_text TEXT,
    visual_direction_json TEXT,
    predicted_cpi_low REAL,
    predicted_cpi_high REAL,
    predicted_d6_roas_low REAL,
    predicted_d6_roas_high REAL,
    test_budget REAL,
    success_threshold TEXT,
    data_basis TEXT,
    is_actioned INTEGER DEFAULT 0,
    generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS revamp_suggestions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad_id TEXT,
    creative_name TEXT,
    option_number INTEGER,
    change_description TEXT,
    current_state TEXT,
    new_state TEXT,
    rationale TEXT,
    predicted_improvement TEXT,
    is_actioned INTEGER DEFAULT 0,
    generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS scheduler_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_name TEXT,
    status TEXT,
    started_at TEXT,
    completed_at TEXT,
    duration_ms INTEGER,
    error_message TEXT,
    rows_affected INTEGER
);

-- ============================================================
-- UNIQUE constraints
-- ============================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_creatives_name ON raw_creatives(creative_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_scores_ad_id ON creative_scores(ad_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_creative_signals_ad_id ON creative_signals(ad_id);

-- ============================================================
-- Indexes on frequently queried columns
-- ============================================================

-- raw_creatives
CREATE INDEX IF NOT EXISTS idx_raw_creatives_ad_id ON raw_creatives(ad_id);
CREATE INDEX IF NOT EXISTS idx_raw_creatives_campaign ON raw_creatives(campaign_name);
CREATE INDEX IF NOT EXISTS idx_raw_creatives_status ON raw_creatives(live_status);
CREATE INDEX IF NOT EXISTS idx_raw_creatives_spend ON raw_creatives(spend);
CREATE INDEX IF NOT EXISTS idx_raw_creatives_d6_roas ON raw_creatives(d6_roas);
CREATE INDEX IF NOT EXISTS idx_raw_creatives_fetched ON raw_creatives(fetched_at);

-- raw_meta_dump
CREATE INDEX IF NOT EXISTS idx_raw_meta_dump_ad_id ON raw_meta_dump(ad_id);
CREATE INDEX IF NOT EXISTS idx_raw_meta_dump_campaign ON raw_meta_dump(campaign_name);
CREATE INDEX IF NOT EXISTS idx_raw_meta_dump_date ON raw_meta_dump(date);

-- raw_metabase
CREATE INDEX IF NOT EXISTS idx_raw_metabase_ad_name ON raw_metabase(ad_name);
CREATE INDEX IF NOT EXISTS idx_raw_metabase_date ON raw_metabase(date);

-- data_fetch_log
CREATE INDEX IF NOT EXISTS idx_data_fetch_log_type ON data_fetch_log(fetch_type);
CREATE INDEX IF NOT EXISTS idx_data_fetch_log_status ON data_fetch_log(status);

-- ai_insights
CREATE INDEX IF NOT EXISTS idx_ai_insights_type ON ai_insights(insight_type);
CREATE INDEX IF NOT EXISTS idx_ai_insights_category ON ai_insights(category);
CREATE INDEX IF NOT EXISTS idx_ai_insights_unread ON ai_insights(is_read);
CREATE INDEX IF NOT EXISTS idx_ai_insights_generated ON ai_insights(generated_at);

-- creative_scores
CREATE INDEX IF NOT EXISTS idx_creative_scores_cps ON creative_scores(cps_score);
CREATE INDEX IF NOT EXISTS idx_creative_scores_percentile ON creative_scores(percentile_rank);

-- creative_signals
CREATE INDEX IF NOT EXISTS idx_creative_signals_format ON creative_signals(format);
CREATE INDEX IF NOT EXISTS idx_creative_signals_hook ON creative_signals(hook_type);

-- pattern_library
CREATE INDEX IF NOT EXISTS idx_pattern_library_cps ON pattern_library(avg_cps);
CREATE INDEX IF NOT EXISTS idx_pattern_library_confidence ON pattern_library(confidence);

-- ltv_predictions
CREATE INDEX IF NOT EXISTS idx_ltv_predictions_ad_id ON ltv_predictions(ad_id);
CREATE INDEX IF NOT EXISTS idx_ltv_predictions_action ON ltv_predictions(recommended_action);

-- ltv_cohorts
CREATE INDEX IF NOT EXISTS idx_ltv_cohorts_campaign ON ltv_cohorts(campaign_name);
CREATE INDEX IF NOT EXISTS idx_ltv_cohorts_period ON ltv_cohorts(period_start, period_end);

-- creative_briefs
CREATE INDEX IF NOT EXISTS idx_creative_briefs_archetype ON creative_briefs(archetype);
CREATE INDEX IF NOT EXISTS idx_creative_briefs_actioned ON creative_briefs(is_actioned);

-- revamp_suggestions
CREATE INDEX IF NOT EXISTS idx_revamp_suggestions_ad_id ON revamp_suggestions(ad_id);
CREATE INDEX IF NOT EXISTS idx_revamp_suggestions_actioned ON revamp_suggestions(is_actioned);

-- scheduler_log
CREATE INDEX IF NOT EXISTS idx_scheduler_log_job ON scheduler_log(job_name);
CREATE INDEX IF NOT EXISTS idx_scheduler_log_status ON scheduler_log(status);
CREATE INDEX IF NOT EXISTS idx_scheduler_log_started ON scheduler_log(started_at);
