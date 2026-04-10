const axios = require('axios');
const RSSParser = require('rss-parser');

const CHANNEL_FEEDS = [
  { name: 'Pranjal Kamra', id: 'UCwAdQUuBfJ37DSrjBiGLDEg' },
  { name: 'Akshat Shrivastava', id: 'UCqW8jxh4tH1Z1sWPbkGWL4g' },
  { name: 'CA Rachana Phadke', id: 'UCsvqVGtbbyHaMoevxPAq9Fg' },
  { name: 'Shankar Nath', id: 'UCylOHcTH2lGFPWa11k4ZOEA' },
  { name: 'Groww', id: 'UCabowmOIKdKS2Y-QmUbkvLg' },
  { name: 'Zerodha Varsity', id: 'UCMGhMiYHqiudHHMNXGFPYPQ' },
  { name: 'FinnovationZ', id: 'UCXT4PBjAhSXlTn30M6k1XJA' },
  { name: 'Asset Yogi', id: 'UCkqbZvS-x4BbzF0TWF_PTXQ' },
];

const FINANCE_KEYWORDS_IN = [
  'stock market india today',
  'nifty banknifty analysis',
  'options trading strategy',
  'sensex nifty tomorrow',
  'best stocks to buy india',
  'multibagger stocks 2025',
  'zerodha groww comparison',
  'demat account india',
  'mutual fund vs stock',
  'trading psychology hindi',
  'technical analysis india',
  'f&o trading strategy',
];

async function fetchYouTubeRSS() {
  const parser = new RSSParser();
  const results = [];

  for (const channel of CHANNEL_FEEDS) {
    try {
      const feed = await parser.parseURL(
        `https://www.youtube.com/feeds/videos.xml?channel_id=${channel.id}`
      );
      const recent = feed.items.slice(0, 5).map((item) => ({
        source: 'youtube',
        channel: channel.name,
        title: item.title,
        url: item.link,
        video_id: item.id?.split(':').pop(),
        published: item.pubDate,
        description_snippet: item.contentSnippet?.substring(0, 300) || '',
        viral_score: 0,
        is_shorts: false,
      }));
      results.push(...recent);
      await new Promise((r) => setTimeout(r, 500));
    } catch (e) {
      console.warn(`YouTube RSS: failed for ${channel.name}:`, e.message);
    }
  }
  return results;
}

async function fetchYouTubeAPI() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) return [];

  const results = [];
  const keywords = FINANCE_KEYWORDS_IN.slice(0, 5);
  const publishedAfter = new Date(Date.now() - 48 * 3600000).toISOString();

  for (const q of keywords) {
    try {
      const response = await axios.get(
        'https://www.googleapis.com/youtube/v3/search',
        {
          params: {
            part: 'snippet',
            q,
            type: 'video',
            regionCode: 'IN',
            order: 'viewCount',
            publishedAfter,
            maxResults: 10,
            key: apiKey,
          },
          timeout: 10000,
        }
      );
      const videos = response.data.items.map((item) => ({
        source: 'youtube',
        channel: item.snippet.channelTitle,
        title: item.snippet.title,
        url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
        video_id: item.id.videoId,
        published: item.snippet.publishedAt,
        description_snippet: item.snippet.description?.substring(0, 300) || '',
        thumbnail: item.snippet.thumbnails?.high?.url || '',
        viral_score: 0,
        is_shorts: false,
      }));
      results.push(...videos);
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      console.warn(`YouTube API: failed for "${q}":`, e.message);
    }
  }
  return results;
}

async function fetchYouTubeTrends() {
  const [rssResults, apiResults] = await Promise.allSettled([
    fetchYouTubeRSS(),
    fetchYouTubeAPI(),
  ]);

  const all = [
    ...(rssResults.status === 'fulfilled' ? rssResults.value : []),
    ...(apiResults.status === 'fulfilled' ? apiResults.value : []),
  ];

  // Deduplicate by video_id
  const seen = new Set();
  return all.filter((v) => {
    if (!v.video_id || seen.has(v.video_id)) return false;
    seen.add(v.video_id);
    return true;
  });
}

module.exports = { fetchYouTubeTrends };
