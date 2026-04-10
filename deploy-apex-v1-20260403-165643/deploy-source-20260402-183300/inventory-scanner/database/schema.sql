CREATE TABLE IF NOT EXISTS inventories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  platform_parent TEXT,
  country TEXT DEFAULT 'IN',
  min_cpm REAL,
  max_cpm REAL,
  pricing_model TEXT,
  estimated_monthly_reach INTEGER,
  target_audience_fit INTEGER DEFAULT 5,
  fintech_friendly INTEGER DEFAULT 1,
  last_verified_date TEXT,
  source_url TEXT,
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS existing_inventories (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL,
  current_monthly_spend REAL,
  current_cpm REAL,
  current_cpc REAL,
  current_ctr REAL,
  current_cpa REAL,
  notes TEXT,
  last_updated TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (inventory_id) REFERENCES inventories(id)
);

CREATE TABLE IF NOT EXISTS competitors (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  vertical TEXT,
  estimated_monthly_adspend REAL,
  primary_channels TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competitor_spends (
  id TEXT PRIMARY KEY,
  competitor_id TEXT NOT NULL,
  inventory_id TEXT NOT NULL,
  estimated_monthly_spend REAL,
  confidence_level TEXT DEFAULT 'medium',
  source TEXT,
  last_updated TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (competitor_id) REFERENCES competitors(id),
  FOREIGN KEY (inventory_id) REFERENCES inventories(id)
);

CREATE TABLE IF NOT EXISTS onboarding_guides (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL,
  step_number INTEGER,
  step_title TEXT,
  step_description TEXT,
  estimated_time TEXT,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact_url TEXT,
  minimum_commitment TEXT,
  documents_required TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (inventory_id) REFERENCES inventories(id)
);

CREATE TABLE IF NOT EXISTS budget_recommendations (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL,
  recommended_starting_budget REAL,
  recommended_testing_budget REAL,
  recommended_scale_budget REAL,
  rationale TEXT,
  data_sources TEXT,
  confidence_score REAL,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (inventory_id) REFERENCES inventories(id)
);

CREATE TABLE IF NOT EXISTS ad_format_scores (
  id TEXT PRIMARY KEY,
  inventory_id TEXT NOT NULL,
  format TEXT,
  score INTEGER,
  reason TEXT,
  best_size_spec TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (inventory_id) REFERENCES inventories(id)
);

CREATE TABLE IF NOT EXISTS discovery_log (
  id TEXT PRIMARY KEY,
  run_date TEXT DEFAULT (datetime('now')),
  inventories_found INTEGER DEFAULT 0,
  new_inventories INTEGER DEFAULT 0,
  updated_inventories INTEGER DEFAULT 0,
  ai_model_used TEXT,
  summary TEXT
);

CREATE TABLE IF NOT EXISTS ai_insights (
  id TEXT PRIMARY KEY,
  inventory_id TEXT,
  insight_type TEXT,
  title TEXT,
  body TEXT,
  priority TEXT DEFAULT 'medium',
  is_read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (inventory_id) REFERENCES inventories(id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  inventory_id TEXT,
  alert_type TEXT,
  threshold_value REAL,
  is_active INTEGER DEFAULT 1,
  last_triggered TEXT,
  FOREIGN KEY (inventory_id) REFERENCES inventories(id)
);

CREATE TABLE IF NOT EXISTS meta_ads (
  id TEXT PRIMARY KEY,
  competitor_id TEXT,
  meta_ad_id TEXT,
  headline TEXT,
  body TEXT,
  platform_list TEXT,
  media_type TEXT,
  spend_min REAL,
  spend_max REAL,
  impressions_min REAL,
  impressions_max REAL,
  start_date TEXT,
  end_date TEXT,
  is_active INTEGER DEFAULT 1,
  run_days INTEGER,
  theme_tag TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (competitor_id) REFERENCES competitors(id)
);

CREATE TABLE IF NOT EXISTS google_ads (
  id TEXT PRIMARY KEY,
  competitor_id TEXT,
  google_ad_id TEXT,
  format TEXT,
  platform TEXT,
  first_shown TEXT,
  last_shown TEXT,
  creative_url TEXT,
  theme_tag TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (competitor_id) REFERENCES competitors(id)
);

CREATE TABLE IF NOT EXISTS youtube_ads (
  id TEXT PRIMARY KEY,
  competitor_id TEXT,
  video_id TEXT,
  title TEXT,
  description TEXT,
  duration_seconds INTEGER,
  view_count INTEGER,
  publish_date TEXT,
  ad_format_guess TEXT,
  theme_tag TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (competitor_id) REFERENCES competitors(id)
);

CREATE TABLE IF NOT EXISTS search_ads (
  id TEXT PRIMARY KEY,
  competitor_id TEXT,
  keyword TEXT,
  headline1 TEXT,
  headline2 TEXT,
  headline3 TEXT,
  description1 TEXT,
  description2 TEXT,
  display_url TEXT,
  position INTEGER,
  captured_date TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (competitor_id) REFERENCES competitors(id)
);

CREATE TABLE IF NOT EXISTS google_advertiser_ids (
  id TEXT PRIMARY KEY,
  competitor_name TEXT,
  advertiser_id TEXT,
  verified INTEGER DEFAULT 0,
  last_checked TEXT
);

CREATE TABLE IF NOT EXISTS seed_status (
  key TEXT PRIMARY KEY,
  value TEXT
);
