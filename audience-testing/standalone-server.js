'use strict';

const express = require('express');
const path = require('path');
const { getMetabaseSessionToken } = require('../config/env');

const PORT = parseInt(process.env.PORT || '3004', 10);
const router = require('./server');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/at', router({
  metaAccessToken: process.env.META_ACCESS_TOKEN,
  metaAdAccountId: process.env.META_AD_ACCOUNT_ID,
  metabaseUrl: process.env.METABASE_URL,
  metabaseSessionToken: getMetabaseSessionToken(),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
}));

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Audience Testing running on port ${PORT}`);
});
