'use strict';

const express = require('express');
let cors;
try { cors = require('cors'); } catch (e) { cors = require('../intelligence/node_modules/cors'); }
const path = require('path');
const routes = require('./routes');
const { getCiDb } = require('./db');
const { getMetabaseSessionToken } = require('../config/env');

const app = express();
const PORT = parseInt(process.env.PORT || '3007', 10);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/ci2', routes({
  metaApiBase: process.env.META_API_BASE,
  metaAdAccountId: process.env.META_AD_ACCOUNT_ID,
  metaAccessToken: process.env.META_ACCESS_TOKEN,
  metaAppSecretProof: process.env.META_APP_SECRET_PROOF,
  metabaseUrl: process.env.METABASE_URL || 'https://analytics.univest.in',
  metabaseSessionToken: getMetabaseSessionToken(),
  openaiApiKey: process.env.OPENAI_API_KEY,
  targetCampaigns: []
}));

app.get('/api/health', (req, res) => {
  try {
    const db = getCiDb();
    const pipelineRun = db.prepare('SELECT 1 AS ok').get();
    res.json({ success: true, status: 'ok', data: { db: !!pipelineRun } });
  } catch (err) {
    res.status(500).json({ success: false, status: 'error', error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Creative Intelligence running on port ${PORT}`);
});
