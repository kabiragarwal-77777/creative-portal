-- Google Creative Intelligence Schema
-- All tables prefixed gc_ to avoid collision with ci- Meta layer

CREATE TABLE IF NOT EXISTS gc_adset_performance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    campaign_id TEXT,
    campaign_name TEXT,
    adgroup_id TEXT,
    adgroup_name TEXT,
    date TEXT,
    spend REAL DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    conversions REAL DEFAULT 0,
    conversion_value REAL DEFAULT 0,
    roas REAL DEFAULT 0,
    ctr REAL DEFAULT 0,
    cpc REAL DEFAULT 0,
    cpa REAL DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gc_ads_raw (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad_id TEXT UNIQUE,
    campaign_id TEXT,
    adgroup_id TEXT,
    ad_type TEXT, -- RSA, VIDEO, DISPLAY, PMAX
    headlines_json TEXT,
    descriptions_json TEXT,
    image_url TEXT,
    youtube_video_id TEXT,
    video_title TEXT,
    video_thumbnail_url TEXT,
    asset_performance_label TEXT, -- BEST, GOOD, LOW, LEARNING
    ad_status TEXT,
    final_url TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gc_creatives (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad_id TEXT,
    campaign_id TEXT,
    campaign_name TEXT,
    adgroup_id TEXT,
    adgroup_name TEXT,
    ad_type TEXT,
    creative_content_json TEXT,
    asset_performance_label TEXT,
    adset_roas REAL DEFAULT 0,
    adset_spend REAL DEFAULT 0,
    adset_conversions REAL DEFAULT 0,
    adset_ctr REAL DEFAULT 0,
    merged_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gc_creative_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creative_id INTEGER,
    ad_id TEXT,
    ad_type TEXT,
    signals_json TEXT,
    classified_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (creative_id) REFERENCES gc_creatives(id)
);

CREATE TABLE IF NOT EXISTS gc_creative_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    creative_id INTEGER,
    ad_id TEXT,
    ad_type TEXT,
    gcps_score REAL DEFAULT 0,
    asset_label_score REAL DEFAULT 0,
    roas_normalized REAL DEFAULT 0,
    ctr_normalized REAL DEFAULT 0,
    cpa_efficiency REAL DEFAULT 0,
    score_breakdown_json TEXT,
    correlation_report_json TEXT,
    scored_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (creative_id) REFERENCES gc_creatives(id)
);

CREATE TABLE IF NOT EXISTS gc_market_signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    nifty_50 REAL,
    vix REAL,
    dxy REAL,
    market_sentiment TEXT,
    google_roas_correlation REAL,
    signals_json TEXT,
    created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gc_simulations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ad_type TEXT,
    creative_input_json TEXT,
    signals_json TEXT,
    similar_creatives_json TEXT,
    predicted_d7_roas REAL, predicted_d7_low REAL, predicted_d7_high REAL,
    predicted_d30_roas REAL, predicted_d30_low REAL, predicted_d30_high REAL,
    predicted_d60_roas REAL, predicted_d60_low REAL, predicted_d60_high REAL,
    predicted_d120_roas REAL, predicted_d120_low REAL, predicted_d120_high REAL,
    predicted_d365_roas REAL, predicted_d365_low REAL, predicted_d365_high REAL,
    campaign_id TEXT,
    adgroup_id TEXT,
    budget_per_day REAL,
    status TEXT DEFAULT 'active',
    raw_response TEXT,
    simulated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gc_forecast_timeseries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    simulation_id INTEGER,
    date TEXT,
    spend REAL DEFAULT 0,
    conversions REAL DEFAULT 0,
    conversion_value REAL DEFAULT 0,
    actual_roas REAL DEFAULT 0,
    predicted_roas REAL DEFAULT 0,
    prediction_version INTEGER DEFAULT 1,
    day_number INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (simulation_id) REFERENCES gc_simulations(id)
);

CREATE TABLE IF NOT EXISTS gc_forecast_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    simulation_id INTEGER,
    alert_type TEXT,
    message TEXT,
    severity TEXT,
    is_read INTEGER DEFAULT 0,
    triggered_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (simulation_id) REFERENCES gc_simulations(id)
);

CREATE TABLE IF NOT EXISTS gc_recommendations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    brief_type TEXT, -- rsa, video, pmax
    briefs_json TEXT,
    generated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS gc_pipeline_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    run_type TEXT,
    status TEXT DEFAULT 'running',
    started_at TEXT DEFAULT (datetime('now')),
    completed_at TEXT,
    details TEXT
);

CREATE INDEX IF NOT EXISTS idx_gc_adset_perf_campaign ON gc_adset_performance(campaign_id);
CREATE INDEX IF NOT EXISTS idx_gc_adset_perf_date ON gc_adset_performance(date);
CREATE INDEX IF NOT EXISTS idx_gc_ads_raw_ad_id ON gc_ads_raw(ad_id);
CREATE INDEX IF NOT EXISTS idx_gc_creatives_ad_id ON gc_creatives(ad_id);
CREATE INDEX IF NOT EXISTS idx_gc_creatives_type ON gc_creatives(ad_type);
CREATE INDEX IF NOT EXISTS idx_gc_scores_creative ON gc_creative_scores(creative_id);
CREATE INDEX IF NOT EXISTS idx_gc_simulations_status ON gc_simulations(status);
CREATE INDEX IF NOT EXISTS idx_gc_forecast_sim ON gc_forecast_timeseries(simulation_id);
