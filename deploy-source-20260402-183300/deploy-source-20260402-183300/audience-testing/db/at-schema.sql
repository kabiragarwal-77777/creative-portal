CREATE TABLE IF NOT EXISTS at_meta_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meta_campaign_id TEXT UNIQUE NOT NULL,
    name TEXT,
    objective TEXT,
    status TEXT,
    vertical TEXT DEFAULT 'Unknown',
    daily_budget REAL DEFAULT 0,
    lifetime_budget REAL DEFAULT 0,
    start_time TEXT,
    stop_time TEXT,
    total_spend REAL DEFAULT 0,
    total_impressions INTEGER DEFAULT 0,
    total_clicks INTEGER DEFAULT 0,
    synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS at_meta_adsets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meta_adset_id TEXT UNIQUE NOT NULL,
    meta_campaign_id TEXT,
    name TEXT,
    status TEXT,
    optimization_goal TEXT,
    bid_strategy TEXT,
    daily_budget REAL DEFAULT 0,
    lifetime_budget REAL DEFAULT 0,
    age_min INTEGER DEFAULT 18,
    age_max INTEGER DEFAULT 65,
    genders_json TEXT DEFAULT '[]',
    geo_locations_json TEXT DEFAULT '[]',
    interests_json TEXT DEFAULT '[]',
    behaviors_json TEXT DEFAULT '[]',
    custom_audiences_json TEXT DEFAULT '[]',
    lookalike_audiences_json TEXT DEFAULT '[]',
    excluded_audiences_json TEXT DEFAULT '[]',
    device_platforms_json TEXT DEFAULT '[]',
    publisher_platforms_json TEXT DEFAULT '[]',
    facebook_positions_json TEXT DEFAULT '[]',
    instagram_positions_json TEXT DEFAULT '[]',
    is_broad INTEGER DEFAULT 0,
    is_advantage_plus INTEGER DEFAULT 0,
    total_spend REAL DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    reach INTEGER DEFAULT 0,
    frequency REAL DEFAULT 0,
    cpm REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpp REAL DEFAULT 0,
    installs INTEGER DEFAULT 0,
    signups INTEGER DEFAULT 0,
    d0_conversions INTEGER DEFAULT 0,
    metabase_signups INTEGER DEFAULT 0,
    d0_revenue REAL DEFAULT 0,
    d6_conversions INTEGER DEFAULT 0,
    d6_revenue REAL DEFAULT 0,
    d6_cac REAL,
    d6_roas REAL,
    d0_cvr_pct REAL,
    d6_cvr_pct REAL,
    d30_conversions INTEGER DEFAULT 0,
    d30_revenue REAL DEFAULT 0,
    synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS at_meta_breakdowns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adset_id TEXT NOT NULL,
    breakdown_type TEXT NOT NULL,
    breakdown_value TEXT,
    spend REAL DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpm REAL DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS at_google_campaigns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_campaign_id TEXT UNIQUE NOT NULL,
    name TEXT,
    status TEXT,
    channel_type TEXT,
    vertical TEXT DEFAULT 'Unknown',
    bidding_strategy TEXT,
    target_cpa REAL,
    target_roas REAL,
    total_spend REAL DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    conversions REAL DEFAULT 0,
    conversion_value REAL DEFAULT 0,
    synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS at_google_adgroups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    google_adgroup_id TEXT UNIQUE NOT NULL,
    google_campaign_id TEXT,
    name TEXT,
    status TEXT,
    adgroup_type TEXT,
    cpc_bid REAL,
    target_cpa REAL,
    total_spend REAL DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    conversions REAL DEFAULT 0,
    conversion_value REAL DEFAULT 0,
    ctr REAL DEFAULT 0,
    avg_cpc REAL DEFAULT 0,
    cost_per_conversion REAL,
    d6_cac REAL,
    d6_roas REAL,
    d6_conversions INTEGER DEFAULT 0,
    d6_revenue REAL DEFAULT 0,
    metabase_signups INTEGER DEFAULT 0,
    synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS at_google_audiences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adgroup_id TEXT NOT NULL,
    criterion_type TEXT,
    audience_name TEXT,
    audience_id TEXT,
    bid_modifier REAL,
    age_range TEXT,
    gender TEXT,
    device_type TEXT,
    spend REAL DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    conversions REAL DEFAULT 0,
    synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS at_google_breakdowns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    adgroup_id TEXT NOT NULL,
    breakdown_type TEXT NOT NULL,
    breakdown_value TEXT,
    spend REAL DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    conversions REAL DEFAULT 0,
    ctr REAL DEFAULT 0,
    synced_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS at_meta_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type TEXT,
    pattern_key TEXT,
    pattern_value_json TEXT,
    avg_d6_cac REAL,
    avg_d6_roas REAL,
    avg_d6_cvr REAL,
    total_spend REAL DEFAULT 0,
    sample_adsets INTEGER DEFAULT 0,
    sample_conversions INTEGER DEFAULT 0,
    confidence TEXT DEFAULT 'LOW',
    synthesized_insight TEXT,
    generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS at_google_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type TEXT,
    pattern_key TEXT,
    pattern_value_json TEXT,
    avg_d6_cac REAL,
    avg_d6_roas REAL,
    avg_d6_cvr REAL,
    total_spend REAL DEFAULT 0,
    sample_adsets INTEGER DEFAULT 0,
    sample_conversions INTEGER DEFAULT 0,
    confidence TEXT DEFAULT 'LOW',
    synthesized_insight TEXT,
    generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS at_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT NOT NULL,
    rec_type TEXT NOT NULL,
    vertical TEXT,
    title TEXT,
    hypothesis TEXT,
    targeting_spec_json TEXT,
    action_type TEXT,
    rationale TEXT,
    specific_change TEXT,
    expected_impact TEXT,
    expected_d6_cac REAL,
    expected_d6_roas REAL,
    priority TEXT DEFAULT 'medium',
    urgency TEXT DEFAULT 'this_week',
    status TEXT DEFAULT 'pending',
    generated_at TEXT DEFAULT (datetime('now')),
    implemented_at TEXT,
    dismissed_reason TEXT,
    adset_id TEXT,
    adset_name TEXT,
    current_d6_cac REAL,
    current_d6_roas REAL
);

CREATE TABLE IF NOT EXISTS at_live_flags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT,
    adset_id TEXT,
    adset_name TEXT,
    flag_type TEXT,
    severity TEXT DEFAULT 'info',
    message TEXT,
    metric_value REAL,
    threshold_value REAL,
    is_resolved INTEGER DEFAULT 0,
    resolved_at TEXT,
    detected_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS at_scheduler_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type TEXT,
    status TEXT DEFAULT 'running',
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    details TEXT,
    error TEXT
);

CREATE INDEX IF NOT EXISTS idx_at_meta_adsets_campaign ON at_meta_adsets(meta_campaign_id);
CREATE INDEX IF NOT EXISTS idx_at_meta_breakdowns_adset ON at_meta_breakdowns(adset_id);
CREATE INDEX IF NOT EXISTS idx_at_google_adgroups_campaign ON at_google_adgroups(google_campaign_id);
CREATE INDEX IF NOT EXISTS idx_at_google_audiences_adgroup ON at_google_audiences(adgroup_id);
CREATE INDEX IF NOT EXISTS idx_at_recommendations_platform ON at_recommendations(platform, rec_type, status);
CREATE INDEX IF NOT EXISTS idx_at_live_flags_severity ON at_live_flags(severity, is_resolved);
