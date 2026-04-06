const fs = require('fs');
const path = require('path');
const CACHE_FILE = path.join(__dirname, 'trend-cache.json');

const cache = {
  raw_trends: null,
  synthesized: null,
  concepts: null,
  last_scraped: null,
  last_synthesized: null,
  last_concepts: null,
  is_scraping: false,
  is_synthesizing: false,
  scan_progress: null,

  get(key) {
    return this[key];
  },
  set(key, value) {
    this[key] = value;
    if (key === 'raw_trends') this.last_scraped = new Date().toISOString();
    if (key === 'synthesized') this.last_synthesized = new Date().toISOString();
    if (key === 'concepts') this.last_concepts = new Date().toISOString();
    this.saveToDisk();
  },
  isStale(key, maxAgeMinutes = 60) {
    const tsMap = {
      raw_trends: 'last_scraped',
      synthesized: 'last_synthesized',
      concepts: 'last_concepts',
    };
    const tsKey = tsMap[key] || 'last_scraped';
    if (!this[tsKey]) return true;
    return Date.now() - new Date(this[tsKey]).getTime() > maxAgeMinutes * 60000;
  },
  saveToDisk() {
    try {
      fs.writeFileSync(
        CACHE_FILE,
        JSON.stringify({
          synthesized: this.synthesized,
          concepts: this.concepts,
          last_scraped: this.last_scraped,
          last_synthesized: this.last_synthesized,
          last_concepts: this.last_concepts,
        })
      );
    } catch (e) {
      // silent — cache is optional
    }
  },
  loadFromDisk() {
    try {
      if (fs.existsSync(CACHE_FILE)) {
        const data = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
        Object.assign(this, data);
      }
    } catch (e) {
      // silent
    }
  },
};

cache.loadFromDisk();
module.exports = cache;
