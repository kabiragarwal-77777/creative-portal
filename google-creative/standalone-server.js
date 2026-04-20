'use strict';

const express = require('express');
const path = require('path');
const { getMetabaseSessionToken } = require('../config/env');

const PORT = parseInt(process.env.PORT || '3003', 10);
const router = require('./server');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/gc', router({
  googleAdsConfig: process.env,
  metabaseUrl: process.env.METABASE_URL,
  metabaseSessionToken: getMetabaseSessionToken(),
  openaiApiKey: process.env.OPENAI_API_KEY,
  googleAdsDeveloperToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN,
  googleAdsClientId: process.env.GOOGLE_ADS_CLIENT_ID,
  googleAdsClientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET,
  googleAdsRefreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN,
  googleAdsCustomerId: process.env.GOOGLE_ADS_CUSTOMER_ID,
  googleAdsLoginCustomerId: process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
}));

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Google Creative running on port ${PORT}`);
});
