'use strict';

const express = require('express');
let cors;
try { cors = require('cors'); } catch (e) { cors = require('../intelligence/node_modules/cors'); }
const path = require('path');
const routes = require('./routes');
const cache = require('./cache');

const app = express();
const PORT = parseInt(process.env.PORT || '3006', 10);

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '..')));
app.use('/api/trends', routes);

app.get('/api/health', (req, res) => {
  res.json({
    success: true,
    status: 'ok',
    data: {
      hasRaw: !!cache.raw_trends,
      hasSynthesized: !!cache.synthesized,
      hasConcepts: !!cache.concepts
    }
  });
});

app.listen(PORT, () => {
  console.log(`Trend Scanner running on port ${PORT}`);
});
