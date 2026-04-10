let OpenAI;
try { OpenAI = require('openai').OpenAI; } catch (e) { /* openai not installed */ }

async function synthesizeTrends(allRawData) {
  if (!OpenAI) throw new Error('OpenAI SDK not installed. Run: npm install openai');
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  const compacted = {
    reddit_top: (allRawData.reddit || [])
      .sort((a, b) => b.viral_score - a.viral_score)
      .slice(0, 40)
      .map((p) => ({ title: p.title, score: p.viral_score, sub: p.subreddit, comments: p.num_comments })),

    youtube_top: (allRawData.youtube || [])
      .slice(0, 25)
      .map((v) => ({ title: v.title, channel: v.channel, published: v.published })),

    news_headlines: (allRawData.news || [])
      .sort((a, b) => (b.univest_relevance || 0) - (a.univest_relevance || 0))
      .slice(0, 35)
      .map((n) => ({ title: n.title, source: n.source_name, age_hours: n.age_hours, sentiment: n.sentiment, category: n.category })),

    twitter_trends: (allRawData.twitter_trends || [])
      .slice(0, 20)
      .map((t) => ({ topic: t.topic || t.text, rank: t.rank, engagement: t.engagement })),

    google_trends: (allRawData.google_trends || [])
      .slice(0, 15)
      .map((g) => ({ topic: g.topic, traffic: g.traffic })),

    india_finance: {
      moneycontrol: (allRawData.india_finance?.moneycontrol || []).slice(0, 10).map(a => ({ title: a.title })),
      et_markets: (allRawData.india_finance?.et_markets || []).slice(0, 10).map(a => ({ title: a.title })),
      nse_trending_stocks: (allRawData.india_finance?.nse_active || [])
        .filter((s) => s.is_trending)
        .slice(0, 10)
        .map((s) => ({ symbol: s.symbol, change_pct: s.change_pct, volume: s.volume })),
    },
  };

  const systemPrompt = `You are a content strategist and trend analyst for Univest,
an Indian fintech company that sells:
1. Research Advisory (RA) subscriptions — stock tips, options strategies, advisory plans (₹999-₹2,999/month)
2. Demat/Trading accounts — discount brokerage, app-based trading

TARGET AUDIENCE: Indian retail investors, 25-45 years, Android-heavy, Tier 1-2 cities,
interested in stock market, options trading, making money from markets.

UNIVEST BRAND TONE: Confident, data-driven, trustworthy, aspirational but realistic.
Not flashy or fake-returns-based. SEBI registered. Educational but actionable.
Colors: Deep purple (#6c5ce7) as primary, teal (#00d4aa) as accent, dark backgrounds.

YOUR JOB: Analyze all social signal data and identify the top trending topics
that Univest can turn into high-performing Meta ads RIGHT NOW.

For each trend, you must assess:
1. Is this something Univest can authentically speak about?
2. What emotional hook does this create for retail investors?
3. Is this a static ad opportunity or video opportunity or both?
4. What's the urgency level — will this trend last 3 days, 1 week, 1 month?`;

  const userPrompt = `Here is the current trend data from across Indian finance social media:

${JSON.stringify(compacted, null, 2)}

MANDATORY: You MUST return EXACTLY 12 items in top_trends, EXACTLY 5 items in emerging_topics, and EXACTLY 3 items in avoid_topics. No fewer. If you cannot find 12 distinct high-signal trends, include medium and low signal ones too — a complete scan is more valuable than a short one. Group related signals from different platforms into single trends.

Each trend description must be specific and detailed (3-4 sentences minimum) — reference actual post titles, video names, or headlines from the data above. The univest_angle must contain a concrete ad idea, not a generic statement.

Return this exact JSON structure:
{
  "scan_timestamp": "ISO datetime",
  "market_mood": "bullish|bearish|volatile|sideways",
  "market_mood_reason": "2-3 sentences explaining the overall market mood based on the data — cite specific signals",

  "top_trends": [
    {
      "trend_id": "T001",
      "rank": 1,
      "topic": "Short, catchy trend name (5-8 words max)",
      "description": "3-4 sentences: What is trending, where is it trending (which platforms), why it matters to Indian retail investors RIGHT NOW, and how viral/urgent it is",
      "sources": ["reddit", "youtube", "news"],
      "signal_strength": "HIGH|MEDIUM|LOW",
      "trend_longevity": "3_days|1_week|2_weeks|1_month",
      "univest_angle": "2-3 sentences: Exactly how Univest should position against this trend. What specific product/feature to highlight. What claim to make. What proof point to use.",
      "audience_emotion": "fear|greed|aspiration|curiosity|urgency|trust",
      "ad_opportunity": "static|video|both",
      "urgency": "run_today|run_this_week|plan_ahead",
      "hook_ideas": ["3 specific hook lines that could open an ad about this trend"],
      "supporting_data": {
        "reddit_posts": ["exact title from data above", "exact title from data above"],
        "youtube_content": "exact video title or channel from data above",
        "news_headline": "exact headline from data above"
      }
    }
  ],

  "emerging_topics": [
    {
      "topic": "topic name",
      "why_watch": "2 sentences: why this could blow up in next 48-72 hours",
      "signal": "the specific data point from above that suggests this is emerging",
      "suggested_action": "what Univest should prepare now"
    }
  ],

  "avoid_topics": [
    {
      "topic": "topic name",
      "reason": "why Univest should avoid — regulatory risk, brand mismatch, or negative sentiment"
    }
  ]
}

CRITICAL: Return exactly 12 top_trends, 5 emerging_topics, 3 avoid_topics. Valid JSON only.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    max_completion_tokens: 8000,
    response_format: { type: 'json_object' },
  });

  const result = JSON.parse(response.choices[0].message.content);
  // Enforce minimum trend count IDs
  (result.top_trends || []).forEach((t, i) => {
    t.trend_id = t.trend_id || `T${String(i + 1).padStart(3, '0')}`;
    t.rank = t.rank || i + 1;
  });
  return result;
}

module.exports = { synthesizeTrends };
