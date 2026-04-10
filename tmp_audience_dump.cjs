const Database = require('./node_modules/better-sqlite3');

const db = new Database('audience-testing/audience-testing.db', { readonly: true });

const metaRows = db.prepare(`
  SELECT a.name AS audience_name, a.adset_name, a.total_spend, mc.name AS campaign_name, mc.vertical, mc.objective
  FROM at_meta_adsets a
  LEFT JOIN at_meta_campaigns mc ON mc.meta_campaign_id = a.meta_campaign_id
  WHERE a.total_spend >= 20000
  ORDER BY a.total_spend DESC
  LIMIT 50
`).all();

const googleRows = db.prepare(`
  SELECT ag.name AS audience_name, ag.adgroup_name, ag.total_spend, gc.name AS campaign_name, gc.vertical, gc.channel_type
  FROM at_google_adgroups ag
  LEFT JOIN at_google_campaigns gc ON gc.google_campaign_id = ag.google_campaign_id
  WHERE ag.total_spend >= 20000
  ORDER BY ag.total_spend DESC
  LIMIT 50
`).all();

console.log(JSON.stringify({ metaRows, googleRows }, null, 2));
