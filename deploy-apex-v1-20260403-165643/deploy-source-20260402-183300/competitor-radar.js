const OpenAI = require('openai');

module.exports = function(config) {
  const openai = new OpenAI({ apiKey: config.openaiApiKey });

  let cachedRadar = null;
  let lastGeneratedAt = null;

  const SYSTEM_PROMPT = `You are a performance marketing director at Univest, an Indian fintech company in stock market advisory and broking. You are analyzing competitor ad data to find actionable opportunities for Univest's ad team.

Given competitor trend data: {trends_json}

Generate 5-8 insight cards. Each card must be:
- Grounded in the actual data (no hallucinations)
- Specific to Indian fintech context (mention SEBI, ₹ amounts, market sentiment where relevant)
- Actionable in 48 hours by a creative/media team

Return ONLY valid JSON array, no preamble:
[{
  "title": "short punchy title",
  "observation": "what the data shows (1-2 sentences)",
  "why_it_matters": "why Univest should care",
  "action": "specific action for Univest creative or media team",
  "priority": "HIGH | MEDIUM | LOW",
  "effort": "Quick Win | Medium | Strategic",
  "vertical": "RA | Broking | Both"
}]`;

  function parseJsonResponse(text) {
    // Strip markdown code fences if present
    let cleaned = text.trim();
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();
    return JSON.parse(cleaned);
  }

  async function generateRadar() {
    let trends;
    try {
      trends = config.getTrends();
    } catch (err) {
      console.error('[competitor-radar] Failed to get trends:', err.message);
      if (cachedRadar) {
        return { insights: cachedRadar, generatedAt: lastGeneratedAt, stale: true, error: 'Failed to fetch trend data' };
      }
      return { insights: [], generatedAt: null, stale: false, error: 'No trend data available' };
    }

    const trendsJson = JSON.stringify(trends, null, 2);
    const prompt = SYSTEM_PROMPT.replace('{trends_json}', trendsJson);

    try {
      const response = await openai.chat.completions.create({
        model: 'gpt-5.4-mini',
        messages: [
          { role: 'system', content: prompt },
          { role: 'user', content: 'Analyze the competitor trend data and generate insight cards.' }
        ],
        temperature: 0.7,
        max_completion_tokens: 2000
      });

      const content = response.choices[0].message.content;
      const insights = parseJsonResponse(content);

      if (!Array.isArray(insights)) {
        throw new Error('OpenAI response did not parse to an array');
      }

      // Validate each card has required fields
      const validInsights = insights.filter(card => {
        return card.title && card.observation && card.why_it_matters && card.action && card.priority && card.effort && card.vertical;
      });

      cachedRadar = validInsights;
      lastGeneratedAt = new Date().toISOString();

      return { insights: cachedRadar, generatedAt: lastGeneratedAt, stale: false };

    } catch (err) {
      console.error('[competitor-radar] OpenAI API error:', err.message);
      if (cachedRadar) {
        return { insights: cachedRadar, generatedAt: lastGeneratedAt, stale: true, error: err.message };
      }
      return { insights: [], generatedAt: null, stale: false, error: err.message };
    }
  }

  async function getRadar() {
    if (cachedRadar && cachedRadar.length > 0) {
      return { insights: cachedRadar, generatedAt: lastGeneratedAt, stale: false };
    }
    return generateRadar();
  }

  return { generateRadar, getRadar };
};
