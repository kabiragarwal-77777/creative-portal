'use strict';

const express = require('express');
const path = require('path');
const { getMetabaseSessionToken } = require('../config/env');

const PORT = parseInt(process.env.PORT || '3005', 10);
const router = require('./server');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api/fe', router({
  metabaseUrl: process.env.METABASE_URL,
  metabaseSessionToken: getMetabaseSessionToken(),
  openaiApiKey: process.env.OPENAI_API_KEY,
}));

app.get('/api/health', (req, res) => {
  res.json({ success: true, status: 'ok' });
});

app.listen(PORT, () => {
  console.log(`Feedback Engine running on port ${PORT}`);
});
