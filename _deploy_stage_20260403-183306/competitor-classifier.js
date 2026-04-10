/**
 * competitor-classifier.js
 * Ad Classifier & Tagger for Univest Competitor Intelligence
 *
 * Receives raw ads from competitor-meta-fetcher.js, classifies each ad
 * with structured metadata using keyword matching (fast) + OpenAI fallback (ambiguous).
 */

const OpenAI = require('openai');

// ── Valid enum values ──────────────────────────────────────────────────────────
const THEMES = ['FOMO', 'Social Proof', 'Education', 'Offer/Discount', 'Feature', 'Comparison', 'Trust/SEBI', 'Free Trial', 'Testimonial', 'Celebrity'];
const FORMATS = ['Video', 'Static', 'Carousel', 'Story'];
const HOOK_STYLES = ['Question', 'Stat-led', 'Benefit-led', 'Fear-led', 'Story-led', 'Offer-led'];
const CTA_TYPES = ['App Install', 'Sign Up', 'Free Trial', 'Learn More', 'Call Now', 'Download'];
const AUDIENCE_SIGNALS = ['Beginner', 'Experienced', 'F&O Trader', 'Long-term', 'HNI'];

// ── Keyword matching helpers ───────────────────────────────────────────────────

function lower(str) {
  return (str || '').toLowerCase();
}

function classifyThemeByKeywords(text) {
  const t = lower(text);

  // Order matters — more specific first
  if ((t.includes('₹0') || t.includes('free') || (t.includes('brokerage') && t.includes('zero'))) &&
      !t.includes('free trial')) {
    return 'Offer/Discount';
  }
  if (t.includes('free trial') || t.includes('freetrial') || t.includes('try free') || t.includes('try for free')) {
    return 'Free Trial';
  }
  if (t.includes('limited time') || t.includes('hurry') || t.includes('last chance') ||
      t.includes('expiring') || t.includes('only today') || t.includes('ends soon')) {
    return 'FOMO';
  }
  if ((t.includes('crore') || t.includes('lakh') || t.includes('million')) &&
      (t.includes('user') || t.includes('investor') || t.includes('trader') || t.includes('customer'))) {
    return 'Social Proof';
  }
  if (t.includes('learn') || t.includes('course') || t.includes('varsity') || t.includes('education') ||
      t.includes('webinar') || t.includes('masterclass')) {
    return 'Education';
  }
  if (t.includes('sebi') || t.includes('registered') || t.includes('regulated') || t.includes('trust')) {
    return 'Trust/SEBI';
  }
  if (t.includes('testimonial') || t.includes('review') || t.includes('said') || t.includes('says')) {
    return 'Testimonial';
  }
  if (t.includes('celebrity') || t.includes('brand ambassador') || t.includes('dhoni') ||
      t.includes('sachin') || t.includes('virat') || t.includes('amitabh')) {
    return 'Celebrity';
  }
  if (t.includes(' vs ') || t.includes('versus') || t.includes('compare') || t.includes('comparison') ||
      t.includes('better than') || t.includes('switch from')) {
    return 'Comparison';
  }
  if (t.includes('offer') || t.includes('discount') || t.includes('cashback') || t.includes('coupon') ||
      t.includes('deal') || t.includes('% off')) {
    return 'Offer/Discount';
  }

  return null; // ambiguous — needs AI
}

function classifyHookByKeywords(text) {
  const t = lower(text);
  const firstSentence = (text || '').split(/[.!?\n]/)[0] || '';

  if (firstSentence.includes('?')) {
    return 'Question';
  }
  if (/^\s*\d/.test(firstSentence) || /^\s*\d+%/.test(firstSentence) || /^\s*₹/.test(firstSentence)) {
    return 'Stat-led';
  }
  if (t.includes('limited') || t.includes('hurry') || t.includes('don\'t miss') || t.includes('last chance') ||
      t.includes('fear') || t.includes('risk') || t.includes('lose') || t.includes('missing out')) {
    return 'Fear-led';
  }
  if (t.includes('flat') || t.includes('% off') || t.includes('offer') || t.includes('cashback') ||
      t.includes('₹0') || t.includes('free')) {
    return 'Offer-led';
  }
  const benefitWords = ['earn', 'save', 'grow', 'profit', 'return', 'wealth', 'income', 'gain', 'benefit', 'reward'];
  if ((t.includes('you') || t.includes('your')) && benefitWords.some(w => t.includes(w))) {
    return 'Benefit-led';
  }
  if (t.includes('story') || t.includes('journey') || t.includes('started') || t.includes('when i') ||
      t.includes('once upon') || t.includes('my first')) {
    return 'Story-led';
  }

  return null; // ambiguous
}

function classifyCtaByKeywords(text) {
  const t = lower(text);

  if (t.includes('install') || t.includes('download now') || t.includes('get the app') || t.includes('play store') || t.includes('app store')) {
    return 'App Install';
  }
  if (t.includes('download') || t.includes('get app')) {
    return 'Download';
  }
  if (t.includes('sign up') || t.includes('signup') || t.includes('register') || t.includes('open account') ||
      t.includes('create account') || t.includes('join now') || t.includes('open your')) {
    return 'Sign Up';
  }
  if (t.includes('free trial') || t.includes('try free') || t.includes('start free') || t.includes('try now')) {
    return 'Free Trial';
  }
  if (t.includes('call now') || t.includes('call us') || t.includes('speak to') || t.includes('contact us')) {
    return 'Call Now';
  }
  if (t.includes('learn more') || t.includes('know more') || t.includes('read more') || t.includes('explore')) {
    return 'Learn More';
  }

  return null;
}

function classifyAudienceByKeywords(text) {
  const t = lower(text);

  if (t.includes('f&o') || t.includes('futures') || t.includes('options') || t.includes('derivatives') ||
      t.includes('intraday') || t.includes('nifty') || t.includes('bank nifty') || t.includes('option chain')) {
    return 'F&O Trader';
  }
  if (t.includes('hni') || t.includes('high net') || t.includes('portfolio management') || t.includes('pms') ||
      t.includes('crore') || t.includes('premium')) {
    return 'HNI';
  }
  if (t.includes('beginner') || t.includes('new to') || t.includes('first time') || t.includes('getting started') ||
      t.includes('learn') || t.includes('basics') || t.includes('start investing') || t.includes('new investor')) {
    return 'Beginner';
  }
  if (t.includes('long term') || t.includes('long-term') || t.includes('sip') || t.includes('mutual fund') ||
      t.includes('retirement') || t.includes('wealth creation') || t.includes('compounding')) {
    return 'Long-term';
  }
  if (t.includes('experienced') || t.includes('advanced') || t.includes('pro trader') || t.includes('expert') ||
      t.includes('algo') || t.includes('technical analysis')) {
    return 'Experienced';
  }

  return null;
}

function detectFormat(ad) {
  // Check creative_type or asset types from Meta Ad Library response
  const body = lower(ad.ad_creative_bodies ? ad.ad_creative_bodies.join(' ') : '');
  const linkTitles = ad.ad_creative_link_titles || [];
  const linkCaptions = ad.ad_creative_link_captions || [];

  if (ad.ad_snapshot_url && lower(ad.ad_snapshot_url).includes('video')) return 'Video';
  if (ad.media_type === 'video' || ad.creative_type === 'video') return 'Video';

  // Multiple images/cards = Carousel
  const images = ad.images || ad.ad_creative_images || [];
  if (Array.isArray(images) && images.length > 1) return 'Carousel';
  if (ad.media_type === 'carousel' || ad.creative_type === 'carousel') return 'Carousel';

  // Story format detection
  if (ad.publisher_platforms && ad.publisher_platforms.length === 1 &&
      ad.publisher_platforms[0] === 'instagram' && ad.placement_type === 'story') {
    return 'Story';
  }
  if (ad.media_type === 'story' || ad.creative_type === 'story') return 'Story';

  // Default to Static for single image or unknown
  return 'Static';
}

function computeRunDays(ad) {
  const start = ad.ad_delivery_start_time ? new Date(ad.ad_delivery_start_time) : null;
  if (!start) return 0;

  const end = ad.ad_delivery_stop_time ? new Date(ad.ad_delivery_stop_time) : new Date();
  const diffMs = end.getTime() - start.getTime();
  return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
}

function computeStatus(ad) {
  return ad.ad_delivery_stop_time ? 'Inactive' : 'Active';
}

function extractPlatforms(ad) {
  if (ad.publisher_platforms && Array.isArray(ad.publisher_platforms) && ad.publisher_platforms.length > 0) {
    return ad.publisher_platforms.map(p => lower(p));
  }
  // Default to facebook if unknown
  return ['facebook'];
}

function getAdText(ad) {
  const parts = [];
  if (ad.ad_creative_bodies && Array.isArray(ad.ad_creative_bodies)) {
    parts.push(...ad.ad_creative_bodies);
  } else if (ad.ad_creative_body) {
    parts.push(ad.ad_creative_body);
  }
  if (ad.ad_creative_link_titles && Array.isArray(ad.ad_creative_link_titles)) {
    parts.push(...ad.ad_creative_link_titles);
  }
  if (ad.ad_creative_link_descriptions && Array.isArray(ad.ad_creative_link_descriptions)) {
    parts.push(...ad.ad_creative_link_descriptions);
  }
  if (ad.ad_creative_link_captions && Array.isArray(ad.ad_creative_link_captions)) {
    parts.push(...ad.ad_creative_link_captions);
  }
  return parts.join(' ').trim();
}

// ── AI classification (OpenAI fallback) ────────────────────────────────────────

async function classifyWithAI(openai, adText, missing) {
  const fieldDescriptions = [];
  if (missing.includes('theme')) fieldDescriptions.push(`theme (one of: ${THEMES.join(', ')})`);
  if (missing.includes('hook_style')) fieldDescriptions.push(`hook_style (one of: ${HOOK_STYLES.join(', ')})`);
  if (missing.includes('cta_type')) fieldDescriptions.push(`cta_type (one of: ${CTA_TYPES.join(', ')})`);
  if (missing.includes('audience_signal')) fieldDescriptions.push(`audience_signal (one of: ${AUDIENCE_SIGNALS.join(', ')})`);

  const prompt = `You are a fintech ad analyst. Given this Indian fintech ad copy: "${adText}", classify it into exactly one value for each: ${fieldDescriptions.join('; ')}. Return only valid JSON, no preamble.`;

  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-5.4-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_completion_tokens: 200,
      response_format: { type: 'json_object' },
    });

    const content = completion.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    return parsed;
  } catch (err) {
    console.error('[classifier] OpenAI error:', err.message);
    return {};
  }
}

// Process AI calls in batches of maxConcurrent
async function batchAIClassify(openai, items, maxConcurrent = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += maxConcurrent) {
    const batch = items.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(
      batch.map(item => classifyWithAI(openai, item.text, item.missing))
    );
    results.push(...batchResults);
  }
  return results;
}

// ── Validate that AI-returned values are within allowed enums ──────────────────

function validateEnum(value, allowed, fallback) {
  if (!value) return fallback;
  // Try exact match
  if (allowed.includes(value)) return value;
  // Try case-insensitive match
  const match = allowed.find(a => a.toLowerCase() === value.toLowerCase());
  return match || fallback;
}

// ── Main factory ───────────────────────────────────────────────────────────────

module.exports = function (config) {
  const { openaiApiKey } = config || {};
  let openai = null;
  if (openaiApiKey) {
    openai = new OpenAI({ apiKey: openaiApiKey });
  }

  // In-memory cache: ad id → classified ad object
  const cache = new Map();

  /**
   * Classify a single ad synchronously (keyword only). Returns the classification
   * object plus a list of fields that still need AI.
   */
  function keywordClassify(ad) {
    const text = getAdText(ad);
    const status = computeStatus(ad);
    const runDays = computeRunDays(ad);

    const theme = classifyThemeByKeywords(text);
    const hookStyle = classifyHookByKeywords(text);
    const ctaType = classifyCtaByKeywords(text);
    const audienceSignal = classifyAudienceByKeywords(text);

    const missing = [];
    if (!theme) missing.push('theme');
    if (!hookStyle) missing.push('hook_style');
    if (!ctaType) missing.push('cta_type');
    if (!audienceSignal) missing.push('audience_signal');

    return {
      classification: {
        theme: theme || null,
        format: detectFormat(ad),
        hook_style: hookStyle || null,
        cta_type: ctaType || null,
        audience_signal: audienceSignal || null,
        run_days: runDays,
        status,
        is_evergreen: runDays >= 30 && status === 'Active',
        platform: extractPlatforms(ad),
      },
      missing,
      text,
    };
  }

  /**
   * classifyAds(rawAds) — classify an array of raw ad objects.
   * Returns array of ads with `.classification` attached.
   */
  async function classifyAds(rawAds) {
    if (!Array.isArray(rawAds) || rawAds.length === 0) return [];

    // Phase 1: keyword classification for all
    const intermediate = rawAds.map(ad => {
      const adId = ad.id || ad.ad_archive_id || ad.adlib_id || `ad_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const { classification, missing, text } = keywordClassify(ad);
      return { ad, adId, classification, missing, text };
    });

    // Phase 2: collect ads that need AI help
    const needAI = intermediate.filter(item => item.missing.length > 0 && item.text.length > 10);

    if (needAI.length > 0 && openai) {
      const aiInputs = needAI.map(item => ({ text: item.text, missing: item.missing }));
      const aiResults = await batchAIClassify(openai, aiInputs);

      needAI.forEach((item, idx) => {
        const aiResult = aiResults[idx] || {};
        if (item.missing.includes('theme') && aiResult.theme) {
          item.classification.theme = validateEnum(aiResult.theme, THEMES, 'Feature');
        }
        if (item.missing.includes('hook_style') && aiResult.hook_style) {
          item.classification.hook_style = validateEnum(aiResult.hook_style, HOOK_STYLES, 'Benefit-led');
        }
        if (item.missing.includes('cta_type') && aiResult.cta_type) {
          item.classification.cta_type = validateEnum(aiResult.cta_type, CTA_TYPES, 'Learn More');
        }
        if (item.missing.includes('audience_signal') && aiResult.audience_signal) {
          item.classification.audience_signal = validateEnum(aiResult.audience_signal, AUDIENCE_SIGNALS, 'Beginner');
        }
      });
    }

    // Phase 3: fill any remaining nulls with safe defaults
    const results = intermediate.map(item => {
      const c = item.classification;
      if (!c.theme) c.theme = 'Feature';
      if (!c.hook_style) c.hook_style = 'Benefit-led';
      if (!c.cta_type) c.cta_type = 'Learn More';
      if (!c.audience_signal) c.audience_signal = 'Beginner';

      const classified = {
        ...item.ad,
        theme: c.theme,
        format: c.format,
        hook_style: c.hook_style,
        cta_type: c.cta_type,
        audience_signal: c.audience_signal,
        run_days: c.run_days,
        status: c.status,
        is_evergreen: c.is_evergreen,
        platform: c.platform,
        classification: c
      };
      cache.set(item.adId, classified);
      return classified;
    });

    return results;
  }

  /**
   * classifyNewAds(rawAds) — incremental: only classify ads not already in cache.
   */
  async function classifyNewAds(rawAds) {
    if (!Array.isArray(rawAds) || rawAds.length === 0) return [];

    const newAds = rawAds.filter(ad => {
      const adId = ad.id || ad.ad_archive_id || ad.adlib_id;
      return adId && !cache.has(adId);
    });

    if (newAds.length === 0) return getCachedAds();

    const freshlyClassified = await classifyAds(newAds);
    console.log(`[classifier] Classified ${freshlyClassified.length} new ads (${rawAds.length - newAds.length} already cached)`);
    return getCachedAds();
  }

  /**
   * Return all cached ads as an array.
   */
  function getCachedAds() {
    return Array.from(cache.values());
  }

  /**
   * getClassifiedAds(filters) — return classified ads with optional filtering.
   * filters: { vertical, competitor, theme, format, status, days }
   */
  function getClassifiedAds(filters) {
    let ads = getCachedAds();

    if (!filters || typeof filters !== 'object') return ads;

    if (filters.vertical) {
      const v = lower(filters.vertical);
      ads = ads.filter(a => lower(a.vertical || a.category || '') === v);
    }

    if (filters.competitor) {
      const c = lower(filters.competitor);
      ads = ads.filter(a => {
        const name = lower(a.page_name || a.advertiser_name || a.competitor || '');
        return name.includes(c);
      });
    }

    if (filters.theme) {
      const th = lower(filters.theme);
      ads = ads.filter(a => a.classification && lower(a.classification.theme) === th);
    }

    if (filters.format) {
      const f = lower(filters.format);
      ads = ads.filter(a => a.classification && lower(a.classification.format) === f);
    }

    if (filters.status) {
      const s = lower(filters.status);
      ads = ads.filter(a => a.classification && lower(a.classification.status) === s);
    }

    if (filters.days && typeof filters.days === 'number') {
      ads = ads.filter(a => a.classification && a.classification.run_days >= filters.days);
    }

    return ads;
  }

  return { classifyAds, getClassifiedAds, classifyNewAds };
};
