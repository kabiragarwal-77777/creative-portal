const axios = require('axios');

const SUBREDDITS = [
  'IndiaInvestments',
  'IndianStockMarket',
  'DalalStreet',
  'personalfinanceindia',
  'SecurityAnalysis',
  'stocks',
  'investing',
  'options',
  'thetagang',
  'wallstreetbets',
];

function calculateViralScore(post) {
  const ageHours = (Date.now() / 1000 - post.created_utc) / 3600;
  const recencyMultiplier = Math.max(0.1, 1 - (ageHours / 48));
  return Math.round(
    (post.score * post.upvote_ratio * 0.6 + post.num_comments * 2 * 0.4) *
      recencyMultiplier
  );
}

async function scrapeSubreddit(subreddit) {
  const url = `https://www.reddit.com/r/${subreddit}/hot.json?limit=25&t=day`;
  const response = await axios.get(url, {
    headers: { 'User-Agent': 'TrendScanner/1.0 (Univest Marketing Tool)' },
    timeout: 10000,
  });
  const posts = response.data.data.children.map((p) => p.data);
  return posts.map((p) => ({
    source: 'reddit',
    subreddit: p.subreddit,
    title: p.title,
    selftext: p.selftext ? p.selftext.substring(0, 500) : '',
    score: p.score,
    upvote_ratio: p.upvote_ratio,
    num_comments: p.num_comments,
    url: `https://reddit.com${p.permalink}`,
    created_utc: p.created_utc,
    flair: p.link_flair_text || '',
    viral_score: calculateViralScore(p),
  }));
}

async function fetchAllRedditTrends() {
  const results = [];
  for (const sub of SUBREDDITS) {
    try {
      const posts = await scrapeSubreddit(sub);
      results.push(...posts);
      await new Promise((r) => setTimeout(r, 800));
    } catch (e) {
      console.warn(`Reddit: failed to fetch r/${sub}:`, e.message);
    }
  }
  return results.sort((a, b) => b.viral_score - a.viral_score).slice(0, 100);
}

module.exports = { fetchAllRedditTrends };
